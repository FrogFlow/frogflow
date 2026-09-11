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
};

/** Последний успешно сохранённый курс. Cron / ручное обновление пишут сюда. */
export async function getStoredVtbRate(): Promise<StoredVtbRate | null> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "consultant_vtb_buy_rate")
    .maybeSingle();
  if (!data?.value?.trim()) return null;
  try {
    const parsed = JSON.parse(data.value) as Partial<StoredVtbRate>;
    const rate = Number(parsed.rate);
    if (!(rate > 0) || !parsed.updatedAt) return null;
    return { rate, updatedAt: String(parsed.updatedAt) };
  } catch {
    return null;
  }
}
