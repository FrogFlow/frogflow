/**
 * Сверка «что сейчас в заказе» vs «что сказал бы OCR».
 *
 * Только чтение: прогон в панели оператора не меняет статусы и не выдаёт
 * материалы. Сюда вынесены чистые правила, чтобы тесты не ходили в Vision.
 * Импорта из *.server нет — вкладка оператора живёт в браузере.
 */

export type OcrFailReason =
  | "not_receipt"
  | "payment_failed"
  | "amount_mismatch"
  | "currency_mismatch"
  | "receipt_reused"
  | "ocr_unavailable"
  | "skip";

export const FULFILLED_ORDER_STATUSES = new Set([
  "delivered",
  "delivering",
  "accepted",
  "in_production",
  "ready",
]);

export const CANCELLED_ORDER_STATUSES = new Set(["rejected", "cancelled", "refunded"]);

export type ActualHandling =
  | "auto_accepted"
  | "manual_accepted"
  | "awaiting_review"
  | "awaiting_retry"
  | "cancelled"
  | "other";

export type OcrWould = "accept" | "reject" | "review" | "skip";

export type AuditSeverity = "ok" | "info" | "warn" | "danger" | "skip";

export type ReceiptAuditComparison = {
  actual: ActualHandling;
  ocrWould: OcrWould;
  severity: AuditSeverity;
  /** Сошлось с тем, как заказ уже обработан. */
  agree: boolean;
  title: string;
  detail: string;
};

export const ACTUAL_HANDLING_LABEL: Record<ActualHandling, string> = {
  auto_accepted: "выдан автопроверкой",
  manual_accepted: "выдан руками",
  awaiting_review: "ждёт продавца",
  awaiting_retry: "просили другой чек",
  cancelled: "отклонён",
  other: "другой статус",
};

export const OCR_WOULD_LABEL: Record<OcrWould, string> = {
  accept: "принял бы",
  reject: "отклонил бы",
  review: "отправил бы продавцу",
  skip: "файл не прочитан",
};

export const OCR_REASON_LABEL: Record<OcrFailReason | "ok", string> = {
  ok: "сумма и текст чека сошлись",
  not_receipt: "не похоже на чек оплаты",
  payment_failed: "в тексте банк пишет, что платёж не прошёл",
  amount_mismatch: "сумма заказа в чеке не найдена",
  currency_mismatch: "в чеке другая валюта",
  receipt_reused: "этот же файл уже принимали по другому заказу",
  ocr_unavailable: "Vision не ответил или нет ключа",
  skip: "файл не прочитан",
};

export function isAuditableProofPath(path: string | null | undefined): boolean {
  const p = (path ?? "").trim();
  if (!p) return false;
  if (p === "robokassa" || p.startsWith("robokassa")) return false;
  return true;
}

/**
 * Куда ходить в storage: как записано, и с префиксом bot_id, если путь ещё
 * старый (order-16/... или ig_…/...), а файл уже лежит в папке арендатора.
 */
export function proofPathCandidates(path: string, botId?: string | null): string[] {
  const p = path.trim().replace(/^\/+/, "");
  if (!p) return [];
  const out = [p];
  const id = botId?.trim();
  if (id && !p.toLowerCase().startsWith(`${id.toLowerCase()}/`)) {
    out.push(`${id}/${p}`);
  }
  return out;
}

export function mimeFromProofPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

function noteHasOcrOk(note: string, proofHash: string | null | undefined): boolean {
  if (proofHash && proofHash.trim()) return true;
  return /OCR ok/i.test(note);
}

export function classifyActualHandling(order: {
  status: string;
  admin_note?: string | null;
  payment_proof_hash?: string | null;
}): ActualHandling {
  const status = String(order.status || "");
  const note = String(order.admin_note || "");
  if (CANCELLED_ORDER_STATUSES.has(status)) return "cancelled";
  if (FULFILLED_ORDER_STATUSES.has(status)) {
    return noteHasOcrOk(note, order.payment_proof_hash) ? "auto_accepted" : "manual_accepted";
  }
  if (status === "awaiting_confirmation") return "awaiting_review";
  if (status === "awaiting_payment") return "awaiting_retry";
  return "other";
}

