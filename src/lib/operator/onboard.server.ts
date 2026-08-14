import crypto from "node:crypto";
import { requireOperator } from "./guard.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";

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
function mintTenantKey(botId: string, years = 5): { key: string; expiresAt: string } {
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

const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

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
    throw new Error(`Не удалось связаться с Telegram: ${(e as Error)?.message ?? e}`);
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

export type OnboardInput = {
  bot_name: string;
  /** Человекочитаемый идентификатор клиента (bots.owner_id), напр. "saltanat". */
  owner_slug: string;
  /** Токен от BotFather. Используется и НЕ сохраняется — см. CONTROL-PLANE-PLAN.md §5. */
  bot_token: string;
  app_url: string | null;
  modules: ModuleKey[];
  owner_name: string | null;
  owner_contact: string | null;
  owner_telegram_id: number | null;
  notes: string | null;
  /**
   * С какого номера продолжить нумерацию заказов. Для нового клиента — 0.
   * Если данные переносятся из его старой базы, поставить текущий максимум:
   * иначе нумерация у покупателей поедет назад (ловили на Print KZ).
   */
  first_order_no: number;
  /** Ставить ли вебхук сразу. Осмысленно только когда деплой уже поднят. */
  set_webhook: boolean;
};

export type OnboardResult = {
  botId: string;
  botUsername: string;
  tenantKeyExpiresAt: string;
  /** Готовый блок для вставки в переменные окружения проекта Vercel. */
  envBlock: string;
  webhook: { attempted: boolean; ok: boolean; detail: string };
  warnings: string[];
};

export async function onboardClient(input: OnboardInput, actor: string): Promise<OnboardResult> {
  await requireOperator();

  const warnings: string[] = [];
  const identity = await verifyBotToken(input.bot_token);

  const unknown = input.modules.filter((k) => !MODULE_KEYS.includes(k));
  if (unknown.length > 0) throw new Error(`Неизвестные модули: ${unknown.join(", ")}`);
  const notReady = input.modules.filter((k) => moduleDef(k).status !== "available");
  if (notReady.length > 0) {
    throw new Error(
      `Нельзя включить модули, которых ещё нет в коде: ${notReady
        .map((k) => moduleDef(k).title)
        .join(", ")}`,
    );
  }

  const modules: Record<string, boolean> = {};
  for (const key of MODULE_KEYS) modules[key] = input.modules.includes(key);

  const s = await db();
  const internalSecret = randomSecret();
  const appUrl = input.app_url?.trim().replace(/\/$/, "") || null;

  const { data: created, error: insertErr } = await s
    .from("bots")
    .insert({
      // bot_token намеренно не заполняется: панель не хранит токенов Telegram.
      bot_name: input.bot_name.trim(),
      owner_id: input.owner_slug.trim(),
      status: "active",
      modules,
      app_url: appUrl,
      internal_secret: internalSecret,
      owner_name: input.owner_name?.trim() || null,
      owner_contact: input.owner_contact?.trim() || null,
      owner_telegram_id: input.owner_telegram_id,
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    throw new Error(`Не удалось создать клиента: ${insertErr?.message ?? "нет данных"}`);
  }
  const botId = created.id;

  // Счётчик заказов — свой на каждого арендатора (MIGRATION-03). Без строки
  // здесь первый заказ получил бы номер из общей последовательности.
  const { error: counterErr } = await s
    .from("order_counters")
    .insert({ bot_id: botId, last_no: input.first_order_no });
  if (counterErr) {
    warnings.push(
      `Счётчик заказов не создан (${counterErr.message}). Нумерация может начаться не с того числа — проверьте order_counters.`,
    );
  }

  const { key: tenantKey, expiresAt } = mintTenantKey(botId);
  const sessionSecret = randomSecret();
  const cronSecret = randomSecret(16);
  const webhookSecret = randomSecret(16);
  const adminPassword = crypto.randomBytes(12).toString("base64url");

  let webhook = { attempted: false, ok: false, detail: "не ставился" };
  if (input.set_webhook) {
    webhook = await setTelegramWebhook(input.bot_token, appUrl, webhookSecret);
  } else if (appUrl) {
    warnings.push(
      "Вебхук не проставлен. Сделайте это после того, как проект Vercel поднимется — кнопка «Проставить вебхук» в карточке клиента.",
    );
  }

  const envBlock = buildEnvBlock({
    botId,
    tenantKey,
    appUrl,
    botToken: input.bot_token,
    sessionSecret,
    cronSecret,
    webhookSecret,
    adminPassword,
  });

  await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: "onboard",
    // Ни токена, ни ключей: журнал читается в панели и не должен их содержать.
    payload: {
      bot_name: input.bot_name,
      bot_username: identity.username,
      modules: input.modules,
      app_url: appUrl,
      first_order_no: input.first_order_no,
    },
  });

  return {
    botId,
    botUsername: identity.username,
    tenantKeyExpiresAt: expiresAt,
    envBlock,
    webhook,
    warnings,
  };
}

async function setTelegramWebhook(
  token: string,
  appUrl: string | null,
  webhookSecret: string,
): Promise<{ attempted: boolean; ok: boolean; detail: string }> {
  if (!appUrl) {
    return { attempted: false, ok: false, detail: "адрес деплоя не указан" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${appUrl}/api/public/telegram/webhook`,
        secret_token: webhookSecret,
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    return body?.ok
      ? { attempted: true, ok: true, detail: `${appUrl}/api/public/telegram/webhook` }
      : {
          attempted: true,
          ok: false,
          detail: body?.description ?? `HTTP ${res.status}`,
        };
  } catch (e: unknown) {
    return { attempted: true, ok: false, detail: (e as Error)?.message ?? String(e) };
  }
}

function buildEnvBlock(v: {
  botId: string;
  tenantKey: string;
  appUrl: string | null;
  botToken: string;
  sessionSecret: string;
  cronSecret: string;
  webhookSecret: string;
  adminPassword: string;
}): string {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

  return [
    "# ── Арендатор: без BOT_ID + SUPABASE_TENANT_KEY деплой видит чужие данные ──",
    `BOT_ID=${v.botId}`,
    `SUPABASE_TENANT_KEY=${v.tenantKey}`,
    "",
    "# ── Общая база ──",
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    `VITE_SUPABASE_URL=${supabaseUrl}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
    "",
    "# ── Telegram ──",
    `TELEGRAM_BOT_TOKEN=${v.botToken}`,
    `TELEGRAM_WEBHOOK_SECRET=${v.webhookSecret}`,
    "",
    "# ── Приложение ──",
    `PUBLIC_APP_URL=${v.appUrl ?? "https://<домен-проекта>"}`,
    `SESSION_SECRET=${v.sessionSecret}`,
    `CRON_SECRET=${v.cronSecret}`,
    "",
    "# ── Вход в админку клиента (пароль сгенерирован, смените при передаче) ──",
    "ADMIN_USERNAME=admin",
    `ADMIN_PASSWORD=${v.adminPassword}`,
    "",
    "# CONTROL_PLANE здесь НЕ задавать: это переменная панели оператора.",
  ].join("\n");
}
