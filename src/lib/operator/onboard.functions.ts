import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, getOperatorSession } from "./guard.server";
import { MODULE_KEYS, type ModuleKey } from "@/lib/modules/registry";
import { onboardClient, repointWebhook, verifyBotToken } from "./onboard.server";

async function actor(): Promise<string> {
  const s = await getOperatorSession();
  return s.data.username || "operator";
}

const ModuleKeyEnum = z.enum(MODULE_KEYS as [string, ...string[]]);
const TokenSchema = z
  .string()
  .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "Токен не похож на выданный BotFather");

/** Проверка токена до отправки формы: показывает, что за бот, и ловит опечатку. */
export const verifyBotTokenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ token: TokenSchema }).parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    const me = await verifyBotToken(data.token);
    return { username: me.username, first_name: me.first_name };
  });

const OnboardInput = z.object({
  bot_name: z.string().min(1),
  owner_slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "Только латиница в нижнем регистре, цифры, дефис и подчёркивание"),
  bot_token: TokenSchema,
  app_url: z.string().url().nullable(),
  modules: z.array(ModuleKeyEnum),
  owner_name: z.string().nullable(),
  owner_contact: z.string().nullable(),
  owner_telegram_id: z.number().int().nullable(),
  notes: z.string().nullable(),
  first_order_no: z.number().int().min(0),
  set_webhook: z.boolean(),
});

export const onboardClientFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => OnboardInput.parse(data))
  .handler(async ({ data }) => {
    await requireOperator();
    return onboardClient({ ...data, modules: data.modules as ModuleKey[] }, await actor());
  });

export const repointWebhookFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        token: TokenSchema,
        webhookSecret: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireOperator();
    return repointWebhook(data.botId, data.token, data.webhookSecret, await actor());
  });
