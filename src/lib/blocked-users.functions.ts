import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Раздел платный: мало быть админом своего бота — модуль должен быть
 * подключён. Без второй проверки тумблер в панели оператора прячет только
 * пункт меню, а серверную функцию по-прежнему можно вызвать напрямую.
 */
async function requireAdminWithModule() {
  const { requireAdmin } = await import("./admin-session.server");
  const { requireModule } = await import("./modules/require-module.server");
  await requireAdmin();
  await requireModule("blocked");
}

export const listBlockedUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listBlockedUsers } = await import("./blocked-users.server");
  await requireAdminWithModule();
  return await listBlockedUsers();
});

export const blockTelegramUserFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegram_id: z.union([z.string(), z.number()]),
        reason: z.string().max(500).optional(),
        username: z.string().optional(),
        first_name: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { blockTelegramUser } = await import("./blocked-users.server");
    await requireAdminWithModule();
    const telegramId = Number(data.telegram_id);
    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      throw new Error("Укажите корректный Telegram ID");
    }
    return await blockTelegramUser(telegramId, {
      reason: data.reason,
      username: data.username ?? null,
      first_name: data.first_name ?? null,
    });
  });

export const unblockTelegramUserFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ telegram_id: z.union([z.string(), z.number()]) }).parse(d))
  .handler(async ({ data }) => {
    const { unblockTelegramUser } = await import("./blocked-users.server");
    await requireAdminWithModule();
    const telegramId = Number(data.telegram_id);
    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      throw new Error("Укажите корректный Telegram ID");
    }
    return await unblockTelegramUser(telegramId);
  });
