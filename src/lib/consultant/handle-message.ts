import type { ZernioPlatform } from "@/lib/zernio-platform";
import type { ZernioWebhookMessagePayload } from "@/lib/zernio.server";
import { sendDirectReply } from "@/lib/direct-purchase.server";
import { runConsultantClaude } from "./claude";
import { getConsultantShopUrl, loadConsultantCatalog, searchProducts } from "./catalog";
import {
  COUNTRY_BUTTONS,
  copyForBucket,
  formatProductReply,
  type ConsultantCopyPack,
} from "./copy";
import { looksLikePromptInjection } from "./injection";
import {
  looksLikeProductQuery,
  matchCatalogIntent,
  matchCountry,
  matchCountryPostback,
  matchOtherCategoriesIntent,
  matchPurchaseIntent,
} from "./intent";
import { consultantRequestId, logConsultantEvent } from "./log";
import { getStoredVtbRate, priceRub } from "./rate";
import {
  appendRecent,
  isAutomationPaused,
  isBotEcho,
  loadConsultantState,
  patchConsultantState,
  pauseConsultant,
  type ConsultantState,
} from "./state";
import { validateConsultantReply } from "./validate";
import { bucketForUser, getForcedAbBucket } from "./ab";
import { recordConsultantEvent } from "./analytics";
import { addConsultantTask } from "./tasks";
import { notifyConsultantHandoff } from "./notify";

export type ConsultantReply = {
  text: string;
  patch: Partial<ConsultantState>;
  buttons?: { type: "postback"; title: string; payload: string }[];
  kind:
    | "country"
    | "product"
    | "oos"
    | "purchase"
    | "handoff"
    | "catalog"
    | "clarify"
    | "error"
    | "injection";
};

export async function handleConsultantZernioEvent(params: {
  payload: ZernioWebhookMessagePayload;
  conversationId: string;
  accountId: string;
  userKey: string;
  text: string;
  platform: ZernioPlatform;
  postback?: string | null;
}): Promise<void> {
  const requestId = consultantRequestId();
  const started = Date.now();
  const direction = params.payload.message?.direction;
  const { consultant } = await loadConsultantState(params.userKey);

  if (direction === "outgoing") {
    if (isBotEcho(consultant, params.text)) return;
    if (params.text.trim()) {
      await pauseConsultant(params.userKey, "manager_intervention");
      logConsultantEvent(requestId, "paused", {
        userKey: params.userKey,
        reason: "manager_intervention",
      });
    }
    return;
  }

  if (isAutomationPaused(consultant)) {
    logConsultantEvent(requestId, "skipped_paused", {
      userKey: params.userKey,
      reason: consultant.pause_reason,
    });
    return;
  }

  const text = params.text.trim() || params.postback?.trim() || "";
  if (!text && !params.postback) return;

  const reply = await decideConsultantReply(text, consultant, {
    userKey: params.userKey,
    postback: params.postback,
    requestId,
  });
  if (!reply) return;

  const sent = await sendDirectReply({
    conversationId: params.conversationId,
    accountId: params.accountId,
    userKey: params.userKey,
    text: reply.text,
    buttons: reply.buttons,
    platform: params.platform,
    force: true,
  });
  if (!sent) return;

  await patchConsultantState(params.userKey, {
    ...reply.patch,
    last_bot_reply: reply.text,
    last_bot_reply_at: new Date().toISOString(),
    recent: appendRecent(consultant, text, reply.text),
  });

  logConsultantEvent(requestId, "replied", {
    userKey: params.userKey,
    kind: reply.kind,
    latencyMs: Date.now() - started,
    tools: reply.patch.last_product_ids?.length ?? 0,
  });
}

