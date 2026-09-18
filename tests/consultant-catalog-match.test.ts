import { describe, expect, it } from "vitest";
import {
  extractHardness,
  findProducts,
  isKitchenTowel,
  productHardness,
  sizeMatches,
  type ConsultantProduct,
} from "../src/lib/consultant/catalog";

/**
 * Данные взяты из живой сессии тестирования продавцом: те самые восемь
 * матрасов SOFT, MEDIUM, который выдавался вместо SOFT, и голубое постельное,
 * подмешанное в ответ про голубые полотенца.
 */
function product(p: Partial<ConsultantProduct> & { id: string; name: string }): ConsultantProduct {
  return {
    category: "",
    size: "",
    colors: [],
    price_kzt: 100_000,
    stock: true,
    ...p,
  };
}

const MATTRESSES: ConsultantProduct[] = [
  product({ id: "L160", name: "Dorelan LEVANT R4 SOFT", category: "матрасы", size: "160x200", stock_qty: 2 }),
  product({ id: "L182", name: "Dorelan LEVANT R4 SOFT", category: "матрасы", size: "182x202", stock_qty: 1 }),
  product({ id: "L200", name: "Dorelan LEVANT R4 SOFT", category: "матрасы", size: "200x200", stock_qty: 1 }),
  product({ id: "T182", name: "Dorelan TRESOR R3 SOFT", category: "матрасы", size: "182x202", stock_qty: 2 }),
  product({ id: "T200", name: "Dorelan TRESOR R3 SOFT", category: "матрасы", size: "200x200", stock_qty: 2 }),
  product({ id: "T160M", name: "Dorelan TRESOR R2 MEDIUM", category: "матрасы", size: "160x200" }),
  product({ id: "L180F", name: "Dorelan LEVANT R3 FIRM", category: "матрасы", size: "180x200" }),
];

describe("жёсткость матраса", () => {
  it("разбирает жёсткость из названия и из фразы клиента", () => {
    expect(extractHardness("Dorelan LEVANT R4 SOFT 160x200")).toBe("soft");
    expect(extractHardness("Dorelan TRESOR R2 MEDIUM")).toBe("medium");
    expect(extractHardness("Dorelan LEVANT R3 FIRM")).toBe("firm");
    expect(extractHardness("Что есть в жёсткости soft?")).toBe("soft");
    expect(extractHardness("нужен жёсткий матрас")).toBe("firm");
    expect(extractHardness("Полотенце банное 50x90")).toBeNull();
  });

  it("выводит жёсткость из названия, когда поля нет — каталог загружен старым импортом", () => {
    const old = product({ id: "x", name: "Dorelan TRESOR R3 SOFT", size: "200x200" });
    expect(old.hardness).toBeUndefined();
    expect(productHardness(old)).toBe("soft");
  });

  it("на запрос SOFT не отдаёт MEDIUM", () => {
    const { all } = findProducts({ hardness: "soft" }, MATTRESSES);
    expect(all.map((p) => p.id)).toEqual(["L160", "L182", "L200", "T182", "T200"]);
    expect(all.some((p) => p.id === "T160M")).toBe(false);
    expect(all.some((p) => p.id === "L180F")).toBe(false);
  });

  it("понимает слова продавца «комфортный» и «упругий»", () => {
    // Продавец просил называть жёсткость покупателю так: комфортный (Soft) и
    // упругий (Firm). Покупатель отвечает теми же словами — разбор запроса
    // обязан их понимать, иначе фильтр по жёсткости молча пропадает.
    expect(extractHardness("нужен комфортный матрас")).toBe("soft");
    expect(extractHardness("упругий, 180x200")).toBe("firm");
    const { all } = findProducts({ hardness: extractHardness("упругий") ?? undefined }, MATTRESSES);
    expect(all.map((p) => p.id)).toEqual(["L180F"]);
  });

  it("отдаёт все позиции нужной жёсткости, а не первые три", () => {
    const { all, shown } = findProducts({ hardness: "soft" }, MATTRESSES);
    expect(shown).toHaveLength(all.length);
    expect(shown.length).toBeGreaterThan(3);
  });
});

