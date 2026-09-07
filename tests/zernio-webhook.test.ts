import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyZernioWebhookSignature } from "../src/routes/api/public/zernio/webhook";
import {
  describeZernioSalesWebhookFit,
  describeZernioWebhookFit,
  isClientStoreZernioWorkspace,
  isOtherStoreWebhook,
} from "../src/lib/zernio.server";

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

describe("describeZernioWebhookFit", () => {
  const expected = "https://aatech-pi.vercel.app/api/public/zernio/webhook";

  it("missing when there is no store webhook at all", () => {
    expect(describeZernioWebhookFit([], expected)).toEqual({ fit: "missing" });
  });

  it("stale when the record points at another host", () => {
    const current = {
      name: "Store Webhook",
      url: "https://old.example/api/public/zernio/webhook",
      events: ["message.received"],
      isActive: true,
    };
    expect(describeZernioWebhookFit([current], expected)).toEqual({ fit: "stale", current });
  });

  it("stale when the record is inactive or no longer listens for DMs", () => {
    const inactive = {
      name: "Store Webhook",
      url: expected,
      events: ["message.received"],
      isActive: false,
    };
    expect(describeZernioWebhookFit([inactive], expected).fit).toBe("stale");

    const noDm = {
      name: "Instagram Store Webhook",
      url: expected,
      events: ["account.disconnected"],
      isActive: true,
    };
    expect(describeZernioWebhookFit([noDm], expected).fit).toBe("stale");
  });

  it("ok when this deployment is already registered for incoming DMs", () => {
    const current = {
      name: "Store Webhook",
      url: expected,
      events: ["message.received", "account.disconnected"],
      isActive: true,
    };
    expect(describeZernioWebhookFit([current], expected)).toEqual({ fit: "ok", current });
  });
});

describe("isOtherStoreWebhook", () => {
  const expected = "https://aatech-pi.vercel.app/api/public/zernio/webhook";

  it("detects another FrogFlow deploy holding the shared Zernio webhook", () => {
    expect(
      isOtherStoreWebhook("https://test-con.vercel.app/api/public/zernio/webhook", expected),
    ).toBe(true);
  });

  it("does not treat this deploy or a non-store URL as foreign", () => {
    expect(isOtherStoreWebhook(expected, expected)).toBe(false);
    expect(isOtherStoreWebhook("https://hooks.zernio.io/custom", expected)).toBe(false);
    expect(isOtherStoreWebhook(undefined, expected)).toBe(false);
  });
});

describe("sales webhook vs client store workspace", () => {
  const salesUrl = "https://panel.example/api/operator/zernio-webhook";

  it("recognizes a client store workspace by public webhook path", () => {
    expect(
      isClientStoreZernioWorkspace([
        { name: "Store Webhook", url: "https://aatech-pi.vercel.app/api/public/zernio/webhook" },
      ]),
    ).toBe(true);
    expect(isClientStoreZernioWorkspace([{ name: "FrogFlow Sales Webhook", url: salesUrl }])).toBe(
      false,
    );
  });

  it("sales fit is ok only for the operator URL listening to DMs", () => {
    const current = {
      name: "FrogFlow Sales Webhook",
      url: salesUrl,
      events: ["message.received"],
      isActive: true,
    };
    expect(describeZernioSalesWebhookFit([current], salesUrl)).toEqual({ fit: "ok", current });
    expect(describeZernioSalesWebhookFit([], salesUrl).fit).toBe("missing");
  });
});
