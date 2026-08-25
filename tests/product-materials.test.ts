import { describe, it, expect } from "vitest";
import {
  materialsForProduct,
  hasAnyMaterial,
  availableMaterialLanguages,
  materialsForOrderItem,
  materialsForOrderItemAnyLang,
  availableOrderItemLanguages,
  parseDeliveredLanguages,
  addDeliveredLanguage,
} from "../src/lib/product-materials";

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

  it("не путает языки — включая новые en/uz, не только ru/kk", () => {
    const product = {
      product_material_files: [
        { language: "kk", file_path: "kk.pdf", file_name: "KK", sort_order: 1 },
        { language: "en", file_path: "en.pdf", file_name: "EN", sort_order: 1 },
        { language: "uz", file_path: "uz.pdf", file_name: "UZ", sort_order: 1 },
      ],
    };
    expect(materialsForProduct(product, "ru")).toEqual([]);
    expect(materialsForProduct(product, "kk")).toHaveLength(1);
    expect(materialsForProduct(product, "en")).toHaveLength(1);
    expect(materialsForProduct(product, "uz")).toHaveLength(1);
  });

  it("падает на старые поля, когда таблицы файлов нет (только ru/kk — у en/uz такой пары не было)", () => {
    expect(materialsForProduct(legacyProduct, "ru")).toEqual([
      { path: "001/kartochki.pdf", name: "Карточки.pdf", url: null },
    ]);
    expect(materialsForProduct({ file_url: "https://disk/file.zip" }, "ru")).toEqual([
      { path: null, name: null, url: "https://disk/file.zip" },
    ]);
    expect(materialsForProduct({ file_path_kz: "kz/file.pdf" }, "kk")).toEqual([
      { path: "kz/file.pdf", name: null, url: null },
    ]);
    // en/uz никогда не имели одиночных legacy-колонок — только product_material_files.
    expect(materialsForProduct(legacyProduct, "en")).toEqual([]);
    expect(materialsForProduct(legacyProduct, "uz")).toEqual([]);
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
  it("считает так же, как снимок, по всем 4 языкам", () => {
    expect(hasAnyMaterial(multiFileProduct)).toBe(true);
    expect(hasAnyMaterial(legacyProduct)).toBe(true);
    expect(hasAnyMaterial({ file_path_kz: "kz/file.pdf" })).toBe(true);
    expect(
      hasAnyMaterial({ product_material_files: [{ language: "uz", file_path: "u.pdf" }] }),
    ).toBe(true);
    expect(hasAnyMaterial({})).toBe(false);
    // Запись без пути файлом не является, сколько бы строк ни было в таблице.
    expect(hasAnyMaterial({ product_material_files: [{ language: "ru", file_path: null }] })).toBe(
      false,
    );
  });
});

describe("availableMaterialLanguages", () => {
  it("возвращает только те языки, для которых реально есть файл", () => {
    expect(availableMaterialLanguages(multiFileProduct)).toEqual(["ru"]);
    expect(availableMaterialLanguages(legacyProduct)).toEqual(["ru"]);
    expect(availableMaterialLanguages({})).toEqual([]);
    const product = {
      product_material_files: [
        { language: "ru", file_path: "r.pdf" },
        { language: "kk", file_path: "k.pdf" },
        { language: "en", file_path: "e.pdf" },
      ],
    };
    expect(availableMaterialLanguages(product)).toEqual(["ru", "kk", "en"]);
  });

  it("supports Kyrgyz as a material language without requiring a Kyrgyz bot UI", () => {
    const product = { product_material_files: [{ language: "ky", file_path: "kg.pdf" }] };
    expect(availableMaterialLanguages(product)).toEqual(["ky"]);
    expect(materialsForProduct(product, "ky")).toEqual([
      { path: "kg.pdf", name: null, url: null },
    ]);
  });
});

/**
 * Снимок заказа — параллельная лестница откатов той же формы, что и у
 * materialsForProduct, только источники другие: сначала material_files_by_lang
 * (MIGRATION-37), потом старые ru/kk снимки, потом совсем старые одиночные
 * *_snapshot-колонки.
 */
describe("materialsForOrderItem", () => {
  it("берёт из material_files_by_lang, когда он заполнен", () => {
    const item = {
      material_files_by_lang: { en: [{ path: "e.pdf", name: "E", url: null }] },
    };
    expect(materialsForOrderItem(item, "en")).toEqual([{ path: "e.pdf", name: "E", url: null }]);
    expect(materialsForOrderItem(item, "ru")).toEqual([]);
  });

  it("откатывается на старые ru/kk снимки, если карты по языкам нет", () => {
    const item = {
      material_files_snapshot: [{ path: "r.pdf", name: "R", url: null }],
      material_files_kz_snapshot: [{ path: "k.pdf", name: "K", url: null }],
    };
    expect(materialsForOrderItem(item, "ru")).toEqual([{ path: "r.pdf", name: "R", url: null }]);
    expect(materialsForOrderItem(item, "kk")).toEqual([{ path: "k.pdf", name: "K", url: null }]);
  });

  it("откатывается на совсем старые одиночные *_snapshot-колонки", () => {
    const item = { file_path_snapshot: "old.pdf", file_name_snapshot: "Old" };
    expect(materialsForOrderItem(item, "ru")).toEqual([
      { path: "old.pdf", name: "Old", url: null },
    ]);
  });

  it("en/uz не имеют legacy-отката — пусто, если карты по языкам нет", () => {
    expect(materialsForOrderItem({ file_path_snapshot: "old.pdf" }, "en")).toEqual([]);
  });
});

describe("materialsForOrderItemAnyLang / availableOrderItemLanguages", () => {
  it("берёт первый непустой язык по порядку ru→kk→en→uz", () => {
    const item = { material_files_by_lang: { uz: [{ path: "u.pdf", name: null, url: null }] } };
    expect(materialsForOrderItemAnyLang(item)).toEqual([{ path: "u.pdf", name: null, url: null }]);
    expect(availableOrderItemLanguages(item)).toEqual(["uz"]);
  });

  it("пусто, если ни в одном языке ничего нет", () => {
    expect(materialsForOrderItemAnyLang({})).toEqual([]);
    expect(availableOrderItemLanguages({})).toEqual([]);
  });
});

describe("parseDeliveredLanguages / addDeliveredLanguage", () => {
  it("«both» — исторический синоним ru+kk", () => {
    expect(parseDeliveredLanguages("both")).toEqual(new Set(["ru", "kk"]));
  });

  it("список через запятую разбирается как множество языков", () => {
    expect(parseDeliveredLanguages("ru,en")).toEqual(new Set(["ru", "en"]));
  });

  it("пусто/мусор — пустое множество", () => {
    expect(parseDeliveredLanguages(null)).toEqual(new Set());
    expect(parseDeliveredLanguages("")).toEqual(new Set());
  });

  it("добавление языка накапливает список, а не перезаписывает", () => {
    expect(addDeliveredLanguage(null, "ru")).toBe("ru");
    expect(addDeliveredLanguage("ru", "kk")).toBe("ru,kk");
    // Уже отмеченный язык не дублируется.
    expect(addDeliveredLanguage("ru,kk", "ru")).toBe("ru,kk");
    expect(addDeliveredLanguage("ru,kk", "ky")).toBe("ru,kk,ky");
  });
});
