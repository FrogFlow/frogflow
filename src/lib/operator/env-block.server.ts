import crypto from "node:crypto";
import { requireOperator, operatorSessionSecretReady } from "./guard.server";
import { errorMessage } from "@/lib/error-message";

/**
 * Сборка блока переменных окружения для деплоя клиента.
 *
 * Раньше это умел только мастер подключения — то есть только для клиента,
 * которого он же и создаёт. Все переезды шли по другому пути: клиент уже был
 * заведён в базе, и собрать его переменные панелью было нечем. Отсюда модуль:
 * и мастер, и карточка существующего клиента зовут отсюда, второй копии
 * алгоритма нет.
 *
 * Токены Telegram панель по-прежнему не хранит (CONTROL-PLANE-PLAN §5): их
 * вводят на месте, они попадают в блок и никуда не сохраняются.
 */

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const b64url = (buf: crypto.BinaryLike) =>
  Buffer.from(buf as never)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * Выпускает SUPABASE_TENANT_KEY — тот же алгоритм, что в
 * scripts/mint-tenant-key.mjs. Токен несёт claim bot_id, PostgREST
 * переключается в роль tenant_bot, и RLS из MIGRATION-02 отсекает чужие
 * строки: деплой с этим ключом физически не может прочитать данные другого
 * клиента, даже если запрос забыл фильтр.
 */
