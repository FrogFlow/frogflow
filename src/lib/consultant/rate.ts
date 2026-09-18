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
  /** Курс покупки рубля банком — от него считается цена в ₽. */
  rate: number;
  updatedAt: string;
  /** URL источника или `manual`. */
  source?: string;
  /**
   * Курс продажи из той же котировки. В расчёте не участвует и нужен только
   * для показа в админке: продавец спрашивал, не подставляем ли мы продажу
   * вместо покупки, и по двум числам рядом это видно сразу.
   */
  sell?: number;
};

let rateCache: { at: number; value: StoredVtbRate | null } | null = null;
const RATE_CACHE_MS = 60_000;

export function rememberStoredVtbRate(value: StoredVtbRate | null): void {
  rateCache = { at: Date.now(), value };
}

/**
 * Сколько курс годится для расчёта цены.
 *
 * Компромисс между двумя потерями. Совсем старый курс — это неправильная
 * цена в рублях у покупателя, и заметят её не скоро. Слишком строгий срок —
 * это бот, который на выходных перестаёт называть цены россиянам из-за
 * сломавшегося на час источника, и потерянные продажи. Трое суток: за это
 * время курс уходит на проценты, а не в разы, и продавец успевает увидеть
 * предупреждение в панели (оно загорается уже через два часа).
 */
export const RATE_MAX_AGE_HOURS = 72;

export function isRateFresh(rate: StoredVtbRate | null, now: number = Date.now()): boolean {
  if (!rate?.rate) return false;
  const ageHours = (now - Date.parse(rate.updatedAt)) / 36e5;
  return Number.isFinite(ageHours) && ageHours <= RATE_MAX_AGE_HOURS;
}

/**
 * Курс для расчёта цены покупателю. Протухший не отдаём: пусть бот честно
 * скажет, что рублёвую сумму подтвердит менеджер, чем назовёт позапрошлую.
 */
export async function getFreshVtbRate(): Promise<StoredVtbRate | null> {
  const stored = await getStoredVtbRate();
  return isRateFresh(stored) ? stored : null;
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
    const sell = Number(parsed.sell);
    const value = {
      rate,
      updatedAt: String(parsed.updatedAt),
      source: parsed.source ? String(parsed.source) : undefined,
      ...(sell > 0 ? { sell } : {}),
    };
    rememberStoredVtbRate(value);
    return value;
  } catch {
    return null;
  }
}
