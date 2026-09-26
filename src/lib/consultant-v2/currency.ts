/**
 * Рубли в v2 считает код, а не модель.
 *
 * 25.09, тест на прайсе BOVI (792 позиции): на «сколько в рублях?» модель
 * назвала рубли одиннадцати подушкам, и шесть из них были чужими — у подушки
 * SENSE LOW за 85 000 ₸ стояло 4 494 ₽ стаканчика Blomus, у Swing Extra Light
 * — рубли дорожки Sander, остальное она «примерно» посчитала сама. Тенге при
 * этом все верные: их модель копирует из прайса точно, а вторую цифру в
 * длинной строке путает.
 *
 * Поэтому модель пишет цены только в тенге, а если покупателю нужны рубли,
 * каждая сумма в тенге переводится здесь по той же формуле, что у магазина.
 */
import { priceRub } from "@/lib/consultant/rate";
import type { ConsultantState } from "@/lib/consultant/state";
import type { V2Profile } from "./tools";
import { russianPlaceIn } from "./geo";

/** Сумма в тенге: «85 000 ₸», «85000₸», «85 000 тг», «85 000 тенге». */
const KZT_AMOUNT_RE = /(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)[ \u00a0\u202f]?(?:₸|тг\.?(?![а-яё])|тенге)/gi;

const ASKS_RUBLES_RE = /рубл|₽|(?:^|[^а-яё])руб(?:[^а-яё]|$)|росси|(?:^|[^а-яё])рф(?:[^а-яё]|$)/i;
const ASKS_TENGE_RE = /тенге|₸|(?:^|[^а-яё])тг(?:[^а-яё]|$)|казахстан/i;

/**
 * Валюта, которую покупатель выбрал в этом сообщении: рубли (попросил, назвал
 * Россию или российский город — «доставка в Москву»), тенге — или ничего.
 * В состояние сохраняется только такой выбор, не вывод из профиля: иначе
 * «тенге по умолчанию» с первого сообщения перекрывало страну, которую
 * покупатель назвал позже.
 */
export function currencyAsked(text: string): boolean | undefined {
  if (ASKS_RUBLES_RE.test(text)) return true;
  if (ASKS_TENGE_RE.test(text)) return false;
  if (russianPlaceIn(text)) return true;
  return undefined;
}

/**
 * Нужны ли покупателю рубли: попросил в этом сообщении, раньше в этом диалоге
 * или сказал, что он из России. Попросил тенге — обратно в тенге.
 */
export function wantsRubles(
  text: string,
  state: Pick<ConsultantState, "v2_rub">,
  profile: V2Profile | undefined,
): boolean {
  const asked = currencyAsked(text);
  if (asked !== undefined) return asked;
  if (state.v2_rub !== undefined) return state.v2_rub;
  return /росси|рф|russia/i.test(profile?.country ?? "");
}

/** Суммы в тенге с местом в тексте — для проверок эталонного набора. */
export function findKztAmounts(text: string): { kzt: number; start: number; end: number }[] {
  return [...text.matchAll(KZT_AMOUNT_RE)].map((m) => ({
    kzt: Number(m[1].replace(/[   ]/g, "")),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

/** Все суммы в тенге → рубли по курсу магазина. Без курса текст не меняется. */
export function tengeToRubles(text: string, rate: number | null): string {
  if (!rate || rate <= 0) return text;
  return text.replace(KZT_AMOUNT_RE, (_match, digits: string) => {
    const kzt = Number(digits.replace(/[ \u00a0\u202f]/g, ""));
    if (!Number.isFinite(kzt) || kzt <= 0) return _match;
    return `${priceRub(kzt, rate).toLocaleString("ru-RU")} ₽`;
  });
}
