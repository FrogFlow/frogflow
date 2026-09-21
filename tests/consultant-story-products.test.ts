import { describe, expect, it } from "vitest";
import { dedupe, legacyColumnsOf, storyProductsOf } from "../src/lib/consultant/story-products";

/**
 * Продавец снимает сторис, где лежат простыня, пододеяльник и наволочки, и
 * просит, чтобы бот знал их все. Раньше товар был ровно один: три колонки
 * product_name, product_price_kzt, product_id.
 *
 * Список живёт в колонке products, старые три колонки хранят ПЕРВЫЙ товар —
 * на них смотрит уже выложенный код, и ломать его ради нового поля незачем.
 */
describe("товары, привязанные к истории", () => {
  it("читает список из новой колонки", () => {
    const tag = {
      products: [
        { id: "sheet-1", name: "Простыня BOVI 180x200", price_kzt: 45000 },
        { id: "duvet-1", name: "Пододеяльник BOVI 200x220", price_kzt: 62000 },
      ],
      product_name: "Простыня BOVI 180x200",
      product_price_kzt: 45000,
      product_id: "sheet-1",
    };
    expect(storyProductsOf(tag).map((p) => p.name)).toEqual([
      "Простыня BOVI 180x200",
      "Пододеяльник BOVI 200x220",
    ]);
  });

  it("старая привязка без списка читается как один товар", () => {
    // Миграция только добавляет колонку: у всех записей до неё products пуст.
    const tag = { product_name: "Полотенце Uchino 50x70", product_price_kzt: 32000, product_id: "u-1" };
    expect(storyProductsOf(tag)).toEqual([
      { id: "u-1", name: "Полотенце Uchino 50x70", price_kzt: 32000 },
    ]);
  });

  it("список строкой JSON тоже читается", () => {
    const tag = { products: '[{"name":"Наволочка BOVI 50x70","price_kzt":18000}]' };
    expect(storyProductsOf(tag).map((p) => p.name)).toEqual(["Наволочка BOVI 50x70"]);
  });

  it("пустой список откатывается на старые колонки, а не теряет товар", () => {
    const tag = { products: [], product_name: "Плед BOVI", product_price_kzt: 70000, product_id: null };
    expect(storyProductsOf(tag).map((p) => p.name)).toEqual(["Плед BOVI"]);
  });

  it("мусор в списке отбрасывается по одной позиции", () => {
    const tag = {
      products: [{ name: "Простыня BOVI", price_kzt: 45000 }, { name: "" }, null, 42],
      product_name: "Простыня BOVI",
    };
    expect(storyProductsOf(tag)).toHaveLength(1);
  });

  it("ничего не привязано — пустой список, а не падение", () => {
    expect(storyProductsOf(null)).toEqual([]);
    expect(storyProductsOf({})).toEqual([]);
    expect(storyProductsOf({ product_name: "   " })).toEqual([]);
  });
});

describe("повторы и старые колонки", () => {
  it("один товар, добавленный дважды, показывается один раз", () => {
    const list = [
      { id: "s-1", name: "Простыня", price_kzt: 45000 },
      { id: "s-1", name: "Простыня", price_kzt: 45000 },
      { id: "d-1", name: "Пододеяльник", price_kzt: 62000 },
    ];
    expect(dedupe(list).map((p) => p.id)).toEqual(["s-1", "d-1"]);
  });

  it("без id повтор ловится по названию", () => {
    const list = [
      { name: "Наволочка", price_kzt: 18000 },
      { name: "наволочка", price_kzt: 18000 },
    ];
    expect(dedupe(list)).toHaveLength(1);
  });

  it("в старые колонки уходит первый товар списка", () => {
    const list = [
      { id: "s-1", name: "Простыня", price_kzt: 45000 },
      { id: "d-1", name: "Пододеяльник", price_kzt: 62000 },
    ];
    expect(legacyColumnsOf(list)).toEqual({
      product_name: "Простыня",
      product_price_kzt: 45000,
      product_id: "s-1",
    });
  });

  it("пустой список сохранять нечего — product_name объявлен NOT NULL", () => {
    expect(legacyColumnsOf([])).toBeNull();
  });
});
