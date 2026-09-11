import type { ZernioPlatform } from "@/lib/zernio-platform";
import type { ZernioWebhookMessagePayload } from "@/lib/zernio.server";
import { sendDirectReply } from "@/lib/direct-purchase.server";
import { logger } from "@/lib/logger.server";
import { runConsultantClaude } from "./claude";
import { loadConsultantCatalog } from "./catalog";
import { consultantCopy, formatProductReply } from "./copy";
import { matchCountry, matchPurchaseIntent } from "./intent";
import { getStoredVtbRate, priceRub } from "./rate";
import {
  isAutomationPaused,
  isBotEcho,
  loadConsultantState,
  patchConsultantState,
  pauseConsultant,
  type ConsultantState,
} from "./state";
import { validateConsultantReply } from "./validate";

export async function handleConsultantZernioEvent(params: {
  payload: ZernioWebhookMessagePayload;
  conversationId: string;
  accountId: string;
  userKey: string;
  text: string;
  platform: ZernioPlatform;
}): Promise<void> {
  const direction = params.payload.message?.direction;
  const { consultant } = await loadConsultantState(params.userKey);

  if (direction === "outgoing") {
    if (isBotEcho(consultant, params.text)) return;
    if (params.text.trim()) {
      await pauseConsultant(params.userKey, "manager_intervention");
      logger.info("consultant.paused", { userKey: params.userKey, reason: "manager_intervention" });
    }
    return;
  }

  if (isAutomationPaused(consultant)) {
    logger.info("consultant.skipped_paused", {
      userKey: params.userKey,
      reason: consultant.pause_reason,
    });
    return;
  }

  const text = params.text.trim();
  if (!text) return;

  const reply = await decideConsultantReply(text, consultant);
  if (!reply) return;

  const sent = await sendDirectReply({
    conversationId: params.conversationId,
    accountId: params.accountId,
    userKey: params.userKey,
    text: reply.text,
    platform: params.platform,
    force: true,
  });
  if (!sent) return;

  await patchConsultantState(params.userKey, {
    ...reply.patch,
    last_bot_reply: reply.text,
    last_bot_reply_at: new Date().toISOString(),
  });
}

export async function decideConsultantReply(
  text: string,
  state: ConsultantState,
): Promise<{ text: string; patch: Partial<ConsultantState> } | null> {
  if (matchPurchaseIntent(text)) {
    return {
      text: consultantCopy.purchase,
      patch: {
        automation_paused: true,
        pause_reason: "purchase",
        conversation_state: "handed_off",
      },
    };
  }

  const countryFromText = matchCountry(text);
  if (!state.country && !countryFromText) {
    return {
      text: consultantCopy.askCountry,
      patch: { conversation_state: "awaiting_country" },
    };
  }

  const country = state.country ?? countryFromText ?? undefined;
  const countryPatch: Partial<ConsultantState> = country
    ? { country, conversation_state: "consulting" }
    : {};

  if (countryFromText && !looksLikeProductQuery(text)) {
    return {
      text: consultantCopy.clarify,
      patch: countryPatch,
    };
  }

  const catalog = await loadConsultantCatalog();
  if (catalog.length === 0) {
    return {
      text: consultantCopy.catalogEmpty,
      patch: {
        ...countryPatch,
        automation_paused: true,
        pause_reason: "other",
        conversation_state: "handed_off",
      },
    };
  }

  try {
    const ai = await runConsultantClaude({
      text,
      state: { ...state, ...countryPatch },
      catalog,
      shopUrl: "https://bovi.kz",
    });

    if (ai.error === "no_api_key") {
      return fallbackFromCatalog(text, catalog, country, countryPatch);
    }

    if (ai.handoff) {
      return {
        text: ai.text.trim() || consultantCopy.purchase,
        patch: {
          ...countryPatch,
          automation_paused: true,
          pause_reason: "purchase",
          conversation_state: "handed_off",
          last_product_ids: ai.products.map((p) => p.id),
        },
      };
    }

    if (ai.error) {
      return {
        text: consultantCopy.apiError,
        patch: {
          ...countryPatch,
          automation_paused: true,
          pause_reason: "error",
          conversation_state: "handed_off",
        },
      };
    }

    const check = validateConsultantReply(ai.text, ai.products, ai.extraNumbers);
    if (!check.ok) {
      logger.warn("consultant.reply_rejected", { reason: check.reason });
      if (ai.products.length === 1 && ai.products[0].stock) {
        const rate = (await getStoredVtbRate())?.rate ?? null;
        const rub = country === "RU" && rate ? priceRub(ai.products[0].price_kzt, rate) : null;
        return {
          text: formatProductReply(ai.products[0], country, rub),
          patch: { ...countryPatch, last_product_ids: [ai.products[0].id] },
        };
      }
      return {
        text: ai.products.length === 0 ? consultantCopy.oos : consultantCopy.clarify,
        patch: { ...countryPatch, last_product_ids: ai.products.map((p) => p.id) },
      };
    }

    return {
      text: ai.text,
      patch: { ...countryPatch, last_product_ids: ai.products.map((p) => p.id) },
    };
  } catch (e) {
    logger.error("consultant.claude_failed", { err: e instanceof Error ? e.message : "error" });
    return {
      text: consultantCopy.apiError,
      patch: {
        ...countryPatch,
        automation_paused: true,
        pause_reason: "error",
        conversation_state: "handed_off",
      },
    };
  }
}

function looksLikeProductQuery(text: string): boolean {
  return text.trim().split(/\s+/).length > 2 || /\d/.test(text);
}

function fallbackFromCatalog(
  text: string,
  catalog: import("./catalog").ConsultantProduct[],
  country: import("./intent").ConsultantCountry | undefined,
  countryPatch: Partial<ConsultantState>,
): { text: string; patch: Partial<ConsultantState> } {
  const tokens = text
    .toLowerCase()
    .replace(/×/g, "x")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const hit = catalog.find((p) => {
    const hay = `${p.name} ${p.size} ${p.colors.join(" ")}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  if (!hit || !hit.stock) {
    return { text: consultantCopy.oos, patch: countryPatch };
  }
  return {
    text: formatProductReply(hit, country, null),
    patch: { ...countryPatch, last_product_ids: [hit.id] },
  };
}
