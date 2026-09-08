/**
 * Прогон чеков на деплое клиента: скачать файл из storage, спросить Vision,
 * сравнить с тем, что уже стоит в заказе. Заказы не обновляем.
 */
import {
  classifyActualHandling,
  compareReceiptAudit,
  isAuditableProofPath,
  mimeFromProofPath,
  OCR_REASON_LABEL,
  ocrWouldFromVerify,
  type OcrFailReason,
  type ReceiptAuditInventory,
  type ReceiptAuditRow,
  type ReceiptAuditScanResult,
  type SeenReceiptHash,
} from "./receipt-audit";
import { receiptOcrUsd } from "./ai-usage";
import { hashReceiptBytes, type ReceiptVerifyResult } from "./receipt-verify.server";

type OrderProofRow = {
  id: number;
  display_no: number | null;
  order_no: number | null;
  status: string;
  total: number | string | null;
  currency: string | null;
  fulfillment_kind: string | null;
  payment_proof_path: string | null;
  payment_proof_hash: string | null;
  admin_note: string | null;
  created_at: string | null;
};

const ORDER_COLS =
  "id, display_no, order_no, status, total, currency, fulfillment_kind, payment_proof_path, payment_proof_hash, admin_note, created_at";

function displayNoOf(order: OrderProofRow): number | string {
  return order.display_no ?? order.order_no ?? order.id;
}

async function visionAndModuleFlags() {
  const { hasModule } = await import("./modules/modules.server");
  const { isReceiptOcrAutoEnabled } = await import("./receipt-ocr-auto.server");
  return {
    visionConfigured: Boolean(process.env.GOOGLE_VISION_API_KEY?.trim()),
    moduleEnabled: await hasModule("receipt_ocr"),
    autoEnabled: await isReceiptOcrAutoEnabled(),
  };
}

export async function loadReceiptAuditInventory(): Promise<ReceiptAuditInventory> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .not("payment_proof_path", "is", null)
    .neq("payment_proof_path", "")
    .neq("payment_proof_path", "robokassa");
  if (error) throw new Error(`Не удалось посчитать чеки: ${error.message}`);
  const flags = await visionAndModuleFlags();
  const withFile = count ?? 0;
  return {
    withFile,
    estimatedUsd: receiptOcrUsd(withFile),
    ...flags,
  };
}

async function countRemaining(afterId: number): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  let q = supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .not("payment_proof_path", "is", null)
    .neq("payment_proof_path", "")
    .neq("payment_proof_path", "robokassa");
  if (afterId > 0) q = q.gt("id", afterId);
  const { count, error } = await q;
  if (error) throw new Error(`Не удалось посчитать оставшиеся чеки: ${error.message}`);
  return count ?? 0;
}

async function nextOrderWithProof(afterId: number): Promise<OrderProofRow | null> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  let q = supabaseAdmin
    .from("orders")
    .select(ORDER_COLS)
    .not("payment_proof_path", "is", null)
    .neq("payment_proof_path", "")
    .neq("payment_proof_path", "robokassa")
    .order("id", { ascending: true })
    .limit(1);
  if (afterId > 0) q = q.gt("id", afterId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`Не удалось взять следующий чек: ${error.message}`);
  return (data as OrderProofRow | null) ?? null;
}

function rowFromSkip(
  order: OrderProofRow,
  expectedAmount: number,
  detail: string,
): ReceiptAuditRow {
  const actual = classifyActualHandling(order);
  const comparison = compareReceiptAudit({
    actual,
    ocrWould: "skip",
    reasonLabel: OCR_REASON_LABEL.skip,
    verifyDetail: detail,
    actualStatus: order.status,
  });
  return {
    orderId: order.id,
    displayNo: displayNoOf(order),
    status: order.status,
    createdAt: order.created_at,
    expectedAmount,
    currency: order.currency,
    proofPath: order.payment_proof_path || "",
    proofHash: null,
    matchedAmount: null,
    ocrReason: "skip",
    extractedPreview: null,
    comparison,
  };
}

