/** Official Claude Haiku 4.5 list price (standard Messages API, not batch). */
export const HAIKU_INPUT_USD_PER_MTOK = 1;
export const HAIKU_OUTPUT_USD_PER_MTOK = 5;
export const DEFAULT_USD_PER_REQUEST = 0.1;
export const SMART_SEARCH_DAILY_LIMIT = 200;

export type SmartSearchTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type SmartSearchDailySpend = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function estimateUsdFromTokens(usage: SmartSearchTokenUsage): number {
  const input = Math.max(0, usage.inputTokens);
  const output = Math.max(0, usage.outputTokens);
  return (input * HAIKU_INPUT_USD_PER_MTOK + output * HAIKU_OUTPUT_USD_PER_MTOK) / 1_000_000;
}

export function parseUsdPerRequest(raw: string | null | undefined): number {
  const parsed = Number(
    String(raw ?? "")
      .replace(",", ".")
      .trim(),
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_USD_PER_REQUEST;
  return Math.min(10, parsed);
}

export function parseDailyCount(raw: string | null | undefined, today = todayUtcDate()): number {
  const [storedDate, storedCountRaw] = (raw ?? "").split(":");
  return storedDate === today ? Number(storedCountRaw) || 0 : 0;
}

export function parseDailySpend(
  raw: string | null | undefined,
  today = todayUtcDate(),
): SmartSearchDailySpend {
  const empty: SmartSearchDailySpend = { date: today, inputTokens: 0, outputTokens: 0, usd: 0 };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<SmartSearchDailySpend>;
    if (parsed.date !== today) return empty;
    return {
      date: today,
      inputTokens: Math.max(0, Number(parsed.inputTokens) || 0),
      outputTokens: Math.max(0, Number(parsed.outputTokens) || 0),
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
    current.date === today ? current : { date: today, inputTokens: 0, outputTokens: 0, usd: 0 };
  return {
    date: today,
    inputTokens: base.inputTokens + Math.max(0, usage.inputTokens),
    outputTokens: base.outputTokens + Math.max(0, usage.outputTokens),
    usd: base.usd + estimateUsdFromTokens(usage),
  };
}

export function extractAnthropicUsage(payload: unknown): SmartSearchTokenUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Math.max(0, inputTokens || 0),
    outputTokens: Math.max(0, outputTokens || 0),
  };
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
