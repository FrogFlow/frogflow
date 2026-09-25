/**
 * Консультант v2 — ИИ-менеджер BOVI.
 *
 * Отличие от v1 в том, кто принимает решения. В v1 сообщение сначала
 * проходило десятки правил в коде (страна, опт, фото, покупка, лимит длины
 * диалога, шаблоны без модели), а ответ модели потом чистили 17 фильтров. Здесь
 * код отвечает за данные и безопасность, а решает модель: что спросить, что
 * показать, когда звать человека (инструмент handoff_to_manager с причиной).
 *
 * Код по-прежнему делает то, что модели делать нельзя или незачем:
 * - прайс, база знаний, курс и товары публикации приходят данными;
 * - попытка взломать промпт и команда сброса обрабатываются до модели;
 * - в ответе вырезается разметка, эмодзи и «!» (просьба магазина), пересказ
 *   служебных пометок и написанные за покупателя реплики;
 * - цены сверяются с прайсом — пока в журнал, без правки ответа.
 *
 * Общее с v1 (защита от дублей, пауза при менеджере в чате, отправка, журнал,
 * задачи и уведомления) живёт в handle-message и не дублируется.
 */
import type { ConsultantReply } from "@/lib/consultant/handle-message";
import type { ConsultantState } from "@/lib/consultant/state";
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import type { StoredVtbRate } from "@/lib/consultant/rate";
import type { SmartSearchTokenUsage } from "@/lib/smart-search-cost";
import {
  V2_TOOLS,
  formatProfile,
  isHandoffReason,
  mergeProfile,
  type V2HandoffReason,
  type V2Profile,
} from "./tools";
import { buildV2SystemPrompt, formatCatalogForV2, V2_PROMPT_VERSION } from "./prompt";
import { tengeToRubles, wantsRubles } from "./currency";

const V2_TIMEOUT_MS = 30_000;
const V2_MAX_ROUNDS = 4;
const V2_MAX_TOKENS = 800;

type HandoffReasonV1 = Parameters<typeof import("@/lib/consultant/handle-message").handoffReply>[3];

/** Причина v2 → причина в задачах и уведомлениях менеджеру (общих с v1). */
const REASON_TO_TASK: Record<V2HandoffReason, HandoffReasonV1> = {
  purchase: "purchase",
  wholesale: "wholesale",
  complaint: "other",
  human: "other",
  photo: "photo",
  no_answer: "question",
};

/**
 * Параметры запроса под модель. Модель задаётся переменной CONSULTANT_MODEL
 * деплоя: так v2 сравнивают на разных моделях без правки кода. У Sonnet 5
 * рассуждение по умолчанию включено — для чата оно даёт задержку, а не
 * качество, поэтому выключено; Haiku 4.5 таких параметров не принимает.
 */
export function modelParams(model: string): Record<string, unknown> {
  if (/^claude-sonnet-5/.test(model)) return { thinking: { type: "disabled" } };
  return {};
}

/**
 * Ответ модели перед отправкой: только защита и просьбы магазина, без
 * переписывания смысла. Разметка и эмодзи — магазин просил без них;
 * пересказ служебных пометок и реплики «за покупателя» — утечка и брак.
 */
