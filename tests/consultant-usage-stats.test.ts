import { describe, expect, it } from "vitest";
import { summarizeConsultantRuns, runUsd } from "../src/lib/consultant/runs";

/**
 * Панель показывала одну цифру «всего потрачено с начала времён», по которой
 * нельзя ни оценить сообщение, ни увидеть, работает ли кеш. Сводка считается
 * из журнала сообщений — по строке на ответ покупателю.
 */
const row = (date: string, usd: number, cacheRead: number, input: number) => ({
  received_at: date,
  token_usage: { usd, cache_read: cacheRead, input, cache_write: 0, output: 130 },
});

describe("сводка расхода консультанта", () => {
  it("считает цену одного сообщения и долю кеша", () => {
    const stats = summarizeConsultantRuns([
      row("2026-09-19T05:00:00.000Z", 0.02, 90_000, 3_000),
      row("2026-09-19T06:00:00.000Z", 0.02, 90_000, 3_000),
    ]);
    expect(stats.messages).toBe(2);
    expect(stats.usd).toBeCloseTo(0.04, 6);
    expect(stats.usdPerMessage).toBeCloseTo(0.02, 6);
    // 180 000 из 186 000 прочитано из кеша.
    expect(stats.cacheReadShare).toBeCloseTo(180_000 / 186_000, 4);
  });

  it("группирует по суткам Алматы, а не по UTC", () => {
    // 19 сентября 21:00 UTC — это уже 20 сентября в Алматы (UTC+5).
    const stats = summarizeConsultantRuns([
      row("2026-09-19T21:00:00.000Z", 0.02, 1, 1),
      row("2026-09-19T05:00:00.000Z", 0.02, 1, 1),
    ]);
    expect(stats.days.map((d) => d.date)).toEqual(["2026-09-20", "2026-09-19"]);
    expect(stats.days[0].messages).toBe(1);
  });

  it("пустой журнал не делит на ноль", () => {
    const stats = summarizeConsultantRuns([]);
    expect(stats.messages).toBe(0);
    expect(stats.usdPerMessage).toBe(0);
    expect(stats.cacheReadShare).toBe(0);
  });

  it("цена сообщения считается по тем же ставкам, что и общий счёт", () => {
    // 90 000 из кеша по 0,1 доллара за миллион плюс 3 000 обычного ввода
    // плюс 130 токенов ответа по 5 долларов за миллион.
    const usd = runUsd({
      inputTokens: 3_000,
      outputTokens: 130,
      cacheCreationTokens: 0,
      cacheReadTokens: 90_000,
    });
    expect(usd).toBeCloseTo((90_000 * 0.1 + 3_000) / 1e6 + (130 * 5) / 1e6, 8);
  });
});
