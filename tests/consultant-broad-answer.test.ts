import { describe, expect, it, vi } from "vitest";

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));

const { executeConsultantTool, CONSULTANT_TOOLS } = await import("../src/lib/consultant/tools");
const { cleanCatalogExcuses, isCatalogExcuse } = await import("../src/lib/consultant/validate");
type ConsultantProduct = import("../src/lib/consultant/catalog").ConsultantProduct;

/**
 * Живой случай продавца: на «полотенца Feiler» бот вывалил весь ассортимент
 * с ценами по каждой позиции. Просьба дословно: сказать, что такие полотенца
 * есть, две строчки о марке, и спросить размер и цвет.
 */
function p(over: Partial<ConsultantProduct> & { id: string; name: string }): ConsultantProduct {
  return { category: "Полотенца", size: "", colors: [], price_kzt: 10_000, stock: true, ...over };
}

const TOWELS: ConsultantProduct[] = [
  p({ id: "f1", name: "Feiler Полотенце махровое FLOWER MEADOW", size: "50x100", colors: ["жёлтый"], price_kzt: 9_889 }),
  p({ id: "f2", name: "Feiler Полотенце махровое DJAMAL", size: "50x100", colors: ["синий"], price_kzt: 9_889 }),
  p({ id: "f3", name: "Feiler Полотенце махровое ELISAVETA", size: "50x100", colors: ["синий"], price_kzt: 10_988 }),
  p({ id: "f4", name: "Feiler Полотенце махровое MARGO", size: "75x150", colors: ["зелёный"], price_kzt: 21_976 }),
  p({ id: "f5", name: "Feiler Полотенце махровое ANTHEA DARK", size: "75x150", colors: ["чёрный"], price_kzt: 19_778 }),
  p({ id: "f6", name: "Feiler Полотенце махровое AROSA", size: "75x150", colors: ["бежевый"], price_kzt: 19_778 }),
];

describe("широкий вопрос не разворачивается в прайс-лист", () => {
  it("на «полотенца Feiler» приходит сводка без карточек", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { query: "полотенца Feiler" },
      { catalog: TOWELS },
    );
    const payload = res.result as {
      ask_size_and_color?: boolean;
      products: unknown[];
      total_matches: number;
      sizes: string[];
      sizes_total: number;
      colors: string[];
      colors_total: number;
      price_from_kzt: number | null;
      in_stock?: boolean;
    };
    expect(payload.ask_size_and_color).toBe(true);
    expect(payload.in_stock).toBe(true);
    expect(payload.products).toEqual([]);
    expect(payload.total_matches).toBe(6);
    expect(payload.sizes).toEqual(["50x100", "75x150"]);
    expect(payload.colors).toContain("жёлтый");
    /**
     * Только нижняя граница. Продавец о живом ответе про коврики: «много
     * лишнего написал, клиент сбежал» — там были одиннадцать расцветок и
     * вилка от 20 000 до 420 000 ₸. Верхнюю границу модель больше не видит,
     * поэтому и назвать её не может.
     */
    expect(payload.price_from_kzt).toBe(9_889);
    expect(payload).not.toHaveProperty("price_kzt");
  });

  it("много расцветок — показываем шесть и говорим, сколько всего", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      id: `m${i}`,
      name: `Коврик для ванной GRACCIOZA ${i}`,
      category: "Коврики",
      size: `${60 + i}x100`,
      colors: [`цвет-${i}`],
      price_kzt: 20_000 + i * 1000,
      stock: true,
    }));
    const res = await executeConsultantTool("search_products", { query: "коврики" }, { catalog: many });
    const payload = res.result as {
      sizes: string[];
      sizes_total: number;
      colors: string[];
      colors_total: number;
    };
    expect(payload.colors).toHaveLength(6);
    expect(payload.colors_total).toBe(11);
    expect(payload.sizes).toHaveLength(6);
    expect(payload.sizes_total).toBe(11);
  });

  it("проверка ответа всё равно знает цены — вилку не посчитают выдумкой", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { query: "полотенца Feiler" },
      { catalog: TOWELS },
    );
    expect(res.products.map((x) => x.id)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
  });

  it("назван размер — выдаются все подходящие карточки", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { query: "полотенца Feiler", size: "75x150" },
      { catalog: TOWELS },
    );
    const payload = res.result as { products: unknown[]; returned: number; ask_size_and_color?: boolean };
    expect(payload.ask_size_and_color).toBeUndefined();
    expect(payload.returned).toBe(3);
    expect(payload.products).toHaveLength(3);
  });

  it("«покажите все» отключает сводку", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { query: "полотенца Feiler", show_all: true },
      { catalog: TOWELS },
    );
    const payload = res.result as { products: unknown[]; returned: number; ask_size_and_color?: boolean };
    expect(payload.ask_size_and_color).toBeUndefined();
    expect(payload.returned).toBe(6);
  });

  it("четыре позиции — уже сводка, а не список", async () => {
    // Живой случай: на вопрос о высоте матраса бот назвал высоту и следом
    // выложил четыре модели LEVANT с ценами. Продавец: «остальным грузить
    // клиента не надо».
    const res = await executeConsultantTool(
      "search_products",
      { query: "полотенца Feiler" },
      { catalog: TOWELS.slice(0, 4) },
    );
    const payload = res.result as { ask_size_and_color?: boolean; total_matches: number };
    expect(payload.ask_size_and_color).toBe(true);
    expect(payload.total_matches).toBe(4);
  });

  it("две-три позиции показываются сразу, без уточняющего вопроса", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { query: "полотенца Feiler MARGO" },
      { catalog: TOWELS },
    );
    const payload = res.result as { returned: number; ask_size_and_color?: boolean };
    expect(payload.ask_size_and_color).toBeUndefined();
    expect(payload.returned).toBe(1);
  });

  it("у инструмента есть переключатель show_all", () => {
    const search = CONSULTANT_TOOLS.find((t) => t.name === "search_products");
    expect(Object.keys(search?.input_schema.properties ?? {})).toContain("show_all");
  });
});

describe("отговорка про каталог не уходит покупателю", () => {
  it("вырезает фразу про то, что в каталоге чего-то не указано", () => {
    const text =
      "О полотенце ANTHEA DARK 75x150: К сожалению, в каталоге не указаны детальные характеристики этой конкретной модели. Это махровое полотенце из коллекции Feiler с зелёным цветом.";
    const cleaned = cleanCatalogExcuses(text);
    expect(cleaned).not.toMatch(/каталоге не указаны/i);
    expect(cleaned).toContain("Это махровое полотенце из коллекции Feiler");
  });

  it("узнаёт отговорку и не путает её с обычным ответом", () => {
    expect(isCatalogExcuse("В каталоге не указан состав.")).toBe(true);
    expect(isCatalogExcuse("У меня нет информации о составе этой модели.")).toBe(true);
    expect(isCatalogExcuse("Feiler — немецкий шенилл с плотным ворсом.")).toBe(false);
    expect(isCatalogExcuse("В каталоге 877 позиций.")).toBe(false);
  });

  it("если отговорка была всем ответом, текст остаётся — молчать нельзя", () => {
    const text = "В каталоге не указаны детальные характеристики.";
    expect(cleanCatalogExcuses(text)).toBe(text);
  });
});
