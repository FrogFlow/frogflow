/**
 * Товары, привязанные к истории.
 *
 * Изначально товар был ровно один: три колонки product_name,
 * product_price_kzt, product_id. Продавец снимает сторис, где лежат простыня,
 * пододеяльник и наволочки, и хочет, чтобы бот знал их все.
 *
 * Список живёт в колонке products (MIGRATION-71). Старые три колонки не
 * удалены и продолжают хранить ПЕРВЫЙ товар списка: на них смотрит уже
 * выложенный код, и ломать его на живых клиентах ради нового поля незачем.
 * Поэтому чтение всегда идёт через этот модуль: есть список — берём его,
 * нет — собираем список из одного по старым колонкам.
 */
export type StoryProduct = {
  id?: string | null;
  name: string;
  price_kzt?: number | null;
};

type StoryTagRow = {
  products?: unknown;
  product_name?: string | null;
  product_price_kzt?: number | null;
  product_id?: string | null;
};

function normalize(raw: unknown): StoryProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (!name) return null;
  const price = Number(p.price_kzt ?? p.priceKzt);
  return {
    name,
    id: typeof p.id === "string" && p.id.trim() ? p.id.trim() : null,
    price_kzt: Number.isFinite(price) && price > 0 ? price : null,
  };
}

/** Что привязано к истории — всегда списком, даже если товар один. */
export function storyProductsOf(tag: StoryTagRow | null | undefined): StoryProduct[] {
  if (!tag) return [];
  const raw = typeof tag.products === "string" ? safeParse(tag.products) : tag.products;
  if (Array.isArray(raw)) {
    const list = raw.map(normalize).filter((p): p is StoryProduct => p !== null);
    if (list.length > 0) return dedupe(list);
  }
  const single = normalize({
    id: tag.product_id,
    name: tag.product_name,
    price_kzt: tag.product_price_kzt,
  });
  return single ? [single] : [];
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Один и тот же товар, добавленный дважды, покупателю показывать не надо. */
export function dedupe(list: StoryProduct[]): StoryProduct[] {
  const seen = new Set<string>();
  const out: StoryProduct[] = [];
  for (const p of list) {
    const key = (p.id || p.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Что писать в колонки product_* при сохранении: первый товар списка. Пустой
 * список сохранять нельзя — product_name объявлен NOT NULL.
 */
export function legacyColumnsOf(list: StoryProduct[]): {
  product_name: string;
  product_price_kzt: number | null;
  product_id: string | null;
} | null {
  const first = list[0];
  if (!first) return null;
  return {
    product_name: first.name,
    product_price_kzt: first.price_kzt ?? null,
    product_id: first.id ?? null,
  };
}
