export type ConsultantCountry = "KZ" | "RU";

/** `\b` в JS не граница для кириллицы — без него «Казахстан» не матчится. */
const PURCHASE_RE =
  /оформляем|оформить|оформление|беру|возьму|покупаю|купить|оплатить|оплата|куда\s+платить|давайте\s+оформ|менеджер|свяжите|хочу\s+заказать/i;

const KZ_RE = /казахстан|қазақстан|(^|[^a-zа-яё])kz([^a-zа-яё]|$)|алматы|астана|шымкент/i;
const RU_RE = /росси[яиию]|рф|russia|(^|[^a-zа-яё])ru([^a-zа-яё]|$)|москва|питер/i;

export function matchPurchaseIntent(text: string): boolean {
  const t = text.trim();
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

/**
 * После страны почти любой осмысленный текст — про товар.
 * «я из России» / «привет» не считаем запросом в прайс.
 */
export function looksLikeProductQuery(text: string): boolean {
  const t = text.trim();
  if (!t || GREETING_RE.test(t)) return false;
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
  return /посовет|порекоменд|что\s+(взять|выбрать|подобрать|можете)|для\s+дома|что\s+есть\b|какие\s+(товар|категор)|покажите\s+(что|ассортимент)/i.test(
    text,
  );
}

export function matchCountryPostback(payload: string | null | undefined): ConsultantCountry | null {
  if (!payload) return null;
  if (payload === "CONSULTANT_COUNTRY:KZ") return "KZ";
  if (payload === "CONSULTANT_COUNTRY:RU") return "RU";
  return null;
}
