import type { ZernioPlatform } from "@/lib/zernio-platform";
import type { ZernioWebhookMessagePayload } from "@/lib/zernio.server";
import { sendDirectReply } from "@/lib/direct-purchase.server";
import { runConsultantClaude } from "./claude";
import {
  getConsultantShopUrl,
  loadConsultantCatalog,
  queryHasCatalogSignal,
  searchProducts,
  searchTokens,
} from "./catalog";
import {
  copyForBucket,
  formatProductReply,
  looksLikeConsultantBotReply,
  type ConsultantCopyPack,
} from "./copy";
import { looksLikePromptInjection } from "./injection";
import {
  looksLikeProductQuery,
  looksLikeVagueHelp,
  matchAdviceIntent,
  matchCatalogIntent,
  matchCountry,
  matchCountryPostback,
  matchOtherCategoriesIntent,
  matchPurchaseIntent,
} from "./intent";
import { consultantRequestId, logConsultantEvent } from "./log";
import { getStoredVtbRate, priceRub } from "./rate";
import {
  alreadyAnsweredIncoming,
  appendRecent,
  claimIncomingMessage,
  isAutomationPaused,
  isBotEcho,
  isFalseManagerPause,
  loadConsultantState,
  patchConsultantState,
  pauseConsultant,
  resumeConsultant,
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
  source?: "webhook" | "poll";
}): Promise<void> {
  const requestId = consultantRequestId();
  const started = Date.now();
  const direction = params.payload.message?.direction;
  const { consultant } = await loadConsultantState(params.userKey);

  if (direction === "outgoing") {
    if (isBotEcho(consultant, params.text) || looksLikeConsultantBotReply(params.text)) return;
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
    let lastOutgoing = "";
    try {
      const { listZernioConversationMessages } = await import("@/lib/zernio.server");
      const messages = await listZernioConversationMessages(
        params.accountId,
        params.conversationId,
      );
      lastOutgoing =
        [...messages].reverse().find((m) => m.direction === "outgoing" && m.message?.trim())
          ?.message ?? "";
    } catch {
      lastOutgoing = "";
    }
    if (isFalseManagerPause(consultant, lastOutgoing)) {
      await resumeConsultant(params.userKey);
    } else {
      logConsultantEvent(requestId, "skipped_paused", {
        userKey: params.userKey,
        reason: consultant.pause_reason,
      });
      return;
    }
  }

  const text = params.text.trim() || params.postback?.trim() || "";
  if (!text && !params.postback) return;

  if (isBotEcho(consultant, text) || looksLikeConsultantBotReply(text)) {
    logConsultantEvent(requestId, "skipped_echo", { userKey: params.userKey });
    return;
  }

  const source = params.source ?? "webhook";
  if (alreadyAnsweredIncoming(consultant, text, Date.now(), source)) {
    logConsultantEvent(requestId, "skipped_duplicate", { userKey: params.userKey });
    return;
  }
  const claimed = await claimIncomingMessage(params.userKey, text, source);
  if (!claimed) {
    logConsultantEvent(requestId, "skipped_duplicate", {
      userKey: params.userKey,
      reason: "claim_lost",
    });
    return;
  }

  const reply = await decideConsultantReply(text, consultant, {
    userKey: params.userKey,
    postback: params.postback,
    requestId,
  });
  if (!reply) return;

  const { consultant: latest } = await loadConsultantState(params.userKey);
  if (
    source === "poll" &&
    latest.last_bot_reply?.trim() === reply.text.trim() &&
    alreadyAnsweredIncoming(latest, text, Date.now(), source)
  ) {
    logConsultantEvent(requestId, "skipped_duplicate", {
      userKey: params.userKey,
      reason: "already_sent",
    });
    return;
  }

  await patchConsultantState(params.userKey, {
    last_customer_text: text,
    last_bot_reply: reply.text,
  });

  const send = (buttons: ConsultantReply["buttons"] | undefined) =>
    sendDirectReply({
      conversationId: params.conversationId,
      accountId: params.accountId,
      userKey: params.userKey,
      text: reply.text,
      buttons,
      platform: params.platform,
      force: true,
    });
  let sent = await send(reply.buttons);
  if (!sent && reply.buttons?.length) sent = await send(undefined);
  if (!sent) {
    logConsultantEvent(requestId, "send_failed", { userKey: params.userKey, kind: reply.kind });
    return;
  }

  await patchConsultantState(params.userKey, {
    ...reply.patch,
    last_customer_text: text,
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
  if (ctx.userKey && !state.ab_bucket) {
    try {
      const forced = await getForcedAbBucket();
      bucket = bucketForUser(ctx.userKey, forced);
    } catch {
      bucket = "a";
    }
  }
  const pack = copyForBucket(bucket);

  if (looksLikePromptInjection(text)) {
    void track(ctx.userKey, "injection", text, bucket);
    return handoffReply(pack, state, bucket, "injection", text, ctx.userKey);
  }

  if (matchPurchaseIntent(text)) {
    void track(ctx.userKey, "purchase", text, bucket);
    return handoffReply(pack, state, bucket, "purchase", text, ctx.userKey, pack.purchase);
  }

  const country =
    matchCountryPostback(ctx.postback) ?? matchCountry(text) ?? state.country ?? undefined;

  if (!country) {
    return {
      text: pack.askCountry,
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
    !matchOtherCategoriesIntent(text) &&
    !matchAdviceIntent(text);

  if (justCountry) {
    void track(ctx.userKey, "country", text, bucket);
    return {
      text: pack.askProduct,
      patch: { ...countryPatch, conversation_state: "awaiting_product" },
      kind: "clarify",
    };
  }

  if (matchCatalogIntent(text)) {
    void track(ctx.userKey, "catalog", text, bucket);
    return {
      text: pack.catalogLink(await getShopUrlSafe()),
      patch: countryPatch,
      kind: "catalog",
    };
  }

  if (looksLikeVagueHelp(text) || matchAdviceIntent(text) || matchOtherCategoriesIntent(text)) {
    let namedProduct = false;
    try {
      const catalog = await loadConsultantCatalog();
      namedProduct = queryHasCatalogSignal(text, catalog);
    } catch {
      namedProduct = false;
    }
    if (!namedProduct) {
      return { text: pack.otherCategories, patch: countryPatch, kind: "clarify" };
    }
  }

  if (!looksLikeProductQuery(text)) {
    return {
      text: pack.askProduct,
      patch: { ...countryPatch, conversation_state: "awaiting_product" },
      kind: "clarify",
    };
  }

  const [catalog, rateRow] = await Promise.all([loadConsultantCatalog(), getStoredVtbRate()]);
  if (catalog.length === 0) {
    void track(ctx.userKey, "error", "catalog_empty", bucket);
    return handoffReply(pack, { ...state, ...countryPatch }, bucket, "other", text, ctx.userKey);
  }

  const local = await replyFromLocalCatalog(
    text,
    catalog,
    country,
    countryPatch,
    pack,
    state,
    rateRow?.rate ?? null,
  );
  if (local) {
    void track(ctx.userKey, local.kind === "oos" ? "oos" : "query", text, bucket);
    return local;
  }

  if (searchTokens(text).length === 0 || looksLikeVagueHelp(text)) {
    return { text: pack.otherCategories, patch: countryPatch, kind: "clarify" };
  }

  try {
    const ai = await runConsultantClaude({
      text,
      state: { ...state, ...countryPatch },
      catalog,
      shopUrl: await getShopUrlSafe(),
      forceTools: false,
    });
    if (ai.usage) {
      void import("@/lib/ai-usage.server").then((m) => m.recordConsultantLifetime(ai.usage!));
    }

    if (ai.error === "no_api_key") {
      return (
        (await replyFromLocalCatalog(
          text,
          catalog,
          country,
          countryPatch,
          pack,
          state,
          rateRow?.rate ?? null,
        )) ?? { text: pack.askProduct, patch: countryPatch, kind: "clarify" }
      );
    }

    if (ai.handoff) {
      void track(ctx.userKey, "handoff", text, bucket);
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
      void track(ctx.userKey, "error", ai.error, bucket);
      return {
        text: pack.askProduct,
        patch: countryPatch,
        kind: "clarify",
      };
    }

    const inStock = ai.products.filter((p) => p.stock);
    if (inStock.length > 0) {
      const includeCdek = country === "RU" && !state.ru_cdek_sent;
      const rub = country === "RU" && rateRow?.rate ? priceRub(inStock[0].price_kzt, rateRow.rate) : null;
      void track(ctx.userKey, "query", text, bucket);
      return {
        text: formatProductReply(inStock[0], country, rub, { includeCdek, pack }),
        patch: {
          ...countryPatch,
          last_product_ids: inStock.map((p) => p.id),
          ru_cdek_sent: state.ru_cdek_sent || includeCdek,
        },
        kind: "product",
      };
    }

    if (looksLikeProductQuery(text) && queryHasCatalogSignal(text, catalog)) {
      void track(ctx.userKey, "oos", text, bucket);
      return { text: pack.oos, patch: { ...countryPatch, last_product_ids: [] }, kind: "oos" };
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
    void track(ctx.userKey, "error", "claude_failed", bucket);
    return {
      text: pack.askProduct,
      patch: countryPatch,
      kind: "clarify",
    };
  }
}

export async function replyFromLocalCatalog(
  text: string,
  catalog: import("./catalog").ConsultantProduct[],
  country: import("./intent").ConsultantCountry | undefined,
  countryPatch: Partial<ConsultantState>,
  pack: ConsultantCopyPack,
  state: ConsultantState,
  rate: number | null,
): Promise<ConsultantReply | null> {
  const found = await searchProducts({ query: text }, catalog);
  const hit = found.find((p) => p.stock);
  if (hit) {
    const includeCdek = country === "RU" && !state.ru_cdek_sent;
    const rub = country === "RU" && rate ? priceRub(hit.price_kzt, rate) : null;
    return {
      text: formatProductReply(hit, country, rub, { includeCdek, pack }),
      patch: {
        ...countryPatch,
        last_product_ids: [hit.id],
        ru_cdek_sent: state.ru_cdek_sent || includeCdek,
      },
      kind: "product",
    };
  }
  if (found.length > 0 || queryHasCatalogSignal(text, catalog)) {
    return { text: pack.oos, patch: { ...countryPatch, last_product_ids: [] }, kind: "oos" };
  }
  return null;
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
    void addConsultantTask({ userKey, reason, text });
    void notifyConsultantHandoff({ userKey, reason, text });
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
