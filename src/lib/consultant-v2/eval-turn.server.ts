/**
 * Эталонный набор консультанта v2: один ход на тестовом деплое.
 *
 * Ключ модели живёт только в окружении деплоя, поэтому ход считается здесь, а
 * сценарии и проверки — в scripts/eval-consultant-v2.ts, который ходит сюда
 * через внутренний API (закрыт bots.internal_secret). Состояние диалога
 * хранит скрипт и передаёт в каждом ходе, поэтому здесь ничего не остаётся:
 * ни паузы, ни задачи и уведомления менеджеру, ни строки в журнале, ни
 * расхода в счёте клиента.
 *
 * Отвечает только деплой с нишей v2: прогон на боевом BOVI (v1) не нужен и
 * стоил бы денег клиента.
 */
import type { ConsultantState } from "@/lib/consultant/state";
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import type { SmartSearchTokenUsage } from "@/lib/smart-search-cost";

export type V2EvalTurnInput = {
  text?: unknown;
  state?: unknown;
  storyProductIds?: unknown;
  /** Фото покупателя — ссылки https, до трёх. */
  imageUrls?: unknown;
};

export type V2EvalToolCall = { name: string; input: Record<string, unknown> };

export type V2EvalTurnResult =
  | {
      ok: true;
      text: string;
      historyText?: string;
      kind: string;
      toolsUsed: string[];
      toolCalls: V2EvalToolCall[];
      handoff: { reason: string; summary: string } | null;
      nextState: ConsultantState;
      usage: SmartSearchTokenUsage | null;
      model: string | null;
      rate: number | null;
      ms: number;
      error?: string;
    }
  | { ok: false; error: string };

async function isV2Deployment(): Promise<boolean> {
  const { currentVertical } = await import("@/lib/verticals/vertical.server");
  const { isBoviConsultantV2Vertical } = await import("@/lib/verticals/registry");
  return isBoviConsultantV2Vertical(currentVertical());
}

export async function runV2EvalTurn(input: V2EvalTurnInput | undefined): Promise<V2EvalTurnResult> {
  if (!(await isV2Deployment())) return { ok: false, error: "not a consultant v2 deployment" };
  const text = typeof input?.text === "string" ? input.text.slice(0, 2000) : "";
  if (!text.trim()) return { ok: false, error: "empty text" };
  const state = (
    input?.state && typeof input.state === "object" ? input.state : {}
  ) as ConsultantState;
  const storyProductIds = Array.isArray(input?.storyProductIds)
    ? input.storyProductIds.filter((id): id is string => typeof id === "string").slice(0, 20)
    : undefined;

  const imageUrls = Array.isArray(input?.imageUrls)
    ? input.imageUrls
        .filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u))
        .slice(0, 3)
    : [];

  const { decideConsultantReplyV2 } = await import("./engine");
  const { appendRecent } = await import("@/lib/consultant/state");
  const toolCalls: V2EvalToolCall[] = [];
  let usage: SmartSearchTokenUsage | null = null;
  let model: string | null = null;
  let rate: number | null = null;
  let modelError: string | undefined;
  const started = Date.now();
  const reply = await decideConsultantReplyV2(text, state, {
    userKey: "eval",
    requestId: "eval",
    dryRun: true,
    ...(storyProductIds?.length ? { storyProductIds } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
    onToolCall: (name, callInput) => toolCalls.push({ name, input: callInput }),
    onUsage: (u, m) => {
      usage = u;
      model = m;
    },
    onRate: (r) => {
      rate = r?.rate ?? null;
    },
    onError: (e) => {
      modelError = e;
    },
  });
  if (!reply) return { ok: false, error: "no reply" };

  const handoffCall = toolCalls.find((c) => c.name === "handoff_to_manager");
  // Состояние после хода — так же, как его сохраняет обработчик сообщений.
  const nextState: ConsultantState = {
    ...state,
    ...reply.patch,
    last_bot_reply: reply.text,
    recent: reply.resetHistory ? [] : appendRecent(state, text, reply.historyText ?? reply.text),
  };
  return {
    ok: true,
    text: reply.text,
    ...(reply.historyText ? { historyText: reply.historyText } : {}),
    kind: reply.kind,
    toolsUsed: reply.toolsUsed ?? [],
    toolCalls,
    handoff: handoffCall
      ? {
          reason: String(handoffCall.input.reason ?? ""),
          summary: String(handoffCall.input.summary ?? ""),
        }
      : null,
    nextState,
    usage,
    model,
    rate,
    ms: Date.now() - started,
    ...(modelError ? { error: modelError } : {}),
  };
}

/** Прайс, который видит консультант (без скрытых позиций), — для проверок прогона. */
export async function v2EvalCatalog(): Promise<
  { ok: true; products: ConsultantProduct[] } | { ok: false; error: string }
> {
  if (!(await isV2Deployment())) return { ok: false, error: "not a consultant v2 deployment" };
  const { loadConsultantCatalog } = await import("@/lib/consultant/catalog");
  return { ok: true, products: await loadConsultantCatalog() };
}
