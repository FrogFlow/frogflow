import { describe, expect, it } from "vitest";
import {
  descendantCategoryIds,
  parseMiniAppCatalogSettings,
  resolveMiniAppCategoryChips,
  type CategoryNode,
} from "../src/lib/category-tree";

const cats: CategoryNode[] = [
  { id: "math", name: "Математика", parent_id: null, sort_order: 1, is_visible: true },
  { id: "grade5", name: "5 класс", parent_id: "math", sort_order: 1, is_visible: true },
  { id: "physics", name: "Физика", parent_id: null, sort_order: 2, is_visible: true },
  { id: "hidden", name: "Скрыто", parent_id: null, sort_order: 3, is_visible: false },
];

describe("Mini App category layout", () => {
  it("defaults to the bot-like tree of root folders", () => {
    expect(parseMiniAppCatalogSettings(null)).toEqual({ layout: "tree", order: [] });
    const { chips } = resolveMiniAppCategoryChips(cats, { layout: "tree", order: [] });
    expect(chips.map((c) => c.id)).toEqual(["math", "physics"]);
  });

  it("shows children after opening a main category", () => {
    const { chips, parentId, current } = resolveMiniAppCategoryChips(
      cats,
      { layout: "tree", order: [] },
      "math",
    );
    expect(current?.id).toBe("math");
    expect(parentId).toBeNull();
    expect(chips.map((c) => c.id)).toEqual(["grade5"]);
    expect([...descendantCategoryIds("math", cats)].sort()).toEqual(["grade5", "math"]);
  });

  it("uses a custom Mini App top-level order", () => {
    const { chips } = resolveMiniAppCategoryChips(cats, {
      layout: "custom",
      order: ["grade5", "physics"],
    });
    expect(chips.map((c) => c.id)).toEqual(["grade5", "physics"]);
  });
});
