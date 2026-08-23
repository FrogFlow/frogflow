import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppOrigin } from "./app-origin.server";

/**
 * Серверные функции вкладки WhatsApp.
 *
 * Гард тот же, что у Instagram (см. requireAdminWithModule в
 * instagram.functions.ts): мало быть админом своего бота — модуль должен быть
 * подключён, иначе тумблер в панели оператора прячет только пункт меню, а
 * функцию по-прежнему можно вызвать напрямую.
 */
async function requireAdminWithModule() {
  const { requireAdmin } = await import("./admin-session.server");
  const { requireModule } = await import("./modules/require-module.server");
  await requireAdmin();
  await requireModule("whatsapp");
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function requireBotId() {
  const botId = process.env.BOT_ID?.trim();
  if (!botId) throw new Error("BOT_ID is required for WhatsApp settings");
  return botId;
}

/* ─────────────────────── Подключение аккаунта ─────────────────────── */

export const getWhatsAppConnectUrlFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getZernioConnectUrl } = await import("./zernio.server");
  await requireAdminWithModule();

  const origin = requireAppOrigin();
  const redirectUrl = `${origin.replace(/\/$/, "")}/admin/whatsapp?connected=1`;
  // Тот же connect-эндпоинт Zernio, что и у Instagram, — он принимает платформу
  // параметром, отдельного пути для WhatsApp не нужно.
  return await getZernioConnectUrl("whatsapp", undefined, redirectUrl);
});

export const getWhatsAppAccountsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listZernioAccounts } = await import("./zernio.server");
  await requireAdminWithModule();
  const all = await listZernioAccounts();
  return { accounts: all.filter((account) => account.platform === "whatsapp") };
});

export const getWhatsAppAccountHealthFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { getZernioAccountHealth } = await import("./zernio.server");
    await requireAdminWithModule();
    return { health: await getZernioAccountHealth(data.accountId) };
  });

export const disconnectWhatsAppAccountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { disconnectZernioAccount, resetProfileAccountsCache } = await import("./zernio.server");
    await requireAdminWithModule();
    const result = await disconnectZernioAccount(data.accountId);
    resetProfileAccountsCache();
    return result;
  });

export const registerWhatsAppWebhookFn = createServerFn({ method: "POST" }).handler(async () => {
  const { registerZernioWebhook } = await import("./zernio.server");
  await requireAdminWithModule();
  const origin = requireAppOrigin();
  // Тот же публичный эндпоинт, что и у Instagram: вебхуки у Zernio общие на
  // команду, и одна запись обслуживает оба канала.
  return await registerZernioWebhook(`${origin.replace(/\/$/, "")}/api/public/zernio/webhook`);
});

/* ─────────────────────── Настройки автоответчика ─────────────────────── */

/**
 * Ключи те же по смыслу, что у Instagram, но со своим префиксом: у клиента
 * может быть куплен один канал и не куплен другой, а приветствие и
 * слова-триггеры в директе и в мессенджере — разные тексты для разной
 * аудитории. Читает их рантайм бота (SETTINGS_PREFIX в zernio-bot.server.ts).
 */
const SETTINGS_PREFIX = "whatsapp_bot_";

async function readSetting(suffix: string): Promise<string> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", requireBotId())
    .eq("key", `${SETTINGS_PREFIX}${suffix}`)
    .maybeSingle();
  return data?.value?.trim() || "";
}

async function writeSetting(suffix: string, value: string): Promise<void> {
  const s = await db();
  await s.from("app_settings").upsert(
    {
      bot_id: requireBotId(),
      key: `${SETTINGS_PREFIX}${suffix}`,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "bot_id,key" },
  );
}

export const getWhatsAppBotSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminWithModule();
  const { DEFAULT_TRIGGER_WORDS } = await import("./zernio-bot.server");
  const { resolveWhatsAppStartPrompt } = await import("./whatsapp-activation");

  const [enabled, script, startPrompt, scope, triggers, features, accountId] = await Promise.all([
    readSetting("enabled"),
    readSetting("script"),
    readSetting("start_prompt"),
    readSetting("scope"),
    readSetting("triggers"),
    readSetting("features"),
    readSetting("account_id"),
  ]);

  let parsedFeatures = { catalog: true, search: true, cart: true, checkout: true };
  try {
    parsedFeatures = { ...parsedFeatures, ...JSON.parse(features || "{}") };
  } catch {
    /* значения по умолчанию */
  }

  return {
    // Только явное "false" выключает — так же, как у Instagram: у клиента,
    // который ничего не настраивал, бот должен работать.
    enabled: enabled !== "false",
    script,
    startPrompt: resolveWhatsAppStartPrompt(startPrompt),
    scope: scope === "all" ? ("all" as const) : ("purchases" as const),
    triggers: triggers || DEFAULT_TRIGGER_WORDS.join(", "),
    features: parsedFeatures,
    accountId,
  };
});

