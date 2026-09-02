import { describe, expect, it } from "vitest";
import {
  filterMiniAppProductIds,
  miniAppEmptyThumbEmoji,
  renderMiniAppLeadBadge,
  renderMiniAppProductCard,
  type MiniAppProduct,
  type MiniAppProductIndexRow,
} from "../src/lib/mini-app-catalog.server";

const products: MiniAppProductIndexRow[] = [
  {
    id: "visible",
    name: "Red cake",
    description: "Chocolate dessert",
    keywords: "математика birthday",
    category_ids: ["cakes"],
    product_variants: [{ name: "Large" }],
  },
  {
    id: "hidden",
    name: "Secret",
    description: null,
    category_ids: ["hidden"],
    product_variants: null,
  },
  {
    id: "uncategorized",
    name: "Gift card",
    description: null,
    category_ids: [],
    product_variants: null,
  },
];

describe("Mini App catalog filtering", () => {
  it("removes products that only belong to hidden categories", () => {
    expect(filterMiniAppProductIds(products, new Set(["hidden"]))).toEqual([
      "visible",
      "uncategorized",
    ]);
  });

  it("searches names, descriptions, variants and keywords across the full index", () => {
    expect(filterMiniAppProductIds(products, new Set(), "chocolate")).toEqual(["visible"]);
    expect(filterMiniAppProductIds(products, new Set(), "large")).toEqual(["visible"]);
    expect(filterMiniAppProductIds(products, new Set(), "red cake")).toEqual(["visible"]);
    expect(filterMiniAppProductIds(products, new Set(), "математика")).toEqual(["visible"]);
  });

  it("keeps uncategorized products only in the unfiltered catalog", () => {
    expect(filterMiniAppProductIds(products, new Set(), "", "cakes")).toEqual(["visible"]);
  });

  it("includes products from Mini App category subtrees", () => {
    const nested: MiniAppProductIndexRow[] = [
      {
        id: "worksheet",
        name: "Worksheet",
        description: null,
        category_ids: ["grade5"],
        product_variants: null,
      },
    ];
    expect(
      filterMiniAppProductIds(nested, new Set(), "", "math", new Set(["math", "grade5"])),
    ).toEqual(["worksheet"]);
  });
});

const cake: MiniAppProduct = {
  id: "cake",
  name: "Red velvet",
  description: "Birthday cake",
  category_ids: ["cakes"],
  rating_avg: null,
  rating_count: 0,
  product_images: null,
  price: 12000,
  currency: "KZT",
  country_prices: null,
  stock_quantity: 3,
  lead_time_days: 2,
  fulfillment_kind: "physical",
  product_variants: null,
};

describe("Mini App physical catalog cards", () => {
  it("shows lead time on physical products and hides it for digital", () => {
    expect(renderMiniAppLeadBadge(cake, "ru")).toContain("Готовим 2 дн.");
    expect(renderMiniAppLeadBadge({ ...cake, lead_time_days: 0 }, "ru")).toContain("В наличии");
    expect(renderMiniAppLeadBadge({ ...cake, fulfillment_kind: "digital" }, "ru")).toBe("");
    const html = renderMiniAppProductCard(cake, undefined, false, "ru");
    expect(html).toContain("card-lead");
    expect(html).toContain("Готовим 2 дн.");
  });

  it("uses a bakery placeholder on confectionery deploys", () => {
    expect(miniAppEmptyThumbEmoji("digital")).toBe("🛍");
    expect(miniAppEmptyThumbEmoji("physical")).toBe("📦");
    expect(miniAppEmptyThumbEmoji("physical", "confectionery")).toBe("🎂");
  });
});
