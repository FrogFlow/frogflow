/** Shared Telegram webhook / admin-id helpers (server-only). */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Сравнение без утечки по времени — через хеши одинаковой длины. Все
 * остальные секреты в проекте (админский вход, internal_secret) уже
 * сравниваются так; вебхуки Telegram раньше были единственным исключением
 * (Блок 1.5).
 */
export function timingSafeSecretEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyTelegramWebhookSecret(request: Request, envNames: string[]): boolean {
  const expected = envNames.map((n) => process.env[n]).find((v) => v && v.length > 0);
  if (!expected) {
    // Fail-closed: без секрета вебхук не принимает ничего, а не тихо
    // доверяет любому POST. Тот же принцип, что и в telegram/webhook.ts.
    console.error(
      `[webhook] No secret configured (${envNames.join(" / ")}). Set env + secret_token on setWebhook.`,
    );
    return false;
  }
  const header = request.headers.get("x-telegram-bot-api-secret-token");
  if (!header) return false;
  return timingSafeSecretEqual(header, expected);
}

/** Collect unique admin Telegram IDs from app_settings keys. */
export function parseNotifyAdminIds(settings: Record<string, string>): string[] {
  // Important: UI для админки работает с `admin_chat_id` как со списком получателей.
  // `owner_chat_id` / `developer_chat_id` исторически могли остаться/быть не настроены,
  // поэтому их нельзя бездумно смешивать: иначе разработчик может получать уведомления
  // даже когда в списке `admin_chat_id` он выключен.
  const adminRaw = (settings.admin_chat_id || "").trim();

  const split = (raw: string) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  if (adminRaw) return Array.from(new Set(split(adminRaw)));

  // Fallback (если admin_chat_id не заполнен): используем owner/developer.
  const ownerRaw = (settings.owner_chat_id || "").trim();
  const devRaw = (settings.developer_chat_id || "").trim();
  return Array.from(new Set([...split(ownerRaw), ...split(devRaw)]));
}

export function isTelegramAdmin(fromId: number | string | undefined, adminIds: string[]): boolean {
  if (fromId == null) return false;
  const id = String(fromId);
  return adminIds.includes(id);
}
