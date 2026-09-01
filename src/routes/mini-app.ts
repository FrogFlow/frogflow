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
import { miniAppHtmlResponse, miniAppLocaleFromQuery, wrapMiniAppPage } from "@/lib/mini-app-page.server";

export const Route = createFileRoute("/mini-app")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const { miniAppModuleEnabled } = await import("@/lib/mini-app.server");
        if (!(await miniAppModuleEnabled())) {
          return new Response("Not found", { status: 404 });
        }
        const { hasModule } = await import("@/lib/modules/modules.server");

        const url = new URL(request.url);
        const locale = miniAppLocaleFromQuery(url);
        const s = miniAppStrings(locale);
        const esc = escapeMiniAppHtml;
        const countryCode = /^[A-Z]{2,8}$/.test(
          (url.searchParams.get("country") || "").toUpperCase(),
        )
          ? (url.searchParams.get("country") || "").toUpperCase()
          : null;
        const requestedPage = Math.max(
          1,
          Math.floor(Number(url.searchParams.get("page"))) || 1,
        );

        const {
          shopName,
          categories,
          visibleProducts,
          stockEnabled,
          totalProducts,
          page,
          pageSize,
        } = await loadMiniAppCatalogData(s.defaultShopName, requestedPage);
        const priced = await priceMiniAppProducts(visibleProducts, countryCode);

        const catChips =
          categories.length > 0
            ? `<div class="cat-scroll" id="mini-categories">
              <button type="button" class="cat-chip active" data-cat="" aria-pressed="true">${esc(s.allCategories)}</button>
              ${categories
                .map(
                  (c) =>
                    `<button type="button" class="cat-chip" data-cat="${esc(c.id)}" aria-pressed="false">${esc(c.name)}</button>`,
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
                  }),
                )
                .join("")
            : `<div class="empty">${esc(s.emptyCatalog)}</div>`;

        const searchHtml =
          visibleProducts.length > 0
            ? `<label for="mini-search" style="position:absolute;left:-9999px">${esc(s.searchPlaceholder)}</label><input type="search" id="mini-search" class="search" placeholder="${esc(s.searchPlaceholder)}" autocomplete="off" />`
            : "";
        const pageCount = Math.max(1, Math.ceil(totalProducts / pageSize));
        const paginationLink = (target: number, label: string) => {
          const params = new URLSearchParams({ lang: locale, page: String(target) });
          if (countryCode) params.set("country", countryCode);
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

        const bodyHtml = `
          <header>
            <h1>${esc(shopName)}</h1>
            <p class="subtitle">${totalProducts > 0 ? s.productsCount(totalProducts) : ""}</p>
          </header>
          ${searchHtml}
          ${catChips}
          <div class="grid">${cardsHtml}</div>
          ${paginationHtml}
          ${renderMiniAppCartShell(locale)}`;

        return miniAppHtmlResponse(wrapMiniAppPage(shopName, bodyHtml, locale));
      },
    },
  },
});
