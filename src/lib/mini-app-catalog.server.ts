import type { Json } from "@/integrations-supabase/types";
import { imageUrl } from "@/lib/public-image";
import { miniAppStrings } from "./mini-app-i18n";
import {
  availableMaterialLanguages,
  MATERIAL_LANG_SHORT,
  MATERIAL_LANGUAGES,
  materialsForProduct,
} from "./product-materials";
import { isLocale, localeFlags, localeNames, type Locale } from "./i18n";
import { currentVertical, currentVerticalDef } from "./verticals/vertical.server";

export const MINI_APP_INDEX_SELECT =
  "id, name, description, keywords, category_ids, fulfillment_kind, price, created_at, rating_avg, rating_count, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order), product_variants(name)";

export const MINI_APP_PRODUCT_SELECT =
  "id, name, description, keywords, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices, stock_quantity, lead_time_days, fulfillment_kind, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order), product_variants(id, name, price, sort_order)";

export type MiniAppProduct = {
  id: string;
  name: string;
  description: string | null;
  keywords?: string | string[] | null;
  category_ids: Json;
  rating_avg: number | null;
  rating_count: number;
  product_images: Array<{ image_path: string; sort_order: number }> | null;
  price: number | string;
  currency: string | null;
  country_prices: Json;
  stock_quantity: number | null;
  lead_time_days?: number | null;
  fulfillment_kind?: "digital" | "physical" | null;
  file_path?: string | null;
  file_name?: string | null;
  file_path_kz?: string | null;
  file_name_kz?: string | null;
  file_url?: string | null;
  file_url_kz?: string | null;
  product_material_files?: Array<{
    language?: string | null;
    file_path?: string | null;
    file_name?: string | null;
    sort_order?: number | null;
  }> | null;
  product_variants: Array<{
    id: string;
    name: string;
    price: number | string;
    sort_order: number;
  }> | null;
};

export type MiniAppCategory = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order?: number;
  is_visible?: boolean;
};
export type MiniAppProductIndexRow = {
  id: string;
  name: string;
  description: string | null;
  keywords?: string | string[] | null;
  category_ids: Json;
  fulfillment_kind?: string | null;
  price?: number | string | null;
  created_at?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  file_path?: string | null;
  file_name?: string | null;
  file_path_kz?: string | null;
  file_name_kz?: string | null;
  file_url?: string | null;
  file_url_kz?: string | null;
  product_material_files?: Array<{
    language?: string | null;
    file_path?: string | null;
    file_name?: string | null;
    sort_order?: number | null;
  }> | null;
  product_variants: Array<{ name: string }> | null;
};

export type PricedProduct = {
  amount: number;
  currency: string;
  isFrom: boolean;
  variants: Record<string, { amount: number; currency: string }>;
};

export function escapeMiniAppHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatMiniAppMoney(amount: number, currency: string): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const cur = (currency || "").toUpperCase();
  return cur === "KZT" ? `${value} ₸` : `${value} ${currency}`;
}

export function miniAppProductSearchText(
  product: Pick<MiniAppProductIndexRow, "name" | "description" | "keywords" | "product_variants">,
  locale?: string,
): string {
  const keywords = Array.isArray(product.keywords)
    ? product.keywords.join(" ")
    : (product.keywords ?? "");
  return [
    product.name,
    product.description ?? "",
    keywords,
    ...(product.product_variants ?? []).map((variant) => variant.name),
  ]
    .join(" ")
    .toLocaleLowerCase(locale);
}

export function filterMiniAppProductIds(
  products: MiniAppProductIndexRow[],
  hiddenCategoryIds: ReadonlySet<string>,
  query = "",
  categoryId = "",
  categoryMatchIds?: ReadonlySet<string>,
  materialLang = "",
): string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase().slice(0, 100);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const matchIds = categoryMatchIds ?? (categoryId ? new Set([categoryId]) : null);
  const lang = materialLang.trim().toLowerCase();
  const langFilter = isLocale(lang) ? lang : "";
  return products
    .filter((product) => {
      const catIds = (product.category_ids as string[] | null) ?? [];
      const visible = catIds.length === 0 || catIds.some((id) => !hiddenCategoryIds.has(id));
      if (!visible) return false;
      if (matchIds && !catIds.some((id) => matchIds.has(id))) return false;
      if (langFilter && !availableMaterialLanguages(product).includes(langFilter)) {
        return false;
      }
      if (!tokens.length) return true;
      return tokens.every((token) => miniAppProductSearchText(product).includes(token));
    })
    .map((product) => product.id);
}

