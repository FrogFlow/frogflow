import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isCronAuthorized } from "./cron-auth.server";

/**
 * isCronAuthorized защищает все /api/cron/*, /api/operator-cron/* и VIP-крон
 * — раньше эта проверка была скопирована в шесть мест почти дословно и не
 * timing-safe. Тестируем саму функцию: ошибка здесь либо запирает весь cron
 * снаружи, либо открывает его кому угодно.
 */

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(init?: { auth?: string; query?: string }): Request {
  const url = init?.query
    ? `https://x.test/api/cron/broadcast?secret=${init.query}`
    : "https://x.test/api/cron/broadcast";
  const headers = new Headers();
  if (init?.auth) headers.set("authorization", init.auth);
  return new Request(url, { headers });
}

describe("isCronAuthorized", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret-value";
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("пропускает верный Bearer-заголовок", () => {
    expect(isCronAuthorized(req({ auth: "Bearer test-cron-secret-value" }))).toBe(true);
  });

  it("пропускает верный query-параметр secret", () => {
    expect(isCronAuthorized(req({ query: "test-cron-secret-value" }))).toBe(true);
  });

  it("отклоняет неверный секрет в заголовке", () => {
    expect(isCronAuthorized(req({ auth: "Bearer wrong" }))).toBe(false);
  });

  it("отклоняет неверный секрет в query", () => {
    expect(isCronAuthorized(req({ query: "wrong" }))).toBe(false);
  });

  it("отклоняет запрос вовсе без секрета", () => {
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("отклоняет всё, если CRON_SECRET не задан на деплое — fail closed", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req({ auth: "Bearer whatever" }))).toBe(false);
  });

  it("не путает голый заголовок x-vercel-cron с настоящей авторизацией", () => {
    const r = new Request("https://x.test/api/cron/broadcast", {
      headers: { "x-vercel-cron": "1" },
    });
    expect(isCronAuthorized(r)).toBe(false);
  });
});
