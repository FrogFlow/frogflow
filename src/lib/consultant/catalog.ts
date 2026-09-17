import { expandToken, foldText, haystackOf, tokenizeQuery } from "./synonyms";

/**
 * Нормализованная карточка. Claude видит только результаты search/get,
 * не весь прайс и не «память» модели.
 */
export type ProductHardness = "soft" | "medium" | "firm";

export type ConsultantProduct = {
  id: string;
  name: string;
  category: string;
  size: string;
  colors: string[];
  price_kzt: number;
  stock: boolean;
  stock_qty?: number;
  material?: string;
  description?: string;
  /**
   * Жёсткость матраса или топпера. В прайсе 1С отдельной колонки под неё нет —
   * фабрика пишет её в названии («Dorelan LEVANT R4 SOFT 160x200»), поэтому
   * поле необязательное, а читать жёсткость надо через productHardness().
   */
  hardness?: ProductHardness;
};

export type ProductSearchQuery = {
  query?: string;
  category?: string;
  size?: string;
  color?: string;
  hardness?: ProductHardness;
  max_price_kzt?: number;
  exclude_ids?: string[];
  /** Переопределяет BROWSE_LIMIT / NARROW_LIMIT — нужен точечно, обычно не задаётся. */
  limit?: number;
};

const HARDNESS_PATTERNS: [ProductHardness, RegExp][] = [
  ["soft", /(?:^|[^a-z])soft(?:[^a-z]|$)|мягк/i],
  ["medium", /(?:^|[^a-z])medium(?:[^a-z]|$)|(?:^|[^a-zа-яё])средн/i],
  ["firm", /(?:^|[^a-z])(?:firm|hard)(?:[^a-z]|$)|жестк|жёстк/i],
];

