import type { Json } from "@/integrations-supabase/types";
import { imageUrl } from "@/lib/public-image";
import { miniAppStrings } from "./mini-app-i18n";
import type { Locale } from "./i18n";

export type MiniAppProduct = {
  id: string;
  name: string;
  description: string | null;
  category_ids: Json;
  rating_avg: number | null;
  rating_count: number;
  product_images: Array<{ image_path: string; sort_order: number }> | null;
  price: number | string;
  currency: string | null;
  country_prices: Json;
  stock_quantity: number | null;
  product_variants: Array<{
    id: string;
    name: string;
    price: number | string;
    sort_order: number;
  }> | null;
};

export type MiniAppCategory = { id: string; name: string };

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

export async function loadMiniAppCatalogData(
  defaultShopName = "Магазин",
  page = 1,
  pageSize = 80,
  filters?: { query?: string; categoryId?: string },
) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { hasModule } = await import("./modules/modules.server");

  const stockEnabled = await hasModule("stock");
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(20, Math.min(100, Math.floor(pageSize) || 80));
  const normalizedQuery = (filters?.query ?? "").trim().toLocaleLowerCase().slice(0, 100);
  const categoryId = (filters?.categoryId ?? "").trim();

  const [{ data: shopSetting }, { data: cats }, { data: hiddenCats }, { data: productIndex }] =
    await Promise.all([
      supabaseAdmin.from("app_settings").select("value").eq("key", "shop_name").maybeSingle(),
      supabaseAdmin
        .from("categories")
        .select("id, name")
        .eq("is_visible", true)
        .order("sort_order")
        .order("name"),
      supabaseAdmin.from("categories").select("id").eq("is_visible", false),
      supabaseAdmin
        .from("products")
        .select("id, name, description, category_ids, product_variants(name)")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
    ]);

  const shopName = shopSetting?.value?.trim() || defaultShopName;
  const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
  const categories = (cats ?? []) as MiniAppCategory[];
  const matchingIds = (productIndex ?? [])
    .filter((product) => {
      const catIds = (product.category_ids as string[] | null) ?? [];
      const visible = catIds.length === 0 || catIds.some((id) => !hiddenIds.has(id));
      if (!visible) return false;
      if (categoryId && !catIds.includes(categoryId)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        product.name,
        product.description ?? "",
        ...(product.product_variants ?? []).map((variant) => variant.name),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .map((product) => product.id as string);

  const totalProducts = matchingIds.length;
  const pageCount = Math.max(1, Math.ceil(totalProducts / safePageSize));
  const actualPage = Math.min(safePage, pageCount);
  const from = (actualPage - 1) * safePageSize;
  const pageIds = matchingIds.slice(from, from + safePageSize);
  let visibleProducts: MiniAppProduct[] = [];
  if (pageIds.length > 0) {
    const { data: productRows } = await supabaseAdmin
      .from("products")
      .select(
        "id, name, description, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices, stock_quantity, product_variants(id, name, price, sort_order)",
      )
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
    visibleProducts,
    stockEnabled,
    totalProducts,
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

export function renderMiniAppProductCard(
  p: MiniAppProduct,
  money: PricedProduct | undefined,
  stockEnabled: boolean,
  locale: Locale,
  opts?: {
    linkToDetail?: boolean;
    countryCode?: string | null;
    catalogParams?: string;
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
    : `<span aria-hidden="true" style="font-size:2rem">🛍</span>`;
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

  const searchText = [p.name, p.description ?? "", ...variants.map((v) => v.name)]
    .join(" ")
    .toLocaleLowerCase(locale);
  return `<div class="card${outOfStock ? " out-of-stock" : ""}" data-name="${esc(searchText)}" data-categories="${esc(catIds)}">
    ${thumbHtml}
    <div class="card-body">
      ${nameHtml}
      ${
        p.rating_count > 0 && p.rating_avg != null
          ? `<div class="pdp-rating">${esc(s.rating(String(p.rating_avg), p.rating_count))}</div>`
          : ""
      }
      ${p.description ? `<div class="card-desc">${esc(p.description)}</div>` : ""}
      ${priceLabel ? `<div class="card-price">${esc(priceLabel)}</div>` : ""}
      ${actionsHtml}
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
