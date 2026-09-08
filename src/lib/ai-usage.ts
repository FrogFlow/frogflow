/**
 * Накопленный расход платных ИИ-сервисов: умный поиск (Anthropic) и
 * автопроверка чеков (Google Vision). Не дневной предохранитель, а счёт
 * «с последнего сброса»: клиент копит сумму, оплачивает, оператор обнуляет.
 */
import { estimateUsdFromTokens, type SmartSearchTokenUsage } from "./smart-search-cost";

export const SMART_SEARCH_LIFETIME_KEY = "smart_search_lifetime_spend";
export const RECEIPT_OCR_LIFETIME_KEY = "receipt_ocr_lifetime_count";

/** Тариф автопроверки для клиента: $2 за 1000 чеков, которые реально ушли в Vision. */
export const RECEIPT_OCR_USD_PER_1000 = 2;

export type SmartSearchLifetimeSpend = {
  count: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

export function emptySmartSearchLifetime(): SmartSearchLifetimeSpend {
  return { count: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
}

export function parseSmartSearchLifetime(raw: string | null | undefined): SmartSearchLifetimeSpend {
  if (!raw?.trim()) return emptySmartSearchLifetime();
  try {
    const parsed = JSON.parse(raw) as Partial<SmartSearchLifetimeSpend>;
    return {
      count: Math.max(0, Math.floor(Number(parsed.count) || 0)),
      inputTokens: Math.max(0, Number(parsed.inputTokens) || 0),
      outputTokens: Math.max(0, Number(parsed.outputTokens) || 0),
      usd: Math.max(0, Number(parsed.usd) || 0),
    };
  } catch {
    return emptySmartSearchLifetime();
  }
}

export function addSmartSearchLifetime(
  current: SmartSearchLifetimeSpend,
  usage: SmartSearchTokenUsage,
): SmartSearchLifetimeSpend {
  return {
    count: current.count + 1,
    inputTokens: current.inputTokens + Math.max(0, usage.inputTokens),
    outputTokens: current.outputTokens + Math.max(0, usage.outputTokens),
    usd: current.usd + estimateUsdFromTokens(usage),
  };
}

export function parseReceiptOcrCount(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function receiptOcrUsd(count: number): number {
  return Math.max(0, count) * (RECEIPT_OCR_USD_PER_1000 / 1000);
}

export type AiUsageSnapshot = {
  smartSearch: SmartSearchLifetimeSpend;
  receiptOcr: { count: number; usd: number };
};

export function buildAiUsageSnapshot(
  smartSearchRaw: string | null | undefined,
  receiptOcrRaw: string | null | undefined,
): AiUsageSnapshot {
  const smartSearch = parseSmartSearchLifetime(smartSearchRaw);
  const count = parseReceiptOcrCount(receiptOcrRaw);
  return {
    smartSearch,
    receiptOcr: { count, usd: receiptOcrUsd(count) },
  };
}
