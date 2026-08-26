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
  loadStorageByKind,
  loadHealthAll,
  setArchived,
  checkReadiness,
  listOwnerCandidates,
  listFeed,
  checkReadinessAll,
  exportClientsCsv,
  getHealthHistory,
} from "./bots.server";

async function actor(): Promise<string> {
  const s = await getOperatorSession();
  return s.data.username || "operator";
}

export const listBotsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z
      .object({ includeArchived: z.boolean().optional() })
      .catch({})
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return listBots(data.includeArchived === true);
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
  bot_name: z.string().trim().min(1).max(120).optional(),
  // Идентификатор попадает в служебные имена, поэтому только латиница, цифры,
  // дефис и подчёркивание — без пробелов и кириллицы.
  owner_id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_-]+$/i, "Только латиница, цифры, дефис и подчёркивание")
    .optional(),
  owner_name: z.string().nullable().optional(),
  owner_contact: z.string().nullable().optional(),
  owner_telegram_id: z.number().int().nullable().optional(),
  app_url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  paused_message: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const updateBotMetaFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => BotMetaInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    const { botId, ...patch } = data;
    await updateBotMeta(botId, patch, await actor());
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
 * «Всё ли готово у клиента» — одной кнопкой. Собирает три источника, которые
 * при подключении расходятся чаще всего: переменные деплоя, запись в карточке
 * и мнение Telegram о вебхуке.
 */
export const checkReadinessFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return checkReadiness(data.botId);
  });

/** Журнал по всем клиентам сразу — «что вообще происходило», а не «что с этим клиентом». */
export const listFeedFn = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z
      .object({
        before: z.string().optional(),
        botId: z.string().uuid().optional(),
        kind: z.string().optional(),
      })
      .catch({})
      .parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return listFeed(data);
  });

/** Проверка готовности по всем действующим клиентам разом. */
export const checkReadinessAllFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireOperator();
  return checkReadinessAll();
});

/** Кто может быть владельцем: admin_chat_id из настроек бота плюс те, кто ему писал. */
export const listOwnerCandidatesFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return listOwnerCandidates(data.botId);
  });

export const setArchivedFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ botId: z.string().uuid(), archived: z.boolean() }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    await setArchived(data.botId, data.archived, await actor());
    return { ok: true as const };
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

/** Разбивка хранилища по видам файлов на клиента — для донат-чартов панели. */
export const listStorageByKindFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  return Object.fromEntries(await loadStorageByKind());
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
        // Почта продавца — при включённом Instagram: заказы оттуда выдаются
        // письмом. Как и токены, панель их не хранит.
        smtpHost: z.string().trim().max(200).nullable().optional(),
        smtpUser: z.string().trim().max(200).nullable().optional(),
        smtpPassword: z.string().trim().max(200).nullable().optional(),
        appUrlOverride: z.string().trim().max(300).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    const { buildEnvBlockFor } = await import("./env-block.server");
    const result = await buildEnvBlockFor(data);
    // В журнал — сам факт, без единого секрета: журнал читается в панели.
    const { logEvent } = await import("./events.server");
    await logEvent(data.botId, await actor(), "env_block", {
      mode: data.mode,
      with_vip: Boolean(data.vipBotToken),
    });
    return result;
  });

/** Клиенты + выручка одним CSV для выгрузки из панели. */
export const exportClientsCsvFn = createServerFn({ method: "POST" }).handler(async () => {
  await requireOperator();
  return exportClientsCsv();
});

/** История падений клиента за последние 14 дней — вкладка «Деплой» карточки. */
export const getHealthHistoryFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => BotIdInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return getHealthHistory(data.botId);
  });

/** Чего не хватает самой панели. Пустые значения в блоке иначе всплывают уже на упавшем деплое клиента. */
export const panelSelfCheckFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  const { panelSelfCheck } = await import("./env-block.server");
  return panelSelfCheck();
});
