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
    expect(page).toContain('src="/mini-app-runtime?v=6"');
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
      expect(pack.filesAfterPayment).toBeTruthy();
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

  it("uses physical completion copy and keeps the Mini App open", () => {
    const bot = source("src/lib/bot.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    expect(bot).toContain("orderCompletePhysical");
    expect(bot).toContain('stayOpen: orderFulfillmentKind === "physical"');
    expect(runtime).toContain("if (!data.stayOpen)");
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
    expect(cart).toContain("quantityLocked");
  });

  it("does not resend files for physical orders", () => {
    const orders = source("src/lib/orders.server.ts");
    const runtime = source("src/lib/mini-app-runtime.ts");
    const resend = orders.slice(orders.indexOf("export async function resendOrderFiles"));
    expect(resend).toContain('fulfillment_kind === "physical"');
    expect(resend).toContain('reason: "not_digital"');
    expect(runtime).toContain('order.status === "delivered" && !physical');
  });
});
