import { describe, expect, it } from "vitest";
import {
  filterMiniAppProductIds,
  miniAppEmptyThumbEmoji,
  renderMiniAppLangBadges,
  renderMiniAppLeadBadge,
  renderMiniAppProductCard,
  type MiniAppProduct,
  type MiniAppProductIndexRow,
} from "../src/lib/mini-app-catalog.server";
import { miniAppStrings } from "../src/lib/mini-app-i18n";

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
    expect(html).toContain("card-footer");
    expect(html.indexOf("card-footer")).toBeLessThan(html.indexOf("add-btn"));
  });

  it("uses a bakery placeholder on confectionery deploys", () => {
    expect(miniAppEmptyThumbEmoji("digital")).toBe("🛍");
    expect(miniAppEmptyThumbEmoji("physical")).toBe("📦");
    expect(miniAppEmptyThumbEmoji("physical", "confectionery")).toBe("🎂");
  });
});

const worksheet: MiniAppProduct = {
  id: "ws",
  name: "1 сентября",
  description: "Оформление",
  category_ids: ["grade1"],
  rating_avg: 4.8,
  rating_count: 12,
  product_images: null,
  price: 500,
  currency: "KZT",
  country_prices: null,
  stock_quantity: null,
  fulfillment_kind: "digital",
  file_path: "materials/sept.pdf",
  file_name: "sept.pdf",
  file_path_kz: "materials/sept-kz.pdf",
  file_name_kz: "sept-kz.pdf",
  product_variants: null,
};

describe("Mini App didactic catalog cards", () => {
  it("shows RU/KK flags for materials and hides them on cakes", () => {
    const html = renderMiniAppProductCard(worksheet, undefined, false, "ru");
    expect(html).toContain("🇷🇺");
    expect(html).toContain("🇰🇿");
    expect(renderMiniAppLangBadges(worksheet)).toContain("🇷🇺");
    expect(renderMiniAppLangBadges({ ...worksheet, fulfillment_kind: "physical" })).toBe("");
  });

  it("counts materials, not generic products, on the digital vertical", () => {
    const previous = process.env.VERTICAL;
    try {
      delete process.env.VERTICAL;
      expect(miniAppStrings("ru").productsCount(3)).toBe("3 материалов");
      expect(miniAppStrings("ru").filesAfterPayment).toContain("бот");
      expect(miniAppStrings("ru").allLanguages).toContain("×N");
    } finally {
      if (previous === undefined) delete process.env.VERTICAL;
      else process.env.VERTICAL = previous;
    }
  });
});
