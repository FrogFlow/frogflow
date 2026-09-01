import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type ValidateInitDataResult =
  | { ok: true; user: TelegramWebAppUser; authDate: number }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "no_user" };

function parseUser(raw: string): TelegramWebAppUser | null {
  try {
    const parsed = JSON.parse(raw) as TelegramWebAppUser;
    if (typeof parsed.id !== "number" || !Number.isFinite(parsed.id)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Проверка initData из Telegram Mini App / Web App.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
): ValidateInitDataResult {
  const trimmed = initData.trim();
  if (!trimmed) return { ok: false, reason: "missing" };

  const params = new URLSearchParams(trimmed);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "invalid" };

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : 0;
  if (!authDate || !Number.isFinite(authDate)) return { ok: false, reason: "invalid" };
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSec) return { ok: false, reason: "expired" };

  const user = parseUser(params.get("user") ?? "");
  if (!user) return { ok: false, reason: "no_user" };

  return { ok: true, user, authDate };
}
