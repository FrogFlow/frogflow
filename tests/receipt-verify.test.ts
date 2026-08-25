import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findMatchingAmount,
  currencyConflict,
  looksLikeReceipt,
  extractMoneyAmounts,
  hashReceiptBytes,
  RECEIPT_UNDERPAY_TOLERANCE,
  RECEIPT_OVERPAY_TOLERANCE,
} from "../src/lib/receipt-verify.server";

describe("findMatchingAmount — асимметричный допуск (Блок A.3)", () => {
  it("недоплата больше 2% не проходит", () => {
    // 900 из 1000 — недоплата 10%, раньше проходила при симметричном допуске.
    expect(findMatchingAmount([900], 1000)).toBeNull();
  });

  it("недоплата в пределах 2% проходит", () => {
    expect(findMatchingAmount([981], 1000)).toBe(981);
  });

  it("переплата на 10% всё ещё проходит — не вредит продавцу", () => {
    expect(findMatchingAmount([1100], 1000)).toBe(1100);
  });

  it("переплата больше 10% не проходит", () => {
    expect(findMatchingAmount([1200], 1000)).toBeNull();
  });

  it("точное совпадение всегда проходит", () => {
    expect(findMatchingAmount([1000], 1000)).toBe(1000);
  });

  it("допуски настраиваемые через opts", () => {
    expect(findMatchingAmount([500], 1000, { underTolerance: 0.6 })).toBe(500);
  });

  it("константы соответствуют документированным значениям", () => {
    expect(RECEIPT_UNDERPAY_TOLERANCE).toBe(0.02);
    expect(RECEIPT_OVERPAY_TOLERANCE).toBe(0.1);
  });
});

describe("currencyConflict (Блок A.1)", () => {
  it("чек с явным упоминанием другой валюты — конфликт", () => {
    expect(currencyConflict("Перевод 5000 RUB успешно выполнен", "KZT")).toBe(true);
  });

  it("чек с ожидаемой валютой — не конфликт", () => {
    expect(currencyConflict("Оплата 5000 тенге получена", "KZT")).toBe(false);
  });

  it("чек без упоминания какой-либо валюты — не конфликт (доверяем сумме, как раньше)", () => {
    expect(currencyConflict("Оплата 5000 получена успешно", "KZT")).toBe(false);
  });

  it("валюта вне списка известных — не блокируем", () => {
    expect(currencyConflict("Payment 5000 EUR", "EUR")).toBe(false);
  });

  it("без ожидаемой валюты — не проверяем вообще", () => {
    expect(currencyConflict("Перевод 5000 RUB", undefined)).toBe(false);
  });
});

describe("hashReceiptBytes (Блок A.4)", () => {
  it("одинаковые байты — одинаковый хеш", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(hashReceiptBytes(bytes)).toBe(hashReceiptBytes(new Uint8Array([1, 2, 3, 4, 5])));
  });

  it("разные байты — разный хеш", () => {
    expect(hashReceiptBytes(new Uint8Array([1, 2, 3]))).not.toBe(
      hashReceiptBytes(new Uint8Array([1, 2, 4])),
    );
  });
});

describe("looksLikeReceipt / extractMoneyAmounts — не тронуты правкой", () => {
  it("текст с маркером платежа и суммой — похоже на чек", () => {
    expect(looksLikeReceipt("Оплата успешно проведена. Сумма: 1 234,56 KZT")).toBe(true);
  });

  it("случайный текст без маркеров — не похоже", () => {
    expect(looksLikeReceipt("Съешь ещё этих мягких французских булок")).toBe(false);
  });

  it("извлекает суммы с разделителем тысяч", () => {
    expect(extractMoneyAmounts("Сумма: 1 234,56 KZT")).toContain(1234.56);
  });
});

let reuseMatch: { id: number; display_no: number; order_no: number } | null = null;

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: reuseMatch, error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

describe("verifyPaymentReceipt — сверка на повтор чека (Блок A.4)", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GOOGLE_VISION_API_KEY;

  const visionResponse = (text: string) => ({
    ok: true,
    json: () =>
      Promise.resolve({
        responses: [{ fullTextAnnotation: { text } }],
      }),
  });

  beforeEach(() => {
    process.env.GOOGLE_VISION_API_KEY = "test-key";
    reuseMatch = null;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_VISION_API_KEY = originalKey;
  });

  it("чек уже принят по другому заказу — receipt_reused, автовыдачи нет", async () => {
    reuseMatch = { id: 42, display_no: 42, order_no: 42 };
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Оплата успешно. Сумма: 1000 KZT")),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 1000,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("receipt_reused");
      expect(result.detail).toContain("42");
    }
  });

  it("чек новый (нет совпадения по хешу) — автовыдача, proofHash в результате", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Оплата успешно. Сумма: 1000 KZT")),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 1000,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matchedAmount).toBe(1000);
      expect(result.proofHash).toBe(hashReceiptBytes(new Uint8Array([1, 2, 3])));
    }
  });

  it("явный конфликт валюты — currency_mismatch, до проверки на повтор не доходит", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Перевод успешно выполнен. Сумма: 1000 RUB")),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 1000,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("currency_mismatch");
  });
});
