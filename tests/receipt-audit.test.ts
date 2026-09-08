import { describe, expect, it } from "vitest";
import {
  classifyActualHandling,
  compareReceiptAudit,
  isAuditableProofPath,
  mimeFromProofPath,
  OCR_REASON_LABEL,
  ocrWouldFromVerify,
  proofPathCandidates,
  summarizeAuditRows,
  auditOrderCaption,
  type ReceiptAuditRow,
} from "../src/lib/receipt-audit";

describe("proofPathCandidates", () => {
  it("путь как есть, плюс префикс bot_id если его ещё нет", () => {
    expect(proofPathCandidates("order-16/1.jpg", "aaa-bbb")).toEqual([
      "order-16/1.jpg",
      "aaa-bbb/order-16/1.jpg",
    ]);
  });

  it("уже с префиксом — не дублируем", () => {
    expect(proofPathCandidates("aaa-bbb/order-16/1.jpg", "aaa-bbb")).toEqual([
      "aaa-bbb/order-16/1.jpg",
    ]);
  });
});

describe("auditOrderCaption", () => {
  it("когда номера разные — пишем оба, как в админке #868 vs проверка №871", () => {
    expect(auditOrderCaption(871, 868)).toBe("№871 · в админке #868");
  });

  it("одинаковые или без админского — только один номер", () => {
    expect(auditOrderCaption(868, 868)).toBe("№868");
    expect(auditOrderCaption(868, null)).toBe("№868");
  });
});

describe("isAuditableProofPath", () => {
  it("пустой и robokassa — не чек", () => {
    expect(isAuditableProofPath(null)).toBe(false);
    expect(isAuditableProofPath("")).toBe(false);
    expect(isAuditableProofPath("robokassa")).toBe(false);
    expect(isAuditableProofPath("robokassa:inv")).toBe(false);
  });

  it("путь в storage — да", () => {
    expect(isAuditableProofPath("bot/order-1/1.jpg")).toBe(true);
  });
});

describe("mimeFromProofPath", () => {
  it("по расширению", () => {
    expect(mimeFromProofPath("a.pdf")).toBe("application/pdf");
    expect(mimeFromProofPath("a.PNG")).toBe("image/png");
    expect(mimeFromProofPath("a.jpg")).toBe("image/jpeg");
  });
});

describe("classifyActualHandling", () => {
  it("хеш или OCR ok — автовыдача", () => {
    expect(
      classifyActualHandling({
        status: "delivered",
        payment_proof_hash: "abc",
        admin_note: null,
      }),
    ).toBe("auto_accepted");
    expect(
      classifyActualHandling({
        status: "accepted",
        payment_proof_hash: null,
        admin_note: "proof_auto; OCR ok amount=1000",
      }),
    ).toBe("auto_accepted");
  });

  it("выдан без следа OCR — руками", () => {
    expect(
      classifyActualHandling({
        status: "delivered",
        payment_proof_hash: null,
        admin_note: null,
      }),
    ).toBe("manual_accepted");
  });

  it("очереди", () => {
    expect(classifyActualHandling({ status: "awaiting_confirmation" })).toBe("awaiting_review");
    expect(classifyActualHandling({ status: "awaiting_payment" })).toBe("awaiting_retry");
    expect(classifyActualHandling({ status: "rejected" })).toBe("cancelled");
  });
});

describe("ocrWouldFromVerify", () => {
  it("ok / отказ / ручная / нет файла", () => {
    expect(ocrWouldFromVerify({ ok: true })).toBe("accept");
    expect(ocrWouldFromVerify({ ok: false, reason: "payment_failed" })).toBe("reject");
    expect(ocrWouldFromVerify({ ok: false, reason: "not_receipt" })).toBe("reject");
    expect(ocrWouldFromVerify({ ok: false, reason: "amount_mismatch" })).toBe("review");
    expect(ocrWouldFromVerify({ ok: false, reason: "ocr_unavailable" })).toBe("review");
    expect(ocrWouldFromVerify({ ok: false, reason: "skip" })).toBe("skip");
  });
});

