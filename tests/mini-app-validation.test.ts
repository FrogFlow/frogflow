import { describe, expect, it } from "vitest";
import {
  isMiniAppFulfillmentType,
  isMiniAppPaymentMethod,
  isValidMiniAppIsoDate,
  normalizeMiniAppPhone,
  normalizeMiniAppText,
} from "../src/lib/mini-app-validation";

describe("Mini App checkout validation", () => {
  it("normalizes valid phones and rejects invalid input", () => {
    expect(normalizeMiniAppPhone(" +7 (777) 123-45-67 ")).toBe("+7 (777) 123-45-67");
    expect(normalizeMiniAppPhone("123")).toBeNull();
    expect(normalizeMiniAppPhone("<script>")).toBeNull();
  });

  it("validates real ISO dates against the minimum date", () => {
    expect(isValidMiniAppIsoDate("2026-09-03", "2026-09-02")).toBe(true);
    expect(isValidMiniAppIsoDate("2026-09-01", "2026-09-02")).toBe(false);
    expect(isValidMiniAppIsoDate("2026-02-30", "2026-01-01")).toBe(false);
    expect(isValidMiniAppIsoDate("03.09.2026", "2026-09-02")).toBe(false);
  });

  it("caps free text and enforces required fields", () => {
    expect(normalizeMiniAppText("  address  ", 500, true)).toBe("address");
    expect(normalizeMiniAppText("   ", 500, true)).toBeNull();
    expect(normalizeMiniAppText("abcdef", 3, false)).toBe("abc");
  });

  it("only accepts supported fulfillment and payment choices", () => {
    expect(isMiniAppFulfillmentType("pickup")).toBe(true);
    expect(isMiniAppFulfillmentType("courier")).toBe(false);
    expect(isMiniAppPaymentMethod("robokassa")).toBe(true);
    expect(isMiniAppPaymentMethod("free")).toBe(false);
  });
});
