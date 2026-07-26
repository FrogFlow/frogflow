/** Tolerance for matching receipt amount to order total (10%). */
export const RECEIPT_AMOUNT_TOLERANCE = 0.1;

const RECEIPT_MARKERS = [
  "оплат",
  "перевод",
  "kaspi",
  "сбер",
  "тиньк",
  "tinkoff",
  "halyk",
  "карт",
  "тенге",
  "сумма",
  "kzt",
  "rub",
  "byn",
  "usd",
  "чек",
  "платеж",
  "платёж",
  "успешн",
  "зачисл",
  "получ",
  "отправил",
  "payment",
  "transfer",
  "receipt",
  "paid",
  "visa",
  "mastercard",
  "мир",
];

export type ReceiptVerifyResult =
  | { ok: true; matchedAmount: number; extractedText: string }
  | {
      ok: false;
      /** not_receipt → ask user to resend; amount_mismatch / ocr_unavailable → manual review */
      reason: "not_receipt" | "amount_mismatch" | "ocr_unavailable";
      detail: string;
      extractedText?: string;
      matchedAmount?: number;
    };

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Extract money-like numbers from OCR text (supports 1 234,56 / 1234.56). */
export function extractMoneyAmounts(text: string): number[] {
  const amounts = new Set<number>();
  // Match clusters like 1 234,56 or 1234.56 or 1500
  const re = /\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d{2,7}/g;
  const matches = text.match(re) || [];
  for (const raw of matches) {
    const normalized = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
    const n = Number(normalized);
    if (!Number.isFinite(n) || n <= 0) continue;
    // Skip likely dates / years / order ids noise: keep plausible money range
    if (n < 1 || n > 10_000_000) continue;
    amounts.add(Math.round(n * 100) / 100);
  }
  return [...amounts];
}

export function looksLikeReceipt(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (t.replace(/\s+/g, "").length < 12) return false;
  const markerHits = RECEIPT_MARKERS.filter((m) => t.includes(m)).length;
  const amounts = extractMoneyAmounts(text);
  // At least one payment marker and one money-like number
  return markerHits >= 1 && amounts.length >= 1;
}

export function findMatchingAmount(
  amounts: number[],
  expected: number,
  tolerance = RECEIPT_AMOUNT_TOLERANCE,
): number | null {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const a of amounts) {
    const diff = Math.abs(a - expected) / expected;
    if (diff <= tolerance && diff < bestDiff) {
      best = a;
      bestDiff = diff;
    }
  }
  return best;
}

async function ocrWithGoogleVision(bytes: Uint8Array, mime: string): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_VISION_API_KEY not set");
  }

  // Vision images:annotate expects image content; PDFs often fail here → caller handles.
  if (mime.includes("pdf") || mime === "application/pdf") {
    throw new Error("PDF OCR via images API not supported; send to manual review");
  }

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: bytesToBase64(bytes) },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    responses?: Array<{
      error?: { message?: string };
      fullTextAnnotation?: { text?: string };
      textAnnotations?: Array<{ description?: string }>;
    }>;
  };

  if (!res.ok) {
    throw new Error(json.error?.message || `Vision HTTP ${res.status}`);
  }

  const first = json.responses?.[0];
  if (first?.error?.message) {
    throw new Error(first.error.message);
  }

  const full = first?.fullTextAnnotation?.text?.trim();
  if (full) return full;
  const firstAnn = first?.textAnnotations?.[0]?.description?.trim();
  return firstAnn || "";
}

/**
 * Verify a payment receipt image against expected order amount (±10%).
 */
export async function verifyPaymentReceipt(params: {
  bytes: Uint8Array;
  mime: string;
  expectedAmount: number;
  currency?: string;
}): Promise<ReceiptVerifyResult> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "ocr_unavailable",
      detail: "GOOGLE_VISION_API_KEY не задан — автовыдача отключена, нужна ручная проверка.",
    };
  }

  let text: string;
  try {
    text = await ocrWithGoogleVision(params.bytes, params.mime || "image/jpeg");
  } catch (e: any) {
    console.error("[receipt-verify] OCR failed", e);
    return {
      ok: false,
      reason: "ocr_unavailable",
      detail: e?.message || "OCR failed",
    };
  }

  if (!text || text.trim().length < 8) {
    return {
      ok: false,
      reason: "not_receipt",
      detail: "На изображении почти нет текста.",
      extractedText: text,
    };
  }

  if (!looksLikeReceipt(text)) {
    return {
      ok: false,
      reason: "not_receipt",
      detail: "Текст не похож на чек оплаты (нет маркеров платежа).",
      extractedText: text.slice(0, 2000),
    };
  }

  const amounts = extractMoneyAmounts(text);
  const matched = findMatchingAmount(amounts, Number(params.expectedAmount));
  if (matched == null) {
    return {
      ok: false,
      reason: "amount_mismatch",
      detail: `Сумма заказа ${params.expectedAmount}${params.currency ? ` ${params.currency}` : ""} не найдена в чеке (±10%). Найдены: ${amounts.slice(0, 8).join(", ") || "—"}.`,
      extractedText: text.slice(0, 2000),
    };
  }

  return {
    ok: true,
    matchedAmount: matched,
    extractedText: text.slice(0, 2000),
  };
}
