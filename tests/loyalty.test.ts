import { describe, it, expect } from "vitest";
import { computePointsEarned, computePointsDiscount } from "../src/lib/loyalty";

describe("computePointsEarned", () => {
  it("считает процент от суммы заказа, округляя вниз", () => {
    expect(computePointsEarned(1000, 5)).toBe(50);
    expect(computePointsEarned(999, 10)).toBe(99);
  });

  it("нулевая сумма или нулевой процент — баллов нет", () => {
    expect(computePointsEarned(0, 10)).toBe(0);
    expect(computePointsEarned(1000, 0)).toBe(0);
    expect(computePointsEarned(-100, 10)).toBe(0);
  });
});

describe("computePointsDiscount", () => {
  it("списывает баллы 1:1, но не больше суммы заказа", () => {
    expect(computePointsDiscount(1000, 300)).toBe(300);
    expect(computePointsDiscount(200, 300)).toBe(200);
  });

  it("нулевая сумма или нулевой баланс — скидки нет", () => {
    expect(computePointsDiscount(0, 300)).toBe(0);
    expect(computePointsDiscount(1000, 0)).toBe(0);
    expect(computePointsDiscount(-100, 300)).toBe(0);
  });
});
