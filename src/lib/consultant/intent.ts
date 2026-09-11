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
