import { describe, it, expect } from "vitest";
import {
  addSmartSearchLifetime,
  buildAiUsageSnapshot,
  emptySmartSearchLifetime,
  parseReceiptOcrCount,
  parseSmartSearchLifetime,
  receiptOcrUsd,
  RECEIPT_OCR_USD_PER_1000,
} from "../src/lib/ai-usage";

describe("smart search lifetime spend", () => {
  it("накапливает запросы и USD, не сбрасывая на новый день", () => {
    const first = addSmartSearchLifetime(emptySmartSearchLifetime(), {
      inputTokens: 10_000,
      outputTokens: 1_000,
    });
    const second = addSmartSearchLifetime(first, { inputTokens: 10_000, outputTokens: 1_000 });
    expect(second.count).toBe(2);
    expect(second.inputTokens).toBe(20_000);
    expect(second.usd).toBeCloseTo(0.03);
  });

  it("битый JSON — пустой счётчик, не бросает", () => {
    expect(parseSmartSearchLifetime("не json")).toEqual(emptySmartSearchLifetime());
    expect(parseSmartSearchLifetime("")).toEqual(emptySmartSearchLifetime());
  });
});

describe("receipt OCR billing", () => {
  it("считает $2 за 1000 чеков", () => {
    expect(RECEIPT_OCR_USD_PER_1000).toBe(2);
    expect(receiptOcrUsd(0)).toBe(0);
    expect(receiptOcrUsd(1000)).toBe(2);
    expect(receiptOcrUsd(500)).toBe(1);
    expect(receiptOcrUsd(1)).toBeCloseTo(0.002);
  });

  it("разбирает счётчик чеков", () => {
    expect(parseReceiptOcrCount("17")).toBe(17);
    expect(parseReceiptOcrCount("")).toBe(0);
    expect(parseReceiptOcrCount("-3")).toBe(0);
  });
});

describe("buildAiUsageSnapshot", () => {
  it("собирает оба счётчика для панели", () => {
    const snap = buildAiUsageSnapshot(
      JSON.stringify({ count: 4, inputTokens: 100, outputTokens: 10, usd: 1.25 }),
      "250",
    );
    expect(snap.smartSearch.count).toBe(4);
    expect(snap.smartSearch.usd).toBe(1.25);
    expect(snap.receiptOcr.count).toBe(250);
    expect(snap.receiptOcr.usd).toBe(0.5);
  });
});
