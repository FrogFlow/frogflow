import { describe, it, expect } from "vitest";
import {
  normalizeGiftCertificateCode,
  computeGiftCertificateDiscount,
  generateGiftCertificateCode,
} from "../src/lib/gift-certificates";

describe("normalizeGiftCertificateCode", () => {
  it("приводит к верхнему регистру и убирает пробелы по краям", () => {
    expect(normalizeGiftCertificateCode("  gift-ab12cd ")).toBe("GIFT-AB12CD");
  });
});

describe("computeGiftCertificateDiscount", () => {
  it("скидка равна номиналу, но не больше суммы заказа", () => {
    expect(computeGiftCertificateDiscount(1000, 300)).toBe(300);
    expect(computeGiftCertificateDiscount(200, 300)).toBe(200);
  });

  it("нулевая сумма или нулевой номинал — скидки нет", () => {
    expect(computeGiftCertificateDiscount(0, 300)).toBe(0);
    expect(computeGiftCertificateDiscount(1000, 0)).toBe(0);
    expect(computeGiftCertificateDiscount(-100, 300)).toBe(0);
  });
});

describe("generateGiftCertificateCode", () => {
  it("генерирует код с префиксом GIFT- и 6 символами суффикса", () => {
    expect(generateGiftCertificateCode()).toMatch(/^GIFT-[A-Z0-9]{6}$/);
  });

  it("генерирует разные коды при повторных вызовах", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateGiftCertificateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
