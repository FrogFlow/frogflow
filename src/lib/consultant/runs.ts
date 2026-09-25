/**
 * Журнал обработанных сообщений консультанта.
 *
 * Таблица consultant_message_runs заведена миграцией 69 под это и до сих пор
 * не использовалась: расход писался одной накопительной суммой в app_settings,
 * и ответить на вопрос «сколько стоит одно сообщение» было нечем — только
 * общая цифра с начала времён. Одна строка на сообщение даёт и цену ответа, и
 * долю кеша, и число обращений к модели, без гонок за один JSON-блоб.
 *
 * Запись никогда не мешает ответу покупателю: любая ошибка здесь только
 * пишется в лог.
 */
import type { SmartSearchTokenUsage } from "@/lib/smart-search-cost";
import { estimateUsdFromTokens } from "@/lib/smart-search-cost";

export type ConsultantRunSource = "webhook" | "poll" | "admin_test";

export type ConsultantRunRecord = {
  /** Идентификатор входящего сообщения — он же ключ идемпотентности. */
  messageId: string;
  conversationId: string;
  accountId?: string | null;
  userKey: string;
  source: ConsultantRunSource;
  incomingText?: string;
  replyText?: string;
  replyKind?: string | null;
  model?: string | null;
  usage?: SmartSearchTokenUsage | null;
  rate?: { value?: number | null; updatedAt?: string | null; source?: string | null };
  errorCode?: string | null;
  /**
   * Что вызвала модель за ход: инструменты и поправки кода (например, повтор
   * ответа, когда модель сама написала рубли). Без этого разбор теста видел
   * только текст и не мог сказать, искала ли модель в прайсе или вспоминала.
   */
  tools?: string[];
  /** Что увидела проверка «в чате уже отвечает менеджер». */
  managerCheck?: import("./manager-guard").ManagerCheck;
  /** По умолчанию replied; пауза из-за менеджера пишется как cancelled. */
  status?: "replied" | "cancelled" | "terminal_failed";
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/** Стоимость одного сообщения по тем же ставкам, что и накопительный счёт. */
export function runUsd(usage: SmartSearchTokenUsage | null | undefined, model?: string | null): number {
  return usage ? estimateUsdFromTokens(usage, undefined, model) : 0;
}

export async function recordConsultantRun(run: ConsultantRunRecord): Promise<void> {
  const botId = process.env.BOT_ID?.trim();
  if (!botId || !run.messageId) return;
  try {
    const s = await db();
    const usage = run.usage ?? null;
    await s.from("consultant_message_runs").upsert(
      {
        bot_id: botId,
        message_id: run.messageId,
        conversation_id: run.conversationId,
        account_id: run.accountId ?? null,
        user_key: run.userKey,
        direction: "incoming",
        source: run.source,
        status: run.status ?? (run.errorCode ? "terminal_failed" : "replied"),
        incoming_text: run.incomingText?.slice(0, 2000) ?? null,
        reply_text: run.replyText?.slice(0, 4000) ?? null,
        reply_kind: run.replyKind ?? null,
        model: run.model ?? null,
        rate_value: run.rate?.value ?? null,
        rate_updated_at: run.rate?.updatedAt ?? null,
        rate_source: run.rate?.source ?? null,
        token_usage: usage
          ? {
              input: usage.inputTokens,
              output: usage.outputTokens,
              cache_write: usage.cacheCreationTokens ?? 0,
              // Разбивка записи по TTL: по ней счёт за токены можно
              // пересчитать и проверить, не заглядывая в ответ API.
              ...(usage.cacheCreation5mTokens !== undefined
                ? { cache_write_5m: usage.cacheCreation5mTokens }
                : {}),
              ...(usage.cacheCreation1hTokens !== undefined
                ? { cache_write_1h: usage.cacheCreation1hTokens }
                : {}),
              cache_read: usage.cacheReadTokens ?? 0,
              usd: runUsd(usage, run.model),
            }
          : {},
        tool_trace: [
          ...(run.managerCheck
            ? [
                {
                  check: "manager_in_chat",
                  status: run.managerCheck.status,
                  messages_seen: run.managerCheck.checked,
                  ...(run.managerCheck.message ? { text: run.managerCheck.message.text.slice(0, 200) } : {}),
                  ...(run.managerCheck.error ? { error: run.managerCheck.error.slice(0, 200) } : {}),
                  ...(run.managerCheck.stats ? { seen: run.managerCheck.stats } : {}),
                },
              ]
            : []),
          ...(run.tools?.length ? [{ tools: run.tools.slice(0, 20) }] : []),
        ],
        error_code: run.errorCode ?? null,
        sent_at: run.errorCode || run.status === "cancelled" ? null : new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bot_id,message_id" },
    );
  } catch (e) {
    console.error("[consultant] не удалось записать строку журнала сообщений", e);
  }
}

/**
 * Дописать запись в tool_trace уже лежащей строки журнала — например, ответ
 * v2 в теневом режиме (consultant-v2/shadow.ts). Строку не создаёт.
 */
export async function appendRunTrace(messageId: string, entry: Record<string, unknown>): Promise<void> {
  const botId = process.env.BOT_ID?.trim();
  if (!botId || !messageId) return;
  try {
    const s = await db();
    const { data } = await s
      .from("consultant_message_runs")
      .select("tool_trace")
      .eq("bot_id", botId)
      .eq("message_id", messageId)
      .maybeSingle();
    if (!data) return;
    const trace = Array.isArray(data.tool_trace) ? data.tool_trace : [];
    await s
      .from("consultant_message_runs")
      .update({ tool_trace: [...trace, entry] as never, updated_at: new Date().toISOString() })
      .eq("bot_id", botId)
      .eq("message_id", messageId);
  } catch (e) {
    console.error("[consultant] не удалось дописать строку журнала", e);
  }
}

/**
 * Что бот говорил в этом диалоге — по журналу, а не по памяти процесса.
 *
 * Отличить своё сообщение от менеджерского по памяти нельзя: на serverless
 * каждый запрос может обслужить новый экземпляр, и уже через минуту бот не
 * помнит собственных слов. Журнал помнит.
 */
export async function loadRecentBotReplies(userKey: string, limit = 20): Promise<string[]> {
  try {
    const s = await db();
    const { data } = await s
      .from("consultant_message_runs")
      .select("reply_text")
      .eq("user_key", userKey)
      .not("reply_text", "is", null)
      .order("received_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => String(r.reply_text ?? "")).filter(Boolean);
  } catch (e) {
    console.error("[consultant] не удалось прочитать свои прошлые ответы", e);
    return [];
  }
}

export type ConsultantUsageDay = {
  /** Дата по Алматы: продавец считает сутки своими, а не по UTC. */
  date: string;
  messages: number;
  usd: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export type ConsultantUsageStats = {
  days: ConsultantUsageDay[];
  /** Итог за весь период. */
  messages: number;
  usd: number;
  /** Средняя цена одного сообщения, в долларах. */
  usdPerMessage: number;
  /** Доля ввода, прочитанная из кеша: при исправном кеше близка к единице. */
  cacheReadShare: number;
};

function almatyDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function readUsage(raw: unknown): {
  usd: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
} {
  const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => Math.max(0, Number(v) || 0);
  return {
    usd: num(u.usd),
    input: num(u.input),
    cacheWrite: num(u.cache_write),
    cacheRead: num(u.cache_read),
    output: num(u.output),
  };
}

/** Сводка за последние `days` суток — то, что показывается продавцу в панели. */
export async function loadConsultantUsageStats(days = 7): Promise<ConsultantUsageStats> {
  const empty: ConsultantUsageStats = {
    days: [],
    messages: 0,
    usd: 0,
    usdPerMessage: 0,
    cacheReadShare: 0,
  };
  try {
    const s = await db();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await s
      .from("consultant_message_runs")
      .select("received_at, token_usage")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(5000);
    if (error || !data) return empty;
    return summarizeConsultantRuns(data as { received_at: string; token_usage: unknown }[]);
  } catch (e) {
    console.error("[consultant] не удалось собрать сводку расхода", e);
    return empty;
  }
}

export function summarizeConsultantRuns(
  rows: { received_at: string; token_usage: unknown }[],
): ConsultantUsageStats {
  const byDate = new Map<string, ConsultantUsageDay>();
  let usd = 0;
  let input = 0;
  let cacheRead = 0;
  for (const row of rows) {
    const date = almatyDate(row.received_at);
    const u = readUsage(row.token_usage);
    const day = byDate.get(date) ?? {
      date,
      messages: 0,
      usd: 0,
      inputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };
    day.messages += 1;
    day.usd += u.usd;
    day.inputTokens += u.input;
    day.cacheWriteTokens += u.cacheWrite;
    day.cacheReadTokens += u.cacheRead;
    day.outputTokens += u.output;
    byDate.set(date, day);
    usd += u.usd;
    input += u.input + u.cacheWrite + u.cacheRead;
    cacheRead += u.cacheRead;
  }
  const messages = rows.length;
  return {
    days: [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)),
    messages,
    usd,
    usdPerMessage: messages > 0 ? usd / messages : 0,
    cacheReadShare: input > 0 ? cacheRead / input : 0,
  };
}
