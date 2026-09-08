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
  proofPathCandidates,
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

/** Подряд без файла — быстро, Vision не зовём. Потом один чек с файлом. */
const MAX_MISSING_PER_CALL = 20;

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
  // С новых к старым: уже взяли afterId, остались меньшие id.
  if (afterId > 0) q = q.lt("id", afterId);
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
    .order("id", { ascending: false })
    .limit(1);
  if (afterId > 0) q = q.lt("id", afterId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`Не удалось взять следующий чек: ${error.message}`);
  return (data as OrderProofRow | null) ?? null;
}

async function downloadProof(
  storedPath: string,
): Promise<{ ok: true; bytes: Uint8Array; usedPath: string } | { ok: false; detail: string }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const botId = process.env.BOT_ID?.trim() || null;
  const tried: string[] = [];
  let lastError = "файла нет в storage";
  for (const candidate of proofPathCandidates(storedPath, botId)) {
    tried.push(candidate);
    const downloaded = await supabaseAdmin.storage.from("payment-proofs").download(candidate);
    if (!downloaded.error && downloaded.data) {
      return {
        ok: true,
        bytes: new Uint8Array(await downloaded.data.arrayBuffer()),
        usedPath: candidate,
      };
    }
    lastError = downloaded.error?.message || lastError;
  }
  return {
    ok: false,
    detail: `В storage нет (${lastError}). Путь в заказе: ${storedPath}${tried.length > 1 ? ` · пробовали ещё ${tried.slice(1).join(", ")}` : ""}`,
  };
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

function finishScan(
  rows: ReceiptAuditRow[],
  afterId: number,
  remaining: number,
  visionConfigured: boolean,
): ReceiptAuditScanResult {
  return {
    rows,
    row: rows[rows.length - 1] ?? null,
    afterId,
    remaining,
    done: remaining === 0,
    visionConfigured,
  };
}

/**
 * С новых заказов к старым. Подряд без файла отдаём пачкой (Vision не зовём),
 * как только файл скачался — один OCR и выход: Vision до 20 с.
 * Заказы не пишем.
 */
export async function scanNextReceipt(params: {
  afterId?: number;
  seenHashes?: SeenReceiptHash[];
}): Promise<ReceiptAuditScanResult> {
  let afterId = Math.max(0, Number(params.afterId) || 0);
  const flags = await visionAndModuleFlags();
  const rows: ReceiptAuditRow[] = [];
  const { amountDueNow } = await import("./fulfillment.server");

  for (let i = 0; i < MAX_MISSING_PER_CALL; i++) {
    const order = await nextOrderWithProof(afterId);
    if (!order) {
      return finishScan(rows, afterId, 0, flags.visionConfigured);
    }

    const expectedAmount = await amountDueNow({
      total: Number(order.total) || 0,
      fulfillment_kind: order.fulfillment_kind || "digital",
    });
    const path = order.payment_proof_path;

    if (!isAuditableProofPath(path)) {
      rows.push(rowFromSkip(order, expectedAmount, "Путь к файлу не является чеком."));
      afterId = order.id;
      continue;
    }

    const downloaded = await downloadProof(path!);
    if (!downloaded.ok) {
      rows.push(rowFromSkip(order, expectedAmount, downloaded.detail));
      afterId = order.id;
      continue;
    }

    const proofHash = hashReceiptBytes(downloaded.bytes);
    const seen = (params.seenHashes ?? []).find(
      (item) => item.hash === proofHash && item.orderId !== order.id,
    );
    const { verifyPaymentReceipt } = await import("./receipt-verify.server");
    const raw = await verifyPaymentReceipt({
      bytes: downloaded.bytes,
      mime: mimeFromProofPath(downloaded.usedPath),
      expectedAmount,
      currency: order.currency || undefined,
      orderId: order.id,
    });
    rows.push(rowFromVerify(order, expectedAmount, applySessionReuse(raw, seen), proofHash));
    const remaining = await countRemaining(order.id);
    return finishScan(rows, order.id, remaining, flags.visionConfigured);
  }

  const remaining = await countRemaining(afterId);
  return finishScan(rows, afterId, remaining, flags.visionConfigured);
}
