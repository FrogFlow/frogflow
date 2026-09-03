import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * listMiniAppLibrary не имела ни одного теста (Ниши/учителя, аудит).
 * Единственное реальное поведение здесь — дедупликация купленных материалов
 * по товару поверх заказов, отсортированных по дате, и исключение физических
 * заказов. Раньше сканировались только последние 80 заказов: покупатель
 * больше чем с 80 заказами терял из "Моих материалов" товары, купленные
 * только в более старых заказах, — они просто не попадали в выборку.
 */

type OrderRow = {
  id: number;
  created_at: string;
  fulfillment_kind: string | null;
  order_items: Array<{ product_id: string | null; name_snapshot: string | null }>;
};

type ProductRow = {
  id: string;
  name: string;
  product_images: Array<{ image_path: string; sort_order: number }>;
};

let ordersStore: OrderRow[] = [];
let productsStore: ProductRow[] = [];

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: (_cols: string) => ({
            eq: (_c1: string, telegramId: number) => ({
              eq: (_c2: string, status: string) => ({
                order: (_col: string, _opts: { ascending: boolean }) => ({
                  limit: async (n: number) => {
                    const rows = ordersStore
                      .filter(
                        (o) => (o as unknown as { telegram_id: number }).telegram_id === telegramId,
                      )
                      .filter(() => status === "delivered")
                      .slice()
                      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                      .slice(0, n);
                    return { data: rows };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "products") {
        return {
          select: (_cols: string) => ({
            in: async (_col: string, ids: string[]) => ({
              data: productsStore.filter((p) => ids.includes(p.id)),
            }),
          }),
        };
      }
      throw new Error(`неожиданная таблица в моке: ${table}`);
    },
  },
}));

vi.mock("../src/lib/public-image", () => ({
  imageUrl: (path: string) => `https://cdn.test/${path}`,
}));

const TELEGRAM_ID = 555;

function makeOrder(
  id: number,
  daysAgo: number,
  productId: string,
  overrides: Partial<OrderRow> = {},
): OrderRow & { telegram_id: number } {
  const created = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    telegram_id: TELEGRAM_ID,
    created_at: created,
    fulfillment_kind: "digital",
    order_items: [{ product_id: productId, name_snapshot: `Материал ${productId}` }],
    ...overrides,
  };
}

beforeEach(() => {
  ordersStore = [];
  productsStore = [];
});

describe("listMiniAppLibrary", () => {
  it("дедуплицирует по товару, оставляя самый свежий заказ", async () => {
    ordersStore = [
      makeOrder(1, 10, "prod-a"),
      makeOrder(2, 5, "prod-a"),
      makeOrder(3, 1, "prod-b"),
    ] as never;
    productsStore = [
      { id: "prod-a", name: "Материал A", product_images: [] },
      { id: "prod-b", name: "Материал B", product_images: [] },
    ];
    const { listMiniAppLibrary } = await import("../src/lib/mini-app-library.server");
    const items = await listMiniAppLibrary(TELEGRAM_ID);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.productId === "prod-a")?.lastOrderId).toBe(2);
  });

  it("исключает физические заказы — библиотека только для цифровых материалов", async () => {
    ordersStore = [
      makeOrder(1, 1, "prod-cake", { fulfillment_kind: "physical" }),
      makeOrder(2, 2, "prod-worksheet"),
    ] as never;
    productsStore = [
      { id: "prod-cake", name: "Торт", product_images: [] },
      { id: "prod-worksheet", name: "Рабочий лист", product_images: [] },
    ];
    const { listMiniAppLibrary } = await import("../src/lib/mini-app-library.server");
    const items = await listMiniAppLibrary(TELEGRAM_ID);
    expect(items.map((i) => i.productId)).toEqual(["prod-worksheet"]);
  });

  /**
   * Регрессия основной находки: товар, купленный только в заказе старше
   * последних 80 (по датам), не должен пропадать из библиотеки.
   */
  it("не теряет товар, купленный только в заказе старше последних 80", async () => {
    const recent: OrderRow[] = [];
    for (let i = 0; i < 80; i++) {
      recent.push(makeOrder(1000 + i, i, "prod-common") as never);
    }
    const oldOrder = makeOrder(1, 200, "prod-old-only") as never;
    ordersStore = [...recent, oldOrder];
    productsStore = [
      { id: "prod-common", name: "Частый материал", product_images: [] },
      { id: "prod-old-only", name: "Старый материал", product_images: [] },
    ];
    const { listMiniAppLibrary } = await import("../src/lib/mini-app-library.server");
    const items = await listMiniAppLibrary(TELEGRAM_ID);
    expect(items.map((i) => i.productId)).toContain("prod-old-only");
  });

  it("подставляет актуальное имя и обложку товара, языки материала", async () => {
    ordersStore = [makeOrder(1, 1, "prod-a")] as never;
    productsStore = [
      {
        id: "prod-a",
        name: "Новое имя товара",
        product_images: [
          { image_path: "b.jpg", sort_order: 1 },
          { image_path: "a.jpg", sort_order: 0 },
        ],
      },
    ];
    const { listMiniAppLibrary } = await import("../src/lib/mini-app-library.server");
    const items = await listMiniAppLibrary(TELEGRAM_ID);
    expect(items[0]!.name).toBe("Новое имя товара");
    expect(items[0]!.image).toBe("https://cdn.test/a.jpg");
  });

  it("пустая история заказов — пустая библиотека, без похода за товарами", async () => {
    ordersStore = [];
    const { listMiniAppLibrary } = await import("../src/lib/mini-app-library.server");
    expect(await listMiniAppLibrary(TELEGRAM_ID)).toEqual([]);
  });
});