export function ocrWouldFromVerify(result: { ok: boolean; reason?: OcrFailReason }): OcrWould {
  if (result.ok) return "accept";
  if (result.reason === "skip") return "skip";
  if (result.reason === "not_receipt" || result.reason === "payment_failed") return "reject";
  return "review";
}

function ocrWhy(ocrWould: OcrWould, reasonLabel: string, verifyDetail: string): string {
  const why = verifyDetail.trim() || reasonLabel;
  if (ocrWould === "accept") {
    return `OCR принял бы чек: ${why}.`;
  }
  if (ocrWould === "reject") {
    return `OCR отклонил бы и попросил другой чек: ${why}.`;
  }
  if (ocrWould === "skip") {
    return `OCR не смог прочитать файл: ${why}.`;
  }
  return `OCR не стал бы выдавать сам и отправил бы продавцу: ${why}.`;
}

/**
 * Сверка с базой: что уже сделали vs что было бы, если бы текущие правила
 * OCR работали в момент приёмки чека.
 */
export function compareReceiptAudit(params: {
  actual: ActualHandling;
  ocrWould: OcrWould;
  reasonLabel: string;
  verifyDetail: string;
  actualStatus: string;
}): ReceiptAuditComparison {
  const { actual, ocrWould, reasonLabel, verifyDetail, actualStatus } = params;
  const why = ocrWhy(ocrWould, reasonLabel, verifyDetail);
  const actualLabel = ACTUAL_HANDLING_LABEL[actual];

  if (ocrWould === "skip") {
    return {
      actual,
      ocrWould,
      severity: "skip",
      agree: false,
      title: "Файл не прочитан",
      detail: `${why} В базе статус «${actualStatus}» (${actualLabel}). Сверки нет.`,
    };
  }

  if (ocrWould === "accept") {
    if (actual === "auto_accepted") {
      return {
        actual,
        ocrWould,
        severity: "ok",
        agree: true,
        title: "Сошлось: выдан, OCR тоже принял бы",
        detail: `В базе заказ уже выдан автопроверкой. ${why}`,
      };
    }
    if (actual === "manual_accepted") {
      return {
        actual,
        ocrWould,
        severity: "info",
        agree: true,
        title: "Выдан руками — OCR выдал бы сам",
        detail: `Продавец подтвердила заказ вручную. Если бы автопроверка была включена, материалы ушли бы без неё. ${why}`,
      };
    }
    if (actual === "awaiting_review" || actual === "awaiting_retry" || actual === "other") {
      return {
        actual,
        ocrWould,
        severity: "info",
        agree: false,
        title: "Расхождение: OCR принял бы, в базе ещё не выдан",
        detail: `Сейчас «${actualStatus}» (${actualLabel}). Если бы автопроверка работала, заказ ушёл бы сам. ${why}`,
      };
    }
    return {
      actual,
      ocrWould,
      severity: "info",
      agree: false,
      title: "OCR принял бы, в базе заказ отклонён",
      detail: `Сейчас «${actualStatus}». ${why}`,
    };
  }

  if (ocrWould === "reject") {
    if (actual === "auto_accepted" || actual === "manual_accepted") {
      return {
        actual,
        ocrWould,
        severity: "danger",
        agree: false,
        title: "Расхождение: мы выдали, OCR отклонил бы",
        detail: `В базе заказ уже выдан (${actualLabel}). По текущим правилам покупателя попросили бы прислать другой чек, автовыдачи не было бы. ${why}`,
      };
    }
    if (actual === "awaiting_retry") {
      return {
        actual,
        ocrWould,
        severity: "ok",
        agree: true,
        title: "Сошлось: просили другой чек",
        detail: `В базе тоже ждали новый файл. ${why}`,
      };
    }
    if (actual === "cancelled") {
      return {
        actual,
        ocrWould,
        severity: "ok",
        agree: true,
        title: "Сошлось: заказ отклонён, OCR тоже не принял бы",
        detail: why,
      };
    }
    return {
      actual,
      ocrWould,
      severity: "info",
      agree: false,
      title: "В очереди у продавца, OCR отклонил бы",
      detail: `Сейчас «${actualStatus}» (${actualLabel}). OCR не положил бы это продавцу, а попросил бы другой чек. ${why}`,
    };
  }

  // review
  if (actual === "awaiting_review") {
    return {
      actual,
      ocrWould,
      severity: "ok",
      agree: true,
      title: "Сошлось: и так, и так ручная проверка",
      detail: `Заказ уже у продавца. ${why}`,
    };
  }
  if (actual === "manual_accepted") {
    return {
      actual,
      ocrWould,
      severity: "ok",
      agree: true,
      title: "Сошлось по сути: продавец смотрела сама",
      detail: `Выдан руками — OCR тоже не стал бы выдавать автоматически. ${why}`,
    };
  }
  if (actual === "auto_accepted") {
    return {
      actual,
      ocrWould,
      severity: "warn",
      agree: false,
      title: "Расхождение: выдан автоматически, OCR не уверен",
      detail: `В базе автовыдача. По текущим правилам заказ ушёл бы продавцу, не покупателю. ${why}`,
    };
  }
  if (actual === "cancelled") {
    return {
      actual,
      ocrWould,
      severity: "info",
      agree: false,
      title: "В базе отклонён, OCR отправил бы продавцу",
      detail: why,
    };
  }
  return {
    actual,
    ocrWould,
    severity: "info",
    agree: false,
    title: "OCR отправил бы продавцу",
    detail: `Сейчас «${actualStatus}» (${actualLabel}). ${why}`,
  };
}