describe("допуск по размеру", () => {
  it("считает расхождение до 3 см одним размером", () => {
    expect(sizeMatches("182x202", "180x200")).toBe(true);
    expect(sizeMatches("180x200", "180x200")).toBe(true);
    expect(sizeMatches("40x70x10", "40x70")).toBe(true);
  });

  it("140x70 и 70x140 — один размер", () => {
    // Живой случай продавца: на «полотенце 140x70» бот ответил, что такого
    // размера в каталоге нет, и предложил «близкий» 70x140 — то же полотенце.
    expect(sizeMatches("70x140", "140x70")).toBe(true);
    expect(sizeMatches("140x70", "70x140")).toBe(true);
    expect(sizeMatches("202x182", "180x200")).toBe(true);
    const TOWELS: ConsultantProduct[] = [
      product({ id: "T70", name: "Bedding House PIP Les Fleurs", category: "полотенца", size: "70x140" }),
      product({ id: "T50", name: "Feiler Полотенце махровое", category: "полотенца", size: "50x100" }),
    ];
    expect(findProducts({ size: "140x70" }, TOWELS).all.map((p) => p.id)).toEqual(["T70"]);
  });

  it("понимает размер, названный словом «на»", () => {
    expect(sizeMatches("70x140", "70 на 140")).toBe(true);
    expect(sizeMatches("70x140", "140 на 70")).toBe(true);
  });

  it("не растягивает допуск на соседние размеры", () => {
    expect(sizeMatches("160x200", "180x200")).toBe(false);
    expect(sizeMatches("200x200", "180x200")).toBe(false);
  });

  it("находит 182x202 по запросу 180x200", () => {
    const { all } = findProducts({ size: "180x200", hardness: "soft" }, MATTRESSES);
    expect(all.map((p) => p.id)).toEqual(["L182", "T182"]);
  });
});

describe("категория и кухонные полотенца", () => {
  const TEXTILE: ConsultantProduct[] = [
    product({ id: "TW50", name: "Полотенце банное", category: "полотенца", size: "50x70", colors: ["голубой"] }),
    product({ id: "TW70", name: "Полотенце банное", category: "полотенца", size: "70x140", colors: ["голубой"] }),
    product({ id: "KIT", name: "SANDER полотенце кухонное", category: "полотенца", size: "50x70", colors: ["голубой"] }),
    product({
      id: "BED",
      name: "Bedding House PIP Secret Garden",
      category: "постельное белье",
      size: "55x100",
      colors: ["бело-голубой"],
    }),
  ];

  it("подбор по цвету внутри категории не выносит соседнюю категорию", () => {
    const { all } = findProducts({ category: "полотенца", color: "голубой" }, TEXTILE);
    expect(all.some((p) => p.id === "BED")).toBe(false);
  });

  it("общий запрос про полотенца не подмешивает кухонные", () => {
    const { all } = findProducts({ query: "полотенца" }, TEXTILE);
    expect(all.map((p) => p.id)).toEqual(["TW50", "TW70"]);
  });

  it("кухонные показываются, когда их спросили", () => {
    const { all } = findProducts({ query: "кухонные полотенца" }, TEXTILE);
    expect(all.map((p) => p.id)).toEqual(["KIT"]);
  });

  it("кухонные остаются находимыми по бренду", () => {
    expect(isKitchenTowel(TEXTILE[2])).toBe(true);
    const { all } = findProducts({ query: "sander" }, TEXTILE);
    expect(all.map((p) => p.id)).toEqual(["KIT"]);
  });
});

describe("полнота выдачи", () => {
  const many: ConsultantProduct[] = Array.from({ length: 30 }, (_, i) =>
    product({ id: `p${i}`, name: `Полотенце банное ${i}`, category: "полотенца", size: "50x90" }),
  );

  it("свободный просмотр остаётся короткой витриной", () => {
    const { shown } = findProducts({}, many);
    expect(shown).toHaveLength(12);
  });

  it("запрос с фильтром отдаёт больше прежнего потолка в 12 позиций", () => {
    const { all, shown } = findProducts({ size: "50x90" }, many);
    expect(all).toHaveLength(30);
    expect(shown).toHaveLength(30);
  });
});
