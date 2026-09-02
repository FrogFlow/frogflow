import { describe, expect, it } from "vitest";
import { linkifyPaymentInstructions } from "../src/lib/mini-app-text";

describe("payment instruction links", () => {
  it("turns Kaspi Pay and https URLs into clickable anchors", () => {
    const html = linkifyPaymentInstructions(
      "Оплатите через Kaspi Pay:\nhttps://pay.kaspi.kz/pay/abc123\nили www.kaspi.kz/pay/xyz",
    );
    expect(html).toContain('href="https://pay.kaspi.kz/pay/abc123"');
    expect(html).toContain('data-external="1"');
    expect(html).toContain('href="https://www.kaspi.kz/pay/xyz"');
    expect(html).toContain("Оплатите через Kaspi Pay:");
  });

  it("escapes unrelated HTML and keeps trailing punctuation outside the URL", () => {
    const html = linkifyPaymentInstructions("Ссылка: https://pay.kaspi.kz/pay/abc). <script>");
    expect(html).toContain('href="https://pay.kaspi.kz/pay/abc"');
    expect(html).toContain(").");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
