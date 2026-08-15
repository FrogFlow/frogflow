import { requireOperator } from "./guard.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { buildEnvBlockFor, randomSecret, verifyBotToken } from "./env-block.server";
import { logEvent } from "./events.server";

export type { TelegramBotIdentity } from "./env-block.server";
export { verifyBotToken };

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
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

  // Блок собирает общий модуль — тот же, что и карточка существующего клиента.
  const built = await buildEnvBlockFor({
    botId,
    mode: "new",
    botToken: input.bot_token,
    appUrlOverride: appUrl,
  });
  warnings.push(...built.warnings);

  let webhook = { attempted: false, ok: false, detail: "не ставился" };
  if (input.set_webhook) {
    // Именно тот секрет, что попал в блок: разойдись они — обработчик деплоя
    // начнёт отклонять апдейты Telegram с 403.
    webhook = await setTelegramWebhook(input.bot_token, appUrl, built.webhookSecret ?? "");
  } else if (appUrl) {
    warnings.push(
      "Вебхук не проставлен. Сделайте это после того, как проект Vercel поднимется — кнопка «Проставить вебхук» в карточке клиента.",
    );
  }

  // Ни токена, ни ключей: журнал читается в панели и не должен их содержать.
  await logEvent(botId, actor, "onboard", {
    bot_name: input.bot_name,
    bot_username: identity.username,
    modules: input.modules,
    app_url: appUrl,
    first_order_no: input.first_order_no,
  });

  return {
    botId,
    botUsername: identity.username,
    tenantKeyExpiresAt: built.tenantKeyExpiresAt,
    envBlock: built.envBlock,
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
