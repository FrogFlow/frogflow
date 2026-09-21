import { describe, expect, it } from "vitest";
import {
  findProducts,
  isDemoMarked,
  isHiddenProduct,
  isNotForSale,
  sellableProducts,
  stripDemoMarking,
  withoutDemoMarking,
} from "../src/lib/consultant/catalog";
import { cleanDemoMentions, mentionsDemoSample } from "../src/lib/consultant/validate";

/**
 * Продавец ведёт пометку «демонстрационный» в прайсе для себя: часть позиций
 * стоит в салоне образцами. Бот пересказывал её покупателю — «Это
 * демонстрационная модель в нашем салоне» прямо в ответе о цене матраса.
 * Написания в прайсе живые, вплоть до опечатки: «(демонстр.)»,
 * «(демонстарационный)», «демонстраци подушк».
 */
const product = (name: string, category: string, over = {}) => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  category,
  size: "",
  colors: [] as string[],
  price_kzt: 2_700_000,
  stock: true,
  ...over,
});

describe("пометка «демонстрационный» в каталоге", () => {
  it("узнаётся и в названии, и в категории", () => {
    expect(isDemoMarked(product("Dorelan матрас EPIC R3 COMFORT 182х202 (демонстарационный)", "Матрасы"))).toBe(true);
    expect(isDemoMarked(product("Dorelan матрас Tresor 182x202", "Демонстрационные позиции"))).toBe(true);
    expect(isDemoMarked(product("Dorelan матрас Levant 90х200", "Матрасы"))).toBe(false);
  });

  it("снимается из названия во всех написаниях прайса", () => {
    expect(stripDemoMarking("Dorelan матрас пружинно-пенный EPIC R3 COMFORT 182х202 (демонстарационный)"))
      .toBe("Dorelan матрас пружинно-пенный EPIC R3 COMFORT 182х202");
    expect(stripDemoMarking("Dorelan защитная дорожка под голову HEADREST 49Х100 (демонстр.)"))
      .toBe("Dorelan защитная дорожка под голову HEADREST 49Х100");
    expect(stripDemoMarking("Dorelan Демонстрационный матрас пружинно-пенный LEVANT R3 90х200"))
      .toBe("Dorelan матрас пружинно-пенный LEVANT R3 90х200");
    expect(stripDemoMarking("Frankenstolz демонстраци подушк двусторонняя, 55х55"))
      .toBe("Frankenstolz подушк двусторонняя, 55х55");
  });

  it("служебная категория обнуляется, обычная остаётся", () => {
    expect(withoutDemoMarking(product("Матрас Tresor 182x202 (демонстр.)", "Демонстрационные позиции")))
      .toMatchObject({ name: "Матрас Tresor 182x202", category: "" });
    expect(withoutDemoMarking(product("Матрас Levant 90х200", "Матрасы")).category).toBe("Матрасы");
  });

  it("позиция без пометки не трогается вовсе", () => {
    const clean = product("Dorelan матрас Levant 90х200", "Матрасы");
    expect(withoutDemoMarking(clean)).toBe(clean);
  });

  it("название, ставшее пустым после чистки, остаётся прежним", () => {
    // Пустая строка в каталоге хуже служебного слова: позиция станет безымянной.
    expect(withoutDemoMarking(product("Демонстрационный", "Демонстрационные позиции")).name)
      .toBe("Демонстрационный");
  });

  it("обнулённая категория не мешает найти товар по названию", () => {
    const rows = [withoutDemoMarking(product("Dorelan матрас EPIC R3 COMFORT 182х202 (демонстр.)", "Демонстрационные позиции"))];
    const found = findProducts({ query: "матрас epic" }, rows);
    expect(found.all.map((p) => p.name)).toEqual(["Dorelan матрас EPIC R3 COMFORT 182х202"]);
  });
});

describe("пометка в готовом ответе — вторая линия", () => {
  it("вырезает предложение про образец, оставляя цену и название", () => {
    const reply =
      "У нас есть матрас Dorelan EPIC R3 COMFORT 182x202 — 2 700 000 ₸. Это демонстрационная модель в нашем салоне. Показать другие размеры?";
    expect(cleanDemoMentions(reply)).toBe(
      "У нас есть матрас Dorelan EPIC R3 COMFORT 182x202 — 2 700 000 ₸. Показать другие размеры?",
    );
  });

  it("обычный ответ не трогает", () => {
    const reply = "Матрас Dorelan Levant 90х200 — 850 000 ₸. Показать расцветки?";
    expect(cleanDemoMentions(reply)).toBe(reply);
  });

  it("если про образец был весь ответ, оставляет исходный текст", () => {
    // Пустое сообщение покупателю хуже, чем лишнее слово.
    const reply = "Это демонстрационная модель.";
    expect(cleanDemoMentions(reply)).toBe(reply);
  });

  it("узнаёт написания прайса", () => {
    expect(mentionsDemoSample("Это демонстрационный образец")).toBe(true);
    expect(mentionsDemoSample("матрас (демонстр.)")).toBe(true);
    expect(mentionsDemoSample("Матрас упругий, 182х202")).toBe(false);
  });
});

/**
 * «Не для продажи» — другая пометка и другое поведение. В прайсе нашлась
 * позиция «Frankenstolz Демонстрационный Плед (не для продажи)» с ценой
 * 70 000 ₸ и остатком, как у обычного товара. Сняв с неё «демонстрационный»,
 * её нельзя оставить в продаже: получится обычный с виду товар, который
 * магазин не продаёт.
 */
describe("«не для продажи» скрывается целиком", () => {
  const blanket = product("Frankenstolz Демонстрационный Плед ткань A1060/B2011 (не для продажи)", "Демонстрационные товары", { price_kzt: 70_000 });

  it("узнаётся по пометке", () => {
    expect(isNotForSale(blanket)).toBe(true);
    expect(isNotForSale(product("Плед Frankenstolz A1060", "Пледы"))).toBe(false);
  });

  it("не всплывает в поиске ни по названию, ни по категории", () => {
    expect(findProducts({ query: "плед" }, [blanket]).all).toEqual([]);
    expect(findProducts({ query: "frankenstolz" }, [blanket]).all).toEqual([]);
  });

  it("скрыто и снятое с производства, и непродаваемое", () => {
    const medium = product("Dorelan матрас LEVANT R3 MEDIUM 90х200", "Матрасы");
    const normal = product("Dorelan матрас EPIC R3 COMFORT 182х202", "Матрасы");
    expect(isHiddenProduct(medium)).toBe(true);
    expect(isHiddenProduct(blanket)).toBe(true);
    expect(isHiddenProduct(normal)).toBe(false);
    expect(sellableProducts([medium, blanket, normal])).toEqual([normal]);
  });
});
