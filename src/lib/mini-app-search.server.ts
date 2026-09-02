import {
  escapeMiniAppHtml,
  filterMiniAppProductIds,
  miniAppProductSearchText,
  priceMiniAppProducts,
  renderMiniAppProductCard,
  type MiniAppProduct,
  type MiniAppProductIndexRow,
} from "./mini-app-catalog.server";
import { resolveMiniAppLocale } from "./mini-app-i18n";
import { descendantCategoryIds, parseMiniAppCatalogSettings } from "./category-tree";

export async function miniAppSmartSearchHtml(params: {
  telegramId: number;
  query: string;
  categoryId?: string;
  countryCode: string | null;
  locale?: string;
}): Promise<{ html: string; total: number; usedSmartSearch: boolean }> {
  const locale = resolveMiniAppLocale(params.locale);
  const query = params.query.trim().slice(0, 100);
  const categoryId = (params.categoryId ?? "").trim();
  const empty = `<div class="empty">${escapeMiniAppHtml("—")}</div>`;
  if (!query) return { html: empty, total: 0, usedSmartSearch: false };

  const { isSmartSearchEnabled, consumeSmartSearchQuota, smartSearchProductIds } =
    await import("./smart-search.server");
  if (!(await isSmartSearchEnabled()) || !(await consumeSmartSearchQuota(params.telegramId))) {
    return { html: empty, total: 0, usedSmartSearch: false };
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { fetchAll } = await import("./csv");
  const { hasModule } = await import("./modules/modules.server");
  const [
    { data: hiddenCats },
    { data: cats },
    { data: catalogSetting },
    productIndex,
    stockEnabled,
  ] = await Promise.all([
    supabaseAdmin.from("categories").select("id").eq("is_visible", false),
    supabaseAdmin
      .from("categories")
      .select("id, name, parent_id, sort_order, is_visible")
      .eq("is_visible", true),
    supabaseAdmin.from("app_settings").select("value").eq("key", "mini_app_catalog").maybeSingle(),
    fetchAll<MiniAppProductIndexRow>(
      (from, to) =>
        supabaseAdmin
          .from("products")
          .select("id, name, description, keywords, category_ids, product_variants(name)")
          .eq("is_active", true)
          .order("sort_order")
          .order("name")
          .range(from, to),
      "индекс товаров mini-app smart-search",
    ),
    hasModule("stock"),
  ]);
  const hiddenIds = new Set((hiddenCats ?? []).map((row) => row.id as string));
  const catalogSettings = parseMiniAppCatalogSettings(catalogSetting?.value);
  const categoryMatchIds =
    categoryId && catalogSettings.layout !== "flat"
      ? descendantCategoryIds(categoryId, cats ?? [])
      : undefined;
  const visibleIds = new Set(
    filterMiniAppProductIds(productIndex, hiddenIds, "", categoryId, categoryMatchIds),
  );
  const candidates = productIndex.filter((product) => visibleIds.has(product.id));
  const ids = await smartSearchProductIds(
    query,
    candidates.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      keywords: miniAppProductSearchText(product),
    })),
  );
  if (!ids?.length) return { html: empty, total: 0, usedSmartSearch: true };

  const { data: productRows } = await supabaseAdmin
    .from("products")
    .select(
      "id, name, description, keywords, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices, stock_quantity, product_variants(id, name, price, sort_order)",
    )
    .in("id", ids)
    .eq("is_active", true);
  const byId = new Map(
    (productRows ?? []).map((product) => [product.id, product as MiniAppProduct]),
  );
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((product): product is MiniAppProduct => Boolean(product));
  const priced = await priceMiniAppProducts(ordered, params.countryCode);
  const catalogParams = new URLSearchParams({ lang: locale });
  if (params.countryCode) catalogParams.set("country", params.countryCode);
  catalogParams.set("q", query);
  if (categoryId) catalogParams.set("category", categoryId);
  const html = ordered
    .map((product) =>
      renderMiniAppProductCard(product, priced.get(product.id), stockEnabled, locale, {
        linkToDetail: true,
        countryCode: params.countryCode,
        catalogParams: catalogParams.toString(),
      }),
    )
    .join("");
  return {
    html: html || empty,
    total: ordered.length,
    usedSmartSearch: true,
  };
}