/** Админка показывает order_no, проверка чеков — display_no. Когда они разные, пишем оба. */
export function auditOrderCaption(
  displayNo: number | string,
  adminNo?: number | string | null,
): string {
  if (adminNo != null && String(adminNo) !== "" && String(adminNo) !== String(displayNo)) {
    return `№${displayNo} · в админке #${adminNo}`;
  }
  return `№${displayNo}`;
}

export type ReceiptAuditRow = {
  orderId: number;
  displayNo: number | string;
  /** То, что продавец видит в админке (#order_no). */
  adminNo?: number | string | null;
  status: string;
  createdAt: string | null;
  expectedAmount: number;
  currency: string | null;
  proofPath: string;
  proofHash: string | null;
  matchedAmount: number | null;
  ocrReason: string;
  extractedPreview: string | null;
  comparison: ReceiptAuditComparison;
};

export type ReceiptAuditInventory = {
  withFile: number;
  estimatedUsd: number;
  visionConfigured: boolean;
  moduleEnabled: boolean;
  autoEnabled: boolean;
};

export type ReceiptAuditScanResult = {
  /** Несколько строк, если подряд нет файла — не тратим раунд на каждый. */
  rows: ReceiptAuditRow[];
  /** Совместимость со старой панелью: последняя строка пачки. */
  row: ReceiptAuditRow | null;
  afterId: number;
  remaining: number;
  done: boolean;
  visionConfigured: boolean;
};

/** Хеши уже прогнанных в этой сессии файлов — ловим повтор, которого ещё нет в базе. */
export type SeenReceiptHash = { hash: string; orderId: number; displayNo: number | string };

export function summarizeAuditRows(rows: ReceiptAuditRow[]) {
  const summary = {
    total: rows.length,
    ok: 0,
    info: 0,
    warn: 0,
    danger: 0,
    skip: 0,
    ocrAccept: 0,
    ocrReject: 0,
    ocrReview: 0,
    agree: 0,
    wouldHaveAuto: 0,
  };
  for (const row of rows) {
    summary[row.comparison.severity] += 1;
    if (row.comparison.ocrWould === "accept") summary.ocrAccept += 1;
    if (row.comparison.ocrWould === "reject") summary.ocrReject += 1;
    if (row.comparison.ocrWould === "review") summary.ocrReview += 1;
    if (row.comparison.agree) summary.agree += 1;
    if (row.comparison.ocrWould === "accept" && row.comparison.actual !== "auto_accepted") {
      summary.wouldHaveAuto += 1;
    }
  }
  return summary;
}
