export type RateSourceKind = "vtb" | "finkaz" | "manual" | "other";

export function rateSourceKind(source: string | undefined): RateSourceKind {
  if (!source) return "other";
  if (source === "manual") return "manual";
  if (/finkaz\.kz/i.test(source)) return "finkaz";
  if (/vtb/i.test(source)) return "vtb";
  return "other";
}

/** Котировка ВТБ: курс покупки рубля банком и, если удалось разобрать, курс продажи. */
export type VtbRateQuote = { buy: number; sell?: number };

/** RUB/KZT вне этого коридора — не курс, а что-то другое со страницы. */
const RATE_MIN = 1;
const RATE_MAX = 20;

function plausibleRate(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > RATE_MIN && n < RATE_MAX ? n : null;
}

/**
 * Котировка из одной записи API.
 *
 * Берём именно coursePurchase. Продавец отдельно спрашивал, не подставляем ли
 * мы курс продажи: на 4 сентября это 4.79 против 5.79, и по формуле
 * ₸ / (курс × 0,95) разница в рублёвой цене — около 20%.
 */
function quoteFromItem(item: Record<string, unknown> | null | undefined): VtbRateQuote | null {
  if (!item) return null;
  // `rate` — плоская форма из самодельного эндпоинта в CONSULTANT_VTB_RATE_URL;
  // она идёт последней, чтобы явный coursePurchase всегда был важнее.
  const buy = plausibleRate(item.coursePurchase ?? item.buy ?? item.purchase ?? item.rate);
  const sell = plausibleRate(item.courseSell ?? item.courseSale ?? item.sell ?? item.sale);
  if (buy == null) return null;
  // Банк всегда покупает рубль дешевле, чем продаёт. Если пришло наоборот —
  // поля поменялись местами, и «покупка» на самом деле продажа. Угадывать тут
  // нельзя: лучше не обновить курс и показать это в админке, чем тихо начать
  // считать цены по чужому числу.
  if (sell != null && buy >= sell) return null;
  return sell == null ? { buy } : { buy, sell };
}

function findRubKzt(list: unknown[]): Record<string, unknown> | null {
  const rows = list.filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object");
  const isRubKzt = (i: Record<string, unknown>) =>
    i.baseCurrencyIsoCode === "RUB" && i.currencyIsoCode === "KZT";
  const cashless = rows.find(
    (i) =>
      isRubKzt(i) &&
      (i.typeId === 2 || (i.type as Record<string, unknown> | undefined)?.value === "CASHLESS"),
  );
  return cashless ?? rows.find(isRubKzt) ?? null;
}

function tryJsonQuote(body: string): VtbRateQuote | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  // Массив курсов ВТБ Онлайн (online-api.vtb.kz/api/exchange-rate/by-currencyMob/).
  if (Array.isArray(parsed)) return quoteFromItem(findRubKzt(parsed));

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const list = obj.data ?? obj.items ?? obj.rates;
    if (Array.isArray(list)) {
      const fromList = quoteFromItem(findRubKzt(list));
      if (fromList) return fromList;
    }
    const direct = quoteFromItem(obj);
    if (direct) return direct;
    const rub = obj.rub;
    if (rub && typeof rub === "object") return quoteFromItem(rub as Record<string, unknown>);
  }
  return null;
}

/**
 * Запасной разбор HTML страницы курсов, если API отдал не JSON.
 *
 * Два правила, чтобы под видом покупки не приехало что попало:
 *  1. рядом с RUB должно быть слово «покупка»/«buy» — иначе это не таблица
 *     курсов банка (RSS НБРК с одним числом под RUB так и отсекается);
 *  2. из строки берём МИНИМАЛЬНОЕ правдоподобное число. В таблице банка
 *     покупка всегда ниже продажи, так что 5.79 структурно не может занять
 *     место 4.79 — даже если колонки поменяют местами.
 */
function tryHtmlQuote(body: string): VtbRateQuote | null {
  const compact = body.replace(/\s+/g, " ");
  const anchor = compact.match(/RUB|российск\w*\s+рубл\w*/i);
  if (!anchor || anchor.index == null) return null;

  const from = Math.max(0, anchor.index - 200);
  const context = compact.slice(from, anchor.index + anchor[0].length + 160);
  if (!/покуп\w*|buy/i.test(context)) return null;

  const row = compact.slice(anchor.index + anchor[0].length, anchor.index + anchor[0].length + 160);
  const numbers = [...row.matchAll(/\d+[.,]\d{1,4}/g)]
    .map((m) => plausibleRate(m[0].replace(",", ".")))
    .filter((n): n is number => n != null);

  // Ноль чисел — разбирать нечего; больше двух — в окно попала соседняя
  // строка таблицы, и какое из чисел про рубль, уже не понять.
  if (numbers.length === 0 || numbers.length > 2) return null;
  const buy = Math.min(...numbers);
  const sell = numbers.length > 1 ? Math.max(...numbers) : undefined;
  return sell == null ? { buy } : { buy, sell };
}

/**
 * Курс ВТБ Казахстан из ответа API или страницы курсов.
 * Никаких сторонних банков (НБРК) — клиенту нужен исключительно ВТБ.
 */
export function parseVtbRateQuote(body: string): VtbRateQuote | null {
  return tryJsonQuote(body) ?? tryHtmlQuote(body);
}

/** Курс покупки рубля банком — то самое число, от которого считается цена в ₽. */
export function parseVtbBuyRate(body: string): number | null {
  return parseVtbRateQuote(body)?.buy ?? null;
}
