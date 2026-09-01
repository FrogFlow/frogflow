import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "../src/lib/telegram-init-data.server";

function buildInitData(botToken: string, user: Record<string, unknown>, authDate?: number) {
  const date = authDate ?? Math.floor(Date.now() / 1000);
  const params = new URLSearchParams();
  params.set("auth_date", String(date));
  params.set("user", JSON.stringify(user));

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("validateTelegramInitData", () => {
  const botToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

  it("принимает корректный initData", () => {
    const initData = buildInitData(botToken, {
      id: 42,
      first_name: "Test",
      username: "tester",
    });
    const result = validateTelegramInitData(initData, botToken);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(42);
      expect(result.user.first_name).toBe("Test");
    }
  });

  it("отклоняет подпись с другим токеном", () => {
    const initData = buildInitData(botToken, { id: 1 });
    const result = validateTelegramInitData(initData, "other-token");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("отклоняет просроченный auth_date", () => {
    const old = Math.floor(Date.now() / 1000) - 90000;
    const initData = buildInitData(botToken, { id: 1 }, old);
    const result = validateTelegramInitData(initData, botToken, 3600);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });
});
