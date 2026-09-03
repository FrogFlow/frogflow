import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import {
  escapeMiniAppHtml,
  loadMiniAppCatalogData,
  parseMiniAppSort,
  priceMiniAppProducts,
  renderMiniAppCartShell,
  renderMiniAppProductCard,
  renderMiniAppSortChips,
  renderMiniAppTabBar,
} from "@/lib/mini-app-catalog.server";
import { MATERIAL_LANG_SHORT } from "@/lib/product-materials";
import { isLocale } from "@/lib/i18n";
import { miniAppStrings } from "@/lib/mini-app-i18n";
import {
  miniAppHtmlResponse,
  miniAppLocaleFromQuery,
  wrapMiniAppPage,
} from "@/lib/mini-app-page.server";

export const Route = createFileRoute("/mini-app")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const { miniAppModuleEnabled } = await import("@/lib/mini-app.server");
        if (!(await miniAppModuleEnabled())) {
          return new Response("Not found", { status: 404 });
        }
        const url = new URL(request.url);
        const locale = miniAppLocaleFromQuery(url);
        const s = miniAppStrings(locale);
        const esc = escapeMiniAppHtml;
        const countryCode = /^[A-Z]{2,8}$/.test(
          (url.searchParams.get("country") || "").toUpperCase(),
        )
          ? (url.searchParams.get("country") || "").toUpperCase()
          : null;
        const requestedPage = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);
        const searchQuery = (url.searchParams.get("q") || "").trim().slice(0, 100);
        const categoryId = (url.searchParams.get("category") || "").trim();
        const materialLangRaw = (url.searchParams.get("mlang") || "").trim().toLowerCase();
        const materialLang = isLocale(materialLangRaw) ? materialLangRaw : "";
        const sort = parseMiniAppSort(url.searchParams.get("sort"));

        const {
          shopName,
          categoryChips,
          categoryParentId,
          catalogLayout,
          visibleProducts,
          stockEnabled,
          multiLanguageEnabled,
          totalProducts,
          materialLanguages,
          page,
          pageSize,
        } = await loadMiniAppCatalogData(s.defaultShopName, requestedPage, 80, {
          query: searchQuery,
          categoryId,
          materialLang,
          sort,
        });
        const priced = await priceMiniAppProducts(visibleProducts, countryCode);

        const catalogParams = (overrides?: {
          page?: number;
          category?: string | null;
          mlang?: string | null;
          sort?: string | null;
        }) => {
          const params = new URLSearchParams({ lang: locale });
          if (countryCode) params.set("country", countryCode);
          if (searchQuery) params.set("q", searchQuery);
          const nextCategory = overrides?.category === undefined ? categoryId : overrides.category;
          if (nextCategory) params.set("category", nextCategory);
          const nextLang = overrides?.mlang === undefined ? materialLang : overrides.mlang;
          if (nextLang) params.set("mlang", nextLang);
          const nextSort = overrides?.sort === undefined ? sort : overrides.sort;
          if (nextSort && nextSort !== "catalog") params.set("sort", nextSort);
          if (overrides?.page && overrides.page > 1) {
            params.set("page", String(overrides.page));
          }
          return params;
        };

        const backChip =
          catalogLayout !== "flat" && categoryId
            ? `<a class="cat-chip" href="/mini-app?${esc(catalogParams({ category: categoryParentId }).toString())}">${esc(s.categoryBack)}</a>`
            : catalogLayout === "flat"
              ? `<a class="cat-chip${categoryId ? "" : " active"}" href="/mini-app?${esc(catalogParams({ category: null }).toString())}" aria-current="${categoryId ? "false" : "page"}">${esc(s.allCategories)}</a>`
              : "";
        const catChips =
          categoryChips.length > 0 || backChip
            ? `<div class="cat-scroll" id="mini-categories">
              ${backChip}
              ${categoryChips
                .map(
                  (c) =>
                    `<a class="cat-chip${categoryId === c.id ? " active" : ""}" href="/mini-app?${esc(catalogParams({ category: c.id }).toString())}" aria-current="${categoryId === c.id ? "page" : "false"}">${esc(c.name)}</a>`,
                )
                .join("")}</div>`
            : "";

        const langChips =
          materialLanguages.length > 1
            ? `<div class="cat-scroll" id="mini-mlangs">
              <a class="cat-chip${materialLang ? "" : " active"}" href="/mini-app?${esc(catalogParams({ mlang: null }).toString())}" aria-current="${materialLang ? "false" : "page"}">${esc(s.materialLangAll)}</a>
              ${materialLanguages
                .map(
                  (code) =>
                    `<a class="cat-chip${materialLang === code ? " active" : ""}" href="/mini-app?${esc(catalogParams({ mlang: code }).toString())}" aria-current="${materialLang === code ? "page" : "false"}">${esc(MATERIAL_LANG_SHORT[code])}</a>`,
                )
                .join("")}</div>`
            : "";

        const cardsHtml =
          visibleProducts.length > 0
            ? visibleProducts
                .map((p) =>
                  renderMiniAppProductCard(p, priced.get(p.id), stockEnabled, locale, {
                    linkToDetail: true,
                    countryCode,
                    catalogParams: catalogParams({ page }).toString(),
                    multiLanguageEnabled,
                  }),
                )
                .join("")
            : `<div class="empty">${esc(searchQuery ? s.searchEmpty : s.emptyCatalog)}</div>`;

        const searchHtml = `<form class="catalog-search" action="/mini-app" method="get">
          <input type="hidden" name="lang" value="${esc(locale)}" />
          ${countryCode ? `<input type="hidden" name="country" value="${esc(countryCode)}" />` : ""}
          ${categoryId ? `<input type="hidden" name="category" value="${esc(categoryId)}" />` : ""}
          ${materialLang ? `<input type="hidden" name="mlang" value="${esc(materialLang)}" />` : ""}
          ${sort !== "catalog" ? `<input type="hidden" name="sort" value="${esc(sort)}" />` : ""}
          <label for="mini-search-server" style="position:absolute;left:-9999px">${esc(s.searchPlaceholder)}</label>
          <input type="search" name="q" id="mini-search-server" class="search" value="${esc(searchQuery)}" placeholder="${esc(s.searchPlaceholder)}" autocomplete="off" enterkeyhint="search" />
          <button type="submit" class="search-submit" aria-label="${esc(s.searchPlaceholder)}">⌕</button>
        </form>`;
        const pageCount = Math.max(1, Math.ceil(totalProducts / pageSize));
        const paginationLink = (target: number, label: string) => {
          const params = catalogParams({ page: target });
          return `<a href="/mini-app?${esc(params.toString())}">${label}</a>`;
        };
        const paginationHtml =
          pageCount > 1
            ? `<nav class="pagination" aria-label="${esc(s.pagination)}">
                ${page > 1 ? paginationLink(page - 1, "←") : ""}
                <span>${page} / ${pageCount}</span>
                ${page < pageCount ? paginationLink(page + 1, "→") : ""}
              </nav>`
            : "";

        const catalogBody = `
          <header>
            <div class="header-row">
              <h1>${esc(shopName)}</h1>
              <a class="header-link" href="/mini-app/orders?${esc(catalogParams().toString())}">${esc(s.myOrders)}</a>
            </div>
            <p class="subtitle">${totalProducts > 0 ? s.productsCount(totalProducts) : ""}</p>
          </header>
          ${searchHtml}
          ${catChips}
          ${langChips}
          ${renderMiniAppSortChips(locale, sort, catalogParams)}
          <div class="grid">${cardsHtml}</div>
          ${paginationHtml}
          ${renderMiniAppCartShell(locale)}
          ${renderMiniAppTabBar(locale, "catalog", catalogParams())}`;
        const needsContext = !url.searchParams.has("lang") || !url.searchParams.has("country");
        const bodyHtml = needsContext
          ? `<div id="mini-context-content" class="context-pending">${catalogBody}</div><div id="mini-context-loader" class="context-loader">${esc(s.loading)}</div>`
          : catalogBody;

        return miniAppHtmlResponse(wrapMiniAppPage(shopName, bodyHtml, locale));
      },
    },
  },
});
