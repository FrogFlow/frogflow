import { describe, expect, it } from "vitest";
import {
  collectMiniAppMaterialLanguages,
  filterMiniAppProductIds,
  miniAppEmptyThumbEmoji,
  parseMiniAppSort,
  renderMiniAppFileList,
  renderMiniAppLangBadges,
  renderMiniAppLeadBadge,
  renderMiniAppProductCard,
  renderMiniAppTabBar,
  sortMiniAppProductIds,
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
  it("shows compact RU/KZ chips, hides description, and keeps flags on named badges", () => {
    const html = renderMiniAppProductCard(worksheet, undefined, false, "ru");
    expect(html).toContain('data-product-id="ws"');
    expect(html).toContain("lang-chip");
    expect(html).toContain("RU");
    expect(html).toContain("KZ");
    expect(html).not.toContain("🇷🇺");
    expect(html).not.toContain("card-desc");
    expect(renderMiniAppLangBadges(worksheet)).toContain("lang-chip");
    expect(renderMiniAppLangBadges(worksheet, true)).toContain("🇷🇺");
    expect(renderMiniAppLangBadges(worksheet, true)).toContain("🇰🇿");
    expect(renderMiniAppLangBadges({ ...worksheet, fulfillment_kind: "physical" })).toBe("");
  });

  it("[Учителя-CRIT] hides language badges when the multi_language module is off", () => {
    expect(renderMiniAppLangBadges(worksheet, false, false)).toBe("");
    expect(renderMiniAppLangBadges(worksheet, true, false)).toBe("");
    expect(renderMiniAppLangBadges(worksheet, false, true)).toContain("lang-chip");

    const htmlEnabled = renderMiniAppProductCard(worksheet, undefined, false, "ru", {
      multiLanguageEnabled: true,
    });
    expect(htmlEnabled).toContain("lang-chip");

    const htmlDisabled = renderMiniAppProductCard(worksheet, undefined, false, "ru", {
      multiLanguageEnabled: false,
    });
    expect(htmlDisabled).not.toContain("lang-chip");
  });

  it("filters materials by language and keeps chips for the unfiltered set", () => {
    const ruOnly: MiniAppProductIndexRow = {
      id: "ru-only",
      name: "Только русский",
      description: null,
      category_ids: ["grade1"],
      fulfillment_kind: "digital",
      file_path: "ru.pdf",
      file_name: "ru.pdf",
      product_variants: null,
    };
    const physical: MiniAppProductIndexRow = {
      id: "cake",
      name: "Торт",
      description: null,
      category_ids: ["cakes"],
      fulfillment_kind: "physical",
      product_variants: null,
    };
    const rows = [
      {
        id: worksheet.id,
        name: worksheet.name,
        description: worksheet.description,
        category_ids: worksheet.category_ids,
        fulfillment_kind: worksheet.fulfillment_kind,
        file_path: worksheet.file_path,
        file_name: worksheet.file_name,
        file_path_kz: worksheet.file_path_kz,
        file_name_kz: worksheet.file_name_kz,
        product_variants: null,
      },
      ruOnly,
      physical,
    ];
    expect(filterMiniAppProductIds(rows, new Set(), "", "", undefined, "kk")).toEqual(["ws"]);
    expect(filterMiniAppProductIds(rows, new Set(), "", "", undefined, "ru")).toEqual([
      "ws",
      "ru-only",
    ]);
    expect(collectMiniAppMaterialLanguages(rows, new Set(rows.map((row) => row.id)))).toEqual([
      "ru",
      "kk",
    ]);
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

  it("lists material files on the product page and keeps a library tab", () => {
    const files = renderMiniAppFileList(worksheet, "ru");
    expect(files).toContain("pdp-files");
    expect(files).toContain("RU");
    expect(files).toContain("KZ");
    expect(files).toContain("sept.pdf");
    expect(renderMiniAppFileList({ ...worksheet, fulfillment_kind: "physical" }, "ru")).toBe("");
    const tabs = renderMiniAppTabBar("ru", "catalog", new URLSearchParams({ lang: "ru" }));
    expect(tabs).toContain("/mini-app/library");
    expect(tabs).toContain("Материалы");
    expect(tabs).toContain("tab-bar");
  });
});

describe("Mini App catalog sort", () => {
  it("orders by popularity, recency and price", () => {
    const rows: MiniAppProductIndexRow[] = [
      {
        id: "old",
        name: "Old",
        description: null,
        category_ids: [],
        price: 900,
        created_at: "2024-01-01",
        rating_avg: 5,
        rating_count: 1,
        product_variants: null,
      },
      {
        id: "hit",
        name: "Hit",
        description: null,
        category_ids: [],
        price: 300,
        created_at: "2025-01-01",
        rating_avg: 4.2,
        rating_count: 40,
        product_variants: null,
      },
      {
        id: "fresh",
        name: "Fresh",
        description: null,
        category_ids: [],
        price: 500,
        created_at: "2026-01-01",
        rating_avg: 0,
        rating_count: 0,
        product_variants: null,
      },
    ];
    const ids = rows.map((row) => row.id);
    expect(parseMiniAppSort("nope")).toBe("catalog");
    expect(sortMiniAppProductIds(rows, ids, "catalog")).toEqual(ids);
    expect(sortMiniAppProductIds(rows, ids, "popular")).toEqual(["hit", "old", "fresh"]);
    expect(sortMiniAppProductIds(rows, ids, "new")).toEqual(["fresh", "hit", "old"]);
    expect(sortMiniAppProductIds(rows, ids, "price")).toEqual(["hit", "fresh", "old"]);
  });
});
