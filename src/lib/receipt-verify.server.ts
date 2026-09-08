import { createHash } from "node:crypto";
import { errorMessage } from "@/lib/error-message";

/**
 * Tolerance for matching receipt amount to order total.
 *
 * ±30% в обе стороны: OCR и банк часто дают сумму рядом с заказом, но не
 * вплотную (комиссия, курс Сбера на пополнении связи, «Сумма в местной
 * валюте»). Скрин карточки товара (2000 ₸ на заказ 800 ₸) по-прежнему
 * не проходит — это +150%.
 */
export const RECEIPT_UNDERPAY_TOLERANCE = 0.3;
export const RECEIPT_OVERPAY_TOLERANCE = 0.3;

/**
 * Тот же ±30%, когда сумму заказа переводим в валюту чека. Mid-market
 * каталога (open.er-api) и розничный курс банка расходятся сильнее, чем
 * на пару процентов: Сбер по Beeline KZ отдаёт примерно на 10–17% меньше
 * тенге, чем mid-market. Отдельные константы оставлены, чтобы FX-сверку
 * можно было сузить независимо от той же валюты.
 */
export const RECEIPT_FX_UNDERPAY_TOLERANCE = 0.3;
export const RECEIPT_FX_OVERPAY_TOLERANCE = 0.3;

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
  const found = detectReceiptCurrency(text, expectedCurrency);
  if (!expectedCurrency || !found) return false;
  return found.toUpperCase() !== expectedCurrency.toUpperCase();
}

/**
 * Какая валюта написана в чеке. Если есть маркеры ожидаемой — берём её
 * (даже когда рядом мелькнул «руб.» в подписи банка). Иначе — первая
 * известная чужая. Нет маркеров — null, сумму сверяем как раньше, в валюте заказа.
 */
export function detectReceiptCurrency(text: string, expectedCurrency?: string): string | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  const expected = expectedCurrency?.toUpperCase();
  if (expected) {
    const expectedMarkers = CURRENCY_MARKERS[expected];
    if (expectedMarkers?.some((m) => t.includes(m))) return expected;
  }
  for (const [code, markers] of Object.entries(CURRENCY_MARKERS)) {
    if (markers.some((m) => t.includes(m))) return code;
  }
  return null;
}

export type ReceiptVerifyResult =
  | { ok: true; matchedAmount: number; extractedText: string; proofHash: string }
  | {
      ok: false;
      /**
       * not_receipt / payment_failed → ask user to resend a successful receipt;
       * amount_mismatch / currency_mismatch / receipt_reused / ocr_unavailable
       * → manual review (не выдаём материалы сами)
       */
      reason:
        | "not_receipt"
        | "payment_failed"
        | "amount_mismatch"
        | "currency_mismatch"
        | "receipt_reused"
        | "ocr_unavailable";
      detail: string;
      extractedText?: string;
      matchedAmount?: number;
    };

/**
 * Покупатель прислал скрин, где банк прямо пишет, что перевод не прошёл.
 * Такие чеки раньше могли пройти автовыдачу: сумма на экране ошибки часто
 * совпадает с суммой заказа, маркеры «платёж»/«оплат» тоже на месте.
 *
 * Только устойчивые фразы, не голое «ошибка»: на успешном чеке банк часто
 * пишет «в случае ошибки обратитесь в поддержку», и это не отказ.
 */
const PAYMENT_FAILED_PHRASES = [
  "платеж не прошел",
  "оплата не прошла",
  "перевод не выполнен",
  "перевод не прошел",
  "перевод отклонен",
  "операция отклонена",
  "операция отменена",
  "операция не выполнена",
  "платеж отклонен",
  "платеж отменен",
  "оплата отклонена",
  "оплата отменена",
  "недостаточно средств",
  "неверно введен",
  "данные введены неверно",
  "ошибка оплаты",
  "ошибка платежа",
  "ошибка перевода",
  "статус: ошибка",
  "статус ошибка",
  "платеж не осуществлен",
  "оплата не выполнена",
  "транзакция отклонена",
  "транзакция не прошла",
  "payment failed",
  "payment declined",
  "transaction failed",
  "transaction declined",
  "insufficient funds",
];

export function looksLikeFailedPayment(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  return PAYMENT_FAILED_PHRASES.some((phrase) => t.includes(phrase));
}

