import { randomUUID } from "node:crypto";
import type { Json } from "@/integrations-supabase/types";
import { logger } from "./logger.server";
import { claimBotUserState } from "./bot-user-claim.server";
import type { ReceiptVerifyResult } from "./receipt-verify.server";

const MAX_PROOF_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

export type PaymentProofFile = {
  bytes: Uint8Array;
  mime: string;
  filename: string;
};

export type PaymentProofOutcome =
  | {
      ok: true;
      outcome: "proof_retry" | "proof_review" | "completed" | "accepted";
      orderId: number;
      displayNo: number;
      reason?: string;
    }
  | {
      ok: false;
      error:
        | "invalid_file"
        | "file_too_large"
        | "order_not_found"
        | "order_already_processed"
        | "proof_in_progress"
        | "storage_failed";
    };

type ProofState = Record<string, unknown> & {
  mode?: string;
  pending_order_id?: number;
  pending_display_no?: number;
  proof_auto?: boolean;
};

function normalizedMime(value: string): string {
  return value.split(";")[0].trim().toLowerCase();
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

function hasMagicBytes(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === "image/webp") {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (mime === "application/pdf") {
    return String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
  }
  if (mime === "image/heic") {
    const brand = String.fromCharCode(...bytes.slice(4, 12)).toLowerCase();
    return brand.includes("ftyp");
  }
  return false;
}

export function validatePaymentProofFile(
  file: PaymentProofFile,
):
  | { ok: true; mime: string; ext: string }
  | { ok: false; error: "invalid_file" | "file_too_large" } {
  if (!file.bytes.length) return { ok: false, error: "invalid_file" };
  if (file.bytes.length > MAX_PROOF_BYTES) {
    return { ok: false, error: "file_too_large" };
  }
  const mime = normalizedMime(file.mime);
  if (!ALLOWED_MIME.has(mime) || !hasMagicBytes(file.bytes, mime)) {
    return { ok: false, error: "invalid_file" };
  }
  return { ok: true, mime, ext: extensionForMime(mime) };
}

async function setProofState(telegramId: number, state: ProofState): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  await supabaseAdmin
    .from("bot_users")
    .update({ state: state as Json })
    .eq("telegram_id", telegramId);
}

function idleState(state: ProofState): ProofState {
  const next = { ...state, mode: "idle", proof_auto: false };
  delete next.pending_order_id;
  delete next.pending_display_no;
  return next;
}

async function saveProof(
  orderId: number,
  file: PaymentProofFile,
  mime: string,
  ext: string,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.some((bucket) => bucket.name === "payment-proofs")) {
      await supabaseAdmin.storage.createBucket("payment-proofs", {
        public: false,
        fileSizeLimit: MAX_PROOF_BYTES,
      });
    }
  } catch (error) {
    logger.warn("payment_proof.bucket_check_failed", { err: error, order_id: orderId });
  }

  const botId = process.env.BOT_ID?.trim();
  if (!botId) return null;
  const path = `${botId}/order-${orderId}/${Date.now()}-${randomUUID()}.${ext}`;
  const body = new Blob([file.bytes as BlobPart], { type: mime });
  const { error } = await supabaseAdmin.storage.from("payment-proofs").upload(path, body, {
    contentType: mime,
    upsert: false,
  });
  if (error) {
    logger.error("payment_proof.storage_failed", {
      err: error,
      order_id: orderId,
    });
    return null;
  }
  return path;
}

