import { describe, expect, it } from "vitest";
import { consumeMiniAppRateLimit } from "../src/lib/mini-app-rate-limit.server";

describe("Mini App rate limiting", () => {
  it("limits checkout bursts independently per Telegram user", () => {
    const telegramId = 9_000_000_001;
    for (let i = 0; i < 20; i++) {
      expect(consumeMiniAppRateLimit("checkout", telegramId).ok).toBe(true);
    }
    const blocked = consumeMiniAppRateLimit("checkout", telegramId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(consumeMiniAppRateLimit("checkout", telegramId + 1).ok).toBe(true);
  });

  it("uses a separate, larger cart allowance", () => {
    const telegramId = 9_000_000_003;
    for (let i = 0; i < 21; i++) {
      expect(consumeMiniAppRateLimit("cart", telegramId).ok).toBe(true);
    }
  });

  it("limits proof uploads more tightly than cart traffic", () => {
    const telegramId = 9_000_000_005;
    for (let i = 0; i < 5; i++) {
      expect(consumeMiniAppRateLimit("proof", telegramId).ok).toBe(true);
    }
    expect(consumeMiniAppRateLimit("proof", telegramId).ok).toBe(false);
  });

  /**
   * Учителя, находка о коллизии лимитов: startPaymentPolling бьёт
   * /api/public/mini-app/orders?poll=1 раз в 4с фоном, пока ждёт оплату, —
   * без отдельного бюджета это делило одну корзину с открытием вкладки
   * «Заказы» самим покупателем, и фоновый опрос мог выесть весь лимит
   * "orders" раньше, чем покупатель успевал сам обновить список.
   */
  it("orders_poll имеет свой бюджет, не деля лимит со вкладкой «Заказы»", () => {
    const telegramId = 9_000_000_007;
    for (let i = 0; i < 30; i++) {
      expect(consumeMiniAppRateLimit("orders", telegramId).ok).toBe(true);
    }
    expect(consumeMiniAppRateLimit("orders", telegramId).ok).toBe(false);
    // "orders" исчерпан — но фоновый опрос платежа под своим scope всё ещё работает.
    expect(consumeMiniAppRateLimit("orders_poll", telegramId).ok).toBe(true);
  });

  it("orders_poll тоже ограничен — не безлимитный фон", () => {
    const telegramId = 9_000_000_009;
    for (let i = 0; i < 20; i++) {
      expect(consumeMiniAppRateLimit("orders_poll", telegramId).ok).toBe(true);
    }
    expect(consumeMiniAppRateLimit("orders_poll", telegramId).ok).toBe(false);
  });
});
