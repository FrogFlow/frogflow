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
import { errorMessage } from "@/lib/error-message";

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

// Спамить этот эндпоинт мусорным x-internal-secret ничего не стоит: заголовок
// проверяется только через хеш, а настоящее значение лежит в базе, поэтому
// каждый запрос без кэша означал бы отдельный поход в БД ДО того, как секрет
// вообще сравнивается (Блок 1.5). TTL короткий — ротация секрета в панели
// отражается почти сразу, но повторные невалидные попытки не долбят базу.
const SECRET_CACHE_TTL_MS = 60 * 1000;
let secretCache: { botId: string; value: string | null; expiresAt: number } | null = null;

async function fetchInternalSecret(botId: string): Promise<string | null> {
  if (secretCache && secretCache.botId === botId && secretCache.expiresAt > Date.now()) {
    return secretCache.value;
  }
  const s = await db();
  const { data, error } = await s.from("bots").select("internal_secret").eq("id", botId).single();

  if (error || !data) {
    console.error("[internal] не удалось прочитать internal_secret:", error?.message);
    // Ошибку чтения не кэшируем — иначе временный сбой БД запирал бы вход на
    // весь TTL вместо того, чтобы попробовать снова на следующем запросе.
    return null;
  }
  // null здесь зарезервирован под "не удалось прочитать строку" (сбой выше) —
  // NULL/пустая строка в самой колонке означают другое (секрет не настроен),
  // поэтому схлопывать их в null тоже нельзя: authenticateInternalRequest
  // иначе не отличил бы 500 (сбой БД) от 503 (секрет не задан).
  const value = data.internal_secret ?? "";
  secretCache = { botId, value, expiresAt: Date.now() + SECRET_CACHE_TTL_MS };
  return value;
}

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

  const expected = await fetchInternalSecret(requireBotId());
  if (expected === null) {
    return { ok: false, status: 500, message: "Internal secret unavailable" };
  }
  // Пустой секрет в базе не должен превращаться в «пускаем всех».
  if (!expected) {
    return { ok: false, status: 503, message: "Internal secret is not configured for this bot" };
  }
  if (!secretsMatch(provided, expected)) {
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
  } catch (e: unknown) {
    // Сюда попадает только незаданный TELEGRAM_BOT_TOKEN: сетевые сбои tg()
    // переживает сам и возвращает ok: false.
    return { ok: false, status: 500, message: `Отправка не удалась: ${errorMessage(e) || e}` };
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

/** Один бот арендатора: магазинный или VIP. */
export type WebhookBotResult = {
  name: "SHOP" | "VIP";
  ok: boolean;
  /** Куда направлен вебхук; пусто, если поставить не удалось. */
  url: string;
  /** Почему пропущен или не удался. */
  detail: string;
};

export type WebhookActionResult =
  | { ok: true; url: string; bots: WebhookBotResult[] }
  | { ok: false; status: number; message: string; bots?: WebhookBotResult[] };

async function setOne(
  name: "SHOP" | "VIP",
  token: string | undefined,
  path: string,
  secret: string,
  base: string,
): Promise<WebhookBotResult> {
  if (!token) {
    // У клиента без VIP-модуля второго токена и не должно быть — это не ошибка.
    return { name, ok: true, url: "", detail: "токен не задан, бот пропущен" };
  }
  const url = `${base}${path}`;
  const body: Record<string, string | boolean> = { url, drop_pending_updates: false };
  // Если секрет задан, вебхук обязан его нести: без него телеграмные апдейты
  // начнёт отклонять сам обработчик.
  if (secret) body.secret_token = secret;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token.trim()}/setWebhook`, {
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
        name,
        ok: false,
        url: "",
        detail: `Telegram отклонил setWebhook: ${json?.description ?? `HTTP ${res.status}`}`,
      };
    }
    return { name, ok: true, url, detail: "проставлен" };
  } catch (e: unknown) {
    return {
      name,
      ok: false,
      url: "",
      detail: `Не удалось вызвать Telegram: ${errorMessage(e)}`,
    };
  }
}

/**
 * Деплой сам направляет своих ботов на себя же.
 *
 * Так панели не нужен ни токен, ни TELEGRAM_WEBHOOK_SECRET: и то, и другое
 * уже лежит здесь, в переменных окружения этого деплоя. Заодно исчезает
 * целый класс ошибок — адрес вебхука берётся не из того, что оператор набрал
 * руками в панели, а из того, где деплой реально работает.
 *
 * Ботов может быть два. Раньше здесь ставился только магазинный, и у клиентов
 * с VIP-подписками второй бот после переезда оставался смотреть на старый
 * деплой: кнопка в панели отчитывалась об успехе, а половина продаж молчала.
 * Cron самовосстановления умел оба (ensureDidWebhooks) — расходились только
 * эти два пути.
 */
export async function setOwnWebhook(): Promise<WebhookActionResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    return { ok: false, status: 500, message: "TELEGRAM_BOT_TOKEN не задан в этом деплое" };
  }

  // Мягкий вариант: панель ждёт осмысленный ответ об ошибке, а не исключение.
  const { appOrigin } = await import("../app-origin.server");
  const base = appOrigin();
  if (!base) {
    return { ok: false, status: 500, message: "PUBLIC_APP_URL не задан в этом деплое" };
  }

  const shopSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  // Свой секрет VIP-бота, иначе общий: так же, как в ensureDidWebhooks.
  const vipSecret = (
    process.env.VIP_TELEGRAM_WEBHOOK_SECRET ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    ""
  ).trim();

  const bots = await Promise.all([
    setOne(
      "SHOP",
      process.env.TELEGRAM_BOT_TOKEN,
      "/api/public/telegram/webhook",
      shopSecret,
      base,
    ),
    setOne("VIP", process.env.VIP_BOT_TOKEN, "/api/public/telegram/webhook-vip", vipSecret, base),
  ]);

  // В сообщении — все боты, а не только упавшие: если магазинный встал, а VIP
  // нет, оператор должен видеть обе половины, иначе непонятно, что чинить и
  // что уже работает.
  const failed = bots.filter((b) => !b.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      status: 502,
      message: bots.map((b) => `${b.name}: ${b.ok ? b.detail : b.detail}`).join(" · "),
      bots,
    };
  }
  // url — магазинный бот: панель показывает его как основной адрес.
  return { ok: true, url: bots[0]!.url, bots };
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
    const me = (await meRes.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    } | null;
    const hook = (await hookRes.json().catch(() => null)) as {
      ok?: boolean;
      result?: {
        url?: string;
        pending_update_count?: number;
        last_error_message?: string;
        last_error_date?: number;
      };
    } | null;

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
      message: `Не удалось опросить Telegram: ${errorMessage(e)}`,
    };
  }
}
