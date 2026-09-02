import { describe, expect, it } from "vitest";
import {
  filterMiniAppProductIds,
  type MiniAppProductIndexRow,
} from "../src/lib/mini-app-catalog.server";

const products: MiniAppProductIndexRow[] = [
  {
    id: "visible",
    name: "Red cake",
    description: "Chocolate dessert",
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

  it("searches names, descriptions and variants across the full index", () => {
    expect(filterMiniAppProductIds(products, new Set(), "chocolate")).toEqual(["visible"]);
    expect(filterMiniAppProductIds(products, new Set(), "large")).toEqual(["visible"]);
    expect(filterMiniAppProductIds(products, new Set(), "red cake")).toEqual(["visible"]);
  });

  it("keeps uncategorized products only in the unfiltered catalog", () => {
    expect(filterMiniAppProductIds(products, new Set(), "", "cakes")).toEqual(["visible"]);
  });
});
