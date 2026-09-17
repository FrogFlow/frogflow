/**
 * Определение выходного дня по времени Алматы (Asia/Almaty, UTC+5).
 */
export function isWeekendInAlmaty(date: Date = new Date()): boolean {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Almaty",
      weekday: "short",
    }).format(date);
    return weekday === "Sat" || weekday === "Sun";
  } catch {
    const utcDay = new Date(date.getTime() + 5 * 60 * 60 * 1000).getUTCDay();
    return utcDay === 0 || utcDay === 6;
  }
}

/**
 * Текущий час по времени Алматы (0..23).
 */
export function getAlmatyHour(date: Date = new Date()): number {
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Almaty",
      hour: "numeric",
      hour12: false,
    }).format(date);
    const parsed = parseInt(hourStr, 10);
    return isNaN(parsed) ? 12 : parsed % 24;
  } catch {
    const utcHour = new Date(date.getTime() + 5 * 60 * 60 * 1000).getUTCHours();
    return utcHour;
  }
}

/**
 * Нерабочие часы магазина в Алматы (после 21:00 и ночью до 10:00 утра).
 */
export function isOffHoursInAlmaty(date: Date = new Date()): boolean {
  const hour = getAlmatyHour(date);
  return hour >= 21 || hour < 10;
}

/**
 * Коэффициент конвертации:
 * - Будние дни: Покупка рубля ВТБ Казахстан - 5% (множитель 0.95).
 * - Выходные (Сб, Вс): Покупка рубля ВТБ Казахстан - 7% (множитель 0.93).
 *   За базу берётся последняя цена пятницы.
 * - В понедельник: автоматический возврат к обычной формуле (0.95).
 */
export function getRubMultiplier(date: Date = new Date()): number {
  return isWeekendInAlmaty(date) ? 0.93 : 0.95;
}

/**
 * RUB = KZT / (VTB KZ buy rate × multiplier). Считает backend, не Claude.
 * Пример из ТЗ (будни): 45 000 / (5.15 × 0.95) ≈ 9 198 ₽.
 * Выходные: 45 000 / (5.15 × 0.93) ≈ 9 396 ₽.
 */
export function priceRub(priceKzt: number, vtbBuyRate: number, date: Date = new Date()): number {
  if (!(priceKzt > 0) || !(vtbBuyRate > 0)) return 0;
  const multiplier = getRubMultiplier(date);
  return Math.round(priceKzt / (vtbBuyRate * multiplier));
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
