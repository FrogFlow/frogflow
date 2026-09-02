/** Shared helpers for category trees in admin UI. */

export type CategoryNode = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order?: number;
  is_visible?: boolean;
};

export function getCategoryPath(id: string, all: CategoryNode[]): string {
  const c = all.find((x) => x.id === id);
  if (!c) return id;
  if (!c.parent_id) return c.name;
  return getCategoryPath(c.parent_id, all) + " → " + c.name;
}

/** Roots first, then children nested under parents (DFS). Stable within level. */
export function sortCategoriesTree<T extends CategoryNode>(cats: T[]): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const c of cats) {
    const key = c.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (so !== 0) return so;
      return a.name.localeCompare(b.name, "ru");
    });
  }
  const out: T[] = [];
  function walk(parentId: string | null) {
    for (const c of byParent.get(parentId) ?? []) {
      out.push(c);
      walk(c.id);
    }
  }
  walk(null);
  return out;
}

export function filterCategoriesByQuery<T extends CategoryNode>(cats: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return cats;
  return cats.filter((c) => {
    const path = getCategoryPath(c.id, cats).toLowerCase();
    return path.includes(q) || c.name.toLowerCase().includes(q);
  });
}

export type MiniAppCatalogLayout = "tree" | "flat" | "custom";

export type MiniAppCatalogSettings = {
  layout: MiniAppCatalogLayout;
  order: string[];
};

export function parseMiniAppCatalogSettings(
  raw: string | null | undefined,
): MiniAppCatalogSettings {
  const fallback: MiniAppCatalogSettings = { layout: "tree", order: [] };
  if (!raw?.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<MiniAppCatalogSettings>;
    const layout: MiniAppCatalogLayout =
      parsed.layout === "flat" || parsed.layout === "custom" ? parsed.layout : "tree";
    const order = Array.isArray(parsed.order)
      ? parsed.order
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .slice(0, 80)
      : [];
    return { layout, order };
  } catch {
    return fallback;
  }
}

export function descendantCategoryIds(categoryId: string, cats: CategoryNode[]): Set<string> {
  const ids = new Set<string>([categoryId]);
  const byParent = new Map<string, CategoryNode[]>();
  for (const category of cats) {
    if (!category.parent_id) continue;
    const children = byParent.get(category.parent_id) ?? [];
    children.push(category);
    byParent.set(category.parent_id, children);
  }
  const stack = [categoryId];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const child of byParent.get(current) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      stack.push(child.id);
    }
  }
  return ids;
}

function sortCategoryLevel<T extends CategoryNode>(cats: T[]): T[] {
  return [...cats].sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (order !== 0) return order;
    return a.name.localeCompare(b.name, "ru");
  });
}

export function resolveMiniAppCategoryChips<T extends CategoryNode>(
  cats: T[],
  settings: MiniAppCatalogSettings,
  currentId = "",
): { chips: T[]; parentId: string | null; current: T | null } {
  const visible = cats.filter((category) => category.is_visible !== false);
  const byId = new Map(visible.map((category) => [category.id, category]));
  const current = currentId ? (byId.get(currentId) ?? null) : null;
  const parentId = current?.parent_id ?? null;

  if (settings.layout === "flat") {
    return { chips: sortCategoriesTree(visible), parentId: null, current };
  }

  if (current) {
    return {
      chips: sortCategoryLevel(visible.filter((category) => category.parent_id === current.id)),
      parentId,
      current,
    };
  }

  if (settings.layout === "custom" && settings.order.length > 0) {
    const chips = settings.order
      .map((id) => byId.get(id))
      .filter((category): category is T => Boolean(category));
    return { chips, parentId: null, current: null };
  }

  return {
    chips: sortCategoryLevel(visible.filter((category) => !category.parent_id)),
    parentId: null,
    current: null,
  };
}
