import { describe, it, expect } from "vitest";
import { parseReceiptOcrAutoSetting } from "../src/lib/receipt-ocr-auto.server";

describe("parseReceiptOcrAutoSetting", () => {
  it("без ключа и с true — автопроверка включена", () => {
    expect(parseReceiptOcrAutoSetting(undefined)).toBe(true);
    expect(parseReceiptOcrAutoSetting(null)).toBe(true);
    expect(parseReceiptOcrAutoSetting("true")).toBe(true);
  });

  it("явное false выключает автопроверку", () => {
    expect(parseReceiptOcrAutoSetting("false")).toBe(false);
  });
});
