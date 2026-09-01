import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import {
  escapeMiniAppHtml,
  formatMiniAppMoney,
  priceMiniAppProducts,
  renderMiniAppCartShell,
  type MiniAppProduct,
} from "@/lib/mini-app-catalog.server";
import { miniAppStrings } from "@/lib/mini-app-i18n";
import { miniAppHtmlResponse, miniAppLocaleFromQuery, wrapMiniAppPage } from "@/lib/mini-app-page.server";
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
        const countryCode = /^[A-Z]{2,8}$/.test(requestedCountry)
          ? requestedCountry
          : null;

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const stockEnabled = await hasModule("stock");

        const { data: product, error } = await supabaseAdmin
          .from("products")
          .select(
            "id, name, description, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices, stock_quantity, product_variants(id, name, price, sort_order)",
          )
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
            : `<div class="thumb" style="width:100%;max-height:280px"><span aria-hidden="true" style="font-size:3rem">🛍</span></div>`;
        const variants = (p.product_variants ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
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
                  `<option value="${esc(v.id)}">${esc(v.name)} — ${esc(
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
        const bodyHtml = `
          <header>
            <a class="back-link" href="/mini-app?${esc(backQuery.toString())}">${esc(s.backToCatalog)}</a>
            <h1>${esc(p.name)}</h1>
          </header>
          <div class="pdp-gallery">${gallery}</div>
          <div class="pdp-body">
            ${rating}
            ${priceLabel ? `<div class="pdp-price">${esc(priceLabel)}</div>` : ""}
            ${p.description ? `<h2 style="font-size:0.95rem;margin:1rem 0 0.35rem">${esc(s.description)}</h2><div class="pdp-desc">${esc(p.description)}</div>` : ""}
            <div style="margin-top:1rem">${actionsHtml}</div>
          </div>
          ${renderMiniAppCartShell(locale)}`;

        return miniAppHtmlResponse(wrapMiniAppPage(p.name, bodyHtml, locale));
      },
    },
  },
});