export const saveWhatsAppBotSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean().optional(),
        script: z.string().trim().max(1500).optional(),
        startPrompt: z
          .string()
          .trim()
          .min(1, "Первое сообщение не может быть пустым.")
          .max(1000)
          .optional(),
        scope: z.enum(["purchases", "all"]).optional(),
        triggers: z.string().trim().max(300).optional(),
        features: z
          .object({
            catalog: z.boolean(),
            search: z.boolean(),
            cart: z.boolean(),
            checkout: z.boolean(),
          })
          .optional(),
        accountId: z.string().trim().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdminWithModule();

    if (data.enabled !== undefined) await writeSetting("enabled", data.enabled ? "true" : "false");
    if (data.script !== undefined) await writeSetting("script", data.script);
    if (data.startPrompt !== undefined) await writeSetting("start_prompt", data.startPrompt);
    if (data.scope !== undefined) await writeSetting("scope", data.scope);
    if (data.features !== undefined) await writeSetting("features", JSON.stringify(data.features));
    if (data.accountId !== undefined) await writeSetting("account_id", data.accountId);

    if (data.triggers !== undefined) {
      const words = data.triggers
        .split(",")
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean);
      if (words.length === 0) {
        throw new Error("Нужно хотя бы одно слово-триггер — иначе бота нечем позвать.");
      }
      await writeSetting("triggers", words.join(", "));
    }

    return { ok: true as const };
  });

/* ─────────────────────── Шаблоны Meta ─────────────────────── */

export const getWhatsAppTemplatesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdminWithModule();
    const { syncWhatsAppTemplates } = await import("./whatsapp.server");
    // Источник истины — Meta; локальная копия нужна, чтобы показать статус и
    // причину отказа, не дёргая Zernio на каждый рендер вкладки.
    const templates = await syncWhatsAppTemplates(data.accountId);
    return { templates };
  });

export const createWhatsAppTemplateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1),
        // Meta принимает только нижний регистр, цифры и подчёркивания.
        name: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(
            /^[a-z0-9_]+$/,
            "Имя шаблона: только латиница в нижнем регистре, цифры и подчёркивания",
          ),
        category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
        language: z.string().trim().min(2).max(10),
        body: z.string().trim().min(1).max(1024),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdminWithModule();
    const { createWhatsAppTemplate } = await import("./zernio.server");
    const { syncWhatsAppTemplates } = await import("./whatsapp.server");

    const result = await createWhatsAppTemplate({
      accountId: data.accountId,
      name: data.name,
      category: data.category,
      language: data.language,
      components: [{ type: "BODY", text: data.body }],
    });
    if (!result.ok) return result;

    // Сразу подтягиваем список: у только что созданного шаблона статус
    // PENDING, и продавец должен увидеть его в таблице, а не пустоту.
    await syncWhatsAppTemplates(data.accountId);
    return result;
  });

/* ─────────────────────── Переписка ─────────────────────── */

export const getWhatsAppConversationsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ accountId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { listZernioConversations } = await import("./zernio.server");
    await requireAdminWithModule();
    return { conversations: await listZernioConversations(data.accountId, "whatsapp") };
  });

export const getWhatsAppConversationMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ accountId: z.string().min(1), conversationId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { listZernioConversationMessages } = await import("./zernio.server");
    await requireAdminWithModule();
    return {
      messages: await listZernioConversationMessages(data.accountId, data.conversationId),
    };
  });

export const sendWhatsAppConversationMessageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        accountId: z.string().min(1),
        conversationId: z.string().min(1),
        message: z.string().trim().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { sendZernioInboxMessage } = await import("./zernio.server");
    await requireAdminWithModule();
    return await sendZernioInboxMessage(data.conversationId, data.accountId, data.message, {
      platform: "whatsapp",
    });
  });
