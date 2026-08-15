import { createHash, timingSafeEqual } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Защита входа в панель.
 *
 * Вход в панель — это доступ ко всем клиентам сразу: выпуск ключей
 * арендаторов, переустановка вебхуков, сообщения владельцам. До этого файла
 * он был защищён одним сравнением строк: без задержки, без ограничения числа
 * попыток и без следа в журнале.
 */

/** За сколько минут считаем неудачи. */
const WINDOW_MIN = 15;
/** Сколько неудач подряд закрывают вход до конца окна. */
const MAX_FAILURES = 5;
/** Журнал попыток не растёт бесконечно — чистится при удачном входе. */
const KEEP_DAYS = 30;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/**
 * Сравнение, не зависящее от того, на каком символе строки разошлись.
 * Хеши — чтобы сравнивать буферы одинаковой длины: timingSafeEqual на разной
 * длине бросает, и сама эта ошибка выдала бы длину пароля.
 */
export function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Адрес, с которого пришёл запрос. За прокси Vercel настоящий адрес лежит в
 * x-forwarded-for; первый элемент списка — клиент, остальные прокси.
 */
export function clientIp(): string | null {
  try {
    const h = getRequest().headers;
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim() || null;
    return h.get("x-real-ip")?.trim() || null;
  } catch {
    // Вне контекста запроса — не повод падать: попытка всё равно запишется.
    return null;
  }
}

export type Lockout = { locked: boolean; failures: number; retryAfterMin: number };

/**
 * Сколько неудач с этого адреса за окно. Без адреса считаем по имени
 * пользователя: хуже, чем по адресу, но лучше, чем не считать вовсе.
 */
export async function checkLockout(username: string, ip: string | null): Promise<Lockout> {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const s = await db();
  let q = s
    .from("operator_login_attempts")
    .select("at", { count: "exact" })
    .eq("ok", false)
    .gte("at", since);
  q = ip ? q.eq("ip", ip) : q.eq("username", username);

  const { count, error } = await q;
  if (error) {
    // Журнал недоступен — вход не блокируем: иначе сбой базы запирает
    // оператора снаружи именно тогда, когда панель нужнее всего.
    console.error("[operator] не удалось проверить попытки входа:", error.message);
    return { locked: false, failures: 0, retryAfterMin: 0 };
  }
  const failures = count ?? 0;
  return {
    locked: failures >= MAX_FAILURES,
    failures,
    retryAfterMin: WINDOW_MIN,
  };
}

export async function recordAttempt(username: string, ip: string | null, ok: boolean) {
  const s = await db();
  const { error } = await s.from("operator_login_attempts").insert({ username, ip, ok });
  if (error) console.error("[operator] не удалось записать попытку входа:", error.message);

  if (ok) {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    const { error: delErr } = await s.from("operator_login_attempts").delete().lt("at", cutoff);
    if (delErr) console.error("[operator] чистка журнала входов не удалась:", delErr.message);
  }
}

/**
 * Небольшая задержка на каждую попытку. Пять попыток за окно и так немного,
 * но задержка убирает возможность быстро перебрать словарь до срабатывания
 * блокировки.
 */
export function loginDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 300));
}
