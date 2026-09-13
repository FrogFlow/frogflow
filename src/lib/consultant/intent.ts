export type ConsultantCountry = "KZ" | "RU";

/** `\b` в JS не граница для кириллицы — без него «Казахстан» не матчится. */
const PURCHASE_RE =
  /оформляем|оформить|оформление|беру|возьму|покупаю|оплатить|оплата|куда\s+платить|давайте\s+оформ|менеджер|свяжите|хочу\s+заказать/i;

const KZ_RE = /казахстан|қазақстан|(^|[^a-zа-яё])kz([^a-zа-яё]|$)|алматы|астана|шымкент/i;
const RU_RE = /росси[яиию]|рф|russia|(^|[^a-zа-яё])ru([^a-zа-яё]|$)|москва|питер/i;

export function matchPurchaseIntent(text: string): boolean {
  const t = text.trim();
  if (/посовет|что\s+(взять|выбрать|купить)|бюджет|только\s+\d/i.test(t)) {
    if (!/оформ|оплат|менеджер|свяжите|куда\s+платить/i.test(t)) return false;
  }
  if (PURCHASE_RE.test(t)) return true;
  if (/^давайте[.!?…]*$/i.test(t)) return true;
  return /давайте\s+(оформ|заказ|куп|плат)/i.test(t);
}

export function matchCountry(text: string): ConsultantCountry | null {
  const t = text.trim();
  const kz = KZ_RE.test(t);
  const ru = RU_RE.test(t);
  if (kz && !ru) return "KZ";
  if (ru && !kz) return "RU";
  return null;
}

export const FORBIDDEN_PHRASES = [
  "отлично",
  "прекрасный выбор",
  "прекрасный",
  "замечательно",
  "будем рады помочь",
  "передаю ваш диалог менеджеру",
  "передаю менеджеру",
  "наверное",
  "примерно",
  "скорее всего",
  "думаю есть",
  "бесплатн",
  "скидк",
] as const;

export function containsForbiddenPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.some((p) => lower.includes(p));
}

const GREETING_RE =
  /^(привет|здравствуйте|добрый\s+(день|вечер)|hi|hello|хай)([.!?…\s]|👋|🙏)*$/i;

export function isConsultantGreeting(text: string): boolean {
  return GREETING_RE.test(text.trim());
}

/** Свободные «чем помочь / мы продаём» — не запрос в прайс и не реплика клиента. */
export function looksLikeVagueHelp(text: string): boolean {
  return /чем\s+(я\s+)?могу\s+помочь|напишите[,\s]+что\s+вас\s+интересует|жду\s+вашего|я\s+здесь[,\s]+чтобы|мы\s+прода[её]м|что\s+вас\s+интересует|я\s+жду\s+вашего/i.test(
    text,
  );
}

/**
 * После страны почти любой осмысленный текст — про товар.
 * «я из России» / «привет» не считаем запросом в прайс.
 */
export function looksLikeProductQuery(text: string): boolean {
  const t = text.trim();
  if (!t || GREETING_RE.test(t)) return false;
  if (looksLikeVagueHelp(t)) return false;
  if (matchPurchaseIntent(t)) return false;
  const country = matchCountry(t);
  if (country) {
    const leftover = t
      .replace(KZ_RE, " ")
      .replace(RU_RE, " ")
      .replace(/я\s+из|из|страна|мы\s+из/gi, " ")
      .replace(/[.!?…,]/g, " ")
      .trim();
    const tokens = leftover.split(/\s+/).filter((w) => w.length > 1);
    if (tokens.length === 0) return false;
  }
  return true;
}

export function matchCatalogIntent(text: string): boolean {
  return /полн(ый|ым)\s+каталог|весь\s+ассортимент|сайт|bovi\.kz|ссылк\w*\s+на\s+(сайт|каталог)/i.test(
    text,
  );
}

export function matchOtherCategoriesIntent(text: string): boolean {
  return /друг(ие|ие категории|ое)|что ещё|что еще|какие категори|ассортимент(?!\s+полный)/i.test(
    text,
  );
}

/** «Что посоветуете для дома?» — показать категории, не «нет в наличии». */
export function matchAdviceIntent(text: string): boolean {
  return /посовет|порекоменд|что\s+(взять|выбрать|подобрать|можете|купить)|для\s+дома|что\s+есть\b|какие\s+(товар|категор)|покажите\s+(что|ассортимент)|бюджет|только\s+\d|предложи/i.test(
    text,
  );
}

/** «А ещё варианты?» — другие карточки той же категории, не повтор. */
export function matchMoreVariantsIntent(text: string): boolean {
  return /ещё\s+вариант|еще\s+вариант|другие\s+вариант|другой\s+(цвет|размер)|другие\s+(цвет|размер|есть)|а\s+ещё\s*\??$|ещё\s+есть\??$/i.test(
    text.trim(),
  );
}

/** «Соберите корзину / набор на N» — не товар «комплект белья» / «набор полотенец». */
export function matchBasketIntent(text: string): boolean {
  if (/корзин/i.test(text)) return true;
  if (/(собери|соберите).{0,32}(набор|комплект)/i.test(text)) return true;
  if (/(набор|комплект).{0,24}(на\s+\d|бюджет|до\s+\d)/i.test(text)) return true;
  return false;
}

/**
 * Бюджет из живой фразы: «только 15000», «корзину на 20 000».
 * Размер 50×70 и мелкие числа не считаем деньгами.
 */
export function extractBudgetKzt(text: string): number | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (!/(только|бюджет|до|на|около|корзин|набор|комплект|посовет|предложи|подбер)/i.test(t)) {
    return null;
  }
  const tagged =
    t.match(
      /(?:только|бюджет|до|на|около)\s*(\d[\d\s]{2,8})\s*(?:₸|тг|тенге|тыс(?:яч)?|к\b)?/i,
    ) ?? t.match(/(\d[\d\s]{2,8})\s*(?:₸|тг|тенге)/i);
  const raw = tagged?.[1] ?? t.match(/(\d[\d\s]{3,8})/)?.[1];
  if (!raw) return null;
  const n = Number(raw.replace(/\s/g, ""));
  if (!Number.isFinite(n) || n < 1000 || n > 10_000_000) return null;
  return n;
}

export function matchCountryPostback(payload: string | null | undefined): ConsultantCountry | null {
  if (!payload) return null;
  if (payload === "CONSULTANT_COUNTRY:KZ") return "KZ";
  if (payload === "CONSULTANT_COUNTRY:RU") return "RU";
  return null;
}