export function collectMiniAppMaterialLanguages(
  products: MiniAppProductIndexRow[],
  ids: ReadonlySet<string>,
): Locale[] {
  const found = new Set<Locale>();
  for (const product of products) {
    if (!ids.has(product.id) || product.fulfillment_kind === "physical") continue;
    for (const language of availableMaterialLanguages(product)) found.add(language);
  }
  return MATERIAL_LANGUAGES.filter((language) => found.has(language));
}

export const MINI_APP_SORTS = ["catalog", "popular", "new", "price"] as const;
export type MiniAppCatalogSort = (typeof MINI_APP_SORTS)[number];

export function parseMiniAppSort(value: unknown): MiniAppCatalogSort {
  return (MINI_APP_SORTS as readonly string[]).includes(String(value))
    ? (value as MiniAppCatalogSort)
    : "catalog";
}

export function sortMiniAppProductIds(
  products: MiniAppProductIndexRow[],
  ids: string[],
  sort: MiniAppCatalogSort,
): string[] {
  if (sort === "catalog" || ids.length < 2) return ids;
  const byId = new Map(products.map((product) => [product.id, product]));
  return ids.slice().sort((leftId, rightId) => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) return 0;
    if (sort === "popular") {
      const count = (right.rating_count ?? 0) - (left.rating_count ?? 0);
      if (count) return count;
      return (right.rating_avg ?? 0) - (left.rating_avg ?? 0);
    }
    if (sort === "new") {
      return String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""));
    }
    return Number(left.price ?? 0) - Number(right.price ?? 0);
  });
}

export async function loadMiniAppCatalogData(
  defaultShopName = "Магазин",
  page = 1,
  pageSize = 80,
  filters?: { query?: string; categoryId?: string; materialLang?: string; sort?: string },
) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { hasModule } = await import("./modules/modules.server");
  const { fetchAll } = await import("./csv");

  const stockEnabled = await hasModule("stock");
  // Без модуля multi_language выдача всегда шлёт только ru (orders.server.ts,
  // deliverOrder) — тот же гейт, что уже стоит на множителе "все языки" в
  // чекауте (bot.server.ts, mini-app-checkout.server.ts). До этой правки
  // фильтр по языку и бейджи "RU/KZ/EN/UZ" были видны и работали независимо
  // от модуля: покупатель мог отфильтровать каталог по "KZ", увидеть карточку
  // с бейджем "KZ" и купить, ожидая казахский файл — а получал либо русский
  // без объяснения, либо (если ru-файла у товара вообще нет) пустую выдачу
  // (Учителя, находка CRIT-2).
  const multiLanguageEnabled = await hasModule("multi_language");
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(20, Math.min(100, Math.floor(pageSize) || 80));
  const categoryId = (filters?.categoryId ?? "").trim();

  const [
    { data: shopSetting },
    { data: cats },
    { data: hiddenCats },
    { data: catalogSetting },
    productIndex,
  ] = await Promise.all([
    supabaseAdmin.from("app_settings").select("value").eq("key", "shop_name").maybeSingle(),
    supabaseAdmin
      .from("categories")
      .select("id, name, parent_id, sort_order, is_visible")
      .eq("is_visible", true)
      .order("sort_order")
      .order("name"),
    supabaseAdmin.from("categories").select("id").eq("is_visible", false),
    supabaseAdmin.from("app_settings").select("value").eq("key", "mini_app_catalog").maybeSingle(),
    fetchAll<MiniAppProductIndexRow>(
      (from, to) =>
        supabaseAdmin
          .from("products")
          .select(MINI_APP_INDEX_SELECT)
          .eq("is_active", true)
          .order("sort_order")
          .order("name")
          .range(from, to),
      "индекс товаров mini-app",
    ),
  ]);

  const shopName = shopSetting?.value?.trim() || defaultShopName;
  const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
  const categories = (cats ?? []) as MiniAppCategory[];
  const { parseMiniAppCatalogSettings, descendantCategoryIds, resolveMiniAppCategoryChips } =
    await import("./category-tree");
  const catalogSettings = parseMiniAppCatalogSettings(catalogSetting?.value);
  const categoryChips = resolveMiniAppCategoryChips(categories, catalogSettings, categoryId);
  const categoryMatchIds =
    categoryId && catalogSettings.layout !== "flat"
      ? descendantCategoryIds(categoryId, categories)
      : undefined;
  const matchingWithoutLang = filterMiniAppProductIds(
    productIndex,
    hiddenIds,
    filters?.query,
    categoryId,
    categoryMatchIds,
  );
  // Пустой список чипсов и игнорируемый ?mlang= — без модуля фильтр по
  // языку не показываем и не применяем вовсе, а не просто прячем кнопку:
  // прямая ссылка с ?mlang=kk иначе продолжала бы фильтровать каталог.
  const materialLanguages = multiLanguageEnabled
    ? collectMiniAppMaterialLanguages(productIndex, new Set(matchingWithoutLang))
    : [];
  const matchingIds = sortMiniAppProductIds(
    productIndex,
    filterMiniAppProductIds(
      productIndex,
      hiddenIds,
      filters?.query,
      categoryId,
      categoryMatchIds,
      multiLanguageEnabled ? filters?.materialLang : undefined,
    ),
    parseMiniAppSort(filters?.sort),
  );

  const totalProducts = matchingIds.length;
  const pageCount = Math.max(1, Math.ceil(totalProducts / safePageSize));
  const actualPage = Math.min(safePage, pageCount);
  const from = (actualPage - 1) * safePageSize;
  const pageIds = matchingIds.slice(from, from + safePageSize);
  let visibleProducts: MiniAppProduct[] = [];
  if (pageIds.length > 0) {
    const { data: productRows } = await supabaseAdmin
      .from("products")
      .select(MINI_APP_PRODUCT_SELECT)
      .in("id", pageIds)
      .eq("is_active", true);
    const byId = new Map(
      ((productRows ?? []) as MiniAppProduct[]).map((product) => [product.id, product]),
    );
    visibleProducts = pageIds
      .map((id) => byId.get(id))
      .filter((product): product is MiniAppProduct => Boolean(product));
  }

  return {
    shopName,
    categories,
    categoryChips: categoryChips.chips,
    categoryParentId: categoryChips.parentId,
    catalogLayout: catalogSettings.layout,
    visibleProducts,
    stockEnabled,
    multiLanguageEnabled,
    totalProducts,
    materialLanguages,
    sort: parseMiniAppSort(filters?.sort),
    page: actualPage,
    pageSize: safePageSize,
  };
}

