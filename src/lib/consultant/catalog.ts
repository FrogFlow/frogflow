/**
 * Нормализованная карточка. Claude видит только результаты search/get,
 * не весь прайс и не «память» модели.
 */
export type ConsultantProduct = {
  id: string;
  name: string;
  category: string;
  size: string;
  colors: string[];
  price_kzt: number;
  stock: boolean;
  stock_qty?: number;
};

export type ProductSearchQuery = {
  query?: string;
  category?: string;
  size?: string;
  color?: string;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/×/g, "x").replace(/\s+/g, " ");
}

function matches(product: ConsultantProduct, q: ProductSearchQuery): boolean {
  if (q.category && normalize(product.category) !== normalize(q.category)) return false;
  if (q.size && normalize(product.size) !== normalize(q.size)) return false;
  if (q.color && !product.colors.some((c) => normalize(c) === normalize(q.color!))) return false;
  if (q.query) {
    const hay = normalize(
      [product.name, product.category, product.size, product.colors.join(" ")].join(" "),
    );
    const tokens = normalize(q.query)
      .split(" ")
      .filter((t) => t.length > 1);
    if (tokens.length > 0 && !tokens.every((t) => hay.includes(t))) return false;
  }
  return true;
}

/**
 * Снимок прайса. Пока нет синка Sheets — читаем JSON из app_settings.
 * Пустой снимок = честный «нет в наличии», не догадка модели.
 */
export async function loadConsultantCatalog(): Promise<ConsultantProduct[]> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "consultant_catalog_json")
    .maybeSingle();
  if (!data?.value?.trim()) return [];
  try {
    const parsed = JSON.parse(data.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConsultantProduct);
  } catch {
    return [];
  }
}

function isConsultantProduct(row: unknown): row is ConsultantProduct {
  if (!row || typeof row !== "object") return false;
  const p = row as Partial<ConsultantProduct>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.category === "string" &&
    typeof p.size === "string" &&
    Array.isArray(p.colors) &&
    typeof p.price_kzt === "number" &&
    typeof p.stock === "boolean"
  );
}

export async function searchProducts(
  q: ProductSearchQuery,
  catalog?: ConsultantProduct[],
): Promise<ConsultantProduct[]> {
  const rows = catalog ?? (await loadConsultantCatalog());
  const hasFilter = Boolean(q.query || q.category || q.size || q.color);
  if (!hasFilter) return rows.slice(0, 8);
  return rows.filter((p) => matches(p, q)).slice(0, 8);
}

export async function getProduct(
  id: string,
  catalog?: ConsultantProduct[],
): Promise<ConsultantProduct | null> {
  const rows = catalog ?? (await loadConsultantCatalog());
  return rows.find((p) => p.id === id) ?? null;
}
