/** Official Claude Haiku 4.5 list price (standard Messages API, not batch). */
export const HAIKU_INPUT_USD_PER_MTOK = 1;
export const HAIKU_OUTPUT_USD_PER_MTOK = 5;
export const DEFAULT_USD_PER_REQUEST = 0.1;
export const SMART_SEARCH_DAILY_LIMIT = 200;

/**
 * Множители кеша промпта. Запись стоит дороже обычного ввода, чтение — почти
 * даром; оба считаются отдельно от input_tokens, потому что API возвращает в
 * input_tokens только то, что НЕ попало ни в запись, ни в чтение кеша.
 */
export const CACHE_WRITE_MULTIPLIER = { "5m": 1.25, "1h": 2 } as const;
export const CACHE_READ_MULTIPLIER = 0.1;

/** TTL кеша, выбранный для консультанта; от него зависит цена записи. */
export const CONSULTANT_CACHE_TTL: keyof typeof CACHE_WRITE_MULTIPLIER = "1h";

export type SmartSearchTokenUsage = {
  /** Токены, посчитанные по полной цене: мимо кеша. */
  inputTokens: number;
  outputTokens: number;
  /** Записано в кеш промпта. */
  cacheCreationTokens?: number;
  /** Прочитано из кеша промпта. */
  cacheReadTokens?: number;
};

export type SmartSearchDailySpend = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  usd: number;
};

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Стоимость вызова с учётом кеша промпта.
 *
 * Без слагаемых кеша счёт получается не «примерно», а в разы меньше: у
 * консультанта системный промпт с каталогом и базой знаний — около 69 тысяч
 * токенов, и при работающем кеше в input_tokens приходит лишь несколько
 * процентов от него. Клиенту этот счёт выставляют, поэтому недосчёт — это
 * деньги мимо кассы.
 */
export function estimateUsdFromTokens(
  usage: SmartSearchTokenUsage,
  ttl: keyof typeof CACHE_WRITE_MULTIPLIER = CONSULTANT_CACHE_TTL,
): number {
  const input = Math.max(0, usage.inputTokens);
  const output = Math.max(0, usage.outputTokens);
  const written = Math.max(0, usage.cacheCreationTokens ?? 0);
  const read = Math.max(0, usage.cacheReadTokens ?? 0);
  const inputUsd =
    (input + written * CACHE_WRITE_MULTIPLIER[ttl] + read * CACHE_READ_MULTIPLIER) *
    HAIKU_INPUT_USD_PER_MTOK;
  return (inputUsd + output * HAIKU_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

export function parseDailyCount(raw: string | null | undefined, today = todayUtcDate()): number {
  const [storedDate, storedCountRaw] = (raw ?? "").split(":");
  return storedDate === today ? Number(storedCountRaw) || 0 : 0;
}

export function parseDailySpend(
  raw: string | null | undefined,
  today = todayUtcDate(),
): SmartSearchDailySpend {
  const empty: SmartSearchDailySpend = {
    date: today,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    usd: 0,
  };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<SmartSearchDailySpend>;
    if (parsed.date !== today) return empty;
    return {
      date: today,
      inputTokens: Math.max(0, Number(parsed.inputTokens) || 0),
      outputTokens: Math.max(0, Number(parsed.outputTokens) || 0),
      // Старые записи полей кеша не содержат — считаем их нулями, а не NaN.
      cacheCreationTokens: Math.max(0, Number(parsed.cacheCreationTokens) || 0),
      cacheReadTokens: Math.max(0, Number(parsed.cacheReadTokens) || 0),
      usd: Math.max(0, Number(parsed.usd) || 0),
    };
  } catch {
    return empty;
  }
}

export function addDailySpend(
  current: SmartSearchDailySpend,
  usage: SmartSearchTokenUsage,
  today = todayUtcDate(),
): SmartSearchDailySpend {
  const base =
    current.date === today
      ? current
      : {
          date: today,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          usd: 0,
        };
  return {
    date: today,
    inputTokens: base.inputTokens + Math.max(0, usage.inputTokens),
    outputTokens: base.outputTokens + Math.max(0, usage.outputTokens),
    cacheCreationTokens: base.cacheCreationTokens + Math.max(0, usage.cacheCreationTokens ?? 0),
    cacheReadTokens: base.cacheReadTokens + Math.max(0, usage.cacheReadTokens ?? 0),
    usd: base.usd + estimateUsdFromTokens(usage),
  };
}

export function extractAnthropicUsage(payload: unknown): SmartSearchTokenUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (
    payload as {
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
        cache_read_input_tokens?: unknown;
      };
    }
  ).usage;
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Math.max(0, inputTokens || 0),
    outputTokens: Math.max(0, outputTokens || 0),
    // Эти два поля раньше выбрасывались, и вместе с ними — почти весь ввод.
    cacheCreationTokens: Math.max(0, Number(usage.cache_creation_input_tokens) || 0),
    cacheReadTokens: Math.max(0, Number(usage.cache_read_input_tokens) || 0),
  };
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
