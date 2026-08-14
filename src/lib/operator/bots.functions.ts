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