describe("compareReceiptAudit — сверка с базой", () => {
  it("выдан автопроверкой + OCR принял бы — сошлось", () => {
    const r = compareReceiptAudit({
      actual: "auto_accepted",
      ocrWould: "accept",
      reasonLabel: OCR_REASON_LABEL.ok,
      verifyDetail: "сумма 1000",
      actualStatus: "delivered",
    });
    expect(r.agree).toBe(true);
    expect(r.severity).toBe("ok");
  });

  it("выдан руками + OCR принял бы — если бы включили, ушёл бы сам", () => {
    const r = compareReceiptAudit({
      actual: "manual_accepted",
      ocrWould: "accept",
      reasonLabel: OCR_REASON_LABEL.ok,
      verifyDetail: "сумма 1000",
      actualStatus: "delivered",
    });
    expect(r.agree).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.title).toMatch(/руками/i);
  });

  it("ждёт продавца + OCR принял бы — расхождение", () => {
    const r = compareReceiptAudit({
      actual: "awaiting_review",
      ocrWould: "accept",
      reasonLabel: OCR_REASON_LABEL.ok,
      verifyDetail: "сумма 1000",
      actualStatus: "awaiting_confirmation",
    });
    expect(r.agree).toBe(false);
    expect(r.severity).toBe("info");
  });

  it("мы выдали, OCR отклонил бы неуспешный платёж — опасно", () => {
    const r = compareReceiptAudit({
      actual: "auto_accepted",
      ocrWould: "reject",
      reasonLabel: OCR_REASON_LABEL.payment_failed,
      verifyDetail: "платёж не прошёл",
      actualStatus: "delivered",
    });
    expect(r.agree).toBe(false);
    expect(r.severity).toBe("danger");
    expect(r.detail).toMatch(/не прошёл|другой чек/i);
  });

  it("просили переслать + OCR отклонил бы — сошлось", () => {
    const r = compareReceiptAudit({
      actual: "awaiting_retry",
      ocrWould: "reject",
      reasonLabel: OCR_REASON_LABEL.not_receipt,
      verifyDetail: "не похоже на чек",
      actualStatus: "awaiting_payment",
    });
    expect(r.agree).toBe(true);
    expect(r.severity).toBe("ok");
  });

  it("автовыдача + OCR на ручную — предупреждение", () => {
    const r = compareReceiptAudit({
      actual: "auto_accepted",
      ocrWould: "review",
      reasonLabel: OCR_REASON_LABEL.amount_mismatch,
      verifyDetail: "сумма не найдена",
      actualStatus: "delivered",
    });
    expect(r.agree).toBe(false);
    expect(r.severity).toBe("warn");
  });

  it("ручная выдача + OCR на ручную — сошлось по сути", () => {
    const r = compareReceiptAudit({
      actual: "manual_accepted",
      ocrWould: "review",
      reasonLabel: OCR_REASON_LABEL.amount_mismatch,
      verifyDetail: "сумма не найдена",
      actualStatus: "delivered",
    });
    expect(r.agree).toBe(true);
    expect(r.severity).toBe("ok");
  });

  it("очередь + OCR на ручную — сошлось", () => {
    const r = compareReceiptAudit({
      actual: "awaiting_review",
      ocrWould: "review",
      reasonLabel: OCR_REASON_LABEL.currency_mismatch,
      verifyDetail: "другая валюта",
      actualStatus: "awaiting_confirmation",
    });
    expect(r.agree).toBe(true);
    expect(r.severity).toBe("ok");
  });
});

describe("summarizeAuditRows", () => {
  it("считает severity", () => {
    const row = (severity: ReceiptAuditRow["comparison"]["severity"]): ReceiptAuditRow => ({
      orderId: 1,
      displayNo: 1,
      status: "delivered",
      createdAt: null,
      expectedAmount: 100,
      currency: "KZT",
      proofPath: "x.jpg",
      proofHash: null,
      matchedAmount: 100,
      ocrReason: "ok",
      extractedPreview: null,
      comparison: {
        actual: "manual_accepted",
        ocrWould: "accept",
        severity,
        agree: severity === "ok",
        title: "",
        detail: "",
      },
    });
    const s = summarizeAuditRows([row("ok"), row("danger"), row("danger"), row("info")]);
    expect(s.total).toBe(4);
    expect(s.ok).toBe(1);
    expect(s.info).toBe(1);
    expect(s.danger).toBe(2);
    expect(s.ocrAccept).toBe(4);
    expect(s.wouldHaveAuto).toBe(4);
    expect(s.agree).toBe(1);
  });
});
