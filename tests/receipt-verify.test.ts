import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findMatchingAmount,
  currencyConflict,
  detectReceiptCurrency,
  looksLikeReceipt,
  looksLikeFailedPayment,
  isReceiptRetryReason,
  isPdfReceipt,
  extractMoneyAmounts,
  amountsForCurrency,
  hashReceiptBytes,
  RECEIPT_UNDERPAY_TOLERANCE,
  RECEIPT_OVERPAY_TOLERANCE,
  RECEIPT_FX_UNDERPAY_TOLERANCE,
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
    expect(RECEIPT_FX_UNDERPAY_TOLERANCE).toBe(0.15);
  });
});

describe("detectReceiptCurrency", () => {
  it("если в чеке ожидаемая валюта — берём её, даже когда рядом другая", () => {
    expect(detectReceiptCurrency("Оплата 5000 тенге, комиссия 10 руб", "KZT")).toBe("KZT");
  });

  it("только чужая валюта — возвращаем её", () => {
    expect(detectReceiptCurrency("Перевод 1000 RUB успешно", "KZT")).toBe("RUB");
  });

  it("нет маркеров — null", () => {
    expect(detectReceiptCurrency("Оплата 5000 получена", "KZT")).toBeNull();
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

describe("looksLikeFailedPayment", () => {
  it("отсекает чек, где банк пишет, что платёж не прошёл", () => {
    expect(
      looksLikeFailedPayment("Платёж не прошёл. Ошибка. Неверно введены данные. Сумма: 500 BYN"),
    ).toBe(true);
    expect(looksLikeFailedPayment("Операция отклонена. Недостаточно средств. 1500 RUB")).toBe(true);
    expect(looksLikeFailedPayment("Payment failed. Transaction declined. Amount 1000")).toBe(true);
  });

  it("успешный чек с оговоркой «в случае ошибки» не считается отказом", () => {
    expect(
      looksLikeFailedPayment(
        "Оплата успешно проведена. Сумма: 1000 KZT. В случае ошибки обратитесь в поддержку.",
      ),
    ).toBe(false);
    expect(
      looksLikeFailedPayment("Платёж выполнен. Если вы не совершали операцию, обратитесь в банк."),
    ).toBe(false);
  });

  it("payment_failed просим переслать, а не кладём в ручную выдачу", () => {
    expect(isReceiptRetryReason("payment_failed")).toBe(true);
    expect(isReceiptRetryReason("not_receipt")).toBe(true);
    expect(isReceiptRetryReason("amount_mismatch")).toBe(false);
  });
});

describe("isPdfReceipt", () => {
  it("узнаёт PDF по mime и по сигнатуре %PDF", () => {
    expect(isPdfReceipt("application/pdf")).toBe(true);
    expect(isPdfReceipt("application/pdf; charset=binary")).toBe(true);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(isPdfReceipt("application/octet-stream", pdf)).toBe(true);
    expect(isPdfReceipt("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
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

  it("ВТБ: сумма операции 228 ₽ и выплата 1101.24 KZT, не телефон и не дата", () => {
    const text = `
      Перевод по номеру телефона в другую страну
      Дата операции 08.09.2026, 19:33
      Номер телефона 7055113828
      Сумма выплаты 1101.24 KZT
      Курс обмена 1 ₽ = 4.83 KZT
      Комиссия за перевод 0 ₽
      Сумма операции 228 ₽
    `;
    const amounts = extractMoneyAmounts(text);
    expect(amounts).toContain(1101.24);
    expect(amounts).toContain(228);
    expect(amounts).not.toContain(7055113);
    expect(amounts).not.toContain(8.09);
    expect(amounts).not.toContain(2026);
  });

  it("Сбер: сумма в местной валюте 1077.30 KZT", () => {
    expect(
      extractMoneyAmounts("Сумма в местной валюте 1077.30 KZT Идентификатор 258797242136PSVG"),
    ).toContain(1077.3);
  });

  it("Сбер: 661.50 и 1072.58 KZT тоже читаются", () => {
    expect(extractMoneyAmounts("Сумма в местной валюте 661.50 KZT")).toContain(661.5);
    expect(extractMoneyAmounts("Сумма в местной валюте 1072.58 KZT")).toContain(1072.58);
  });

  it("экран «Платёж выполнен» 227 ₽", () => {
    expect(extractMoneyAmounts("Платёж выполнен\n227 ₽\n7055113828")).toContain(227);
    expect(extractMoneyAmounts("Платёж выполнен\n227 ₽\n7055113828")).not.toContain(7055113);
  });
});

describe("amountsForCurrency — не смешивать 1000 ₽ и 1000 ₸", () => {
  it("1000 RUB не идёт в пул KZT", () => {
    expect(amountsForCurrency("Перевод успешно выполнен. Сумма: 1000 RUB", "KZT")).not.toContain(
      1000,
    );
    expect(amountsForCurrency("Перевод успешно выполнен. Сумма: 1000 RUB", "RUB")).toContain(1000);
  });

  it("на смешанном чеке в KZT остаётся выплата, не рубли", () => {
    const text = "Сумма выплаты 1101.24 KZT. Сумма операции 228 ₽.";
    expect(amountsForCurrency(text, "KZT")).toEqual(expect.arrayContaining([1101.24]));
    expect(amountsForCurrency(text, "KZT")).not.toContain(228);
    expect(amountsForCurrency(text, "RUB")).toContain(228);
    expect(amountsForCurrency(text, "RUB")).not.toContain(1101.24);
  });
});

let reuseMatch: { id: number; display_no: number; order_no: number } | null = null;

vi.mock("../src/lib/currency.server", () => ({
  convertAmount: async (amount: number, from: string, to: string) => {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return Math.round(amount);
    // Как mid-market каталога 8.09.2026: 1 ₽ ≈ 5.267 ₸. Розничный Сбер ~4.73.
    const kztPerRub = 5.267;
    if (f === "KZT" && t === "RUB") return Math.round(amount / kztPerRub);
    if (f === "RUB" && t === "KZT") return Math.round(amount * kztPerRub);
    return null;
  },
}));

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

  it("чек с ошибкой оплаты — payment_failed, даже если сумма совпадает", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Платёж не прошёл. Неверно введены данные. Сумма: 1000 KZT")),
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
    if (!result.ok) expect(result.reason).toBe("payment_failed");
  });

  it("успешный чек с фразой «в случае ошибки» — автовыдача", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        visionResponse(
          "Оплата успешно проведена. Сумма: 1000 KZT. В случае ошибки обратитесь в банк.",
        ),
      ),
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
  });

  it("чек с тенге и рублями — находит 1101.24 KZT под заказ 1100 ₸", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        visionResponse("Сумма выплаты 1101.24 KZT. Сумма операции 228 ₽. Телефон 7055113828."),
      ),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 1100,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matchedAmount).toBe(1101.24);
  });

  it("на экране только 227 ₽ — переводим заказ 1100 ₸ и принимаем", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Платёж выполнен. 227 ₽. Билайн Казахстан. 7055113828.")),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 1100,
      currency: "KZT",
      orderId: 99,
    });
    // 1100 ₸ → 209 ₽ по mid-market 5.267, 227 в допуске FX (+12%)
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matchedAmount).toBe(227);
  });

  it("Сбер «местная валюта» 1077.30 KZT на заказ 228 ₽ — принимаем (спред банка ~10%)", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        visionResponse(
          "Чек по операции. Мобильная связь. Сумма в местной валюте 1077.30 KZT. Номер 7055113828.",
        ),
      ),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 228,
      currency: "RUB",
      orderId: 99,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matchedAmount).toBe(1077.3);
  });

  it("Сбер 661.50 KZT на заказ 152 ₽ — слишком далеко от mid-market, к продавцу", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Чек по операции. Сумма в местной валюте 661.50 KZT.")),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 152,
      currency: "RUB",
      orderId: 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("amount_mismatch");
  });

  it("скрин карточки товара 2000 ₸ вместо чека на 800 ₸ — не принимаем", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        visionResponse("039. Математический тренажёр. 2000 ₸. Продолжить оплату. 0 в корзине."),
      ),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 800,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("amount_mismatch");
  });

  it("чек в другой валюте — переводим сумму заказа и сверяем", async () => {
    reuseMatch = null;
    global.fetch = vi.fn(() =>
      Promise.resolve(visionResponse("Перевод успешно выполнен. Сумма: 1000 RUB")),
    ) as unknown as typeof fetch;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const result = await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 5000,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matchedAmount).toBe(1000);
  });

  it("чек в другой валюте, сумма после курса не сошлась — amount_mismatch", async () => {
    reuseMatch = null;
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
    if (!result.ok) {
      expect(result.reason).toBe("amount_mismatch");
      expect(result.detail).toMatch(/RUB/);
    }
  });

  it("PDF идёт в files:annotate и проходит ту же сверку суммы", async () => {
    reuseMatch = null;
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            responses: [
              {
                responses: [{ fullTextAnnotation: { text: "Оплата успешно. Сумма: 1000 KZT" } }],
              },
            ],
          }),
      }),
    ) as unknown as typeof fetch;
    global.fetch = fetchMock;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const result = await verifyPaymentReceipt({
      bytes: pdfBytes,
      mime: "application/pdf",
      expectedAmount: 1000,
      currency: "KZT",
      orderId: 99,
    });
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("files:annotate");
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(body.requests[0].inputConfig.mimeType).toBe("application/pdf");
    expect(body.requests[0].pages).toEqual([1, 2, 3, 4, 5]);
  });

  it("картинка по-прежнему идёт в images:annotate", async () => {
    reuseMatch = null;
    const fetchMock = vi.fn(() =>
      Promise.resolve(visionResponse("Оплата успешно. Сумма: 1000 KZT")),
    ) as unknown as typeof fetch;
    global.fetch = fetchMock;
    const { verifyPaymentReceipt } = await import("../src/lib/receipt-verify.server");
    await verifyPaymentReceipt({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
      expectedAmount: 1000,
      currency: "KZT",
      orderId: 99,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("images:annotate");
  });
});
