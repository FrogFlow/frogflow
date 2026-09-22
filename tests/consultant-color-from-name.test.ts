import { describe, expect, it } from "vitest";
import { extractColorsFromName } from "../src/lib/consultant/catalog-import";

/**
 * Живой тест 22.09. На «какие расцветки есть и какая стоимость у air waffle»
 * бот ответил «цены от 26 500 ₸» и пообещал уточнить расцветки позже.
 *
 * И он был прав. В боевом каталоге пять позиций Air Waffle, две из них
 * одного размера 60x100 с разной ценой — 26 500 и 28 000, — и различал их
 * только цвет. Цвета в данных не было: поле пустое у 309 позиций из 792,
 * и у 69 из них цвет написан прямо в названии. Назвать такие позиции
 * списком значило напечатать две одинаковые строки с разными ценами.
 *
 * Разбор требовал пометки «цв.» — так пишет только часть выгрузки. Вторая
 * часть пишет цвет просто последним словом.
 */
describe("цвет из названия без пометки «цв.»", () => {
  it("берёт цвет, написанный словом", () => {
    expect(extractColorsFromName("Uchino Полотенце вафельное Air Waffle, 60x100, бежевый")).toEqual([
      "бежевый",
    ]);
    expect(extractColorsFromName("Uchino Полотенце вафельное Air Waffle, 70x140, серый")).toEqual([
      "серый",
    ]);
    expect(extractColorsFromName("Blomus SONO Ершик, розовый")).toEqual(["розовый"]);
    expect(extractColorsFromName("Cote Noire Persian Lime подарочный набор бирюзовый из 5 ед.")).toEqual([
      "бирюзовый",
    ]);
  });

  it("раскрывает сокращения выгрузки", () => {
    expect(extractColorsFromName("FEILER Полотенце махровое DJAMAL 221 син. 50х100")).toEqual(["синий"]);
    expect(extractColorsFromName("Feiler Полотенце махровое FLOWER MEADOW 50х100 голуб.")).toEqual([
      "голубой",
    ]);
    expect(extractColorsFromName("FEILER Полотенце махровое MARGO 50х100 зелен")).toEqual(["зелёный"]);
  });

  it("оттенок через дефис остаётся оттенком", () => {
    expect(extractColorsFromName("BOVI Наволочка светло-беж")).toEqual(["светло-бежевый"]);
    expect(extractColorsFromName("Blomus SONO Подставка для аксессуаров, темно-корич.")).toEqual([
      "темно-коричневый",
    ]);
  });

  /**
   * Окончание проверяется целиком, иначе «бел» ловит «бельё», а «сер» —
   * «сервиз». На этом такой разбор обычно и ломается.
   */
  it("не принимает за цвет часть другого слова", () => {
    for (const name of [
      "Полотенце для белья",
      "Комплект постельного белья",
      "BOVI Сервиз столовый на 6 персон",
      "Полотенце серия Classic",
      "Arthur Price Avalon лопатка для торта в подарочной упаковке",
    ]) {
      expect(extractColorsFromName(name), name).toEqual([]);
    }
  });

  it("пометка «цв.» по-прежнему главнее", () => {
    expect(extractColorsFromName("BOVI Простыня 180x200, цв. молочный")).toEqual(["молочный"]);
  });
});
