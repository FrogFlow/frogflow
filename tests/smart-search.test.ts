import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSmartSearchIds } from "../src/lib/smart-search";
import {
  addDailySpend,
  estimateUsdFromTokens,
  extractAnthropicUsage,
  formatUsd,
  parseDailyCount,
  parseDailySpend,
} from "../src/lib/smart-search-cost";
import { smartSearchProductIds } from "../src/lib/smart-search.server";

const valid = ["aaa", "bbb", "ccc"];

describe("parseSmartSearchIds", () => {
  it("достаёт id из чистого JSON", () => {
    expect(parseSmartSearchIds('{"ids": ["aaa", "bbb"]}', valid)).toEqual(["aaa", "bbb"]);
  });

  it("достаёт JSON, даже если модель добавила текст вокруг", () => {
    const text = 'Вот подходящие товары:\n{"ids": ["ccc"]}\nНадеюсь, это поможет!';
    expect(parseSmartSearchIds(text, valid)).toEqual(["ccc"]);
  });

  it("отбрасывает id, которых нет среди реальных кандидатов", () => {
    expect(parseSmartSearchIds('{"ids": ["aaa", "fake-id"]}', valid)).toEqual(["aaa"]);
  });

  it("пустой список ids — пустой результат", () => {
    expect(parseSmartSearchIds('{"ids": []}', valid)).toEqual([]);
  });

  it("невалидный JSON — пустой результат, не бросает", () => {
    expect(parseSmartSearchIds("не могу распарсить это", valid)).toEqual([]);
    expect(parseSmartSearchIds("{ вообще не json", valid)).toEqual([]);
  });

  it("ids не массив — пустой результат", () => {
    expect(parseSmartSearchIds('{"ids": "aaa"}', valid)).toEqual([]);
    expect(parseSmartSearchIds("{}", valid)).toEqual([]);
  });
});

describe("smart search cost", () => {
  it("считает USD по прайсу Haiku 4.5: $1/MTok in, $5/MTok out", () => {
    expect(estimateUsdFromTokens({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(1);
    expect(estimateUsdFromTokens({ inputTokens: 0, outputTokens: 1_000_000 })).toBe(5);
    expect(estimateUsdFromTokens({ inputTokens: 50_000, outputTokens: 2_000 })).toBeCloseTo(0.06);
  });

  it("сбрасывает дневной счётчик и расход на новую дату", () => {
    expect(parseDailyCount("2026-09-01:17", "2026-09-02")).toBe(0);
    expect(parseDailyCount("2026-09-02:17", "2026-09-02")).toBe(17);
    expect(parseDailySpend('{"date":"2026-09-01","usd":1.5}', "2026-09-02").usd).toBe(0);
    expect(
      parseDailySpend(
        '{"date":"2026-09-02","inputTokens":10,"outputTokens":2,"usd":0.04}',
        "2026-09-02",
      ),
    ).toEqual({
      date: "2026-09-02",
      inputTokens: 10,
      outputTokens: 2,
      usd: 0.04,
    });
  });

  it("накапливает токены и USD за день", () => {
    const first = addDailySpend(
      { date: "2026-09-02", inputTokens: 0, outputTokens: 0, usd: 0 },
      { inputTokens: 10_000, outputTokens: 1_000 },
      "2026-09-02",
    );
    const second = addDailySpend(first, { inputTokens: 10_000, outputTokens: 1_000 }, "2026-09-02");
    expect(second.inputTokens).toBe(20_000);
    expect(second.outputTokens).toBe(2_000);
    expect(second.usd).toBeCloseTo(0.03);
  });

  it("достаёт usage из ответа Anthropic", () => {
    expect(extractAnthropicUsage({ usage: { input_tokens: 1200, output_tokens: 80 } })).toEqual({
      inputTokens: 1200,
      outputTokens: 80,
    });
    expect(extractAnthropicUsage({ error: "nope" })).toBeNull();
  });

  it("форматирует мелкие суммы с 4 знаками", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0032)).toBe("$0.0032");
    expect(formatUsd(1.2)).toBe("$1.20");
  });
});

/**
 * Раньше промпт всегда говорил "товар в интернет-магазине" одинаково для
 * обеих ниш платформы — учителя ищут по предмету/классу/теме урока,
 * кондитерская по поводу/начинке/оформлению, и общая формулировка не давала
 * модели контекста домена, в котором вообще происходит поиск.
 */
describe("smartSearchProductIds — промпт учитывает нишу (Учителя, находка про generic-промпт)", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalVertical = process.env.VERTICAL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
    if (originalVertical === undefined) delete process.env.VERTICAL;
    else process.env.VERTICAL = originalVertical;
  });

  function mockFetchCapturingBody(capture: { body?: string }) {
    global.fetch = vi.fn(async (_url, init) => {
      capture.body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"ids":[]}' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
  }

  it("digital (умолчание, VERTICAL не задан) — промпт про учебные материалы", async () => {
    delete process.env.VERTICAL;
    const capture: { body?: string } = {};
    mockFetchCapturingBody(capture);
    await smartSearchProductIds("тесты по алгебре для 7 класса", [
      { id: "p1", name: "Тест", description: null, keywords: null },
    ]);
    expect(capture.body).toContain("учебный материал");
    expect(capture.body).not.toContain("кондитерской");
  });

  it("confectionery — промпт про торты и десерты", async () => {
    process.env.VERTICAL = "confectionery";
    const capture: { body?: string } = {};
    mockFetchCapturingBody(capture);
    await smartSearchProductIds("что-то на день рождения пятилетке", [
      { id: "p1", name: "Торт", description: null, keywords: null },
    ]);
    expect(capture.body).toContain("кондитерской");
    expect(capture.body).not.toContain("учебный материал");
  });
});
