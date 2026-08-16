import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyZernioWebhookSignature } from "../src/routes/api/public/zernio/webhook";

describe("verifyZernioWebhookSignature", () => {
  const body = JSON.stringify({ id: "event-1", event: "message.received" });
  const secret = "unit-test-secret";
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  it("accepts an HMAC-SHA256 signature for the untouched raw body", () => {
    expect(verifyZernioWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects missing credentials, altered bodies and altered signatures", () => {
    expect(verifyZernioWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyZernioWebhookSignature(body, signature, undefined)).toBe(false);
    expect(verifyZernioWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyZernioWebhookSignature(body, `${signature.slice(0, -1)}0`, secret)).toBe(false);
  });
});
