import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { miniAppStringsClientPack } from "../src/lib/mini-app-i18n";
import { MINI_APP_RUNTIME_JS } from "../src/lib/mini-app-runtime";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("Mini App production regressions", () => {
  it("ships syntactically valid browser runtime JavaScript", () => {
    expect(() => new Function(MINI_APP_RUNTIME_JS)).not.toThrow();
  });

  it("loads the runtime from the registered route", () => {
    const page = source("src/lib/mini-app-page.server.ts");
    const route = source("src/routes/mini-app-runtime.ts");
    expect(page).toContain('src="/mini-app-runtime?v=8"');
    expect(route).toContain('createFileRoute("/mini-app-runtime")');
    expect(page).not.toContain('src="/mini-app-runtime.js"');
  });

  it("continues KZ payment on the existing order instead of recreating it", () => {
    const checkout = source("src/lib/mini-app-checkout.server.ts");
    const bot = source("src/lib/bot.server.ts");
    expect(checkout.indexOf("completeMiniAppPayment")).toBeLessThan(
      checkout.indexOf("miniAppCheckoutNeeds"),
    );
    expect(bot).toContain("export async function completeMiniAppPayment");
    expect(bot).toContain("pending_order_id");
    expect(bot).toContain('.eq("telegram_id", telegram_id)');
    const continuation = bot.slice(bot.indexOf("export async function completeMiniAppPayment"));
    expect(continuation.indexOf("const locale: Locale")).toBeLessThan(
      continuation.indexOf("miniAppAmountLabel"),
    );
  });

  it("exposes pending payment resume and cancellation", () => {
    const bot = source("src/lib/bot.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(bot).toContain("export async function miniAppPendingPayment");
    expect(bot).toContain("export async function cancelMiniAppPendingPayment");
    expect(runtime).toContain("resume_payment: true");
    expect(runtime).toContain("cancel_pending: true");
  });

  it("uses delivery zone price and never the nonexistent fee property", () => {
    const checkout = source("src/lib/mini-app-checkout.server.ts");
    expect(checkout).toContain("Number(zone.price)");
    expect(checkout).toContain("Number(z.price)");
    expect(checkout).not.toMatch(/\bzone\.fee\b|\bz\.fee\b/);
  });

  it("releases order placement for terminal Mini App paths", () => {
    const bot = source("src/lib/bot.server.ts");
    const zeroTotal = bot.slice(
      bot.indexOf("if (total <= 0)"),
      bot.indexOf("// Оплата при получении"),
    );
    const onReceipt = bot.slice(
      bot.indexOf('loadPaymentMode()) === "on_receipt"'),
      bot.indexOf("const amountDue = await amountDueNow"),
    );
    expect(zeroTotal).toContain("releaseOrderPlacement(telegram_id, user.state)");
    expect(onReceipt).toContain("releaseOrderPlacement(telegram_id, user.state)");
    const release = bot.slice(
      bot.indexOf("export async function releaseOrderPlacement"),
      bot.indexOf("export async function releaseOrderPlacement") + 400,
    );
    expect(release).toContain("placing_order");
    expect(release).not.toContain("checkout_lang_choice:");
  });

  it("escapes cart product names and supports PDP variant controls", () => {
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(runtime).toContain("escapeHtml(it.name)");
    expect(runtime).toContain('closest(".card, .pdp-body")');
  });

  it("resets Telegram Menu Button when the module is disabled", () => {
    const server = source("src/lib/mini-app.server.ts");
    expect(server).toContain('menu_button: { type: "default" }');
  });

  it("does not accept initData credentials through URL query parameters", () => {
    const server = source("src/lib/mini-app.server.ts");
    expect(server).not.toContain('searchParams.get("initData")');
    expect(server).toContain("request.headers.get(INIT_DATA_HEADER)");
  });

  it.each(["ru", "kk", "en", "uz"] as const)(
    "ships a complete client dictionary for %s",
    (locale) => {
      const pack = miniAppStringsClientPack(locale);
      expect(pack.pay).toBeTruthy();
      expect(pack.inCart).toBeTruthy();
      expect(pack.materialLangAll).toBeTruthy();
      expect(pack.filesInBot).toBeTruthy();
      expect(pack.rateMaterial).toBeTruthy();
      expect(pack.myMaterials).toBeTruthy();
      expect(pack.purchased).toBeTruthy();
      expect(pack.tabLibrary).toBeTruthy();
      expect(pack.sortPopular).toBeTruthy();
      expect(pack.allLanguages).toBeTruthy();
      expect(pack.languagesLabel).toBeTruthy();
      expect(pack.orderCompletePhysical).toBeTruthy();
      expect(pack.physicalDelivering).toBeTruthy();
      expect(pack.paidLabel).toBeTruthy();
      expect(pack.pagination).toBeTruthy();
      expect(pack.inStock).toBeTruthy();
      expect(pack.chooseDeliveryLanguage).toBeTruthy();
      expect(pack.invalidField).toBeTruthy();
      expect(pack.paymentUnavailable).toBeTruthy();
      expect(pack.uploadReceipt).toBeTruthy();
      expect(pack.myOrders).toBeTruthy();
      expect(pack.searchEmpty).toBeTruthy();
      expect(pack.categoryBack).toBeTruthy();
      expect(pack.searchingDeeper).toBeTruthy();
      expect(pack.waitingPayment).toBeTruthy();
      expect(pack.orderStatus).toBeTruthy();
    },
  );

  it("exposes receipt upload, orders history and payment return polling", () => {
    const runtime = source("src/lib/mini-app-runtime.ts");
    const page = source("src/routes/mini-app.orders.ts");
    const proof = source("src/routes/api/public/mini-app/proof.ts");
    const orders = source("src/routes/api/public/mini-app/orders.ts");
    expect(runtime).toContain("/api/public/mini-app/proof");
    expect(runtime).toContain("startPaymentPolling");
    expect(runtime).toContain("/api/public/mini-app/orders");
    expect(page).toContain('createFileRoute("/mini-app/orders")');
    expect(proof).toContain("processMiniAppPaymentProof");
    expect(orders).toContain("resendOrderFiles");
    expect(orders).toContain('action === "rate"');
    expect(orders).toContain("delivery_lang_choice");
    expect(runtime).toContain("rateMaterial");
    expect(runtime).toContain("filesInBot");
  });

  it("searches the catalog without dropping the Telegram WebView hash", () => {
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(runtime).toContain("/api/public/mini-app/search");
    expect(runtime).toContain("maybeSmartSearch");
    expect(runtime).toContain('querySelector(".catalog-search")');
    expect(runtime).toContain("e.preventDefault()");
    expect(runtime).toContain("location.hash");
    expect(runtime).toContain("maybeSmartSearch(location.pathname + location.search");
    expect(runtime).toContain(".card:not([hidden])");
    expect(runtime).toContain('showSearchStatus(t("searchingDeeper"))');
    const search = source("src/lib/mini-app-search.server.ts");
    expect(search).not.toContain("descendantCategoryIds");
    expect(search).toContain("весь видимый каталог");
  });

  it("opens Kaspi and other payment URLs from manual instructions", () => {
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(runtime).toContain("function linkifyPaymentInstructions");
    expect(runtime).toContain("pay\\\\.kaspi\\\\.kz");
    expect(runtime).toContain("openLink");
    expect(runtime).toContain("instEl.innerHTML = linkifyPaymentInstructions");
  });

  it("clears fulfillment checkout state when Mini App country changes", () => {
    const bot = source("src/lib/bot.server.ts");
    const fn = bot.slice(bot.indexOf("export async function miniAppSetCountry"));
    expect(fn).toContain("countryChanged");
    expect(fn).toContain("delete nextState.checkout_fulfillment_type");
    expect(fn).toContain("delete nextState.checkout_delivery_zone_id");
  });

  it("skips delivery-language checkout for a physical cart", () => {
    const checkout = source("src/lib/mini-app-checkout.server.ts");
    const needs = checkout.slice(checkout.indexOf("export async function miniAppCheckoutNeeds"));
    expect(needs).toContain('fulfillmentKind !== "physical"');
    expect(needs).toContain('hasModule("multi_language")');
  });

  it("uses physical completion copy and keeps the Mini App open after any order", () => {
    const bot = source("src/lib/bot.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(bot).toContain("orderCompletePhysical");
    expect(bot).toContain("stayOpen: true");
    expect(runtime).not.toContain("tg.close()");
    expect(runtime).toContain("/mini-app/orders");
    expect(runtime).toContain('t("filesAfterPayment")');
    expect(runtime).toContain('t("physicalDelivering")');
    expect(runtime).toContain('t("paidLabel")');
    expect(runtime).toContain('fulfillmentType === "pickup"');
  });

  it("shows material languages and all-languages price like the bot", () => {
    const catalog = source("src/lib/mini-app-catalog.server.ts");
    const checkout = source("src/lib/mini-app-checkout.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    const cart = source("src/lib/mini-app-cart.server.ts");
    expect(catalog).toContain("renderMiniAppLangBadges");
    expect(catalog).toContain("availableMaterialLanguages");
    expect(checkout).toContain("allLanguages");
    expect(checkout).not.toContain("All / Все");
    expect(runtime).toContain("quantityLocked");
    expect(runtime).toContain("productsCountSuffix");
    expect(runtime).toContain("syncCartButtons");
    expect(runtime).toContain("in-cart");
    expect(runtime).toContain("cart-thumb");
    expect(cart).toContain("quantityLocked");
    expect(cart).toContain("product_images(image_path, sort_order)");
  });

  it("filters catalog by material language and uses a two-column grid", () => {
    const page = source("src/lib/mini-app-page.server.ts");
    const catalog = source("src/lib/mini-app-catalog.server.ts");
    const route = source("src/routes/mini-app.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(page).toContain("repeat(2, minmax(0, 1fr))");
    expect(page).toContain(".lang-chip");
    expect(catalog).toContain("collectMiniAppMaterialLanguages");
    expect(catalog).toContain("MATERIAL_LANG_SHORT");
    expect(catalog).not.toContain("card-desc");
    expect(route).toContain('searchParams.get("mlang")');
    expect(route).toContain("mini-mlangs");
    expect(runtime).toContain("#mini-mlangs");
    expect(runtime).toContain("mlang:");
  });

  it("pins catalog add-to-cart buttons to a shared card footer", () => {
    const page = source("src/lib/mini-app-page.server.ts");
    const catalog = source("src/lib/mini-app-catalog.server.ts");
    expect(page).toContain("height: 100%");
    expect(page).toContain(".card-footer { margin-top: auto");
    expect(catalog).toContain('class="card-footer"');
  });

  it("does not resend files for physical orders", () => {
    const orders = source("src/lib/orders.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    const resend = orders.slice(orders.indexOf("export async function resendOrderFiles"));
    expect(resend).toContain('fulfillment_kind === "physical"');
    expect(resend).toContain('reason: "not_digital"');
    expect(runtime).toContain('order.status === "delivered" && !physical');
  });

  /**
   * Бэкенд (reviews.server.ts, /api/public/mini-app/orders.ts) разрешает
   * оценку физического заказа без единой проверки fulfillment_kind — Mini
   * App скрывала кнопку "Оценить" для него без причины (в отличие от кнопки
   * повторной выдачи файлов выше, которой физический заказ действительно
   * не касается).
   */
  it("offers rating for delivered physical orders, unlike file resend", () => {
    const runtime = source("src/lib/mini-app-runtime.ts");
    const rateBlock = runtime.slice(
      runtime.indexOf('var rateHtml = ""'),
      runtime.indexOf("var digitalHint ="),
    );
    expect(rateBlock).toContain('reviewsEnabled && order.status === "delivered"');
    expect(rateBlock).not.toContain('reviewsEnabled && order.status === "delivered" && !physical');
  });

  /**
   * Кнопка "Поделиться" раньше рассылала location.href — обычный URL
   * страницы Mini App, который открывается только внутри уже авторизованной
   * сессии Telegram WebView; у получателя ссылки сразу падало "сессия не
   * готова". Mini App здесь настроен через Menu Button (нет своего
   * t.me/…?startapp= входа), поэтому рабочая ссылка — обычный /start
   * deep-link (t.me/<bot>?start=p_<id>), а карточка товара показывается
   * ботом уже после выбора языка.
   */
  it("shares a working t.me deep link instead of the raw Mini App page URL", () => {
    const pdp = source("src/routes/mini-app.product.$productId.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    const bot = source("src/lib/bot.server.ts");
    expect(pdp).toContain("getCachedBotUrl");
    expect(pdp).toContain("?start=p_");
    expect(pdp).toContain("data-share-url");
    expect(runtime).toContain('getAttribute("data-share-url") || location.href');
    expect(bot).toContain('startPayload.startsWith("p_")');
    expect(bot).toContain("pending_start_product_id");
    const applyLocale = bot.slice(
      bot.indexOf("async function applyLocaleSelection"),
      bot.indexOf("function legalInlineKeyboard"),
    );
    expect(applyLocale).toContain("pending_start_product_id");
    expect(applyLocale).toContain("showProduct(chat_id, sharedProductId");
  });

  it("ships a purchased-materials library, sort chips and bottom tabs", () => {
    const page = source("src/lib/mini-app-page.server.ts");
    const catalog = source("src/lib/mini-app-catalog.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    const libraryPage = source("src/routes/mini-app.library.ts");
    const libraryApi = source("src/routes/api/public/mini-app/library.ts");
    const pdp = source("src/routes/mini-app.product.$productId.ts");
    expect(page).toContain(".tab-bar");
    expect(catalog).toContain("renderMiniAppTabBar");
    expect(catalog).toContain("sortMiniAppProductIds");
    expect(catalog).toContain("loadRelatedMiniAppProducts");
    expect(catalog).toContain("renderMiniAppFileList");
    expect(runtime).toContain("/api/public/mini-app/library");
    expect(runtime).toContain("loadLibrary");
    expect(runtime).toContain("purchased");
    expect(runtime).toContain("data-share");
    expect(libraryPage).toContain('createFileRoute("/mini-app/library")');
    expect(libraryApi).toContain("listMiniAppLibrary");
    expect(pdp).toContain("renderMiniAppFileList");
    expect(pdp).toContain("loadRelatedMiniAppProducts");
    expect(pdp).toContain("mlang");
  });
});
