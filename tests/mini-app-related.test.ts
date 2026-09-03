import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * loadRelatedMiniAppProducts выходила пустой строкой для любого товара без
 * категории (Учителя, находка про похожие материалы без fallback) — секция
 * "похожие" просто не рендерилась, хотя в каталоге могло быть что показать.
 * Категория у товара необязательна, так что это не редкий случай.
 */

type IndexRow = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  category_ids: string[];
  fulfillment_kind: string | null;
  price: number;
  currency: string;
  created_at: string;
  rating_avg: number | null;
  rating_count: number;
  product_variants: Array<{ name: string }> | null;
};

let indexStore: IndexRow[] = [];
let productStore: Array<Record<string, unknown>> = [];

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "products") throw new Error(`неожиданная таблица в моке: ${table}`);
      return {
        select: (_cols: string) => ({
          eq: (_c: string, _v: unknown) => ({
            order: () => ({
              order: () => ({
                range: async (_from: number, _to: number) => ({ data: indexStore }),
              }),
            }),
          }),
          in: (_c: string, ids: string[]) => ({
            eq: async (_c2: string, _v: unknown) => ({
              data: productStore.filter((p) => ids.includes(p.id as string)),
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock("../src/lib/modules/modules.server", () => ({
  hasModule: async () => false,
}));

vi.mock("../src/lib/public-image", () => ({
  imageUrl: (path: string) => `https://cdn.test/${path}`,
}));

function makeIndexRow(id: string, categoryIds: string[]): IndexRow {
  return {
    id,
    name: `Материал ${id}`,
    description: null,
    keywords: null,
    category_ids: categoryIds,
    fulfillment_kind: "digital",
    price: 500,
    currency: "KZT",
    created_at: new Date().toISOString(),
    rating_avg: null,
    rating_count: 0,
    product_variants: null,
  };
}

function makeFullProduct(id: string, categoryIds: string[]) {
  return {
    id,
    name: `Материал ${id}`,
    description: null,
    keywords: null,
    category_ids: categoryIds,
    rating_avg: null,
    rating_count: 0,
    product_images: [],
    price: 500,
    currency: "KZT",
    country_prices: null,
    stock_quantity: null,
    lead_time_days: null,
    fulfillment_kind: "digital",
    product_material_files: [],
    product_variants: null,
  };
}

beforeEach(() => {
  indexStore = [];
  productStore = [];
});

describe("loadRelatedMiniAppProducts", () => {
  it("товар без категории всё равно получает блок похожих — fallback на весь каталог", async () => {
    const target = makeFullProduct("target", []);
    indexStore = [
      makeIndexRow("target", []),
      makeIndexRow("other-1", ["math"]),
      makeIndexRow("other-2", []),
    ];
    productStore = [makeFullProduct("other-1", ["math"]), makeFullProduct("other-2", [])];
    const { loadRelatedMiniAppProducts } = await import("../src/lib/mini-app-catalog.server");
    const html = await loadRelatedMiniAppProducts(target as never, null, "ru", "");
    expect(html).not.toBe("");
    expect(html).toContain("Может понравиться");
    expect(html).not.toContain("Ещё в этой папке");
    expect(html).toContain("Материал other-1");
    expect(html).toContain("Материал other-2");
  });

  it("товар с категорией использует прежний заголовок и фильтр по категории", async () => {
    const target = makeFullProduct("target", ["math"]);
    indexStore = [
      makeIndexRow("target", ["math"]),
      makeIndexRow("same-cat", ["math"]),
      makeIndexRow("other-cat", ["history"]),
    ];
    productStore = [
      makeFullProduct("same-cat", ["math"]),
      makeFullProduct("other-cat", ["history"]),
    ];
    const { loadRelatedMiniAppProducts } = await import("../src/lib/mini-app-catalog.server");
    const html = await loadRelatedMiniAppProducts(target as never, null, "ru", "");
    expect(html).toContain("Ещё в этой папке");
    expect(html).toContain("Материал same-cat");
    expect(html).not.toContain("Материал other-cat");
  });

  it("нет ни одного другого товара в каталоге — секция не рендерится вовсе", async () => {
    const target = makeFullProduct("target", []);
    indexStore = [makeIndexRow("target", [])];
    productStore = [];
    const { loadRelatedMiniAppProducts } = await import("../src/lib/mini-app-catalog.server");
    const html = await loadRelatedMiniAppProducts(target as never, null, "ru", "");
    expect(html).toBe("");
  });
});