export function mintTenantKey(botId: string, years = 5): { key: string; expiresAt: string } {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SUPABASE_JWT_SECRET не задан в переменных окружения панели — без него " +
        "нельзя выпустить ключ арендатора. Supabase → Settings → API → JWT Secret.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    role: "tenant_bot",
    bot_id: botId,
    iss: "supabase",
    iat: now,
    exp: now + Math.round(years * 365 * 24 * 60 * 60),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(signingInput).digest());
  return {
    key: `${signingInput}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString().slice(0, 10),
  };
}

export const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

export type TelegramBotIdentity = { username: string; first_name: string };

/**
 * Проверяет токен через getMe до того, как что-то создано в базе: опечатка в
 * токене иначе оставила бы наполовину заведённого клиента.
 */
export async function verifyBotToken(token: string): Promise<TelegramBotIdentity> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e: unknown) {
    throw new Error(`Не удалось связаться с Telegram: ${errorMessage(e)}`);
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: TelegramBotIdentity;
    description?: string;
  } | null;
  if (!body?.ok || !body.result) {
    throw new Error(`Telegram отклонил токен: ${body?.description ?? `HTTP ${res.status}`}`);
  }
  return body.result;
}

/**
 * Что панель знает о себе самой. Если чего-то из этого нет, блоки переменных
 * выходят с пустыми значениями — и это замечаешь уже на упавшем деплое
 * клиента. Поэтому проверка показывается прямо в панели, до сборки блока.
 */
export type PanelSelfCheck = {
  ok: boolean;
  vars: { name: string; present: boolean; why: string }[];
};

export function panelSelfCheck(): PanelSelfCheck {
  const vars = [
    {
      name: "OPERATOR_SESSION_SECRET",
      present: operatorSessionSecretReady(),
      why: "не задан или короче 32 символов — вход в панель закрыт",
    },
    {
      name: "SUPABASE_JWT_SECRET",
      present: Boolean(process.env.SUPABASE_JWT_SECRET),
      why: "без него панель не выпустит ключ арендатора",
    },
    {
      name: "SUPABASE_URL",
      present: Boolean(process.env.SUPABASE_URL),
      why: "попадает в блок клиента",
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      present: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      why: "попадает в блок клиента",
    },
    {
      name: "SUPABASE_PUBLISHABLE_KEY",
      present: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
      why: "попадает в блок клиента, в том числе в VITE_-переменные",
    },
  ];
  return { ok: vars.every((v) => v.present), vars };
}

export type EnvBlockMode =
  /** Проект Vercel ещё не поднят: нужен весь набор, включая свежие секреты. */
  | "new"
  /** Деплой уже работает: только то, что не сломает его на ходу. */
  | "running";

export type EnvBlockInput = {
  botId: string;
  mode: EnvBlockMode;
  /** Токен основного бота. Нужен только для режима "new". */
  botToken?: string | null;
  /** Токен VIP-бота — если у клиента включён модуль vip. */
  vipBotToken?: string | null;
  /** Ключ Zernio — если включён модуль instagram. */
  zernioApiKey?: string | null;
  zernioProfileId?: string | null;
  /**
   * Почта продавца — тоже при включённом instagram: заказы оттуда выдаются
   * письмом. Панель эти значения не хранит, как и токены ботов: они попадают
   * в блок и никуда не сохраняются.
   */
  smtpHost?: string | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  /** Перекрыть адрес деплоя, если в базе он ещё не записан. */
  appUrlOverride?: string | null;
};

export type EnvBlockResult = {
  botName: string;
  botUsername: string | null;
  vipBotUsername: string | null;
  tenantKeyExpiresAt: string;
  envBlock: string;
  warnings: string[];
  /** Строки, которых нет в блоке, потому что режим "running" их намеренно не трогает. */
  omitted: string[];
  /**
   * Секрет вебхука, попавший в блок: тот, кто ставит вебхук сразу, обязан
   * подставить в setWebhook именно его, иначе обработчик начнёт отклонять
   * апдейты Telegram. В режиме "running" — null, там секреты не выдаются.
   */
  webhookSecret: string | null;
};

type BotRow = {
  bot_name: string | null;
  app_url: string | null;
  modules: Record<string, boolean> | null;
};

export async function buildEnvBlockFor(input: EnvBlockInput): Promise<EnvBlockResult> {
  await requireOperator();

  const check = panelSelfCheck();
  const warnings: string[] = [];
  for (const v of check.vars) {
    if (!v.present) warnings.push(`В окружении панели нет ${v.name} — ${v.why}.`);
  }

  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("bot_name, app_url, modules")
    .eq("id", input.botId)
    .single();
  if (error || !data) {
    throw new Error(`Клиент не найден: ${error?.message ?? "нет данных"}`);
  }
  const bot = data as unknown as BotRow;
  const modules = bot.modules ?? {};

  const appUrl = (input.appUrlOverride ?? bot.app_url ?? "").trim().replace(/\/$/, "");
  if (!appUrl) {
    warnings.push(
      "Адрес деплоя неизвестен — в блоке стоит заглушка. Впишите его, иначе ссылки в боте и колбэки оплаты уйдут в никуда.",
    );
  }

  // Токены проверяем до сборки: пусть лучше ошибка вылезет здесь, чем клиент
  // вставит опечатку в Vercel и будет искать причину в пятистах строках лога.
  let botUsername: string | null = null;
  if (input.botToken?.trim()) {
    botUsername = (await verifyBotToken(input.botToken.trim())).username;
  }
  let vipBotUsername: string | null = null;
  if (input.vipBotToken?.trim()) {
    vipBotUsername = (await verifyBotToken(input.vipBotToken.trim())).username;
  }

  if (modules.vip && input.mode === "new" && !input.vipBotToken?.trim()) {
    warnings.push(
      "У клиента включён модуль VIP, но токен VIP-бота не указан — раздел не заработает.",
    );
  }
  if (modules.instagram && input.mode === "new" && !input.zernioApiKey?.trim()) {
    warnings.push("Включён Instagram, но ключ Zernio не указан — автоматизация не заработает.");
  }
  if (modules.instagram && input.mode === "new" && !input.smtpHost?.trim()) {
    warnings.push(
      "Включён Instagram, но почта продавца не указана. Заказы оттуда выдаются письмом " +
        "(Direct не принимает документы вложением), и без SMTP покупатель дойдёт до оплаты, " +
        "а получить материалы не сможет.",
    );
  }

  const { key: tenantKey, expiresAt } = mintTenantKey(input.botId);
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

  const lines: string[] = [
    "# ── Арендатор: без BOT_ID + SUPABASE_TENANT_KEY деплой видит чужие данные ──",
    `BOT_ID=${input.botId}`,
    `SUPABASE_TENANT_KEY=${tenantKey}`,
    "",
    "# ── Общая база ──",
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    `VITE_SUPABASE_URL=${supabaseUrl}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    "",
    "# ── Приложение ──",
    `PUBLIC_APP_URL=${appUrl || "https://<домен-проекта>"}`,
  ];

  const omitted: string[] = [];
  let webhookSecret: string | null = null;

  if (input.mode === "new") {
    webhookSecret = randomSecret(16);
    lines.push(
      "",
      "# ── Telegram ──",
      `TELEGRAM_BOT_TOKEN=${input.botToken?.trim() || "<токен от @BotFather>"}`,
      `TELEGRAM_WEBHOOK_SECRET=${webhookSecret}`,
    );

    if (modules.vip) {
      lines.push(
        "",
        "# ── VIP-бот ──",
        `VIP_BOT_TOKEN=${input.vipBotToken?.trim() || "<токен VIP-бота>"}`,
        // Юзернейм подставляем из getMe: «с @ или без» тут больше не вопрос.
        `VIP_BOT_USERNAME=${vipBotUsername ?? "<юзернейм VIP-бота>"}`,
        `VIP_TELEGRAM_WEBHOOK_SECRET=${randomSecret(16)}`,
      );
    }
    if (modules.instagram) {
      lines.push(
        "",
        "# ── Instagram (Zernio) ──",
        `ZERNIO_API_KEY=${input.zernioApiKey?.trim() || "<ключ sk_…>"}`,
        // This value is sent to Zernio while registering the webhook and is
        // used by our endpoint to verify the raw-body HMAC signature.
        `ZERNIO_WEBHOOK_SECRET=${randomSecret(16)}`,
        ...(input.zernioProfileId?.trim()
          ? [`ZERNIO_PROFILE_ID=${input.zernioProfileId.trim()}`]
          : []),
        "",
        // Почта здесь не «на всякий случай»: заказ из Instagram выдаётся
        // письмом, потому что Direct не принимает вложениями документы, а окно
        // на ответ там 24 часа. Без этих трёх переменных покупатель дойдёт до
        // конца — оплатит, пришлёт чек, оставит адрес — и упрётся в
        // подтверждение, на котором выдавать будет нечем.
        "# ── Почта для выдачи заказов из Instagram ──",
        "# Ящик продавца. Пароль — приложения, не основной от почты.",
        `SMTP_HOST=${input.smtpHost?.trim() || "<smtp.yandex.ru>"}`,
        `SMTP_USER=${input.smtpUser?.trim() || "<ящик продавца>"}`,
        `SMTP_PASSWORD=${input.smtpPassword?.trim() || "<пароль приложения>"}`,
      );
    }

    lines.push(
      "",
      "# ── Секреты деплоя ──",
      `SESSION_SECRET=${randomSecret()}`,
      `CRON_SECRET=${randomSecret(16)}`,
      "",
      "# ── Вход в админку клиента (пароль сгенерирован, передайте его владельцу) ──",
      "ADMIN_USERNAME=admin",
      `ADMIN_PASSWORD=${crypto.randomBytes(12).toString("base64url")}`,
    );
  } else {
    omitted.push(
      "TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET",
      "SESSION_SECRET и CRON_SECRET",
      "ADMIN_USERNAME и ADMIN_PASSWORD",
      ...(modules.vip ? ["VIP_BOT_TOKEN, VIP_BOT_USERNAME, VIP_TELEGRAM_WEBHOOK_SECRET"] : []),
      ...(modules.instagram
        ? [
            "ZERNIO_API_KEY, ZERNIO_WEBHOOK_SECRET, ZERNIO_PROFILE_ID",
            "SMTP_HOST, SMTP_USER, SMTP_PASSWORD (выдача заказов из Instagram письмом)",
          ]
        : []),
    );
  }

  lines.push("", "# CONTROL_PLANE здесь НЕ задавать: это переменная панели оператора.");

  return {
    botName: bot.bot_name ?? "",
    botUsername,
    vipBotUsername,
    tenantKeyExpiresAt: expiresAt,
    envBlock: lines.join("\n"),
    warnings,
    omitted,
    webhookSecret,
  };
}