/** Жёсткость из свободного текста: «TRESOR R3 SOFT», «что есть в жёсткости soft». */
export function extractHardness(text: string): ProductHardness | null {
  if (!text) return null;
  for (const [kind, re] of HARDNESS_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

/**
 * Жёсткость товара: поле, если импорт его проставил, иначе вывод из названия.
 * Вывод из названия обязателен — каталог в базе загружен прежним импортом,
 * без поля hardness, и переимпорт ради поиска по жёсткости требовать нельзя.
 */
export function productHardness(product: ConsultantProduct): ProductHardness | null {
  return product.hardness ?? extractHardness(`${product.name} ${product.size}`);
}

/**
 * Допуск по размеру. Продавец подтвердил: фабрика выпускает 182×202 вместо
 * 180×200, и для покупателя это один и тот же размер — расхождение до 3 см
 * по каждой стороне считается совпадением, иначе поиск отвечает «нет»
 * на товар, который лежит на складе.
 */
export const SIZE_TOLERANCE_CM = 3;

function parseSizeDims(text: string): number[] | null {
  const m = foldText(text).match(/(\d{2,3})x(\d{2,3})(?:x(\d{1,3}))?/);
  if (!m) return null;
  const dims = [Number(m[1]), Number(m[2])];
  if (m[3]) dims.push(Number(m[3]));
  return dims.every((n) => Number.isFinite(n) && n > 0) ? dims : null;
}

/**
 * Кухонные полотенца. У BOVI это отдельное назначение (SANDER), всё остальное —
 * банные и для лица. Продавец попросил не подмешивать кухонные в общий запрос
 * про полотенца и предлагать их, только когда спросили именно кухонные.
 */
const KITCHEN_TOWEL_RE = /кухон|kitchen|tea\s*towel/i;

export function isKitchenTowel(product: ConsultantProduct): boolean {
  return KITCHEN_TOWEL_RE.test(`${product.name} ${product.category}`);
}

/**
 * Прячем кухонные только в запросе именно про полотенца: поиск по бренду
 * SANDER или по цвету должен их находить, иначе они станут ненаходимыми.
 */
function hidesKitchenTowels(q: ProductSearchQuery): boolean {
  const text = `${q.query ?? ""} ${q.category ?? ""}`;
  if (!/полотенц|towel/i.test(foldText(text))) return false;
  return !KITCHEN_TOWEL_RE.test(text);
}

/** Точное вхождение либо расхождение не больше SIZE_TOLERANCE_CM по каждой стороне. */
export function sizeMatches(productSize: string, querySize: string): boolean {
  const want = foldText(querySize);
  if (!want) return true;
  if (foldText(productSize).includes(want)) return true;
  const have = parseSizeDims(productSize);
  const asked = parseSizeDims(querySize);
  if (!have || !asked) return false;
  const shared = Math.min(have.length, asked.length);
  if (shared < 2) return false;
  for (let i = 0; i < shared; i++) {
    if (Math.abs(have[i] - asked[i]) > SIZE_TOLERANCE_CM) return false;
  }
  return true;
}

function matches(product: ConsultantProduct, q: ProductSearchQuery): boolean {
  const hay = haystackOf([product.name, product.category, product.size, product.colors.join(" ")]);
  // Категорию сверяем только с названием и категорией товара. Раньше она
  // искалась по общему стогу вместе с расцветками и размером, и подбор по
  // цвету сползал в соседнюю категорию: на «голубые полотенца 50x70»
  // выдавалось голубое постельное бельё.
  if (q.category && !haystackOf([product.category, product.name]).includes(expandToken(q.category))) {
    return false;
  }
  if (q.size && !sizeMatches(product.size, q.size)) return false;
  if (q.color && !hay.includes(expandToken(q.color))) return false;
  // Жёсткость названа явно — другая жёсткость это не «похожий вариант», а
  // не тот товар: на запрос про soft выдавался TRESOR R2 MEDIUM.
  if (q.hardness && productHardness(product) !== q.hardness) return false;
  if (isKitchenTowel(product) && hidesKitchenTowels(q)) return false;
  if (typeof q.max_price_kzt === "number" && q.max_price_kzt > 0 && product.price_kzt > q.max_price_kzt) {
    return false;
  }
  if (q.exclude_ids?.includes(product.id)) return false;
  if (q.query) {
    const negated = extractNegatedWords(q.query);
    for (const neg of negated) {
      if (hay.includes(neg)) return false;
    }
    const tokens = searchTokens(q.query);
    if (tokens.length === 0 && negated.size === 0) return false;
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
    if (catalogCache?.products?.length) return catalogCache.products;
    catalogCache = { at: Date.now(), products: [] };
    return [];
  }
  try {
    const parsed = JSON.parse(data.value) as unknown;
    if (!Array.isArray(parsed)) return catalogCache?.products ?? [];
    const products = parsed.filter(isConsultantProduct);
    catalogCache = { at: Date.now(), products };
    return products;
  } catch {
    return catalogCache?.products ?? [];
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

/** Служебные слова живой фразы. «У вас есть полотенца?» → только «полотенце». */
export const QUERY_STOP = new Set([
  "есть",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
  "хочу",
  "подскажи",
  "подскажите",
  "скажите",
  "сколько",
  "стоит",
  "цена",
  "пожалуйста",
  "можно",
  "какой",
  "какая",
  "какое",
  "какие",
  "наличии",
  "наличие",
  "вас",
  "вам",
  "мне",
  "меня",
  "нам",
  "вы",
  "ли",
  "или",
  "для",
  "дома",
  "дом",
  "что",
  "это",
  "этот",
  "эта",
  "эти",
  "ещё",
  "еще",
  "нибудь",
  "можете",
  "посоветовать",
  "посоветуйте",
  "посоветуешь",
  "посоветуете",
  "порекомендуйте",
  "интересует",
  "интересуют",
  "покажите",
  "только",
  "купить",
  "купите",
  "предложите",
  "предложить",
  "корзину",
  "корзина",
  "бюджет",
  "тысяч",
  "тенге",
  "казахстан",
  "казахстана",
  "қазақстан",
  "россия",
  "россии",
  "россию",
  "россией",
  "алматы",
  "астана",
  "шымкент",
  "москва",
  "питер",
  "страна",
  "дагестан",
  "дагестане",
  "хасавюрт",
  "хасавюрте",
  "доставка",
  "доставку",
  "доставке",
  "сдэк",
  "cdek",
  "заказать",
  "цвет",
  "цвета",
  "расцветка",
  "расцветки",
  "оттенок",
  "оттенки",
  "осень",
  "зима",
  "качество",
  "соотношение",
  "здравствуйте",
  "привет",
  "добрый",
  "день",
  "вечер",
  "давайте",
  "давай",
  "хочу",
  "хотим",
  "хочется",
  "возьму",
  "возьмем",
  "возьмём",
  "берем",
  "берём",
  "беру",
  "буду",
  "будем",
  "можно",
  "пожалуйста",
  "спасибо",
  "благодарю",
  "какой",
  "какая",
  "какое",
  "какие",
  "каком",
  "наличие",
  "наличии",
  "подскажите",
  "выбрать",
  "выберите",
  "этого",
  "этому",
  "этом",
  "будет",
  "хватит",
  "достаточно",
]);

export function extractNegatedWords(text: string): Set<string> {
  const negated = new Set<string>();
  const re = /\bне\s+([а-яa-z0-9]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      negated.add(expandToken(m[1]));
    }
  }
  return negated;
}

export function searchTokens(text: string): string[] {
  const negated = extractNegatedWords(text);
  return tokenizeQuery(text).filter((t) => {
    if (negated.has(t)) return false;
    if (QUERY_STOP.has(t) || /^\d+$/.test(t)) return false;
    if (/^[smlx]{1,3}$/i.test(t)) return true;
    return t.length > 2;
  });
}

/** В запросе есть размер, цвет или слово из прайса — можно ответить без Claude. */
const CATEGORY_STEMS = new Set([
  "одеяло",
  "подушка",
  "полотенце",
  "плед",
  "матрас",
  "постельное",
  "халат",
  "тарелка",
  "кружка",
]);

const SIZE_WORDS = /евро|семей|двуспальн|полутор|1\.5|полутораспальн/;

/** «Интересует одеяло» без 150×200 — менеджер сначала даёт размеры, не одну SKU. */
export function isCategoryWithoutSize(text: string): boolean {
  if (/\bне\s+/i.test(text)) return false;
  if (/\d+\s*[xх×*∗]\s*\d+/i.test(text)) return false;
  const tokens = searchTokens(text);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => SIZE_WORDS.test(t))) return false;
  return tokens.every((t) => CATEGORY_STEMS.has(t));
}

export function categoryQuery(text: string): string | null {
  const cats = searchTokens(text).filter((t) => CATEGORY_STEMS.has(t));
  return cats.length ? cats.join(" ") : null;
}

export function sizeOptions(
  catalog: ConsultantProduct[],
  query: string,
  limit = 5,
): ConsultantProduct[] {
  const tokens = searchTokens(query);
  const inStock = catalog.filter((p) => {
    if (!p.stock) return false;
    const hay = haystackOf([p.name, p.category, p.size, p.colors.join(" ")]);
    return tokens.length > 0 && tokens.every((t) => hay.includes(t));
  });
  const bySize = new Map<string, ConsultantProduct>();
  for (const p of inStock) {
    const key = foldText(p.size) || p.id;
    if (!bySize.has(key)) bySize.set(key, p);
  }
  return [...bySize.values()].slice(0, limit);
}

export function queryHasCatalogSignal(text: string, catalog: ConsultantProduct[]): boolean {
  if (/\d+\s*[xх×]\s*\d+/i.test(text)) return true;
  const tokens = searchTokens(text);
  if (tokens.length === 0) return false;
  return catalog.some((p) => {
    const hay = haystackOf([p.name, p.category, p.size, p.colors.join(" ")]);
    return tokens.some((t) => hay.includes(t));
  });
}

/**
 * Разнообразит выборку: гарантирует, что каждый доступный размер и модель
 * попадают в топ результатов, а не вытесняются несколькими расцветками одного размера.
 */
export function diversifyProducts(products: ConsultantProduct[], limit = 12): ConsultantProduct[] {
  const inStock = products.filter((p) => p.stock);
  const outOfStock = products.filter((p) => !p.stock);
  const sorted = [...inStock, ...outOfStock];

  const byGroup = new Map<string, ConsultantProduct[]>();
  for (const p of sorted) {
    const key = `${foldText(p.name)}|${foldText(p.size)}`;
    const list = byGroup.get(key) ?? [];
    list.push(p);
    byGroup.set(key, list);
  }

  const result: ConsultantProduct[] = [];
  let round = 0;
  let added = true;
  while (added && result.length < limit) {
    added = false;
    for (const list of byGroup.values()) {
      if (round < list.length) {
        result.push(list[round]);
        added = true;
        if (result.length >= limit) break;
      }
    }
    round++;
  }
  return result;
}

/**
 * Обогащает карточку всеми доступными в наличии расцветками для данной модели и размера.
 * В исходном прайсе/CSV каждый цвет — отдельная строка (SKU).
 * Чтобы модель видела полный спектр расцветок (и валидатор не блокировал их),
 * агрегируем расцветки из всех товаров в наличии с тем же именем и размером.
 */
export function enrichProductColors(
  product: ConsultantProduct,
  catalog: ConsultantProduct[],
): ConsultantProduct {
  const matching = catalog.filter(
    (p) =>
      p.stock &&
      foldText(p.name) === foldText(product.name) &&
      foldText(p.size) === foldText(product.size),
  );
  if (matching.length <= 1) return product;

  const colorSet = new Set<string>();
  for (const c of product.colors) {
    if (c && c.trim()) colorSet.add(c.trim());
  }
  for (const p of matching) {
    for (const c of p.colors) {
      if (c && c.trim()) colorSet.add(c.trim());
    }
  }
  if (colorSet.size === 0) return product;

  return {
    ...product,
    colors: Array.from(colorSet),
  };
}

/** Свободный просмотр без единого фильтра — короткая витрина, а не весь прайс. */
const BROWSE_LIMIT = 12;

/**
 * Запрос с явным фильтром (размер, цвет, жёсткость, категория, бюджет).
 * Прежний потолок в 12 позиций резал выдачу молча: на «что есть в жёсткости
 * soft» продавец получил три матраса из восьми и сказал, что так работать
 * нельзя. Потолок оставлен только как страховка от выгрузки всего прайса в
 * контекст модели, а сколько позиций нашлось всего, возвращается отдельно —
 * чтобы ответ мог назвать полное число, а не делать вид, что их столько и есть.
 */
const NARROW_LIMIT = 40;

/**
 * Полный список совпадений и то, что реально уходит в ответ.
 * Вызывающему нужен именно `all.length`: без него «показано 12» и «всего 12»
 * неразличимы.
 */
export function findProducts(
  q: ProductSearchQuery,
  rows: ConsultantProduct[],
): { all: ConsultantProduct[]; shown: ConsultantProduct[] } {
  const hasFilter = Boolean(
    q.query || q.category || q.size || q.color || q.hardness || q.max_price_kzt,
  );
  if (!hasFilter) {
    return { all: rows, shown: diversifyProducts(rows, q.limit ?? BROWSE_LIMIT) };
  }
  const all = rows.filter((p) => matches(p, q));
  const limit = q.limit ?? NARROW_LIMIT;
  if (q.max_price_kzt) {
    const sorted = [...all].sort(
      (a, b) => Number(b.stock) - Number(a.stock) || b.price_kzt - a.price_kzt,
    );
    return { all: sorted, shown: sorted.slice(0, limit) };
  }
  if (q.size || q.color || q.hardness) {
    return { all, shown: all.slice(0, limit) };
  }
  return { all, shown: diversifyProducts(all, limit) };
}

export async function searchProductsDetailed(
  q: ProductSearchQuery,
  catalog?: ConsultantProduct[],
): Promise<{ all: ConsultantProduct[]; shown: ConsultantProduct[] }> {
  const rows = catalog ?? (await loadConsultantCatalog());
  return findProducts(q, rows);
}

export async function searchProducts(
  q: ProductSearchQuery,
  catalog?: ConsultantProduct[],
): Promise<ConsultantProduct[]> {
  return (await searchProductsDetailed(q, catalog)).shown;
}

/**
 * Ценовое дно и потолок того же среза каталога, но БЕЗ ограничения по цене.
 *
 * Нужно, чтобы ответ про бюджет опирался на факт, а не на догадку. На запрос
 * «одеяло за 100 000 ₸» бот ответил «это довольно узкий ценовой сегмент» и
 * подставил подушку за 30 000, хотя правда простая: одеял дешевле 170 000 в
 * каталоге нет вообще. С этим числом на руках сказать правду проще, чем
 * смягчить.
 */
export function priceFloorInScope(
  q: ProductSearchQuery,
  rows: ConsultantProduct[],
): { cheapest: ConsultantProduct; count: number } | null {
  const { max_price_kzt: _ignored, ...scope } = q;
  const inScope = rows.filter((p) => p.stock && p.price_kzt > 0 && matches(p, scope));
  if (inScope.length === 0) return null;
  const cheapest = inScope.reduce((a, b) => (b.price_kzt < a.price_kzt ? b : a));
  return { cheapest, count: inScope.length };
}

export function productsUnderBudget(
  catalog: ConsultantProduct[],
  maxPriceKzt: number,
): ConsultantProduct[] {
  return catalog
    .filter((p) => p.stock && p.price_kzt > 0 && p.price_kzt <= maxPriceKzt)
    .sort((a, b) => b.price_kzt - a.price_kzt);
}

/**
 * Две позиции из разных категорий в бюджет — не одна случайная первая.
 *
 * `category` сужает подбор, когда клиент назвал категорию: разброс по
 * категориям задумывался под «соберите набор», а на «одеяло за 100 000»
 * он выдавал подушку. Разные категории внутри среза по-прежнему
 * предпочитаются — но только внутри него.
 */
export function suggestForBudget(
  catalog: ConsultantProduct[],
  maxPriceKzt: number,
  limit = 2,
  category?: string,
): ConsultantProduct[] {
  const scoped = category
    ? catalog.filter((p) => matches(p, { category }))
    : catalog;
  const under = productsUnderBudget(scoped, maxPriceKzt);
  const picks: ConsultantProduct[] = [];
  const seen = new Set<string>();
  for (const p of under) {
    const cat = foldText(p.category || p.name);
    if (picks.length > 0 && seen.has(cat)) continue;
    picks.push(p);
    seen.add(cat);
    if (picks.length >= limit) break;
  }
  if (picks.length === 1 && under.length > 1) picks.push(under.find((p) => p.id !== picks[0].id)!);
  return picks.filter(Boolean);
}

/** Набор 2–3 позиций, сумма как можно ближе к бюджету, но не выше. */
export function packBasket(
  catalog: ConsultantProduct[],
  budgetKzt: number,
  maxItems = 3,
): { items: ConsultantProduct[]; total: number } {
  const under = productsUnderBudget(catalog, budgetKzt);
  if (under.length === 0) return { items: [], total: 0 };

  const byCat = new Map<string, ConsultantProduct[]>();
  for (const p of under) {
    const cat = foldText(p.category || p.name);
    const list = byCat.get(cat) ?? [];
    if (list.length < 3) list.push(p);
    byCat.set(cat, list);
  }
  const cheap = [...under].sort((a, b) => a.price_kzt - b.price_kzt).slice(0, 10);
  const seen = new Set<string>();
  const pool: ConsultantProduct[] = [];
  for (const p of [...byCat.values()].flat().concat(cheap)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    pool.push(p);
  }

  let best: { items: ConsultantProduct[]; total: number } = { items: [], total: 0 };
  const consider = (items: ConsultantProduct[]) => {
    if (items.length === 0 || items.length > maxItems) return;
    const total = items.reduce((sum, p) => sum + p.price_kzt, 0);
    if (total > budgetKzt) return;
    if (total > best.total || (total === best.total && items.length > best.items.length)) {
      best = { items, total };
    }
  };

  for (const a of pool) consider([a]);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) consider([pool[i], pool[j]]);
  }
  if (maxItems >= 3) {
    const n = Math.min(pool.length, 18);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) consider([pool[i], pool[j], pool[k]]);
      }
    }
  }
  return best;
}

