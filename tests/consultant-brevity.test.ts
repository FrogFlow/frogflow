import { describe, expect, it } from "vitest";
import { cleanEmptyPraise } from "../src/lib/consultant/validate";
import { matchCountry, matchUnsupportedCountry } from "../src/lib/consultant/intent";

/**
 * Продавец 22.09, голосовым и следом текстом: «надо как то совсем просто —
 * вопрос-ответ, без лишних слов и информации».
 */
describe("без лишних слов", () => {
  it("на вопрос о цвете и цене остаются цвет, цена и уточняющий вопрос", () => {
    const live =
      "Добрый день. В публикации представлены два размера полотенец для ног Uchino Merveille " +
      "белого цвета: • 35x50 см — 27 000 ₸ (в наличии) • 50x80 см — 52 000 ₸ (в наличии) " +
      "Это премиальные махровые полотенца японского бренда Uchino. Изготовлены из натурального " +
      "хлопка высокого качества, отличаются мягкостью, впитываемостью и долговечностью. " +
      "Соответствуют международным стандартам комфорта и качества. Какой размер вас интересует?";
    const out = cleanEmptyPraise(live);
    expect(out).not.toMatch(/международным стандартам/i);
    expect(out).not.toMatch(/отличаются мягкостью/i);
    // Цены, размеры и марка — это ответ, их не трогаем.
    expect(out).toContain("27 000 ₸");
    expect(out).toContain("52 000 ₸");
    expect(out).toContain("Uchino Merveille");
    expect(out).toContain("Какой размер вас интересует?");
  });

  it("дежурное «с удовольствием помогу» уходит", () => {
    expect(
      cleanEmptyPraise(
        "Доставляем только по Казахстану и в Россию. Если у вас есть вопросы о товарах, " +
          "я с удовольствием помогу.",
      ),
    ).toBe("Доставляем только по Казахстану и в Россию.");
    expect(cleanEmptyPraise("Подскажу по размерам. Буду рад помочь.")).toBe("Подскажу по размерам.");
  });

  it("предложение с фактом не режется, даже если хвалит", () => {
    const withFact = "Полотенце Uchino Merveille 50x80 высочайшего качества — 52 000 ₸.";
    expect(cleanEmptyPraise(withFact)).toBe(withFact);
  });

  it("обычный ответ и перечень позиций проходят насквозь", () => {
    const list = "• 35x50 см — 27 000 ₸\n• 50x80 см — 52 000 ₸";
    expect(cleanEmptyPraise(list)).toBe(list);
    const plain = "Белый, серый и бежевый в наличии.";
    expect(cleanEmptyPraise(plain)).toBe(plain);
  });

  it("если похвала была всем ответом — оставляем, молчать нельзя", () => {
    const only = "Соответствуют международным стандартам качества.";
    expect(cleanEmptyPraise(only)).toBe(only);
  });
});

/**
 * Живой диалог 22.09, @inameleshko: «Делаете доставку в Израиль?» → бот
 * спросил страну → «Израиль» → бот спросил ровно то же самое второй раз.
 * Продавец: «почему то два раза тут спросил про страну».
 */
describe("страна, в которую мы не возим", () => {
  it("узнаём ответ на наш же вопрос", () => {
    expect(matchUnsupportedCountry("Израиль")).toBe(true);
    expect(matchUnsupportedCountry("Я из Израиля")).toBe(true);
    expect(matchUnsupportedCountry("Германия")).toBe(true);
    expect(matchUnsupportedCountry("Узбекистан")).toBe(true);
  });

  it("Казахстан и Россию сюда не пускаем — они разбираются обычным путём", () => {
    expect(matchUnsupportedCountry("Казахстан 🇰🇿")).toBe(false);
    expect(matchUnsupportedCountry("Россия")).toBe(false);
    expect(matchCountry("Казахстан 🇰🇿")).toBe("KZ");
  });

  it("страна бренда — не страна покупателя", () => {
    // Половина каталога — европейские марки, и покупатели зовут их по стране.
    expect(matchUnsupportedCountry("Мне голландские с птичками понравились")).toBe(false);
    expect(matchUnsupportedCountry("Хочу итальянское постельное")).toBe(false);
    expect(matchUnsupportedCountry("а сколько стоит?")).toBe(false);
  });
});
