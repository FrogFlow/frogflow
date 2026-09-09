import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  instagramFilesButtonTitle,
  mintOrderFilesToken,
  parseOrderFilesToken,
  renderOrderFilesPageHtml,
} from "../src/lib/order-files-page";

const SECRET = "test-order-files-secret";

describe("order files page token", () => {
  it("round-trips a valid token", () => {
    const token = mintOrderFilesToken(42, SECRET, 1_700_000_000_000);
    expect(parseOrderFilesToken(token, SECRET, 1_700_000_000_000)).toEqual({
      ok: true,
      orderId: 42,
    });
  });

  it("rejects a tampered order id", () => {
    const token = mintOrderFilesToken(42, SECRET, 1_700_000_000_000);
    const [orderId, exp, sig] = token.split("-");
    expect(orderId).toBe("42");
    expect(parseOrderFilesToken(`43-${exp}-${sig}`, SECRET, 1_700_000_000_000)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an expired token", () => {
    const token = mintOrderFilesToken(42, SECRET, 1_700_000_000_000, 7);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    expect(parseOrderFilesToken(token, SECRET, 1_700_000_000_000 + weekMs + 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a token signed with another secret", () => {
    const token = mintOrderFilesToken(42, SECRET, 1_700_000_000_000);
    expect(parseOrderFilesToken(token, "other-secret", 1_700_000_000_000)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("order files page html", () => {
  it("lists download links and does not auto-open files", () => {
    const html = renderOrderFilesPageHtml({
      shopName: "Учителя",
      orderNo: 911,
      files: [
        { name: "4 класс математика.pdf", url: "https://cdn.example/a.pdf" },
        { name: "прописи.zip", url: "https://cdn.example/b.zip" },
      ],
      linkDays: 7,
    });
    expect(html).toContain("4 класс математика.pdf");
    expect(html).toContain("https://cdn.example/a.pdf");
    expect(html).toContain("прописи.zip");
    expect(html).not.toContain("http-equiv");
    expect(html).not.toMatch(/window\.location|meta http-equiv="refresh"/i);
    expect(html).toContain("не открываются сами");
  });

  it("keeps Instagram button titles within Meta's 20-character limit", () => {
    expect(instagramFilesButtonTitle(1).length).toBeLessThanOrEqual(20);
    expect(instagramFilesButtonTitle(2).length).toBeLessThanOrEqual(20);
    expect(instagramFilesButtonTitle(1)).toBe("Получить файл");
    expect(instagramFilesButtonTitle(3)).toBe("Получить файлы");
  });
});

describe("Instagram delivery uses the files page button", () => {
  it("sends a URL button instead of attaching a document", () => {
    const source = readFileSync(resolve("src/lib/orders.server.ts"), "utf8");
    expect(source).toContain("orderFilesPageUrl");
    expect(source).toContain('type: "url"');
    expect(source).toContain("instagramFilesButtonTitle");
    expect(source).not.toMatch(/attachmentType:\s*"file"[\s\S]{0,80}platform:\s*"instagram"/);
  });
});