/** Другие карточки той же категории, чем уже показали. */
export function relatedVariants(
  catalog: ConsultantProduct[],
  lastIds: string[],
  limit = 2,
): ConsultantProduct[] {
  const shown = catalog.filter((p) => lastIds.includes(p.id));
  if (shown.length === 0) return [];
  const cats = new Set(shown.map((p) => foldText(p.category)));
  const stems = new Set(shown.map((p) => foldText(p.name).split(" ")[0] ?? "").filter(Boolean));
  const shownSig = new Set(
    shown.map((p) => `${foldText(p.size)}|${p.colors.map((c) => foldText(c)).sort().join(",")}`),
  );
  const rest = catalog.filter((p) => {
    if (!p.stock || lastIds.includes(p.id)) return false;
    const cat = foldText(p.category);
    const stem = foldText(p.name).split(" ")[0] ?? "";
    return cats.has(cat) || stems.has(stem);
  });
  const different = rest.filter(
    (p) => !shownSig.has(`${foldText(p.size)}|${p.colors.map((c) => foldText(c)).sort().join(",")}`),
  );
  const pool = different.length > 0 ? different : rest;
  return pool.slice(0, limit);
}

export async function getProduct(
  id: string,
  catalog?: ConsultantProduct[],
): Promise<ConsultantProduct | null> {
  const rows = catalog ?? (await loadConsultantCatalog());
  return rows.find((p) => p.id === id) ?? null;
}
