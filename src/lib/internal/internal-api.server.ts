/**
 * Внутренний API клиентского деплоя — то, ради чего панель не хранит ни одного
 * токена Telegram (CONTROL-PLANE-PLAN.md §5–6).
 *
 * Панель знает `bots.app_url` и `bots.internal_secret`, стучится сюда, а токен
 * берёт уже сам деплой — из своих же переменных окружения. Утечка секрета даёт
 * максимум возможность отправить сообщение владельцу; утечка токена означала бы
 * полный контроль над ботом.
 */
import { createHash, timingSafeEqual } from "node:crypto";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function requireBotId(): string {
  const id = process.env.BOT_ID?.trim();
  if (!id) throw new Error("BOT_ID не задан в переменных окружения");
  return id;
}

/**
 * Сравнение постоянного времени. Хеширование до сравнения выравнивает длину:
 * timingSafeEqual на буферах разной длины бросает исключение, а проверка длины
 * до него утекала бы длиной секрета.
 */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type InternalAuthResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Проверяет заголовок x-internal-secret против bots.internal_secret своей же
 * строки. Деплой ходит под ключом арендатора, которому RLS оставляет ровно
 * свою строку в `bots` — чужой секрет отсюда не прочитать в принципе.
 */
export async function authenticateInternalRequest(request: Request): Promise<InternalAuthResult> {
  const provided = request.headers.get("x-internal-secret");
  if (!provided) {
    return { ok: false, status: 401, message: "Missing x-internal-secret" };
  }

  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("internal_secret")
    .eq("id", requireBotId())
    .single();

  if (error || !data) {
    console.error("[internal] не удалось прочитать internal_secret:", error?.message);
    return { ok: false, status: 500, message: "Internal secret unavailable" };
  }
  // Пустой секрет в базе не должен превращаться в «пускаем всех».
  if (!data.internal_secret) {
    return { ok: false, status: 503, message: "Internal secret is not configured for this bot" };
  }
  if (!secretsMatch(provided, data.internal_secret)) {
    return { ok: false, status: 403, message: "Invalid secret" };
  }
  return { ok: true };
}

export type NotifyOwnerResult = { ok: true } | { ok: false; status: number; message: string };

/** Шлёт текст владельцу от имени ЭТОГО бота, своим TELEGRAM_BOT_TOKEN. */
export async function notifyOwner(text: string): Promise<NotifyOwnerResult> {
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("owner_telegram_id")
    .eq("id", requireBotId())
    .single();

  if (error || !data) {
    return { ok: false, status: 500, message: `Не удалось прочитать владельца: ${error?.message}` };
  }
  if (!data.owner_telegram_id) {
    // Не 500: деплой исправен, просто в панели не заполнен Telegram ID владельца.
    return { ok: false, status: 409, message: "owner_telegram_id не заполнен в панели" };
  }

  const { tg } = await import("@/lib/telegram.server");
  let res: { ok: boolean; description?: string };
  try {
    res = await tg("sendMessage", { chat_id: Number(data.owner_telegram_id), text });
  } catch (e: any) {
    // Сюда попадает только незаданный TELEGRAM_BOT_TOKEN: сетевые сбои tg()
    // переживает сам и возвращает ok: false.
    return { ok: false, status: 500, message: `Отправка не удалась: ${e?.message || e}` };
  }
  // tg() не бросает при отказе Telegram, а возвращает ok: false. Проглотить
  // это значило бы отрапортовать панели об успешной доставке несуществующего
  // сообщения — ровно та ошибка, против которой написан §6 плана.
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      message: `Telegram отклонил отправку: ${res.description || "неизвестная ошибка"}`,
    };
  }
  return { ok: true };
}

export type WebhookActionResult =
  { ok: true; url: string } | { ok: false; status: number; message: string };

/**
 * Деплой сам направляет своего бота на себя же.
 *
 * Так панели не нужен ни токен, ни TELEGRAM_WEBHOOK_SECRET: и то, и другое
 * уже лежит здесь, в переменных окружения этого деплоя. Заодно исчезает
 * целый класс ошибок — адрес вебхука берётся не из того, что оператор набрал
 * руками в панели, а из того, где деплой реально работает.
 */
export async function setOwnWebhook(): Promise<WebhookActionResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, status: 500, message: "TELEGRAM_BOT_TOKEN не задан в этом деплое" };
  }

  const base = (
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "")
  )
    .trim()
    .replace(/\/$/, "");
  if (!base) {
    return { ok: false, status: 500, message: "PUBLIC_APP_URL не задан в этом деплое" };
  }

  const url = `${base}/api/public/telegram/webhook`;
  const body: Record<string, string | boolean> = { url, drop_pending_updates: false };
  // Если секрет задан, вебхук обязан его нести: без него телеграмные апдейты
  // начнёт отклонять сам обработчик.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) body.secret_token = secret;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    if (!json?.ok) {
      return {
        ok: false,
        status: 502,
        message: `Telegram отклонил setWebhook: ${json?.description ?? `HTTP ${res.status}`}`,
      };
    }
    return { ok: true, url };
  } catch (e: unknown) {
    return {
      ok: false,
      status: 502,
      message: `Не удалось вызвать Telegram: ${(e as Error)?.message}`,
    };
  }
}

export type HealthReport = {
  bot_username: string | null;
  webhook_url: string | null;
  pending_updates: number | null;
  /** Последняя ошибка доставки со стороны Telegram — самый честный признак «бот сломан». */
  last_error: string | null;
  last_error_at: string | null;
};

/**
 * Состояние бота глазами Telegram. Панель спрашивает деплой, деплой
 * спрашивает Telegram своим токеном — токен снова остаётся здесь.
 */
export async function botHealth(): Promise<
  { ok: true; report: HealthReport } | { ok: false; status: number; message: string }
> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, status: 500, message: "TELEGRAM_BOT_TOKEN не задан в этом деплое" };
  }

  try {
    const [meRes, hookRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) }),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    const me = (await meRes.json().catch(() => null)) as any;
    const hook = (await hookRes.json().catch(() => null)) as any;

    if (!me?.ok) {
      return {
        ok: false,
        status: 502,
        message: `Telegram отклонил getMe: ${me?.description ?? `HTTP ${meRes.status}`}`,
      };
    }

    const info = hook?.ok ? hook.result : null;
    return {
      ok: true,
      report: {
        bot_username: me.result?.username ?? null,
        webhook_url: info?.url || null,
        pending_updates:
          typeof info?.pending_update_count === "number" ? info.pending_update_count : null,
        last_error: info?.last_error_message || null,
        last_error_at: info?.last_error_date
          ? new Date(info.last_error_date * 1000).toISOString()
          : null,
      },
    };
  } catch (e: unknown) {
    return {
      ok: false,
      status: 502,
      message: `Не удалось опросить Telegram: ${(e as Error)?.message}`,
    };
  }
}
