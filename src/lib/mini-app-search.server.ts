import {
  escapeMiniAppHtml,
  filterMiniAppProductIds,
  MINI_APP_INDEX_SELECT,
  MINI_APP_PRODUCT_SELECT,
  miniAppProductSearchText,
  priceMiniAppProducts,
  renderMiniAppProductCard,
  type MiniAppProduct,
  type MiniAppProductIndexRow,
} from "./mini-app-catalog.server";
import { miniAppStrings, resolveMiniAppLocale } from "./mini-app-i18n";
import { availableMaterialLanguages } from "./product-materials";
import { isLocale } from "./i18n";

export async function miniAppSmartSearchHtml(params: {
  telegramId: number;
  query: string;
  categoryId?: string;
  countryCode: string | null;
  locale?: string;
  materialLang?: string;
}): Promise<{ html: string; total: number; usedSmartSearch: boolean }> {
  const locale = resolveMiniAppLocale(params.locale);
  const query = params.query.trim().slice(0, 100);
  const empty = `<div class="empty">${escapeMiniAppHtml(miniAppStrings(locale).searchEmpty)}</div>`;
  if (!query) return { html: empty, total: 0, usedSmartSearch: false };

  const { isSmartSearchEnabled, consumeSmartSearchQuota, smartSearchProductIds } =
    await import("./smart-search.server");
  if (!(await isSmartSearchEnabled())) {
    return { html: empty, total: 0, usedSmartSearch: false };
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { fetchAll } = await import("./csv");
  const { hasModule } = await import("./modules/modules.server");
  const [{ data: hiddenCats }, productIndex, stockEnabled, multiLanguageEnabled] =
    await Promise.all([
      supabaseAdmin.from("categories").select("id").eq("is_visible", false),
      fetchAll<MiniAppProductIndexRow>(
        (from, to) =>
          supabaseAdmin
            .from("products")
            .select(MINI_APP_INDEX_SELECT)
            .eq("is_active", true)
            .order("sort_order")
            .order("name")
            .range(from, to),
        "индекс товаров mini-app smart-search",
      ),
      hasModule("stock"),
      hasModule("multi_language"),
    ]);
  const hiddenIds = new Set((hiddenCats ?? []).map((row) => row.id as string));
  // Как в боте: умный поиск смотрит весь видимый каталог, а не текущую
  // папку Mini App. Иначе запрос из категории «Математика» не находит
  // подарок из другой ветки и выглядит как «умный поиск сломан».
  const visibleIds = new Set(filterMiniAppProductIds(productIndex, hiddenIds));
  const candidates = productIndex.filter((product) => visibleIds.has(product.id));
  if (!candidates.length) return { html: empty, total: 0, usedSmartSearch: false };
  if (!(await consumeSmartSearchQuota(params.telegramId))) {
    return { html: empty, total: 0, usedSmartSearch: false };
  }
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
    .select(MINI_APP_PRODUCT_SELECT)
    .in("id", ids)
    .eq("is_active", true);
  const byId = new Map(
    (productRows ?? []).map((product) => [product.id, product as MiniAppProduct]),
  );
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((product): product is MiniAppProduct => Boolean(product))
    .filter((product) => {
      if (!multiLanguageEnabled) return true;
      const lang = (params.materialLang || "").trim().toLowerCase();
      if (!isLocale(lang)) return true;
      return availableMaterialLanguages(product).includes(lang);
    });
  const priced = await priceMiniAppProducts(ordered, params.countryCode);
  const catalogParams = new URLSearchParams({ lang: locale });
  if (params.countryCode) catalogParams.set("country", params.countryCode);
  catalogParams.set("q", query);
  const lang = (params.materialLang || "").trim().toLowerCase();
  if (multiLanguageEnabled && isLocale(lang)) catalogParams.set("mlang", lang);
  const html = ordered
    .map((product) =>
      renderMiniAppProductCard(product, priced.get(product.id), stockEnabled, locale, {
        linkToDetail: true,
        countryCode: params.countryCode,
        catalogParams: catalogParams.toString(),
        multiLanguageEnabled,
      }),
    )
    .join("");
  return {
    html: html || empty,
    total: ordered.length,
    usedSmartSearch: true,
  };
}
