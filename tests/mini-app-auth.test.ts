import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/modules/modules.server", () => ({
  loadModulesFresh: vi.fn(async () => ({
    telegram_mini_app: true,
    shop: true,
  })),
}));

import { authorizeMiniAppRequest } from "../src/lib/mini-app.server";
import { loadModulesFresh } from "../src/lib/modules/modules.server";

function signedInitData(token: string, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: 777, first_name: "Mini" }),
  });
  const pairs = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(pairs).digest("hex"));
  return params.toString();
}

describe("authorizeMiniAppRequest", () => {
  const token = "123456:test-token";
  const previous = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = token;
    vi.mocked(loadModulesFresh).mockResolvedValue({
      telegram_mini_app: true,
      shop: true,
    } as Awaited<ReturnType<typeof loadModulesFresh>>);
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  });

  it("accepts fresh signed initData from the header", async () => {
    const result = await authorizeMiniAppRequest(
      new Request("https://shop.example/api/public/mini-app/cart", {
        headers: { "X-Telegram-Init-Data": signedInitData(token) },
      }),
    );
    expect(result).toMatchObject({ ok: true, user: { id: 777 } });
  });

  it("rejects missing and expired credentials", async () => {
    const missing = await authorizeMiniAppRequest(
      new Request("https://shop.example/api/public/mini-app/cart"),
    );
    expect(missing).toMatchObject({ ok: false, status: 401, error: "missing" });

    const expired = await authorizeMiniAppRequest(
      new Request("https://shop.example/api/public/mini-app/cart", {
        headers: {
          "X-Telegram-Init-Data": signedInitData(token, Math.floor(Date.now() / 1000) - 3601),
        },
      }),
    );
    expect(expired).toMatchObject({ ok: false, status: 401, error: "expired" });
  });

  it("ignores credentials leaked through the query string", async () => {
    const result = await authorizeMiniAppRequest(
      new Request(
        `https://shop.example/api/public/mini-app/cart?initData=${encodeURIComponent(
          signedInitData(token),
        )}`,
      ),
    );
    expect(result).toMatchObject({ ok: false, status: 401, error: "missing" });
  });

  it("requires both shop and telegram_mini_app modules", async () => {
    vi.mocked(loadModulesFresh).mockResolvedValue({
      telegram_mini_app: true,
      shop: false,
    } as Awaited<ReturnType<typeof loadModulesFresh>>);
    const result = await authorizeMiniAppRequest(
      new Request("https://shop.example/api/public/mini-app/cart", {
        headers: { "X-Telegram-Init-Data": signedInitData(token) },
      }),
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