export async function priceMiniAppProducts(
  products: MiniAppProduct[],
  countryCode: string | null,
): Promise<Map<string, PricedProduct>> {
  const { resolvePrice } = await import("./pricing.server");
  const priced = new Map<string, PricedProduct>();
  for (const p of products) {
    const variants = p.product_variants ?? [];
    if (variants.length > 0) {
      const pricedVariants = await Promise.all(
        variants.map((v) => resolvePrice(p, countryCode, v)),
      );
      const minAmount = Math.min(...pricedVariants.map((m) => m.amount));
      const currency = pricedVariants[0]?.currency ?? p.currency ?? "KZT";
      const variantMap = Object.fromEntries(
        variants.map((variant, index) => [
          variant.id,
          {
            amount: pricedVariants[index]?.amount ?? Number(variant.price),
            currency: pricedVariants[index]?.currency ?? currency,
          },
        ]),
      );
      priced.set(p.id, {
        amount: minAmount,
        currency,
        isFrom: true,
        variants: variantMap,
      });
    } else {
      const money = await resolvePrice(p, countryCode);
      priced.set(p.id, { ...money, isFrom: false, variants: {} });
    }
  }
  return priced;
}

export function productCategoryIds(p: MiniAppProduct): string[] {
  return (p.category_ids as string[] | null) ?? [];
}

export function miniAppEmptyThumbEmoji(
  fulfillmentKind?: string | null,
  vertical = currentVertical(),
): string {
  if (vertical === "confectionery") return "🎂";
  return fulfillmentKind === "physical" ? "📦" : "🛍";
}

export function renderMiniAppLeadBadge(p: MiniAppProduct, locale: Locale): string {
  if (p.fulfillment_kind !== "physical") return "";
  const s = miniAppStrings(locale);
  const days = p.lead_time_days;
  const label = days && days > 0 ? s.leadTime(days) : s.inStock;
  return `<div class="card-lead">${escapeMiniAppHtml(label)}</div>`;
}

