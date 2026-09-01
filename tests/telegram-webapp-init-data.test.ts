import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  initDataFromStoredInitParams,
  initDataFromWebAppHash,
  resolveTelegramInitData,
} from "../src/lib/telegram-webapp-init-data";

const inner =
  "auth_date=1700000000&query_id=AAE&user=%7B%22id%22%3A1%7D&hash=abc123def";

describe("initDataFromWebAppHash", () => {
  it("читает tgWebAppData из hash Mini App", () => {
    const hash = `#tgWebAppData=${encodeURIComponent(inner)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
    expect(initDataFromWebAppHash(hash)).toBe(inner);
  });

  it("собирает значение, если внутренний query не закодирован целиком", () => {
    const hash = `#tgWebAppData=${inner}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`;
    const got = initDataFromWebAppHash(hash);
    expect(got).toContain("auth_date=1700000000");
    expect(got).toContain("hash=abc123def");
  });

  it("пустой hash — пустая строка", () => {
    expect(initDataFromWebAppHash("")).toBe("");
    expect(initDataFromWebAppHash("#")).toBe("");
  });
});

describe("initDataFromStoredInitParams", () => {
  it("берёт tgWebAppData из JSON, который пишет telegram-web-app.js", () => {
    expect(initDataFromStoredInitParams(JSON.stringify({ tgWebAppData: inner }))).toBe(inner);
  });

  it("игнорирует битый JSON", () => {
    expect(initDataFromStoredInitParams("{not json")).toBe("");
  });
});

describe("resolveTelegramInitData", () => {
  it("предпочитает SDK, затем hash, затем sessionStorage", () => {
    expect(
      resolveTelegramInitData({
        sdkInitData: "from-sdk",
        hash: `#tgWebAppData=${encodeURIComponent(inner)}`,
        storedInitParamsJson: JSON.stringify({ tgWebAppData: "from-store" }),
      }),
    ).toBe("from-sdk");

    expect(
      resolveTelegramInitData({
        sdkInitData: "",
        hash: `#tgWebAppData=${encodeURIComponent(inner)}&tgWebAppVersion=8.0`,
        storedInitParamsJson: JSON.stringify({ tgWebAppData: "from-store" }),
      }),
    ).toBe(inner);

    expect(
      resolveTelegramInitData({
        sdkInitData: "  ",
        hash: "",
        storedInitParamsJson: JSON.stringify({ tgWebAppData: "from-store" }),
      }),
    ).toBe("from-store");
  });
});

describe("mini-app boot", () => {
  it("не затирает каталог при пустом initData в первый тик", () => {
    const src = readFileSync(resolve("src/routes/mini-app.ts"), "utf8");
    expect(src).toContain("tgWebAppData");
    expect(src).toMatch(/MAX_INIT_ATTEMPTS/);
    expect(src).not.toMatch(/if\s*\(\s*!initData\(\)\s*\)\s*\{[\s\S]*body\.innerHTML/);
  });
});
