import { expandToken, foldText, haystackOf, tokenizeQuery } from "./synonyms";

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

function matches(product: ConsultantProduct, q: ProductSearchQuery): boolean {
  const hay = haystackOf([product.name, product.category, product.size, product.colors.join(" ")]);
  if (q.category && !hay.includes(expandToken(q.category))) return false;
  if (q.size && !foldText(product.size).includes(foldText(q.size))) return false;
  if (q.color && !hay.includes(expandToken(q.color))) return false;
  if (q.query) {
    const tokens = tokenizeQuery(q.query);
    if (tokens.length > 0 && !tokens.every((t) => hay.includes(t))) return false;
  }
  return true;
}

export const CATALOG_KEY = "consultant_catalog_json";
export const CATALOG_META_KEY = "consultant_catalog_meta";
export const SHOP_URL_KEY = "consultant_shop_url";
export const SHEETS_URL_KEY = "consultant_sheets_url";
export const DEFAULT_SHOP_URL = "https://bovi.kz";

export type CatalogMeta = {
  count: number;
  importedAt: string;
  source: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function getConsultantShopUrl(): Promise<string> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", SHOP_URL_KEY)
    .maybeSingle();
  const url = data?.value?.trim();
  return url || DEFAULT_SHOP_URL;
}

export async function loadCatalogMeta(): Promise<CatalogMeta | null> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", CATALOG_META_KEY)
    .maybeSingle();
  if (!data?.value?.trim()) return null;
  try {
    return JSON.parse(data.value) as CatalogMeta;
  } catch {
    return null;
  }
}

export type SheetsImportResult =
  { ok: true; meta: CatalogMeta; skipped: number } | { ok: false; reason: string };

export async function importCatalogFromSheetsUrl(url: string): Promise<SheetsImportResult> {
  const { googleSheetsCsvUrl, parseCatalogCsv } = await import("./catalog-import");
  const csvUrl = googleSheetsCsvUrl(url);
  if (!csvUrl) return { ok: false, reason: "bad_url" };
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const csv = await res.text();
  const parsed = parseCatalogCsv(csv);
  if (parsed.products.length === 0) {
    return { ok: false, reason: parsed.errors[0]?.message || "empty" };
  }
  const s = await db();
  await s.from("app_settings").upsert({
    key: SHEETS_URL_KEY,
    value: url,
    updated_at: new Date().toISOString(),
  });
  const meta = await saveConsultantCatalog(parsed.products, "google_sheets");
  return { ok: true, meta, skipped: parsed.errors.length };
}

/** Крон: если ссылка на таблицу сохранена — обновить снимок. */
export async function refreshCatalogFromSavedSheet(): Promise<SheetsImportResult> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", SHEETS_URL_KEY)
    .maybeSingle();
  const url = data?.value?.trim();
  if (!url) return { ok: false, reason: "no_sheets_url" };
  return importCatalogFromSheetsUrl(url);
}

export async function saveConsultantCatalog(
  products: ConsultantProduct[],
  source: string,
): Promise<CatalogMeta> {
  const meta: CatalogMeta = {
    count: products.length,
    importedAt: new Date().toISOString(),
    source,
  };
  const s = await db();
  const now = meta.importedAt;
  await s.from("app_settings").upsert([
    { key: CATALOG_KEY, value: JSON.stringify(products), updated_at: now },
    { key: CATALOG_META_KEY, value: JSON.stringify(meta), updated_at: now },
  ]);
  catalogCache = { at: Date.now(), products };
  return meta;
}

let catalogCache: { at: number; products: ConsultantProduct[] } | null = null;
const CATALOG_CACHE_MS = 45_000;

export function invalidateConsultantCatalogCache(): void {
  catalogCache = null;
}

/**
 * Снимок прайса. Пустой = честный «нет в наличии», не догадка модели.
 */
export async function loadConsultantCatalog(): Promise<ConsultantProduct[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_MS) {
    return catalogCache.products;
  }
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", CATALOG_KEY)
    .maybeSingle();
  if (!data?.value?.trim()) {
    catalogCache = { at: Date.now(), products: [] };
    return [];
  }
  try {
    const parsed = JSON.parse(data.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const products = parsed.filter(isConsultantProduct);
    catalogCache = { at: Date.now(), products };
    return products;
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

const QUERY_STOP = new Set([
  "есть",
  "нужен",
  "нужна",
  "нужно",
  "хочу",
  "подскажи",
  "сколько",
  "стоит",
  "цена",
  "пожалуйста",
  "можно",
  "какой",
  "какое",
  "какие",
  "наличии",
  "наличие",
]);

/** В запросе есть размер, цвет или слово из прайса — можно ответить без Claude. */
export function queryHasCatalogSignal(text: string, catalog: ConsultantProduct[]): boolean {
  if (/\d+\s*[xх×]\s*\d+/i.test(text)) return true;
  const tokens = tokenizeQuery(text).filter((t) => t.length > 2 && !QUERY_STOP.has(t));
  if (tokens.length === 0) return false;
  return catalog.some((p) => {
    const hay = haystackOf([p.name, p.category, p.size, p.colors.join(" ")]);
    return tokens.some((t) => hay.includes(t));
  });
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
