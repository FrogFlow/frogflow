import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import {
  escapeMiniAppHtml,
  loadMiniAppCatalogData,
  priceMiniAppProducts,
  renderMiniAppCartShell,
  renderMiniAppProductCard,
} from "@/lib/mini-app-catalog.server";
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

        const {
          shopName,
          categories,
          visibleProducts,
          stockEnabled,
          totalProducts,
          page,
          pageSize,
        } = await loadMiniAppCatalogData(s.defaultShopName, requestedPage, 80, {
          query: searchQuery,
          categoryId,
        });
        const priced = await priceMiniAppProducts(visibleProducts, countryCode);

        const catalogParams = (overrides?: { page?: number; category?: string | null }) => {
          const params = new URLSearchParams({ lang: locale });
          if (countryCode) params.set("country", countryCode);
          if (searchQuery) params.set("q", searchQuery);
          const nextCategory = overrides?.category === undefined ? categoryId : overrides.category;
          if (nextCategory) params.set("category", nextCategory);
          if (overrides?.page && overrides.page > 1) {
            params.set("page", String(overrides.page));
          }
          return params;
        };

        const catChips =
          categories.length > 0
            ? `<div class="cat-scroll" id="mini-categories">
              <a class="cat-chip${categoryId ? "" : " active"}" href="/mini-app?${esc(catalogParams({ category: null }).toString())}" aria-current="${categoryId ? "false" : "page"}">${esc(s.allCategories)}</a>
              ${categories
                .map(
                  (c) =>
                    `<a class="cat-chip${categoryId === c.id ? " active" : ""}" href="/mini-app?${esc(catalogParams({ category: c.id }).toString())}" aria-current="${categoryId === c.id ? "page" : "false"}">${esc(c.name)}</a>`,
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
                  }),
                )
                .join("")
            : `<div class="empty">${esc(s.emptyCatalog)}</div>`;

        const searchHtml = `<form class="catalog-search" action="/mini-app" method="get">
          <input type="hidden" name="lang" value="${esc(locale)}" />
          ${countryCode ? `<input type="hidden" name="country" value="${esc(countryCode)}" />` : ""}
          ${categoryId ? `<input type="hidden" name="category" value="${esc(categoryId)}" />` : ""}
          <label for="mini-search-server" style="position:absolute;left:-9999px">${esc(s.searchPlaceholder)}</label>
          <input type="search" name="q" id="mini-search-server" class="search" value="${esc(searchQuery)}" placeholder="${esc(s.searchPlaceholder)}" autocomplete="off" />
          <button type="submit" class="search-submit" aria-label="${esc(s.searchPlaceholder)}">⌕</button>
        </form>`;
        const pageCount = Math.max(1, Math.ceil(totalProducts / pageSize));
        const paginationLink = (target: number, label: string) => {
          const params = catalogParams({ page: target });
          return `<a href="/mini-app?${esc(params.toString())}">${label}</a>`;
        };
        const paginationHtml =
          pageCount > 1
            ? `<nav class="pagination" aria-label="Pagination">
                ${page > 1 ? paginationLink(page - 1, "←") : ""}
                <span>${page} / ${pageCount}</span>
                ${page < pageCount ? paginationLink(page + 1, "→") : ""}
              </nav>`
            : "";

        const catalogBody = `
          <header>
            <h1>${esc(shopName)}</h1>
            <p class="subtitle">${totalProducts > 0 ? s.productsCount(totalProducts) : ""}</p>
          </header>
          ${searchHtml}
          ${catChips}
          <div class="grid">${cardsHtml}</div>
          ${paginationHtml}
          ${renderMiniAppCartShell(locale)}`;
        const needsContext = !url.searchParams.has("lang") || !url.searchParams.has("country");
        const bodyHtml = needsContext
          ? `<div id="mini-context-content" class="context-pending">${catalogBody}</div><div id="mini-context-loader" class="context-loader">${esc(s.loading)}</div>`
          : catalogBody;

        return miniAppHtmlResponse(wrapMiniAppPage(shopName, bodyHtml, locale));
      },
    },
  },
});