function rowFromVerify(
  order: OrderProofRow,
  expectedAmount: number,
  result: ReceiptVerifyResult,
  proofHash: string | null,
): ReceiptAuditRow {
  const actual = classifyActualHandling(order);
  const ocrWould = ocrWouldFromVerify(result);
  const reason: OcrFailReason | "ok" = result.ok ? "ok" : result.reason;
  const comparison = compareReceiptAudit({
    actual,
    ocrWould,
    reasonLabel: OCR_REASON_LABEL[reason],
    verifyDetail: result.ok
      ? `${OCR_REASON_LABEL.ok} (${result.matchedAmount}${order.currency ? ` ${order.currency}` : ""})`
      : result.detail,
    actualStatus: order.status,
  });
  return {
    orderId: order.id,
    displayNo: displayNoOf(order),
    status: order.status,
    createdAt: order.created_at,
    expectedAmount,
    currency: order.currency,
    proofPath: order.payment_proof_path || "",
    proofHash,
    matchedAmount: result.ok ? result.matchedAmount : (result.matchedAmount ?? null),
    ocrReason: reason,
    extractedPreview: result.extractedText ? result.extractedText.slice(0, 400) : null,
    comparison,
  };
}

function applySessionReuse(
  result: ReceiptVerifyResult,
  seen: SeenReceiptHash | undefined,
): ReceiptVerifyResult {
  if (!seen || !result.ok) return result;
  return {
    ok: false,
    reason: "receipt_reused",
    detail: `Этот же файл уже встретился в этом прогоне на заказе №${seen.displayNo}. В базе хеша могло ещё не быть — тогда живая автопроверка повтор не поймала бы.`,
    extractedText: result.extractedText,
    matchedAmount: result.matchedAmount,
  };
}

/**
 * Один заказ за вызов: Vision до 20 с, панель ждёт синхронно.
 * Заказы, статусы и хеши не пишем.
 */
export async function scanNextReceipt(params: {
  afterId?: number;
  seenHashes?: SeenReceiptHash[];
}): Promise<ReceiptAuditScanResult> {
  const afterId = Math.max(0, Number(params.afterId) || 0);
  const flags = await visionAndModuleFlags();
  const order = await nextOrderWithProof(afterId);
  if (!order) {
    return {
      row: null,
      afterId,
      remaining: 0,
      done: true,
      visionConfigured: flags.visionConfigured,
    };
  }

  const { amountDueNow } = await import("./fulfillment.server");
  const expectedAmount = await amountDueNow({
    total: Number(order.total) || 0,
    fulfillment_kind: order.fulfillment_kind || "digital",
  });

  const path = order.payment_proof_path;
  if (!isAuditableProofPath(path)) {
    const remaining = await countRemaining(order.id);
    return {
      row: rowFromSkip(order, expectedAmount, "Путь к файлу не является чеком."),
      afterId: order.id,
      remaining,
      done: remaining === 0,
      visionConfigured: flags.visionConfigured,
    };
  }

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const downloaded = await supabaseAdmin.storage.from("payment-proofs").download(path!);
  if (downloaded.error || !downloaded.data) {
    const remaining = await countRemaining(order.id);
    return {
      row: rowFromSkip(
        order,
        expectedAmount,
        downloaded.error?.message || "Файла нет в storage — OCR смотреть нечего.",
      ),
      afterId: order.id,
      remaining,
      done: remaining === 0,
      visionConfigured: flags.visionConfigured,
    };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const proofHash = hashReceiptBytes(bytes);
  const seen = (params.seenHashes ?? []).find(
    (item) => item.hash === proofHash && item.orderId !== order.id,
  );

  const { verifyPaymentReceipt } = await import("./receipt-verify.server");
  const raw = await verifyPaymentReceipt({
    bytes,
    mime: mimeFromProofPath(path!),
    expectedAmount,
    currency: order.currency || undefined,
    orderId: order.id,
  });
  const result = applySessionReuse(raw, seen);
  const remaining = await countRemaining(order.id);
  return {
    row: rowFromVerify(order, expectedAmount, result, proofHash),
    afterId: order.id,
    remaining,
    done: remaining === 0,
    visionConfigured: flags.visionConfigured,
  };
}
