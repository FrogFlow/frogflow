import { describe, expect, it } from "vitest";
import { receiptDownloadRequest } from "../src/lib/direct-purchase.server";

describe("receiptDownloadRequest", () => {
  it("authenticates WhatsApp media and adds the receiving account", () => {
    const request = receiptDownloadRequest(
      "https://zernio.com/api/v1/whatsapp/media/media-1",
      { platform: "whatsapp", accountId: "account-1" },
      "sk_test",
    );

    expect(request.url.searchParams.get("accountId")).toBe("account-1");
    expect(request.headers).toEqual({ Authorization: "Bearer sk_test" });
  });

  it("leaves an Instagram CDN URL unauthenticated", () => {
    const request = receiptDownloadRequest(
      "https://cdn.example/receipt.jpg?token=abc",
      { platform: "instagram", accountId: "account-1" },
      "sk_test",
    );

    expect(request.url.toString()).toBe("https://cdn.example/receipt.jpg?token=abc");
    expect(request.headers).toBeUndefined();
  });

  it("does not duplicate an accountId already present in the Zernio URL", () => {
    const request = receiptDownloadRequest(
      "https://zernio.com/api/v1/whatsapp/media/media-1?accountId=from-event",
      { platform: "whatsapp", accountId: "from-handler" },
      "sk_test",
    );

    expect(request.url.searchParams.getAll("accountId")).toEqual(["from-event"]);
  });
});
