import { createHash, timingSafeEqual } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Защита входа в админку магазина — тот же приём, что уже применён для входа
 * в панель оператора (operator/login-guard.server.ts): задержка на попытку,
 * блокировка после нескольких неудач, сравнение без утечки по времени.
 *
 * Отличие от панели оператора: это таблица per-tenant (bot_id NOT NULL,
 * обычная политика tenant_isolation), заведена MIGRATION-22 и до её
 * применения на конкретном проекте ещё не существует. checkLockout/
 * recordAttempt на такой ошибке не запирают и не роняют вход — тогда
 * защита сводится к задержке и timing-safe сравнению, а блокировка по
 * числу попыток включится сама, как только миграция применена.
 */

const WINDOW_MIN = 15;
const MAX_FAILURES = 5;
const KEEP_DAYS = 30;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/** Сравнение без утечки по времени — через хеши одинаковой длины. */
export function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function clientIp(): string | null {
  try {
    const h = getRequest().headers;
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim() || null;
    return h.get("x-real-ip")?.trim() || null;
  } catch {
    return null;
  }
}

export type Lockout = { locked: boolean; failures: number; retryAfterMin: number };

export async function checkLockout(ip: string | null): Promise<Lockout> {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const s = await db();
  let q = s
    .from("admin_login_attempts")
    .select("at", { count: "exact" })
    .eq("ok", false)
    .gte("at", since);
  q = ip ? q.eq("ip", ip) : q;

  const { count, error } = await q;
  if (error) {
    // Таблица может быть ещё не заведена (MIGRATION-22) или недоступна —
    // не запираем вход из-за этого, деградируем до задержки+timing-safe.
    return { locked: false, failures: 0, retryAfterMin: 0 };
  }
  const failures = count ?? 0;
  return { locked: failures >= MAX_FAILURES, failures, retryAfterMin: WINDOW_MIN };
}

export async function recordAttempt(ip: string | null, ok: boolean) {
  const botId = process.env.BOT_ID?.trim();
  if (!botId) return;
  const s = await db();
  const { error } = await s.from("admin_login_attempts").insert({ bot_id: botId, ip, ok });
  if (error) return;

  if (ok) {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    await s.from("admin_login_attempts").delete().lt("at", cutoff);
  }
}

export function loginDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 300));
}