export function renderMiniAppLangBadges(
  p: MiniAppProduct,
  named = false,
  multiLanguageEnabled = true,
): string {
  if (p.fulfillment_kind === "physical") return "";
  // Без модуля выдача всегда шлёт только ru (orders.server.ts) — бейдж
  // "KZ"/"EN" на карточке без модуля был бы обещанием, которое выдача не
  // выполняет (Учителя, находка CRIT-2).
  if (!multiLanguageEnabled) return "";
  const langs = availableMaterialLanguages(p);
  if (!langs.length) return "";
  if (named) {
    const label = langs.map((lang) => `${localeFlags[lang]} ${localeNames[lang]}`).join(" · ");
    return `<div class="card-langs">${escapeMiniAppHtml(label)}</div>`;
  }
  return `<div class="card-langs">${langs
    .map((lang) => `<span class="lang-chip">${escapeMiniAppHtml(MATERIAL_LANG_SHORT[lang])}</span>`)
    .join("")}</div>`;
}

export function renderMiniAppFileList(p: MiniAppProduct, locale: Locale): string {
  if (p.fulfillment_kind === "physical") return "";
  const langs = availableMaterialLanguages(p);
  if (!langs.length) return "";
  const s = miniAppStrings(locale);
  const items = langs
    .map((lang) => {
      const fileName = materialsForProduct(p, lang).find((file) => file.name)?.name;
      return `<li><span class="lang-chip">${escapeMiniAppHtml(MATERIAL_LANG_SHORT[lang])}</span> ${escapeMiniAppHtml(fileName || localeNames[lang])}</li>`;
    })
    .join("");
  return `<div class="pdp-files"><h2>${escapeMiniAppHtml(s.filesIncluded)}</h2><ul>${items}</ul></div>`;
}

export function renderMiniAppReviews(
  reviews: Array<{ rating: number; comment: string | null }>,
  locale: Locale,
): string {
  const s = miniAppStrings(locale);
  if (!reviews.length) return "";
  const items = reviews
    .map((review) => {
      const stars =
        "★".repeat(Math.max(1, Math.min(5, review.rating))) +
        "☆".repeat(5 - Math.max(1, Math.min(5, review.rating)));
      const comment = review.comment?.trim()
        ? `<div class="pdp-review-text">${escapeMiniAppHtml(review.comment.trim())}</div>`
        : "";
      return `<li><div class="pdp-review-stars">${escapeMiniAppHtml(stars)}</div>${comment}</li>`;
    })
    .join("");
  return `<div class="pdp-reviews"><h2>${escapeMiniAppHtml(s.reviewsTitle)}</h2><ul>${items}</ul></div>`;
}

export function renderMiniAppTabBar(
  locale: Locale,
  active: "catalog" | "library" | "orders" | "product",
  query: URLSearchParams,
): string {
  const s = miniAppStrings(locale);
  const esc = escapeMiniAppHtml;
  const ctx = new URLSearchParams();
  const lang = query.get("lang");
  const country = query.get("country");
  if (lang) ctx.set("lang", lang);
  else ctx.set("lang", locale);
  if (country) ctx.set("country", country);
  const qs = ctx.toString();
  const physical = currentVerticalDef().defaultFulfillment === "physical";
  const tabs = [
    { id: "catalog" as const, href: `/mini-app?${qs}`, label: s.tabCatalog },
    ...(!physical
      ? [{ id: "library" as const, href: `/mini-app/library?${qs}`, label: s.tabLibrary }]
      : []),
    { id: "orders" as const, href: `/mini-app/orders?${qs}`, label: s.tabOrders },
  ];
  return `<nav class="tab-bar" aria-label="${esc(s.tabCatalog)}">
    ${tabs
      .map((tab) => {
        const current = tab.id === active || (active === "product" && tab.id === "catalog");
        return `<a class="${current ? "active" : ""}" href="${esc(tab.href)}" aria-current="${current ? "page" : "false"}">${esc(tab.label)}</a>`;
      })
      .join("")}
  </nav>`;
}

export function renderMiniAppSortChips(
  locale: Locale,
  current: MiniAppCatalogSort,
  catalogParams: (overrides?: { sort?: MiniAppCatalogSort | null }) => URLSearchParams,
): string {
  const s = miniAppStrings(locale);
  const esc = escapeMiniAppHtml;
  const chips: Array<{ id: MiniAppCatalogSort; label: string }> = [
    { id: "catalog", label: s.sortCatalog },
    { id: "popular", label: s.sortPopular },
    { id: "new", label: s.sortNew },
    { id: "price", label: s.sortPrice },
  ];
  return `<div class="cat-scroll" id="mini-sorts">
    ${chips
      .map((chip) => {
        const params = catalogParams({ sort: chip.id === "catalog" ? null : chip.id });
        return `<a class="cat-chip${current === chip.id ? " active" : ""}" href="/mini-app?${esc(params.toString())}" aria-current="${current === chip.id ? "page" : "false"}">${esc(chip.label)}</a>`;
      })
      .join("")}
  </div>`;
}