export async function decideConsultantReply(
  text: string,
  state: ConsultantState,
  ctx: { userKey?: string; postback?: string | null; requestId?: string } = {},
): Promise<ConsultantReply | null> {
  let bucket = state.ab_bucket ?? "a";
  if (ctx.userKey) {
    try {
      const forced = await getForcedAbBucket();
      bucket = state.ab_bucket ?? bucketForUser(ctx.userKey, forced);
    } catch {
      bucket = state.ab_bucket ?? "a";
    }
  }
  const pack = copyForBucket(bucket);
  const shopUrl = await getShopUrlSafe();

  if (looksLikePromptInjection(text)) {
    await track(ctx.userKey, "injection", text, bucket);
    return handoffReply(pack, state, bucket, "injection", text, ctx.userKey);
  }

  if (matchPurchaseIntent(text)) {
    await track(ctx.userKey, "purchase", text, bucket);
    return handoffReply(pack, state, bucket, "purchase", text, ctx.userKey, pack.purchase);
  }

  const country =
    matchCountryPostback(ctx.postback) ?? matchCountry(text) ?? state.country ?? undefined;

  if (!country) {
    return {
      text: pack.askCountry,
      buttons: COUNTRY_BUTTONS,
      patch: { conversation_state: "awaiting_country", ab_bucket: bucket },
      kind: "country",
    };
  }

  const countryPatch: Partial<ConsultantState> = {
    country,
    ab_bucket: bucket,
    conversation_state: "consulting",
  };

  const justCountry =
    Boolean(matchCountryPostback(ctx.postback) ?? matchCountry(text)) &&
    !looksLikeProductQuery(text) &&
    !matchCatalogIntent(text) &&
    !matchOtherCategoriesIntent(text);

  if (justCountry) {
    await track(ctx.userKey, "country", text, bucket);
    return {
      text: pack.askProduct,
      patch: { ...countryPatch, conversation_state: "awaiting_product" },
      kind: "clarify",
    };
  }

  if (matchCatalogIntent(text)) {
    await track(ctx.userKey, "catalog", text, bucket);
    return {
      text: pack.catalogLink(shopUrl),
      patch: countryPatch,
      kind: "catalog",
    };
  }

  if (matchOtherCategoriesIntent(text) && !looksLikeProductQuery(text)) {
    return { text: pack.otherCategories, patch: countryPatch, kind: "clarify" };
  }

  const catalog = await loadConsultantCatalog();
  if (catalog.length === 0) {
    await track(ctx.userKey, "error", "catalog_empty", bucket);
    return handoffReply(pack, { ...state, ...countryPatch }, bucket, "other", text, ctx.userKey);
  }

  try {
    const ai = await runConsultantClaude({
      text,
      state: { ...state, ...countryPatch },
      catalog,
      shopUrl,
      forceTools: looksLikeProductQuery(text) || matchCatalogIntent(text),
    });
    if (ai.usage) {
      const { recordConsultantLifetime } = await import("@/lib/ai-usage.server");
      await recordConsultantLifetime(ai.usage);
    }

    if (ai.error === "no_api_key") {
      return fallbackFromCatalog(text, catalog, country, countryPatch, pack, state);
    }

    if (ai.handoff) {
      await track(ctx.userKey, "handoff", text, bucket);
      return handoffReply(
        pack,
        { ...state, ...countryPatch, last_product_ids: ai.products.map((p) => p.id) },
        bucket,
        "purchase",
        text,
        ctx.userKey,
        pack.purchase,
      );
    }

    if (ai.error) {
      await track(ctx.userKey, "error", ai.error, bucket);
      return handoffReply(pack, { ...state, ...countryPatch }, bucket, "error", text, ctx.userKey);
    }

    const inStock = ai.products.filter((p) => p.stock);
    if (looksLikeProductQuery(text) && inStock.length === 0) {
      await track(ctx.userKey, "oos", text, bucket);
      return {
        text: pack.oos,
        patch: { ...countryPatch, last_product_ids: [] },
        kind: "oos",
      };
    }

    if (inStock.length > 0) {
      const rate = (await getStoredVtbRate())?.rate ?? null;
      const includeCdek = country === "RU" && !state.ru_cdek_sent;
      const rub = country === "RU" && rate ? priceRub(inStock[0].price_kzt, rate) : null;
      const card = formatProductReply(inStock[0], country, rub, {
        includeCdek,
        shopUrl,
        pack,
      });
      await track(ctx.userKey, "query", text, bucket);
      return {
        text: card,
        patch: {
          ...countryPatch,
          last_product_ids: inStock.map((p) => p.id),
          ru_cdek_sent: state.ru_cdek_sent || includeCdek,
        },
        kind: "product",
      };
    }

    const check = validateConsultantReply(ai.text, ai.products, ai.extraNumbers);
    if (!check.ok) {
      return {
        text: pack.askProduct,
        patch: { ...countryPatch, last_product_ids: ai.products.map((p) => p.id) },
        kind: "clarify",
      };
    }

    return {
      text: ai.text.trim() || pack.askProduct,
      patch: { ...countryPatch, last_product_ids: ai.products.map((p) => p.id) },
      kind: "clarify",
    };
  } catch {
    await track(ctx.userKey, "error", "claude_failed", bucket);
    return handoffReply(pack, { ...state, ...countryPatch }, bucket, "error", text, ctx.userKey);
  }
}

async function fallbackFromCatalog(
  text: string,
  catalog: import("./catalog").ConsultantProduct[],
  country: import("./intent").ConsultantCountry | undefined,
  countryPatch: Partial<ConsultantState>,
  pack: ConsultantCopyPack,
  state: ConsultantState,
): Promise<ConsultantReply> {
  const found = await searchProducts({ query: text }, catalog);
  const hit = found.find((p) => p.stock);
  if (!hit) {
    return { text: pack.oos, patch: countryPatch, kind: "oos" };
  }
  const includeCdek = country === "RU" && !state.ru_cdek_sent;
  return {
    text: formatProductReply(hit, country, null, { includeCdek, pack }),
    patch: {
      ...countryPatch,
      last_product_ids: [hit.id],
      ru_cdek_sent: state.ru_cdek_sent || includeCdek,
    },
    kind: "product",
  };
}

async function handoffReply(
  pack: ConsultantCopyPack,
  state: ConsultantState,
  bucket: "a" | "b",
  reason: "purchase" | "error" | "other" | "injection",
  text: string,
  userKey?: string,
  message?: string,
): Promise<ConsultantReply> {
  const pauseReason = reason === "injection" ? "other" : reason === "other" ? "other" : reason;
  if (userKey) {
    await pauseConsultant(userKey, pauseReason === "purchase" ? "purchase" : pauseReason);
    await addConsultantTask({
      userKey,
      reason,
      text,
    });
    await notifyConsultantHandoff({ userKey, reason, text });
  }
  return {
    text: message ?? pack.unrecognized,
    patch: {
      ...state,
      ab_bucket: bucket,
      automation_paused: true,
      pause_reason:
        pauseReason === "purchase" ? "purchase" : pauseReason === "error" ? "error" : "other",
      conversation_state: "handed_off",
    },
    kind: reason === "purchase" ? "purchase" : reason === "injection" ? "injection" : "handoff",
  };
}

async function getShopUrlSafe(): Promise<string> {
  try {
    return await getConsultantShopUrl();
  } catch {
    return "https://bovi.kz";
  }
}

async function track(
  userKey: string | undefined,
  kind: import("./analytics").ConsultantEventKind,
  text: string,
  bucket: string,
) {
  if (!userKey) return;
  await recordConsultantEvent({ userKey, kind, text, bucket });
}
