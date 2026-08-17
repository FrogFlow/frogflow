import { describe, it, expect } from "vitest";
import { materialsForProduct, hasAnyMaterial } from "../src/lib/product-materials";

/**
 * Тот самый товар, на котором потерялся оплаченный заказ №484 из Instagram:
 * файл у него есть, но лежит только в product_material_files, а снимок заказа
 * копировал одни старые поля file_path/file_url — и выдача не нашла ничего.
 */
const multiFileProduct = {
  file_path: null,
  file_name: null,
  file_url: null,
  product_material_files: [
    { language: "ru", file_path: "376/oformlenie.pdf", file_name: "Оформление.pdf", sort_order: 1 },
  ],
};

const legacyProduct = {
  file_path: "001/kartochki.pdf",
  file_name: "Карточки.pdf",
  file_url: null,
  product_material_files: [],
};

describe("materialsForProduct", () => {
  it("берёт файлы из product_material_files", () => {
    expect(materialsForProduct(multiFileProduct, "ru")).toEqual([
      { path: "376/oformlenie.pdf", name: "Оформление.pdf", url: null },
    ]);
  });

  it("сохраняет порядок, заданный продавцом", () => {
    const product = {
      product_material_files: [
        { language: "ru", file_path: "b.pdf", file_name: "Б", sort_order: 2 },
        { language: "ru", file_path: "a.pdf", file_name: "А", sort_order: 1 },
      ],
    };
    expect(materialsForProduct(product, "ru").map((m) => m.path)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("не путает языки", () => {
    const product = {
      product_material_files: [
        { language: "kz", file_path: "kz.pdf", file_name: "KZ", sort_order: 1 },
      ],
    };
    expect(materialsForProduct(product, "ru")).toEqual([]);
    expect(materialsForProduct(product, "kz")).toHaveLength(1);
  });

  it("падает на старые поля, когда таблицы файлов нет", () => {
    expect(materialsForProduct(legacyProduct, "ru")).toEqual([
      { path: "001/kartochki.pdf", name: "Карточки.pdf", url: null },
    ]);
    expect(materialsForProduct({ file_url: "https://disk/file.zip" }, "ru")).toEqual([
      { path: null, name: null, url: "https://disk/file.zip" },
    ]);
  });

  it("у товара без файлов не выдумывает материал", () => {
    expect(materialsForProduct({}, "ru")).toEqual([]);
    expect(materialsForProduct(null, "ru")).toEqual([]);
  });
});

/**
 * Проверка «можно ли продавать» и снимок в заказ обязаны считать одинаково:
 * из их расхождения и вырос заказ, который приняли к оплате, но выдать не
 * смогли.
 */
describe("hasAnyMaterial", () => {
  it("считает так же, как снимок", () => {
    expect(hasAnyMaterial(multiFileProduct)).toBe(true);
    expect(hasAnyMaterial(legacyProduct)).toBe(true);
    expect(hasAnyMaterial({ file_path_kz: "kz/file.pdf" })).toBe(true);
    expect(hasAnyMaterial({})).toBe(false);
    // Запись без пути файлом не является, сколько бы строк ни было в таблице.
    expect(hasAnyMaterial({ product_material_files: [{ language: "ru", file_path: null }] })).toBe(
      false,
    );
  });
});