export async function processMiniAppPaymentProof(params: {
  telegramId: number;
  orderId?: number;
  file: PaymentProofFile;
}): Promise<PaymentProofOutcome> {
  const validation = validatePaymentProofFile(params.file);
  if (!validation.ok) return validation;

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: user } = await supabaseAdmin
    .from("bot_users")
    .select("state")
    .eq("telegram_id", params.telegramId)
    .maybeSingle();
  const currentState =
    user?.state && typeof user.state === "object" && !Array.isArray(user.state)
      ? (user.state as ProofState)
      : {};
  const orderId = Number(params.orderId ?? currentState.pending_order_id);
  if (!orderId) return { ok: false, error: "order_not_found" };

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_no, display_no, status, admin_note, telegram_id, total, currency, fulfillment_kind, payment_proof_hash, paid_amount",
    )
    .eq("id", orderId)
    .eq("telegram_id", params.telegramId)
    .maybeSingle();
  if (!order) return { ok: false, error: "order_not_found" };
  if (order.status !== "awaiting_payment" && order.status !== "awaiting_confirmation") {
    return { ok: false, error: "order_already_processed" };
  }

  const claimedState = await claimBotUserState<ProofState>({
    db: supabaseAdmin,
    column: "telegram_id",
    value: params.telegramId,
    isClaimable: (state) =>
      state.mode !== "processing_proof" && Number(state.pending_order_id ?? orderId) === orderId,
    claim: (state) => ({
      ...state,
      mode: "processing_proof",
      pending_order_id: orderId,
    }),
  });
  if (!claimedState) return { ok: false, error: "proof_in_progress" };

  const displayNo = order.display_no ?? order.order_no ?? orderId;
  const proofPath = await saveProof(orderId, params.file, validation.mime, validation.ext);
  if (!proofPath) {
    await setProofState(params.telegramId, claimedState);
    return { ok: false, error: "storage_failed" };
  }

  const note = String(order.admin_note || "");
  const autoDeliver =
    claimedState.proof_auto === true || note === "proof_auto" || note.startsWith("proof_auto");

  if (!autoDeliver) {
    await supabaseAdmin
      .from("orders")
      .update({
        payment_proof_path: proofPath,
        status: "awaiting_confirmation",
      })
      .eq("id", orderId)
      .in("status", ["awaiting_payment", "awaiting_confirmation"]);
    await setProofState(params.telegramId, idleState(claimedState));
    const { notifyAdminNewOrder } = await import("./bot.server");
    await notifyAdminNewOrder(orderId, null, null);
    return { ok: true, outcome: "proof_review", orderId, displayNo };
  }

  const { amountDueNow } = await import("./fulfillment.server");
  const expectedAmount = await amountDueNow({
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const { hasModule } = await import("./modules/modules.server");
  const { verifyPaymentReceipt } = await import("./receipt-verify.server");
  const verify: ReceiptVerifyResult = (await hasModule("receipt_ocr"))
    ? await verifyPaymentReceipt({
        bytes: params.file.bytes,
        mime: validation.mime,
        expectedAmount,
        currency: order.currency || undefined,
        orderId,
      })
    : {
        ok: false,
        reason: "ocr_unavailable",
        detail: "модуль receipt_ocr не подключён",
      };

  if (!verify.ok && verify.reason === "not_receipt") {
    await supabaseAdmin
      .from("orders")
      .update({
        payment_proof_path: proofPath,
        status: "awaiting_payment",
        admin_note: note.startsWith("proof_auto") ? note : "proof_auto",
      })
      .eq("id", orderId);
    await setProofState(params.telegramId, {
      ...claimedState,
      mode: "awaiting_proof",
      pending_order_id: orderId,
      pending_display_no: displayNo,
      proof_auto: true,
    });
    return {
      ok: true,
      outcome: "proof_retry",
      orderId,
      displayNo,
      reason: verify.reason,
    };
  }

  if (!verify.ok) {
    await supabaseAdmin
      .from("orders")
      .update({
        payment_proof_path: proofPath,
        status: "awaiting_confirmation",
        admin_note: `proof_auto; OCR: ${verify.detail}`.slice(0, 500),
      })
      .eq("id", orderId);
    await setProofState(params.telegramId, idleState(claimedState));
    const { notifyAdminNewOrder } = await import("./bot.server");
    await notifyAdminNewOrder(orderId, null, null, {
      reviewReason: verify.detail,
    });
    return {
      ok: true,
      outcome: "proof_review",
      orderId,
      displayNo,
      reason: verify.reason,
    };
  }

  await supabaseAdmin
    .from("orders")
    .update({
      status: "awaiting_payment",
      admin_note: `proof_auto; OCR ok amount=${verify.matchedAmount}`,
      payment_proof_hash: verify.proofHash,
      payment_proof_path: proofPath,
    })
    .eq("id", orderId);

  try {
    if (order.fulfillment_kind === "physical") {
      const { acceptOrder, recordPayment, remainingDueNow } = await import("./fulfillment.server");
      const accepted = await acceptOrder(orderId);
      const due = remainingDueNow(expectedAmount, order.paid_amount);
      if (!accepted.alreadyAccepted && due > 0) {
        const paid = await recordPayment(orderId, due).catch((e) => {
          logger.error("payment_proof.record_payment_failed", { err: e, order_id: orderId });
          return false;
        });
        if (!paid) {
          logger.error("payment_proof.record_payment_returned_false", { order_id: orderId });
        }
      }
    } else {
      const { deliverOrder } = await import("./orders.server");
      await deliverOrder(orderId);
    }
  } catch (error) {
    logger.error("payment_proof.auto_fulfillment_failed", {
      err: error,
      order_id: orderId,
    });
    await supabaseAdmin
      .from("orders")
      .update({ status: "awaiting_confirmation" })
      .eq("id", orderId);
    await setProofState(params.telegramId, idleState(claimedState));
    const { notifyAdminNewOrder } = await import("./bot.server");
    await notifyAdminNewOrder(orderId, null, null, {
      reviewReason: "Ошибка выдачи после успешного OCR",
    });
    return {
      ok: true,
      outcome: "proof_review",
      orderId,
      displayNo,
      reason: "delivery_failed",
    };
  }

  await setProofState(params.telegramId, idleState(claimedState));
  const { notifyAdminNewOrder } = await import("./bot.server");
  await notifyAdminNewOrder(orderId, null, null, { autoDelivered: true });
  return {
    ok: true,
    outcome: order.fulfillment_kind === "physical" ? "accepted" : "completed",
    orderId,
    displayNo,
  };
}

export const PAYMENT_PROOF_MAX_BYTES = MAX_PROOF_BYTES;
