import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { miniAppStringsClientPack } from "../src/lib/mini-app-i18n";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("Mini App production regressions", () => {
  it("loads the runtime from the registered route", () => {
    const page = source("src/lib/mini-app-page.server.ts");
    const route = source("src/routes/mini-app-runtime.ts");
    expect(page).toContain('src="/mini-app-runtime?v=2"');
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
  });

  it("uses delivery zone price and never the nonexistent fee property", () => {
    const checkout = source("src/lib/mini-app-checkout.server.ts");
    expect(checkout).toContain("Number(zone.price)");
    expect(checkout).toContain("Number(z.price)");
    expect(checkout).not.toMatch(/\bzone\.fee\b|\bz\.fee\b/);
  });

  it("releases order placement for terminal Mini App paths", () => {
    const bot = source("src/lib/bot.server.ts");
    const completedPaths = bot.match(
      /if \(miniApp\) \{\s+await releaseOrderPlacement\(telegram_id, user\.state\);/g,
    );
    expect(completedPaths?.length).toBeGreaterThanOrEqual(2);
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
      expect(pack.chooseDeliveryLanguage).toBeTruthy();
      expect(pack.invalidField).toBeTruthy();
      expect(pack.paymentUnavailable).toBeTruthy();
    },
  );
});
