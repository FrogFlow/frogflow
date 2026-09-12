/**
 * RUB = KZT / (VTB KZ buy rate × 0.95). Считает backend, не Claude.
 * Пример из ТЗ: 45 000 / (5.15 × 0.95) ≈ 9 198.
 */
export function priceRub(priceKzt: number, vtbBuyRate: number): number {
  if (!(priceKzt > 0) || !(vtbBuyRate > 0)) return 0;
  return Math.round(priceKzt / (vtbBuyRate * 0.95));
}

export type StoredVtbRate = {
  rate: number;
  updatedAt: string;
  /** URL источника или `manual`. */
  source?: string;
};

let rateCache: { at: number; value: StoredVtbRate | null } | null = null;
const RATE_CACHE_MS = 60_000;

export function rememberStoredVtbRate(value: StoredVtbRate | null): void {
  rateCache = { at: Date.now(), value };
}

/** Последний успешно сохранённый курс. Cron / ручное обновление пишут сюда. */
export async function getStoredVtbRate(): Promise<StoredVtbRate | null> {
  if (rateCache && Date.now() - rateCache.at < RATE_CACHE_MS) return rateCache.value;
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "consultant_vtb_buy_rate")
    .maybeSingle();
  if (!data?.value?.trim()) {
    rememberStoredVtbRate(null);
    return null;
  }
  try {
    const parsed = JSON.parse(data.value) as Partial<StoredVtbRate>;
    const rate = Number(parsed.rate);
    if (!(rate > 0) || !parsed.updatedAt) {
      rememberStoredVtbRate(null);
      return null;
    }
    const value = {
      rate,
      updatedAt: String(parsed.updatedAt),
      source: parsed.source ? String(parsed.source) : undefined,
    };
    rememberStoredVtbRate(value);
    return value;
  } catch {
    return null;
  }
}