export async function loadRelatedMiniAppProducts(
  product: MiniAppProduct,
  countryCode: string | null,
  locale: Locale,
  catalogParams: string,
  limit = 6,
): Promise<string> {
  const categoryIds = productCategoryIds(product);
  // Без категории раньше секция вообще не рендерилась — товар без категории
  // (не редкость: категории необязательны при создании) никогда не получал
  // блок "похожие", даже когда в каталоге есть на что посмотреть (Учителя,
  // находка про похожие материалы без fallback). match=undefined в
  // filterMiniAppProductIds означает "без фильтра по категории", а не "не
  // найдено ничего" — тем самым fallback превращается в "весь каталог по
  // порядку витрины", и заголовок секции меняется на нейтральный (не
  // "Ещё в этой папке" — папки-то и нет).
  const match = categoryIds.length ? new Set(categoryIds) : undefined;
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { hasModule } = await import("./modules/modules.server");
  const { fetchAll } = await import("./csv");
  const [{ data: hiddenCats }, stockEnabled, multiLanguageEnabled, productIndex] =
    await Promise.all([
      supabaseAdmin.from("categories").select("id").eq("is_visible", false),
      hasModule("stock"),
      hasModule("multi_language"),
      fetchAll<MiniAppProductIndexRow>(
        (from, to) =>
          supabaseAdmin
            .from("products")
            .select(MINI_APP_INDEX_SELECT)
            .eq("is_active", true)
            .order("sort_order")
            .order("name")
            .range(from, to),
        "похожие товары mini-app",
      ),
    ]);
  // hiddenIds, а не new Set() (Учителя-HIGH): раньше "похожие" не исключали
  // товары из скрытых категорий вовсе — такой товар не найти через обычный
  // каталог/поиск, но он мог всплыть в блоке "похожие" на карточке любого
  // другого товара той же (не скрытой) категории.
  const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
  const relatedIds = filterMiniAppProductIds(productIndex, hiddenIds, "", "", match).filter(
    (id) => id !== product.id,
  );
  const pageIds = relatedIds.slice(0, limit);
  if (!pageIds.length) return "";
  const { data: productRows } = await supabaseAdmin
    .from("products")
    .select(MINI_APP_PRODUCT_SELECT)
    .in("id", pageIds)
    .eq("is_active", true);
  const byId = new Map(((productRows ?? []) as MiniAppProduct[]).map((row) => [row.id, row]));
  const related = pageIds
    .map((id) => byId.get(id))
    .filter((row): row is MiniAppProduct => Boolean(row));
  if (!related.length) return "";
  const priced = await priceMiniAppProducts(related, countryCode);
  const s = miniAppStrings(locale);
  const cards = related
    .map((row) =>
      renderMiniAppProductCard(row, priced.get(row.id), stockEnabled, locale, {
        linkToDetail: true,
        countryCode,
        catalogParams,
        multiLanguageEnabled,
      }),
    )
    .join("");
  const heading = categoryIds.length ? s.moreInFolder : s.youMayAlsoLike;
  return `<section class="related"><h2>${escapeMiniAppHtml(heading)}</h2><div class="grid related-grid">${cards}</div></section>`;
}

