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
});
