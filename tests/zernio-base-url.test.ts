import { afterEach, describe, expect, it, vi } from "vitest";
import { getZernioConnectUrl, normalizeZernioBaseUrl } from "../src/lib/zernio.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeZernioBaseUrl", () => {
  it("uses the official API URL when unset", () => {
    expect(normalizeZernioBaseUrl()).toBe("https://zernio.com/api/v1");
  });

  it("repairs the common host-only Vercel configuration", () => {
    expect(normalizeZernioBaseUrl("https://zernio.com")).toBe("https://zernio.com/api/v1");
    expect(normalizeZernioBaseUrl("https://zernio.com/")).toBe("https://zernio.com/api/v1");
  });

  it("preserves explicit API and proxy base URLs", () => {
    expect(normalizeZernioBaseUrl("https://zernio.com/api/v1/")).toBe("https://zernio.com/api/v1");
    expect(normalizeZernioBaseUrl("https://proxy.example.com/zernio/")).toBe(
      "https://proxy.example.com/zernio",
    );
  });

  it("calls the JSON API even when Vercel contains only the Zernio host", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "sk_test");
    vi.stubEnv("ZERNIO_BASE_URL", "https://zernio.com");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authUrl: "https://facebook.example/oauth" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getZernioConnectUrl("whatsapp", "profile-1", "https://shop.example/admin/whatsapp"),
    ).resolves.toEqual({ authUrl: "https://facebook.example/oauth" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://zernio.com/api/v1/connect/whatsapp?profileId=profile-1&redirect_url=https%3A%2F%2Fshop.example%2Fadmin%2Fwhatsapp",
      expect.any(Object),
    );
  });

  it("reports a useful configuration error for an HTML response", async () => {
    vi.stubEnv("ZERNIO_API_KEY", "sk_test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!DOCTYPE html><title>Zernio</title>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    await expect(getZernioConnectUrl("whatsapp", "profile-1")).rejects.toThrow(
      "Проверьте ZERNIO_BASE_URL",
    );
  });
});
