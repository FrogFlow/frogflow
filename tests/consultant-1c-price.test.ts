import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "../src/lib/consultant/catalog-import";

/**
 * Слепок боевой выгрузки 1С «Остатки товара по складам с ценами» (10.09.2026):
 * преамбула, двухстрочная шапка, иерархия папок и цена вида «47,000   KZT»,
 * где запятая — разделитель ТЫСЯЧ. На живом файле из 879 строк с ценой
 * прежний разбор возвращал 0 товаров и 0 ошибок.
 */
const REPORT = [
  "Сформирован: 10.09.2026 15:52:22;;;;;;;",
  "Остатки товара по складам с ценами;;;;;;;",
  ";;;;;;;",
  "Параметры:;;Период: 10.09.2026 15:52:00;;;;;",
  ";;Тип цен: Розничная;;;;;",
  ";;;;;;;",
  "Номенклатура;;;;;Розничная;;",
  ";;;;;Цена;;Остаток",
  "Aquanova (Бельгия);;;;;;;",
  "Коврики;;;;;;;",
  "Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый;;;;;47,000   KZT;;1",
  "Dorelan (Италия);;;;;;;",
  "Матрасы;;;;;;;",
  "Dorelan LEVANT R4 SOFT 160x200;;;;;1,200,000   KZT;;2",
  "Мелочи;;;;;;;",
  "Пробник;;;;;5   KZT;;3",
].join("\n");

describe("выгрузка 1С", () => {
  const { products, errors } = parseCatalogCsv(REPORT);

  it("читает цену, где запятая — разделитель тысяч", () => {
    expect(products.map((p) => p.price_kzt)).toEqual([47_000, 1_200_000, 5]);
  });

  it("не путает тысячи с копейками", () => {
    // Наивное «заменить запятую на точку» дало бы 47 ₸ за коврик и
    // 1,2 ₸ за матрас — ошибку в тысячу раз в цене для покупателя.
    expect(products[0].price_kzt).not.toBe(47);
    expect(products[1].price_kzt).not.toBeCloseTo(1.2);
  });

  it("строки-папки становятся категорией, а не ошибкой", () => {
    expect(products[0].category).toBe("Коврики");
    expect(products[1].category).toBe("Матрасы");
    expect(errors).toHaveLength(0);
  });

  it("остаток и наличие читаются", () => {
    expect(products.map((p) => p.stock_qty)).toEqual([1, 2, 3]);
    expect(products.every((p) => p.stock)).toBe(true);
  });

  it("десятичная цена по-прежнему понимается", () => {
    const csv = "Номенклатура;Цена;Остаток\nПлед;12500,50;2";
    expect(parseCatalogCsv(csv).products[0].price_kzt).toBeCloseTo(12500.5);
  });

  it("пустой разбор больше не молчит", () => {
    const broken = [
      "Номенклатура;;;;;Розничная;;",
      ";;;;;Цена;;Остаток",
      "Товар без цены;;;;;;;",
      "Ещё один;;;;;;;",
    ].join("\n");
    const res = parseCatalogCsv(broken);
    expect(res.products).toHaveLength(0);
    expect(res.errors.map((e) => e.message).join(" ")).toMatch(/ни одной позиции с ценой/);
  });
});
