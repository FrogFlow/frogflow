import { describe, it, expect } from "vitest";
import { computePromoDiscount, normalizePromoCode } from "../src/lib/promo-codes";

describe("normalizePromoCode", () => {
  it("приводит к верхнему регистру и убирает пробелы по краям", () => {
    expect(normalizePromoCode("  sale20 ")).toBe("SALE20");
  });
});

describe("computePromoDiscount", () => {
  it("процентная скидка считается от суммы и округляется", () => {
    expect(computePromoDiscount(1000, { discount_type: "percent", discount_value: 15 })).toBe(150);
    expect(computePromoDiscount(999, { discount_type: "percent", discount_value: 10 })).toBe(100);
  });

  it("фиксированная скидка — как есть, но не больше суммы заказа", () => {
    expect(computePromoDiscount(1000, { discount_type: "fixed", discount_value: 300 })).toBe(300);
    expect(computePromoDiscount(200, { discount_type: "fixed", discount_value: 300 })).toBe(200);
  });

  it("нулевая или отрицательная сумма — скидки нет", () => {
    expect(computePromoDiscount(0, { discount_type: "fixed", discount_value: 300 })).toBe(0);
    expect(computePromoDiscount(-100, { discount_type: "percent", discount_value: 10 })).toBe(0);
  });
});
