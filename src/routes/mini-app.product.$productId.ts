import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import {
  escapeMiniAppHtml,
  formatMiniAppMoney,
  MINI_APP_PRODUCT_SELECT,
  miniAppEmptyThumbEmoji,
  priceMiniAppProducts,
  renderMiniAppCartShell,
  renderMiniAppLeadBadge,
  type MiniAppProduct,
} from "@/lib/mini-app-catalog.server";
import { miniAppStrings } from "@/lib/mini-app-i18n";
import {
  miniAppHtmlResponse,
  miniAppLocaleFromQuery,
  wrapMiniAppPage,
} from "@/lib/mini-app-page.server";
import { imageUrl } from "@/lib/public-image";
export const Route = createFileRoute("/mini-app/product/$productId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const { miniAppModuleEnabled } = await import("@/lib/mini-app.server");
        if (!(await miniAppModuleEnabled())) {
          return new Response("Not found", { status: 404 });
        }
        const { hasModule } = await import("@/lib/modules/modules.server");

        const productId = params.productId?.trim();
        if (!productId) return new Response("Not found", { status: 404 });

        const url = new URL(request.url);
        const locale = miniAppLocaleFromQuery(url);
        const s = miniAppStrings(locale);
        const esc = escapeMiniAppHtml;
        const requestedCountry = (url.searchParams.get("country") || "").toUpperCase();
        const countryCode = /^[A-Z]{2,8}$/.test(requestedCountry) ? requestedCountry : null;

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const stockEnabled = await hasModule("stock");

        const { data: product, error } = await supabaseAdmin
          .from("products")
          .select(MINI_APP_PRODUCT_SELECT)
          .eq("id", productId)
          .eq("is_active", true)
          .maybeSingle();

        if (error || !product) return new Response("Not found", { status: 404 });

        const p = product as MiniAppProduct;
        const categoryIds = (p.category_ids as string[] | null) ?? [];
        if (categoryIds.length > 0) {
          const { data: visibleCategories } = await supabaseAdmin
            .from("categories")
            .select("id")
            .in("id", categoryIds)
            .eq("is_visible", true);
          if (!visibleCategories?.length) {
            return new Response("Not found", { status: 404 });
          }
        }

        const priced = await priceMiniAppProducts([p], countryCode);
        const money = priced.get(p.id);
        const imgs = (p.product_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
        const gallery =
          imgs.length > 0
            ? imgs
                .map(
                  (im, index) =>
                    `<img src="${esc(imageUrl(im.image_path))}" alt="${esc(p.name)} — ${index + 1}" loading="lazy" />`,
                )
                .join("")
            : `<div class="thumb" style="width:100%;max-height:280px"><span aria-hidden="true" style="font-size:3rem">${miniAppEmptyThumbEmoji(p.fulfillment_kind)}</span></div>`;
        const variants = (p.product_variants ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order);
        const outOfStock = stockEnabled && p.stock_quantity !== null && p.stock_quantity <= 0;
        const rating =
          p.rating_count > 0 && p.rating_avg != null
            ? `<div class="pdp-rating">${esc(s.rating(String(p.rating_avg), p.rating_count))}</div>`
            : "";

        let actionsHtml = "";
        if (!outOfStock) {
          if (variants.length > 0) {
            const opts = variants
              .map(
                (v) =>
                  `<option value="${esc(v.id)}" data-price="${esc(
                    formatMiniAppMoney(
                      money?.variants[v.id]?.amount ?? Number(v.price),
                      money?.variants[v.id]?.currency ?? money?.currency ?? p.currency ?? "KZT",
                    ),
                  )}">${esc(v.name)} — ${esc(
                    formatMiniAppMoney(
                      money?.variants[v.id]?.amount ?? Number(v.price),
                      money?.variants[v.id]?.currency ?? money?.currency ?? p.currency ?? "KZT",
                    ),
                  )}</option>`,
              )
              .join("");
            actionsHtml = `<select class="variant-select" aria-label="${esc(s.variant)}"><option value="">${esc(s.variant)}</option>${opts}</select>
              <button type="button" class="add-btn" data-product-id="${esc(p.id)}" data-has-variants="1" disabled>${esc(s.addToCart)}</button>`;
          } else {
            actionsHtml = `<button type="button" class="add-btn" data-product-id="${esc(p.id)}">${esc(s.addToCart)}</button>`;
          }
        } else {
          actionsHtml = `<div class="card-oos">${esc(s.outOfStock)}</div>`;
        }

        const priceLabel = money
          ? `${money.isFrom ? s.fromPrice : ""}${formatMiniAppMoney(money.amount, money.currency)}`
          : "";

        const backQuery = new URLSearchParams({ lang: locale });
        if (countryCode) backQuery.set("country", countryCode);
        const requestedBack = new URLSearchParams(url.searchParams.get("back") || "");
        for (const key of ["q", "category", "page"]) {
          const value = requestedBack.get(key);
          if (value) backQuery.set(key, value.slice(0, 100));
        }
        const productBody = `
          <header>
            <a class="back-link" href="/mini-app?${esc(backQuery.toString())}">${esc(s.backToCatalog)}</a>
            <div class="header-row">
              <h1>${esc(p.name)}</h1>
              <a class="header-link" href="/mini-app/orders?${esc(backQuery.toString())}">${esc(s.myOrders)}</a>
            </div>
          </header>
          <div class="pdp-gallery">${gallery}</div>
          <div class="pdp-body">
            ${rating}
            ${priceLabel ? `<div class="pdp-price">${esc(priceLabel)}</div>` : ""}
            ${renderMiniAppLeadBadge(p, locale)}
            ${p.description ? `<h2 style="font-size:0.95rem;margin:1rem 0 0.35rem">${esc(s.description)}</h2><div class="pdp-desc">${esc(p.description)}</div>` : ""}
            <div style="margin-top:1rem">${actionsHtml}</div>
          </div>
          ${renderMiniAppCartShell(locale)}`;
        const needsContext = !url.searchParams.has("lang") || !url.searchParams.has("country");
        const bodyHtml = needsContext
          ? `<div id="mini-context-content" class="context-pending">${productBody}</div><div id="mini-context-loader" class="context-loader">${esc(s.loading)}</div>`
          : productBody;

        return miniAppHtmlResponse(wrapMiniAppPage(p.name, bodyHtml, locale));
      },
    },
  },
});
