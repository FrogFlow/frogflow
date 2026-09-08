import { describe, it, expect } from "vitest";
import {
  parseReceiptOcrAutoSetting,
  shouldEnterReceiptOcrPath,
} from "../src/lib/receipt-ocr-auto.server";

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

describe("shouldEnterReceiptOcrPath", () => {
  it("тумблер включён — читаем чек даже без proof_auto (KZ до кнопки реквизитов)", () => {
    expect(shouldEnterReceiptOcrPath(true, false)).toBe(true);
  });

  it("тумблер выключен и нет proof_auto — обычный заказ, OCR нет", () => {
    expect(shouldEnterReceiptOcrPath(false, false)).toBe(false);
  });
});

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