export function renderMiniAppProductCard(
  p: MiniAppProduct,
  money: PricedProduct | undefined,
  stockEnabled: boolean,
  locale: Locale,
  opts?: {
    linkToDetail?: boolean;
    countryCode?: string | null;
    catalogParams?: string;
    multiLanguageEnabled?: boolean;
  },
): string {
  const s = miniAppStrings(locale);
  const esc = escapeMiniAppHtml;
  const imgs = (p.product_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const img = imgs[0] ? imageUrl(imgs[0].image_path) : null;
  const outOfStock = stockEnabled && p.stock_quantity !== null && p.stock_quantity <= 0;
  const variants = (p.product_variants ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const hasVariants = variants.length > 0;
  const priceLabel = money
    ? `${money.isFrom ? s.fromPrice : ""}${formatMiniAppMoney(money.amount, money.currency)}`
    : "";
  const catIds = productCategoryIds(p).join(",");

  let actionsHtml = "";
  if (!outOfStock) {
    if (hasVariants) {
      const optsHtml = variants
        .map(
          (v) =>
            `<option value="${esc(v.id)}">${esc(v.name)} — ${esc(
              formatMiniAppMoney(
                money?.variants[v.id]?.amount ?? Number(v.price),
                money?.variants[v.id]?.currency ?? money?.currency ?? p.currency ?? "KZT",
              ),
            )}</option>`,
        )
        .join("");
      actionsHtml = `<select class="variant-select" aria-label="${esc(s.variant)}"><option value="">${esc(s.variant)}</option>${optsHtml}</select>
        <button type="button" class="add-btn" data-product-id="${esc(p.id)}" data-has-variants="1" disabled>${esc(s.addToCart)}</button>`;
    } else {
      actionsHtml = `<button type="button" class="add-btn" data-product-id="${esc(p.id)}">${esc(s.addToCart)}</button>`;
    }
  } else {
    actionsHtml = `<div class="card-oos">${esc(s.outOfStock)}</div>`;
  }

  const thumbInner = img
    ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" />`
    : `<span aria-hidden="true" style="font-size:2rem">${miniAppEmptyThumbEmoji(p.fulfillment_kind)}</span>`;
  const query = new URLSearchParams({ lang: locale });
  if (opts?.countryCode) query.set("country", opts.countryCode);
  if (opts?.catalogParams) query.set("back", opts.catalogParams);
  const detailHref = `/mini-app/product/${encodeURIComponent(p.id)}?${query.toString()}`;
  const thumbHtml = opts?.linkToDetail
    ? `<a class="thumb thumb-link" href="${esc(detailHref)}">${thumbInner}</a>`
    : `<div class="thumb">${thumbInner}</div>`;
  const nameHtml = opts?.linkToDetail
    ? `<a class="card-name card-link" href="${esc(detailHref)}">${esc(p.name)}</a>`
    : `<div class="card-name">${esc(p.name)}</div>`;

  const searchText = miniAppProductSearchText(p, locale);
  return `<div class="card${outOfStock ? " out-of-stock" : ""}" data-product-id="${esc(p.id)}" data-name="${esc(searchText)}" data-categories="${esc(catIds)}">
    ${thumbHtml}
    <div class="card-body">
      ${nameHtml}
      ${
        p.rating_count > 0 && p.rating_avg != null
          ? `<div class="pdp-rating">${esc(s.rating(String(p.rating_avg), p.rating_count))}</div>`
          : ""
      }
      ${renderMiniAppLangBadges(p, false, opts?.multiLanguageEnabled ?? true)}
      ${renderMiniAppLeadBadge(p, locale)}
      <div class="card-footer">
        ${priceLabel ? `<div class="card-price">${esc(priceLabel)}</div>` : ""}
        ${actionsHtml}
      </div>
    </div>
  </div>`;
}

export function renderMiniAppCartShell(locale: Locale): string {
  const s = miniAppStrings(locale);
  const esc = escapeMiniAppHtml;
  return `
    <div id="mini-cart-bar" class="cart-bar hidden">
      <button type="button" id="mini-open-cart" class="cart-summary" aria-label="${esc(s.cartTitle)}" style="border:none;background:none;text-align:left;cursor:pointer;color:inherit">
        <strong id="mini-cart-total">0 ₸</strong>
        <span><span id="mini-cart-count">0</span> ${esc(s.inCartOpen)}</span>
      </button>
      <button type="button" id="mini-checkout" class="checkout-btn" disabled>${esc(s.pay)}</button>
    </div>
    <div id="mini-cart-sheet" class="cart-sheet hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-label="${esc(s.cartTitle)}">
      <div class="cart-panel" tabindex="-1">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <strong>${esc(s.cartTitle)}</strong>
          <button type="button" id="mini-close-cart" aria-label="${esc(s.close)}" style="border:none;background:none;font-size:1.25rem;cursor:pointer">×</button>
        </div>
        <div id="mini-pending-payment"></div>
        <div id="mini-cart-lines"></div>
        <div id="mini-cart-discounts"></div>
        <div id="mini-checkout-form" class="checkout-form hidden"></div>
        <div id="mini-cart-error" class="cart-error" role="alert" aria-live="assertive"></div>
        <p class="checkout-hint">${esc(s.checkoutInChat)}</p>
      </div>
    </div>`;
}
