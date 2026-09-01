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

        const { hasModule } = await import("@/lib/modules/modules.server");
        if (!(await hasModule("telegram_mini_app"))) {
          return new Response("Not found", { status: 404 });
        }

        const url = new URL(request.url);
        const locale = miniAppLocaleFromQuery(url);
        const s = miniAppStrings(locale);
        const esc = escapeMiniAppHtml;

        const { shopName, categories, visibleProducts, stockEnabled } = await loadMiniAppCatalogData();
        const priced = await priceMiniAppProducts(visibleProducts, null);

        const catChips =
          categories.length > 0
            ? `<div class="cat-scroll" id="mini-categories">
              <button type="button" class="cat-chip active" data-cat="">${esc(s.allCategories)}</button>
              ${categories
                .map(
                  (c) =>
                    `<button type="button" class="cat-chip" data-cat="${esc(c.id)}">${esc(c.name)}</button>`,
                )
                .join("")}</div>`
            : "";

        const cardsHtml =
          visibleProducts.length > 0
            ? visibleProducts
                .map((p) => renderMiniAppProductCard(p, priced.get(p.id), stockEnabled, locale, { linkToDetail: true }))
                .join("")
            : `<div class="empty">Каталог пока пуст.</div>`;

        const searchHtml =
          visibleProducts.length > 0
            ? `<input type="search" id="mini-search" class="search" placeholder="${esc(s.searchPlaceholder)}" autocomplete="off" />`
            : "";

        const bodyHtml = `
          <header>
            <h1>${esc(shopName)}</h1>
            <p class="subtitle">${visibleProducts.length > 0 ? s.productsCount(visibleProducts.length) : ""}</p>
          </header>
          ${searchHtml}
          ${catChips}
          <div class="grid">${cardsHtml}</div>
          ${renderMiniAppCartShell(locale)}`;

        return miniAppHtmlResponse(wrapMiniAppPage(shopName, bodyHtml, locale));
      },
    },
  },
});
