import { describe, expect, it, vi } from "vitest";

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));

const {
  findProducts,
  isDiscontinuedProduct,
  isMattress,
  sellableProducts,
} = await import("../src/lib/consultant/catalog");
type ConsultantProduct = import("../src/lib/consultant/catalog").ConsultantProduct;
const {
  cleanDiscontinuedMattressOffers,
  offersDiscontinuedMattress,
  DISCONTINUED_MEDIUM_MATTRESS_REPLY,
} = await import("../src/lib/consultant/validate");
const { executeConsultantTool } = await import("../src/lib/consultant/tools");

/**
 * Продавец: «матрасов средней жёсткости мы не упоминаем — сняты с
 * производства». Проверяем ровно это: MEDIUM-матрас не виден нигде, а
 * наматрасник и подушка с тем же словом в названии остаются в продаже.
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

const CATALOG: ConsultantProduct[] = [
  product({ id: "SOFT", name: "Dorelan LEVANT R4 SOFT", category: "Матрасы", size: "160x200" }),
  product({ id: "MED", name: "Dorelan TRESOR R2 MEDIUM", category: "Матрасы", size: "160x200" }),
  product({ id: "MED_RU", name: "Матрас Frankenstolz средней жёсткости", category: "Матрасы", size: "180x200" }),
  product({ id: "FIRM", name: "Dorelan LEVANT R3 FIRM", category: "Матрасы", size: "180x200" }),
  product({ id: "PROT", name: "Наматрасник Traumina MEDIUM", category: "Наматрасники", size: "160x200" }),
  product({ id: "PILLOW", name: "Подушка Traumina Medium", category: "Подушки", size: "50x70" }),
];

describe("снятое с производства — матрасы средней жёсткости", () => {
  it("MEDIUM-матрас помечен снятым, соседние товары — нет", () => {
    expect(isDiscontinuedProduct(CATALOG[1])).toBe(true);
    expect(isDiscontinuedProduct(CATALOG[2])).toBe(true);
    expect(isDiscontinuedProduct(CATALOG[0])).toBe(false);
    expect(isDiscontinuedProduct(CATALOG[3])).toBe(false);
  });

  it("наматрасник и подушка со словом MEDIUM остаются в продаже", () => {
    expect(isMattress(CATALOG[4])).toBe(false);
    expect(isMattress(CATALOG[5])).toBe(false);
    expect(isDiscontinuedProduct(CATALOG[4])).toBe(false);
    expect(isDiscontinuedProduct(CATALOG[5])).toBe(false);
  });

  it("sellableProducts убирает только снятые позиции", () => {
    expect(sellableProducts(CATALOG).map((p) => p.id)).toEqual([
      "SOFT",
      "FIRM",
      "PROT",
      "PILLOW",
    ]);
  });

  it("поиск матраса средней жёсткости не находит ничего", () => {
    expect(findProducts({ category: "матрасы", hardness: "medium" }, CATALOG).all).toEqual([]);
  });

  it("запрос про среднюю жёсткость без категории не выдаёт ни одного матраса", () => {
    // Подушка и наматрасник со средней жёсткостью продаются и остаются в
    // выдаче: снята с производства только линейка матрасов.
    const { all } = findProducts({ hardness: "medium" }, CATALOG);
    expect(all.some((p) => p.category === "Матрасы")).toBe(false);
    expect(all.map((p) => p.id)).toEqual(["PROT", "PILLOW"]);
  });

  it("свободный просмотр матрасов не показывает снятые", () => {
    const { all, shown } = findProducts({ query: "матрас" }, CATALOG);
    expect(all.map((p) => p.id)).toEqual(["SOFT", "FIRM"]);
    expect(shown.some((p) => p.id === "MED")).toBe(false);
  });

  it("инструмент поиска объясняет пустую выдачу фактом, а не догадкой", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { category: "матрасы", hardness: "medium" },
      { catalog: CATALOG },
    );
    const payload = res.result as { returned: number; medium_mattresses_discontinued?: boolean };
    expect(payload.returned).toBe(0);
    expect(payload.medium_mattresses_discontinued).toBe(true);
  });

  it("на запрос про SOFT в выдаче нет пометки о снятой жёсткости", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { category: "матрасы", hardness: "soft" },
      { catalog: CATALOG },
    );
    const payload = res.result as { medium_mattresses_discontinued?: boolean };
    expect(payload.medium_mattresses_discontinued).toBeUndefined();
  });
});

describe("механический запрет упоминания", () => {
  it("предложение снятого матраса считается упоминанием, честный отказ — нет", () => {
    expect(offersDiscontinuedMattress("Могу предложить Dorelan TRESOR R2 MEDIUM 160x200.")).toBe(true);
    expect(offersDiscontinuedMattress("Есть матрас средней жёсткости за 950 000 тенге.")).toBe(true);
    expect(offersDiscontinuedMattress("Матрасов средней жёсткости сейчас нет.")).toBe(false);
    expect(offersDiscontinuedMattress("Матрасы средней жёсткости сняты с производства.")).toBe(false);
    expect(offersDiscontinuedMattress("Матрас Dorelan LEVANT R4 SOFT в наличии.")).toBe(false);
    expect(offersDiscontinuedMattress("Наматрасник Traumina MEDIUM в наличии.")).toBe(false);
    expect(offersDiscontinuedMattress("Матрас средней ценовой категории.")).toBe(false);
  });

  it("вырезает предложение со снятой жёсткостью и оставляет остальной ответ", () => {
    const text =
      "Матрас Dorelan LEVANT R4 SOFT 160x200 в наличии. Также есть TRESOR R2 MEDIUM средней жёсткости. Цена — 1 200 000 тенге.";
    const cleaned = cleanDiscontinuedMattressOffers(text);
    expect(cleaned).toBe(
      "Матрас Dorelan LEVANT R4 SOFT 160x200 в наличии. Цена — 1 200 000 тенге.",
    );
  });

  it("убирает строку списка целиком, не оставляя пустую", () => {
    const text = "Есть варианты:\nМатрас LEVANT R4 SOFT\nМатрас TRESOR R2 MEDIUM\nМатрас LEVANT R3 FIRM";
    expect(cleanDiscontinuedMattressOffers(text)).toBe(
      "Есть варианты:\nМатрас LEVANT R4 SOFT\nМатрас LEVANT R3 FIRM",
    );
  });

  it("честный отказ про среднюю жёсткость не режется", () => {
    const text = "Матрасов средней жёсткости сейчас нет. Есть SOFT и FIRM, показать?";
    expect(cleanDiscontinuedMattressOffers(text)).toBe(text);
  });

  it("готовый ответ на прямой вопрос не предлагает снятую жёсткость", () => {
    expect(offersDiscontinuedMattress(DISCONTINUED_MEDIUM_MATTRESS_REPLY)).toBe(false);
    expect(cleanDiscontinuedMattressOffers(DISCONTINUED_MEDIUM_MATTRESS_REPLY)).toBe(
      DISCONTINUED_MEDIUM_MATTRESS_REPLY,
    );
  });
});
