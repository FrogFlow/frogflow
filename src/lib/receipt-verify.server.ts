import { createHash } from "node:crypto";
import { errorMessage } from "@/lib/error-message";

/**
 * Tolerance for matching receipt amount to order total.
 *
 * Асимметрично, а не одно число на оба направления (Блок A.3, кейс 2, раунд
 * 2): недоплата — это не «сумма чуть отличается из-за округления банка», это
 * деньги, которых продавец не получил, и раньше допуск в 10% позволял
 * систематически платить 90% от любого заказа и всё равно получить
 * автовыдачу. Переплата продавцу не вредит и может быть просто щедростью
 * или комиссией банка на стороне отправителя — здесь запас оставлен прежним.
 */
export const RECEIPT_UNDERPAY_TOLERANCE = 0.02;
export const RECEIPT_OVERPAY_TOLERANCE = 0.1;

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

/**
 * Слова/символы, по которым в тексте чека можно узнать валюту (Блок A.1).
 * Только реально используемые в каталоге коды (см. products/payment_methods
 * живой базы) — валюта вне этого списка не проверяется вообще, чтобы не
 * плодить ложных «не сошлось» на редких случаях.
 */
const CURRENCY_MARKERS: Record<string, string[]> = {
  KZT: ["kzt", "тенге", "тг.", "₸"],
  RUB: ["rub", "руб", "₽"],
  USD: ["usd", "$", "долл"],
  BYN: ["byn", "бел. руб", "бел.руб", "белруб"],
  KGS: ["kgs", "сом", "som"],
};

/**
 * Явный конфликт валюты: в тексте нашлись маркеры ДРУГОЙ известной валюты, а
 * маркеров ожидаемой — нет вообще. Не требуем точного совпадения: банковский
 * чек часто не пишет код валюты словами, только число, — в этом случае
 * маркеров ни одной валюты не найдётся, и мы по-прежнему доверяем сумме, как
 * раньше. Здесь блокируется только явное расхождение — чек, где прямым
 * текстом написана не та валюта, которую ждёт заказ.
 */
export function currencyConflict(text: string, expectedCurrency: string | undefined): boolean {
  if (!expectedCurrency) return false;
  const expected = expectedCurrency.toUpperCase();
  const expectedMarkers = CURRENCY_MARKERS[expected];
  if (!expectedMarkers) return false;
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (expectedMarkers.some((m) => t.includes(m))) return false;
  for (const [code, markers] of Object.entries(CURRENCY_MARKERS)) {
    if (code === expected) continue;
    if (markers.some((m) => t.includes(m))) return true;
  }
  return false;
}

export type ReceiptVerifyResult =
  | { ok: true; matchedAmount: number; extractedText: string; proofHash: string }
  | {
      ok: false;
      /**
       * not_receipt → ask user to resend; amount_mismatch / currency_mismatch /
       * receipt_reused / ocr_unavailable → manual review
       */
      reason:
        | "not_receipt"
        | "amount_mismatch"
        | "currency_mismatch"
        | "receipt_reused"
        | "ocr_unavailable";
      detail: string;
      extractedText?: string;
      matchedAmount?: number;
    };

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** SHA-256 картинки чека — для сверки на повторное использование (Блок A.4). */
export function hashReceiptBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
  opts?: { underTolerance?: number; overTolerance?: number },
): number | null {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  const under = opts?.underTolerance ?? RECEIPT_UNDERPAY_TOLERANCE;
  const over = opts?.overTolerance ?? RECEIPT_OVERPAY_TOLERANCE;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const a of amounts) {
    // Знак важен: -0.05 — недоплата на 5%, +0.05 — переплата на 5%, у них
    // разный допуск.
    const diff = (a - expected) / expected;
    if (diff < -under || diff > over) continue;
    const absDiff = Math.abs(diff);
    if (absDiff < bestDiff) {
      best = a;
      bestDiff = absDiff;
    }
  }
  return best;
}

/**
 * Тот же чек уже был принят по другому заказу этого арендатора (Блок A.4).
 *
 * supabaseAdmin здесь — клиент арендатора (SUPABASE_TENANT_KEY), а не
 * service_role: RLS сам ограничивает выборку своим bot_id, отдельно
 * фильтровать не нужно (тот же приём, что и везде в проекте).
 */
async function findReceiptReuse(
  hash: string,
  excludeOrderId: number,
): Promise<{ displayNo: number | string } | null> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, display_no, order_no")
    .eq("payment_proof_hash", hash)
    .neq("id", excludeOrderId)
    .limit(1)
    .maybeSingle();
  if (error) {
    // Проверка на повтор — дополнительная страховка, а не единственная линия
    // защиты (сумма и маркеры платежа уже сошлись). Сбой запроса не должен
    // блокировать честного покупателя — падаем обратно на «не нашли повтора».
    console.error("[receipt-verify] reuse check failed", error);
    return null;
  }
  if (!data) return null;
  return { displayNo: (data.display_no ?? data.order_no ?? data.id) as number };
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
    // OCR — необязательная оптимизация: при его сбое заказ всё равно должен
    // уйти на ручную проверку, а не удерживать диалог в обработке.
    signal: AbortSignal.timeout(15_000),
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
 * Verify a payment receipt image against expected order amount (+2%/-10%,
 * см. RECEIPT_UNDERPAY_TOLERANCE/RECEIPT_OVERPAY_TOLERANCE), against the
 * expected currency (см. currencyConflict), and against reuse on another
 * order of the same tenant (см. findReceiptReuse).
 */
export async function verifyPaymentReceipt(params: {
  bytes: Uint8Array;
  mime: string;
  expectedAmount: number;
  currency?: string;
  /** Заказ, для которого проверяется чек — исключается из проверки на повтор. */
  orderId: number;
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
  } catch (e: unknown) {
    console.error("[receipt-verify] OCR failed", e);
    return {
      ok: false,
      reason: "ocr_unavailable",
      detail: errorMessage(e) || "OCR failed",
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

  if (currencyConflict(text, params.currency)) {
    return {
      ok: false,
      reason: "currency_mismatch",
      detail: `В чеке похоже указана другая валюта, не ${params.currency}. Нужна ручная проверка.`,
      extractedText: text.slice(0, 2000),
    };
  }

  const amounts = extractMoneyAmounts(text);
  const matched = findMatchingAmount(amounts, Number(params.expectedAmount));
  if (matched == null) {
    return {
      ok: false,
      reason: "amount_mismatch",
      detail: `Сумма заказа ${params.expectedAmount}${params.currency ? ` ${params.currency}` : ""} не найдена в чеке (допуск: -2%/+10%). Найдены: ${amounts.slice(0, 8).join(", ") || "—"}.`,
      extractedText: text.slice(0, 2000),
    };
  }

  const proofHash = hashReceiptBytes(params.bytes);
  const reuse = await findReceiptReuse(proofHash, params.orderId);
  if (reuse) {
    return {
      ok: false,
      reason: "receipt_reused",
      detail: `Этот же чек уже был принят по заказу №${reuse.displayNo}.`,
      extractedText: text.slice(0, 2000),
      matchedAmount: matched,
    };
  }

  return {
    ok: true,
    matchedAmount: matched,
    extractedText: text.slice(0, 2000),
    proofHash,
  };
}
