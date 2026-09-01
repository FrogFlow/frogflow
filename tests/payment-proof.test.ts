import { describe, expect, it } from "vitest";
import { validatePaymentProofFile } from "../src/lib/payment-proof.server";

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function pdfBytes(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
}

describe("payment proof validation", () => {
  it("accepts jpeg/png/pdf with matching magic bytes", () => {
    expect(
      validatePaymentProofFile({
        bytes: jpegBytes(),
        mime: "image/jpeg",
        filename: "receipt.jpg",
      }),
    ).toEqual({ ok: true, mime: "image/jpeg", ext: "jpg" });
    expect(
      validatePaymentProofFile({
        bytes: pngBytes(),
        mime: "image/png",
        filename: "receipt.png",
      }).ok,
    ).toBe(true);
    expect(
      validatePaymentProofFile({
        bytes: pdfBytes(),
        mime: "application/pdf",
        filename: "receipt.pdf",
      }).ok,
    ).toBe(true);
  });

  it("rejects empty files, spoofed mime types and oversized payloads", () => {
    expect(
      validatePaymentProofFile({
        bytes: new Uint8Array(),
        mime: "image/jpeg",
        filename: "empty.jpg",
      }),
    ).toEqual({ ok: false, error: "invalid_file" });
    expect(
      validatePaymentProofFile({
        bytes: jpegBytes(),
        mime: "application/pdf",
        filename: "fake.pdf",
      }),
    ).toEqual({ ok: false, error: "invalid_file" });
    expect(
      validatePaymentProofFile({
        bytes: new Uint8Array(20 * 1024 * 1024 + 1).fill(1),
        mime: "image/jpeg",
        filename: "huge.jpg",
      }),
    ).toEqual({ ok: false, error: "file_too_large" });
  });
});
