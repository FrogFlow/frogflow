import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, getOperatorSession } from "./guard.server";
import { MODULE_KEYS, type ModuleKey } from "@/lib/modules/registry";
import {
  listBots,
  getBot,
  setModule,
  setBotStatus,
  updateBotMeta,
  listBotEvents,
  checkBotHealth,
  requestWebhookSetup,
  loadStats,
  loadHealthAll,
} from "./bots.server";

async function actor(): Promise<string> {
  const s = await getOperatorSession();
  return s.data.username || "operator";
}

export const listBotsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return listBots();
});

const BotIdInput = z.object({ botId: z.string().uuid() });

export const getBotFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return getBot(data.botId);
  });

const ModuleKeyEnum = z.enum(MODULE_KEYS as [string, ...string[]]);

export const setModuleFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ botId: z.string().uuid(), key: ModuleKeyEnum, enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    // z.enum(MODULE_KEYS) validates data.key is one of ModuleKey at runtime;
    // the cast just as[string,...] widened the array type dropped that.
    await setModule(data.botId, data.key as ModuleKey, data.enabled, await actor());
    return { ok: true as const };
  });

export const setBotStatusFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({ botId: z.string().uuid(), status: z.enum(["active", "paused", "suspended"]) })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await setBotStatus(data.botId, data.status, await actor());
    return { ok: true as const };
  });

const BotMetaInput = z.object({
  botId: z.string().uuid(),
  owner_name: z.string().nullable().optional(),
  owner_contact: z.string().nullable().optional(),
  owner_telegram_id: z.number().int().nullable().optional(),
  app_url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  paused_message: z.string().nullable().optional(),
});

export const updateBotMetaFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => BotMetaInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    const { botId, ...patch } = data;
    await updateBotMeta(botId, patch);
    return { ok: true as const };
  });

export const listBotEventsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return listBotEvents(data.botId);
  });

export const checkBotHealthFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return checkBotHealth(data.botId);
  });

export const requestWebhookSetupFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return requestWebhookSetup(data.botId, await actor());
  });

/**
 * Здоровье всех ботов разом. Отдельным запросом от списка: обход деплоев
 * занимает секунды, а таблица не должна ждать его, чтобы отрисоваться.
 */
export const listHealthFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return loadHealthAll();
});

/** Сводка по всем клиентам разом — отдаётся объектом, Map через сериализацию не проходит. */
export const listStatsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return Object.fromEntries(await loadStats());
});

/**
 * Собрать блок переменных окружения для уже заведённого клиента.
 *
 * Ради этого всё и затевалось: мастер подключения умеет только нового клиента,
 * а при переезде существующего собрать его переменные было нечем.
 *
 * Токен в базу не попадает — он нужен только чтобы подставить его в блок и
 * проверить через getMe, что это действительно рабочий бот.
 */
export const buildEnvBlockFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        mode: z.enum(["new", "running"]),
        botToken: z.string().trim().max(200).nullable().optional(),
        vipBotToken: z.string().trim().max(200).nullable().optional(),
        zernioApiKey: z.string().trim().max(200).nullable().optional(),
        zernioProfileId: z.string().trim().max(200).nullable().optional(),
        appUrlOverride: z.string().trim().max(300).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    const { buildEnvBlockFor } = await import("./env-block.server");
    const result = await buildEnvBlockFor(data);
    // В журнал — сам факт, без единого секрета: журнал читается в панели.
    // Ошибку записи не глушим: выдача ключа арендатора обязана оставлять след,
    // и потерю следа надо видеть хотя бы в логах.
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { error: evErr } = await supabaseAdmin.from("bot_events").insert({
      bot_id: data.botId,
      actor: await actor(),
      kind: "env_block",
      payload: { mode: data.mode, with_vip: Boolean(data.vipBotToken) },
    });
    if (evErr) console.error("[operator] не удалось записать bot_events:", evErr.message);
    return result;
  });

/** Чего не хватает самой панели. Пустые значения в блоке иначе всплывают уже на упавшем деплое клиента. */
export const panelSelfCheckFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  const { panelSelfCheck } = await import("./env-block.server");
  return panelSelfCheck();
});
