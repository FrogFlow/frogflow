import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  initDataFromCapturedLaunch,
  initDataFromStoredInitParams,
  initDataFromWebAppHash,
  initDataFromWebAppLocation,
  resolveTelegramInitData,
} from "../src/lib/telegram-webapp-init-data";

const inner = "auth_date=1700000000&query_id=AAE&user=%7B%22id%22%3A1%7D&hash=abc123def";

describe("initDataFromWebAppLocation", () => {
  it("читает tgWebAppData из hash Mini App", () => {
    const hash = `#tgWebAppData=${encodeURIComponent(inner)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
    expect(initDataFromWebAppHash(hash)).toBe(inner);
  });

  it("читает tgWebAppData из query string", () => {
    const search = `?tgWebAppData=${encodeURIComponent(inner)}&tgWebAppVersion=8.0`;
    expect(initDataFromWebAppLocation(search)).toBe(inner);
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

describe("initDataFromCapturedLaunch", () => {
  it("разбирает сохранённый hash+search", () => {
    const packed = `#tgWebAppData=${encodeURIComponent(inner)}&tgWebAppVersion=8.0\n`;
    expect(initDataFromCapturedLaunch(packed)).toBe(inner);
  });
});

describe("resolveTelegramInitData", () => {
  it("предпочитает SDK, затем capture, затем hash", () => {
    expect(
      resolveTelegramInitData({
        sdkInitData: inner,
        hash: `#tgWebAppData=${encodeURIComponent("auth_date=1&hash=other")}`,
      }),
    ).toBe(inner);

    expect(
      resolveTelegramInitData({
        sdkInitData: "",
        search: `?tgWebAppData=${encodeURIComponent(inner)}`,
      }),
    ).toBe(inner);

    expect(
      resolveTelegramInitData({
        storedInitParamsJson: JSON.stringify({ tgWebAppData: inner }),
      }),
    ).toBe(inner);
  });
});

describe("mini-app boot", () => {
  it("захватывает launch params до SDK и не просит закрыть окно", () => {
    const page = readFileSync(resolve("src/lib/mini-app-page.server.ts"), "utf8");
    const runtime = readFileSync(resolve("src/lib/mini-app-runtime.ts"), "utf8");
    expect(page).toContain("ff_tg_launch");
    expect(page).toContain("telegram-web-app.js?63");
    expect(runtime).not.toMatch(/Закройте окно/);
    expect(runtime).not.toMatch(/body\.innerHTML/);
  });
});