/** Чек просим прислать заново, а не кладём продавцу в очередь на выдачу. */
export function isReceiptRetryReason(
  reason: Extract<ReceiptVerifyResult, { ok: false }>["reason"],
): boolean {
  return reason === "not_receipt" || reason === "payment_failed";
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function isPdfReceipt(mime: string, bytes?: Uint8Array): boolean {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return true;
  if (!bytes || bytes.length < 4) return false;
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF";
}

/**
 * Онлайн files:annotate принимает JSON до 10 МБ, base64 раздувает файл
 * примерно на 37%. Банковский PDF обычно десятки–сотни КБ; если вдруг
 * прилетел огромный документ — лучше ручная проверка, чем оборванный запрос.
 */
const MAX_PDF_BYTES_FOR_VISION = 7 * 1024 * 1024;

/** Синхронный files:annotate читает не больше 5 страниц. Чек почти всегда на 1-й. */
const PDF_OCR_PAGES = [1, 2, 3, 4, 5];

/** SHA-256 картинки чека — для сверки на повторное использование (Блок A.4). */
export function hashReceiptBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const AMOUNT_TOKEN = String.raw`\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d+`;
const AMOUNT_DEC = String.raw`(?:[.,]\d{1,2})?`;

/** Хвост валюты у суммы. `rub` — латиница на чеке («1000 RUB»); без неё 1000 считался «голой» цифрой. */
const CURRENCY_AMOUNT_TAIL: Record<string, string> = {
  KZT: String.raw`(?:kzt|₸|тенге|тг\.?)`,
  RUB: String.raw`(?:₽|руб(?:\.|лей|ля)?|rub)`,
  USD: String.raw`(?:usd|\$|долл)`,
  BYN: String.raw`(?:byn|бел\.?\s*руб)`,
  KGS: String.raw`(?:kgs|сом|som)`,
};
const CURRENCY_TAIL = `(?:${Object.values(CURRENCY_AMOUNT_TAIL).join("|")})`;

function parseAmountToken(raw: string): number | null {
  const normalized = raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

function addAmount(into: Set<number>, raw: string) {
  const n = parseAmountToken(raw);
  if (n != null) into.add(n);
}

function isInsideLongDigitRun(text: string, index: number, length: number): boolean {
  let start = index;
  while (start > 0 && /\d/.test(text[start - 1]!)) start -= 1;
  let end = index + length;
  while (end < text.length && /\d/.test(text[end]!)) end += 1;
  return end - start >= 8;
}

/**
 * Суммы из OCR. Сбер/ВТБ пишут «227 ₽», «1077.30 KZT», «Сумма операции 228 ₽».
 * Телефон (7055113828) и дату (08.09.2026) в деньги не берём — из-за них
 * раньше «находились» 7055113 и 8.09, а крупная сумма с ₽ терялась в шуме.
 */
export function extractMoneyAmounts(text: string): number[] {
  const amounts = new Set<number>();

  const amount = `(?:${AMOUNT_TOKEN})${AMOUNT_DEC}`;
  const tagged = new RegExp(`(${amount})\\s*${CURRENCY_TAIL}`, "gi");
  for (const m of text.matchAll(tagged)) addAmount(amounts, m[1] ?? "");

  const labeled = new RegExp(
    `(?:сумма(?:\\s+(?:операции|выплаты|перевода|платежа|в\\s+местной\\s+валюте))?|итого)\\s*[:\\-]?\\s*(${amount})`,
    "gi",
  );
  for (const m of text.matchAll(labeled)) addAmount(amounts, m[1] ?? "");

  const general = new RegExp(`${amount}|\\d{2,7}`, "g");
  const dates = new Set<string>();
  for (const m of text.matchAll(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/g)) {
    if (m[0]) dates.add(m[0]);
  }
  for (const m of text.matchAll(general)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    if (dates.has(raw) || [...dates].some((d) => d.includes(raw) && /[./]/.test(d))) continue;
    if (isInsideLongDigitRun(text, idx, raw.length)) continue;
    const n = parseAmountToken(raw);
    if (n == null) continue;
    // 1900 и 2000 — обычные цены (Kaspi «1 900 ₸»). Год из «06.09.2026»
    // уже отсечён выше как фрагмент даты; не выкидываем всю тысячу 1900–2099.
    amounts.add(n);
  }
  return [...amounts];
}

/**
 * Текст, который уже лежит в PDF (Kaspi фискальный чек — вектор, не скан).
 * Vision files:annotate на длинном узком бланке часто читает только низ
 * (РНМ/ФП) и не видит «1 900 ₸» сверху.
 */
export async function extractEmbeddedPdfText(bytes: Uint8Array): Promise<string> {
  if (!isPdfReceipt("application/pdf", bytes)) return "";
  try {
    const { extractText } = await import("unpdf");
    const { text } = await extractText(bytes, { mergePages: true });
    return text.trim();
  } catch {
    return "";
  }
}

/** Суммы, у которых в чеке явно написана валюта — «228 ₽», «1101.24 KZT». */
export function extractTaggedCurrencyAmounts(text: string): Record<string, number[]> {
  const amount = `(?:${AMOUNT_TOKEN})${AMOUNT_DEC}`;
  const out: Record<string, number[]> = {};
  for (const [code, tail] of Object.entries(CURRENCY_AMOUNT_TAIL)) {
    const re = new RegExp(`(${amount})\\s*${tail}`, "gi");
    const found = new Set<number>();
    for (const m of text.matchAll(re)) addAmount(found, m[1] ?? "");
    if (found.size) out[code] = [...found];
  }
  return out;
}

/**
 * Для сверки в валюте заказа не берём цифры, которые в чеке подписаны другой
 * валютой: 1000 RUB при заказе 1000 ₸ — это не совпадение.
 */
export function amountsForCurrency(text: string, currency?: string): number[] {
  const all = extractMoneyAmounts(text);
  if (!currency) return all;
  const tagged = extractTaggedCurrencyAmounts(text);
  const own = new Set(tagged[currency] ?? []);
  const foreign = new Set(
    Object.entries(tagged)
      .filter(([code]) => code !== currency)
      .flatMap(([, nums]) => nums),
  );
  return all.filter((n) => own.has(n) || !foreign.has(n));
}

/** Все известные валюты, которые явно есть в тексте чека. */
export function detectAllReceiptCurrencies(text: string): string[] {
  const t = text.toLowerCase().replace(/ё/g, "е");
  return Object.entries(CURRENCY_MARKERS)
    .filter(([, markers]) => markers.some((m) => t.includes(m)))
    .map(([code]) => code);
}

/**
 * Скрин нашего же сообщения «Заказ создан / сумма к оплате / пришлите чек»
 * или карточки товара. OCR находит ту же сумму, что в заказе, и без этой
 * проверки выдаёт файлы за скриншот инструкции.
 *
 * Если в том же кадре есть признаки уже прошедшего платежа (фискальный чек,
 * «сумма операции») — не режем: покупатель мог сфотографировать чат вместе
 * с настоящим чеком.
 */
const SHOP_SCREEN_PHRASES = [
  "сумма к оплате",
  "к оплате:",
  "amount due",
  "төлеуге тиіс сома",
  "төлемге:",
  "to‘lash summasi",
  "to'lash summasi",
  "tolash summasi",
  "пришлите скриншот",
  "пришлите чек",
  "в этот чат",
  "send the receipt",
  "send a screenshot",
  "in this chat",
  "чекті осы чатқа жіберіңіз",
  "скриншотты осы чатқа жіберіңіз",
  "chekni shu chatga yuboring",
  "skrinshotni shu chatga yuboring",
  "выберите способ оплаты",
  "оплатить через robokassa",
  "оплатить по реквизитам",
  "продолжить оплату",
  "в корзине",
  "добавить в корзину",
];

const RECEIPT_DONE_PHRASES = [
  "оплата совершена",
  "платеж выполнен",
  "успешно проведен",
  "успешно проведена",
  "перевод выполнен",
  "перевод успешно",
  "зачисл",
  "фискальн",
  "сумма операции",
  "сумма выплаты",
  "сумма в местной валюте",
  "чек по операции",
  "рнм",
  "комиссия за",
  "payment successful",
  "paid successfully",
  "operation completed",
  "операция выполнена",
];

const ORDER_CREATED_RE =
  /(?:заказ|тапсырыс|buyurtma|order)\s*#\s*\d+[\s\S]{0,120}(?:создан|жасалды|yaratildi|created)/;

function normalizeReceiptText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function looksLikeShopScreenNotReceipt(text: string): boolean {
  const t = normalizeReceiptText(text);
  if (RECEIPT_DONE_PHRASES.some((p) => t.includes(p))) return false;
  if (SHOP_SCREEN_PHRASES.some((p) => t.includes(p))) return true;
  return ORDER_CREATED_RE.test(t);
}

export function looksLikeReceipt(text: string): boolean {
  if (looksLikeShopScreenNotReceipt(text)) return false;
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

type VisionPageAnnotation = {
  error?: { message?: string };
  fullTextAnnotation?: { text?: string };
  textAnnotations?: Array<{ description?: string }>;
};

function textFromVisionPage(page: VisionPageAnnotation | undefined): string {
  const full = page?.fullTextAnnotation?.text?.trim();
  if (full) return full;
  return page?.textAnnotations?.[0]?.description?.trim() || "";
}

async function ocrImageWithGoogleVision(bytes: Uint8Array, apiKey: string): Promise<string> {
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
    responses?: VisionPageAnnotation[];
  };
  const { recordReceiptOcrCall } = await import("./ai-usage.server");
  await recordReceiptOcrCall();

  if (!res.ok) {
    throw new Error(json.error?.message || `Vision HTTP ${res.status}`);
  }

  const first = json.responses?.[0];
  if (first?.error?.message) {
    throw new Error(first.error.message);
  }

  return textFromVisionPage(first);
}

/**
 * PDF нельзя отдать в images:annotate — там только картинки. Для файлов
 * Vision даёт files:annotate (до 5 страниц синхронно, без GCS). Банковский
 * чек из РФ/РБ часто именно PDF, не скрин.
 */
async function ocrPdfWithGoogleVision(bytes: Uint8Array, apiKey: string): Promise<string> {
  if (bytes.length > MAX_PDF_BYTES_FOR_VISION) {
    throw new Error("PDF слишком большой для онлайн-OCR Vision");
  }

  const url = `https://vision.googleapis.com/v1/files:annotate?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      requests: [
        {
          inputConfig: {
            content: bytesToBase64(bytes),
            mimeType: "application/pdf",
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages: PDF_OCR_PAGES,
        },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    responses?: Array<{
      error?: { message?: string };
      responses?: VisionPageAnnotation[];
    }>;
  };
  const { recordReceiptOcrCall } = await import("./ai-usage.server");
  await recordReceiptOcrCall();

  if (!res.ok) {
    throw new Error(json.error?.message || `Vision HTTP ${res.status}`);
  }

  const file = json.responses?.[0];
  if (file?.error?.message) {
    throw new Error(file.error.message);
  }

  const parts: string[] = [];
  for (const page of file?.responses ?? []) {
    if (page?.error?.message) continue;
    const text = textFromVisionPage(page);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

async function ocrWithGoogleVision(bytes: Uint8Array, mime: string): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_VISION_API_KEY not set");
  }

  if (isPdfReceipt(mime, bytes)) {
    return ocrPdfWithGoogleVision(bytes, apiKey);
  }
  return ocrImageWithGoogleVision(bytes, apiKey);
}

async function readReceiptText(bytes: Uint8Array, mime: string): Promise<string> {
  if (isPdfReceipt(mime, bytes)) {
    const embedded = await extractEmbeddedPdfText(bytes);
    if (looksLikeReceipt(embedded) && extractMoneyAmounts(embedded).length >= 1) {
      return embedded;
    }
  }
  if (!process.env.GOOGLE_VISION_API_KEY?.trim()) {
    throw new Error(
      "GOOGLE_VISION_API_KEY не задан — автовыдача отключена, нужна ручная проверка.",
    );
  }
  return ocrWithGoogleVision(bytes, mime);
}

/**
 * Verify a payment receipt (фото или PDF) against expected order amount
 * (±30%, см. RECEIPT_UNDERPAY_TOLERANCE/RECEIPT_OVERPAY_TOLERANCE),
 * against the expected currency (см. detectReceiptCurrency): чужая валюта
 * в чеке — не отказ, а перевод суммы заказа тем же convertAmount, что каталог,
 * и сверка уже в валюте чека.
 * on another order of the same tenant (см. findReceiptReuse).
 *
 * Картинки — images:annotate. PDF — files:annotate (до 5 страниц). Дальше
 * тот же разбор текста: маркеры платежа, отказ, валюта, сумма, повтор.
 */
export async function verifyPaymentReceipt(params: {
  bytes: Uint8Array;
  mime: string;
  expectedAmount: number;
  currency?: string;
  /** Заказ, для которого проверяется чек — исключается из проверки на повтор. */
  orderId: number;
}): Promise<ReceiptVerifyResult> {
  let text: string;
  try {
    text = await readReceiptText(params.bytes, params.mime || "image/jpeg");
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
      detail: "В файле почти нет текста.",
      extractedText: text,
    };
  }

  if (looksLikeShopScreenNotReceipt(text)) {
    return {
      ok: false,
      reason: "not_receipt",
      detail:
        "Это скрин заказа, счёта к оплате или карточки товара — не чек банка. Сумма в тексте бота не считается оплатой.",
      extractedText: text.slice(0, 2000),
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

  if (looksLikeFailedPayment(text)) {
    return {
      ok: false,
      reason: "payment_failed",
      detail:
        "В тексте чека указано, что платёж не прошёл (ошибка, отказ, неверные данные). Автовыдачи нет.",
      extractedText: text.slice(0, 2000),
    };
  }

  const amounts = extractMoneyAmounts(text);
  const orderCurrency = params.currency?.trim().toUpperCase() || undefined;
  const orderExpected = Number(params.expectedAmount);
  const currenciesToTry = [
    ...new Set(
      [orderCurrency, ...detectAllReceiptCurrencies(text)].filter((c): c is string => Boolean(c)),
    ),
  ];

  let matched: number | null = null;
  let comparedAs = orderCurrency;
  let lastExpected = orderExpected;
  let usedFx = false;
  let convertFailed = false;

  for (const ccy of currenciesToTry.length ? currenciesToTry : [undefined]) {
    let expected = orderExpected;
    let matchOpts: { underTolerance?: number; overTolerance?: number } | undefined;
    if (ccy && orderCurrency && ccy !== orderCurrency) {
      const { convertAmount } = await import("./currency.server");
      const converted = await convertAmount(orderExpected, orderCurrency, ccy);
      if (converted == null) {
        convertFailed = true;
        continue;
      }
      expected = converted;
      matchOpts = {
        underTolerance: RECEIPT_FX_UNDERPAY_TOLERANCE,
        overTolerance: RECEIPT_FX_OVERPAY_TOLERANCE,
      };
    }
    const hit = findMatchingAmount(amountsForCurrency(text, ccy), expected, matchOpts);
    if (hit != null) {
      matched = hit;
      comparedAs = ccy;
      lastExpected = expected;
      usedFx = Boolean(matchOpts);
      break;
    }
    lastExpected = expected;
    usedFx = Boolean(matchOpts);
    comparedAs = ccy;
  }

  if (matched == null && convertFailed && amounts.length === 0) {
    return {
      ok: false,
      reason: "currency_mismatch",
      detail: `В чеке другая валюта, заказ ${orderCurrency} — курс перевести не удалось. Нужна ручная проверка.`,
      extractedText: text.slice(0, 2000),
    };
  }

  if (matched == null) {
    const fxNote =
      usedFx && comparedAs && orderCurrency && comparedAs !== orderCurrency
        ? `заказ ${orderExpected} ${orderCurrency} ≈ ${lastExpected} ${comparedAs} по курсу каталога`
        : `Сумма заказа ${orderExpected}${orderCurrency ? ` ${orderCurrency}` : ""}`;
    return {
      ok: false,
      reason: "amount_mismatch",
      detail: `${fxNote} не найдена в чеке (допуск: ${
        usedFx
          ? `-${RECEIPT_FX_UNDERPAY_TOLERANCE * 100}%/+${RECEIPT_FX_OVERPAY_TOLERANCE * 100}%`
          : `-${RECEIPT_UNDERPAY_TOLERANCE * 100}%/+${RECEIPT_OVERPAY_TOLERANCE * 100}%`
      }). Найдены: ${amounts.slice(0, 8).join(", ") || "—"}.`,
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