export async function finalizeV2Text(raw: string, catalog: ConsultantProduct[]): Promise<string> {
  const { stripMarkdownFormatting } = await import("@/lib/consultant/copy");
  const { cleanInstructionEcho, cleanScriptHallucinations } = await import("@/lib/consultant/validate");
  const { brandVocabulary, fixBrandSpelling, humanizePunctuation, stripExclamationsAndEmoji } = await import(
    "@/lib/consultant/style"
  );
  let text = cleanScriptHallucinations(raw ?? "");
  text = cleanInstructionEcho(text);
  text = fixBrandSpelling(text, brandVocabulary(catalog));
  return humanizePunctuation(stripExclamationsAndEmoji(stripMarkdownFormatting(text))).trim();
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

/** Товары публикации — пометкой для модели. Покупатель её не видит. Цены — в тенге. */
async function storyNote(
  ctx: V2Context,
  catalog: ConsultantProduct[],
): Promise<{ note: string; products: ConsultantProduct[] }> {
  if (!ctx.storyId && !ctx.storyMediaUrl) return { note: "", products: [] };
  try {
    const { findStoryTag } = await import("@/lib/consultant/story-tags.functions");
    const { storyProductsOf } = await import("@/lib/consultant/story-products");
    const { getProduct } = await import("@/lib/consultant/catalog");
    const { matchProductsInText } = await import("@/lib/consultant/handle-message");
    const tag = await findStoryTag(ctx.storyId, ctx.storyMediaUrl);
    const products: ConsultantProduct[] = [];
    for (const tagged of storyProductsOf(tag)) {
      const byId = tagged.id ? await getProduct(tagged.id, catalog) : null;
      const found = byId ?? matchProductsInText(tagged.name, catalog)[0] ?? null;
      if (found) products.push(found);
    }
    if (products.length === 0) {
      return {
        note: "[Покупатель пишет из публикации (сторис или рилс), но товары к ней не привязаны. Спросите, что из неё понравилось.]",
        products,
      };
    }
    const lines = products.map(
      (p) => `• ${p.name}${p.size ? `, ${p.size}` : ""} — ${p.price_kzt.toLocaleString("ru-RU")} ₸`,
    );
    return {
      note: `[Покупатель пишет из публикации (сторис или рилс). Товары в ней:\n${lines.join("\n")}]`,
      products,
    };
  } catch (err) {
    console.warn("[consultant-v2] товары публикации не найдены", err);
    return { note: "", products: [] };
  }
}

export type V2Context = {
  userKey?: string;
  requestId?: string;
  storyId?: string | null;
  storyMediaUrl?: string | null;
  onUsage?: (usage: SmartSearchTokenUsage, model: string) => void;
  onRate?: (rate: StoredVtbRate | null) => void;
  /** Для тестов и эталонного набора: прайс и курс без базы. */
  catalog?: ConsultantProduct[];
  rate?: number | null;
};

export async function decideConsultantReplyV2(
  text: string,
  state: ConsultantState,
  ctx: V2Context = {},
): Promise<ConsultantReply | null> {
  const { copyForBucket, HANDOFF_TO_MANAGER_REPLY } = await import("@/lib/consultant/copy");
  const { handoffReply, knowledgeForQuestion } = await import("@/lib/consultant/handle-message");
  const { looksLikePromptInjection } = await import("@/lib/consultant/injection");
  const { isResetIntent } = await import("@/lib/consultant/intent");
  const { consultantApiKey, consultantModel } = await import("@/lib/consultant/config");
  const { logConsultantEvent } = await import("@/lib/consultant/log");
  const requestId = ctx.requestId ?? "v2";

  const bucket = state.ab_bucket ?? "a";
  const pack = copyForBucket(bucket);

  if (looksLikePromptInjection(text)) {
    return handoffReply(pack, state, bucket, "injection", text, ctx.userKey);
  }
  if (isResetIntent(text)) {
    return {
      text: "Начнём заново. Что подсказать?",
      patch: {
        recent: [],
        v2_profile: undefined,
        v2_rub: undefined,
        last_product_ids: [],
        automation_paused: false,
        country: undefined,
        conversation_state: "consulting",
        pending_story_id: undefined,
        pending_story_url: undefined,
      },
      kind: "clarify",
    };
  }

  const apiKey = consultantApiKey();
  if (!apiKey) {
    return handoffReply(pack, state, bucket, "error", text, ctx.userKey, HANDOFF_TO_MANAGER_REPLY);
  }
  const model = consultantModel();

  // ── Данные ────────────────────────────────────────────────────────────
  const { buildAnthropicMessages, withTailCacheBreakpoint } = await import("@/lib/consultant/claude");
  const { loadConsultantCatalog, getConsultantShopUrl } = await import("@/lib/consultant/catalog");
  const { getFreshVtbRate } = await import("@/lib/consultant/rate");
  const catalog = ctx.catalog ?? (await loadConsultantCatalog());
  const rateRow: StoredVtbRate | null =
    ctx.catalog != null
      ? ctx.rate != null
        ? ({ rate: ctx.rate, updatedAt: "test", source: "test" } as StoredVtbRate)
        : null
      : await getFreshVtbRate();
  ctx.onRate?.(rateRow);
  const rate = rateRow?.rate ?? null;
  const shopUrl = await getConsultantShopUrl().catch(() => "https://bovi.kz");
  const { getConsultantStoreInfo } = await import("@/lib/consultant/store-info");
  const store = await getConsultantStoreInfo().catch(() => ({
    address: "г. Алматы, ул. Сатпаева, 3 (бутик-молл COLIBRI, 1-й этаж)",
    phone: "+7 (777) 333 08 08",
    hours: "ежедневно с 10:00 до 22:00",
  }));
  const { loadConsultantKnowledge, formatKnowledgeForPrompt, formatKnowledgeIndexForPrompt, knowledgeFitsInPrompt } =
    await import("@/lib/consultant/knowledge");
  const articles = await loadConsultantKnowledge().catch(() => []);
  const knowledgeSection = knowledgeFitsInPrompt(articles)
    ? formatKnowledgeForPrompt(articles)
    : formatKnowledgeIndexForPrompt(articles);
  const brandsSection = await (async () => {
    try {
      const { loadConsultantSynonyms } = await import("@/lib/consultant/catalog");
      const { parseSynonymGroups, formatSynonymsForPrompt } = await import("@/lib/consultant/synonyms");
      return formatSynonymsForPrompt(parseSynonymGroups(await loadConsultantSynonyms()));
    } catch {
      return "";
    }
  })();
  const system = buildV2SystemPrompt({
    catalogSection: formatCatalogForV2(catalog),
    knowledgeSection,
    brandsSection,
    shopUrl,
    store: { address: store.address, phone: store.phone, hours: store.hours },
  });

  // Всё, что известно к этому сообщению, — пометками перед словами покупателя.
  // Системный промпт общий и в кеше; сюда кладётся то, что меняется.
  const notes: string[] = [];
  const profileNote = formatProfile(state.v2_profile);
  if (profileNote) notes.push(profileNote);
  const story = await storyNote(ctx, catalog);
  if (story.note) notes.push(story.note);
  const known = await knowledgeForQuestion(text, catalog);
  if (known) notes.push(`[Из базы знаний — покупатель этого не видит:\n${known}]`);
  const userTurn = [...notes, text.trim() || "Здравствуйте"].join("\n\n");
  const messages = buildAnthropicMessages(state.recent, userTurn);

  // ── Модель ────────────────────────────────────────────────────────────
  const { executeConsultantTool } = await import("@/lib/consultant/tools");
  const { CONSULTANT_CACHE_TTL, addTokenUsage, extractAnthropicUsage } = await import(
    "@/lib/smart-search-cost"
  );
  const tools = V2_TOOLS.map((tool, i) =>
    i === V2_TOOLS.length - 1 ? { ...tool, cache_control: { type: "ephemeral", ttl: CONSULTANT_CACHE_TTL } } : tool,
  );

  let profile: V2Profile | undefined = state.v2_profile;
  let handoff: { reason: V2HandoffReason; summary: string; phone?: string } | null = null;
  const products: ConsultantProduct[] = [...story.products];
  const toolsUsed: string[] = [];
  let usage: SmartSearchTokenUsage | null = null;
  let lastText = "";
  let error: string | null = null;

  for (let round = 0; round < V2_MAX_ROUNDS; round++) {
    let json: { content?: AnthropicBlock[]; usage?: unknown };
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: V2_MAX_TOKENS,
          system: [
            { type: "text", text: system, cache_control: { type: "ephemeral", ttl: CONSULTANT_CACHE_TTL } },
          ],
          tools,
          messages: withTailCacheBreakpoint(messages),
          ...modelParams(model),
        }),
        signal: AbortSignal.timeout(V2_TIMEOUT_MS),
      });
      if (!res.ok) {
        error = `anthropic_${res.status}:${(await res.text().catch(() => "")).slice(0, 180)}`;
        break;
      }
      json = (await res.json()) as typeof json;
    } catch (err) {
      error = `network:${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
      break;
    }

    const roundUsage = extractAnthropicUsage(json as never);
    if (roundUsage) usage = addTokenUsage(usage, roundUsage);
    const content = json.content ?? [];
    messages.push({ role: "assistant", content });

    const texts = content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    if (texts.length) lastText = texts.map((b) => b.text).join("\n").trim();
    const calls = content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use",
    );
    if (calls.length === 0) break;

    const results: unknown[] = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      const input = call.input ?? {};
      let result: unknown;
      if (call.name === "remember_customer") {
        profile = mergeProfile(profile, input);
        result = { ok: true };
      } else if (call.name === "handoff_to_manager") {
        handoff = {
          reason: isHandoffReason(input.reason) ? input.reason : "human",
          summary: typeof input.summary === "string" ? input.summary.trim() : "",
          phone: typeof input.customer_phone === "string" ? input.customer_phone.trim() : undefined,
        };
        result = { ok: true, note: "Менеджер подключится. Напишите покупателю одну короткую фразу об этом." };
      } else {
        try {
          // Карточки — в тенге: рубли переводит код после ответа.
          const executed = await executeConsultantTool(call.name, input, {
            country: "KZ",
            catalog,
            shopUrl,
            excludeIds: state.last_product_ids,
            userKey: ctx.userKey,
          });
          products.push(...executed.products);
          result = executed.result;
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: results });
    // Модель уже написала фразу покупателю вместе с передачей — дальше ходить незачем.
    if (handoff && lastText) break;
  }

  if (usage) {
    ctx.onUsage?.(usage, model);
    await import("@/lib/ai-usage.server")
      .then((m) => m.recordConsultantLifetime(usage!))
      .catch(() => {});
  }

  const rub = wantsRubles(text, state, profile);
  let finalText = await finalizeV2Text(lastText, catalog);
  if (rub) finalText = tengeToRubles(finalText, rate);
  logConsultantEvent(requestId, "v2_reply", {
    userKey: ctx.userKey,
    promptVersion: V2_PROMPT_VERSION,
    model,
    tools: toolsUsed,
    handoff: handoff?.reason ?? null,
    error,
  });

  // Цены сверяем с прайсом. Пока только в журнал: править ответ задним
  // числом — ровно та дорожка заплаток, с которой ушли из v1.
  if (finalText) {
    const { validateConsultantReply } = await import("@/lib/consultant/validate");
    const extra: number[] = rate ? [rate] : [];
    if (rate) {
      const { priceRub } = await import("@/lib/consultant/rate");
      for (const p of catalog) extra.push(priceRub(p.price_kzt, rate));
    }
    const verdict = validateConsultantReply(finalText, catalog, extra);
    if (!verdict.ok) {
      logConsultantEvent(requestId, "v2_validation", { userKey: ctx.userKey, reason: verdict.reason });
    }
  }

  const stateWithProfile = { ...state, v2_profile: profile, v2_rub: rub };

  if (handoff) {
    const reply = await handoffReply(
      pack,
      stateWithProfile,
      bucket,
      REASON_TO_TASK[handoff.reason],
      text,
      ctx.userKey,
      finalText || HANDOFF_TO_MANAGER_REPLY,
      handoff.phone || profile?.phone,
      catalog,
      handoff.summary,
    );
    return { ...reply, patch: { ...reply.patch, v2_profile: profile, v2_rub: rub }, toolsUsed };
  }

  if (!finalText) {
    // Модель не ответила (сбой сети, пустой ответ). Молчать нельзя — человек
    // ждёт; отдаём менеджеру с причиной «ошибка».
    return handoffReply(pack, stateWithProfile, bucket, "error", text, ctx.userKey, HANDOFF_TO_MANAGER_REPLY);
  }

  const ids = [...new Set(products.map((p) => p.id))];
  return {
    text: finalText,
    patch: {
      v2_profile: profile,
      v2_rub: rub,
      conversation_state: "consulting",
      ...(ids.length ? { last_product_ids: ids.slice(0, 12) } : {}),
    },
    kind: products.length ? "product" : "clarify",
    toolsUsed,
  };
}
