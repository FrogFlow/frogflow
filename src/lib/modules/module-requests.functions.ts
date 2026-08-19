import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-session.server";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "./registry";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function requireBotId(): string {
  const id = process.env.BOT_ID?.trim();
  if (!id) throw new Error("BOT_ID не задан в переменных окружения этого деплоя.");
  return id;
}

/** Ключи модулей, на которые у этого бота уже есть заявка в очереди. */
export const getPendingModuleRequests = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s
    .from("module_requests")
    .select("module_key")
    .eq("bot_id", requireBotId())
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.module_key as ModuleKey);
});

const RequestInput = z.object({ moduleKey: z.string().min(1) });

/**
 * Заявка «Заказать подключение» из витрины /admin/modules — пишет строку в
 * module_requests и возвращает deep-link на оператора в Telegram, если
 * OPERATOR_TELEGRAM_USERNAME задан для этого деплоя. Оба канала, по прямому
 * решению оператора (и таблица, и ссылка), а не один вместо другого.
 */
export const requestModuleConnection = createServerFn({ method: "POST" })
  .validator((d: unknown) => RequestInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();

    const key = data.moduleKey as ModuleKey;
    if (!MODULE_KEYS.includes(key)) throw new Error(`Неизвестный модуль: ${data.moduleKey}`);
    if (moduleDef(key).status !== "available") {
      throw new Error(`Модуль «${moduleDef(key).title}» ещё не готов к подключению.`);
    }

    const s = await db();
    const botId = requireBotId();
    const { error } = await s.from("module_requests").insert({ bot_id: botId, module_key: key });
    // 23505 = unique_violation — заявка на этот модуль уже стоит в очереди
    // (частичный уникальный индекс uq_module_requests_pending), это не ошибка.
    if (error && error.code !== "23505") throw new Error(error.message);

    const username = process.env.OPERATOR_TELEGRAM_USERNAME?.trim().replace(/^@/, "");
    const telegramUrl = username
      ? `https://t.me/${username}?text=${encodeURIComponent(
          `Здравствуйте! Хочу подключить модуль «${moduleDef(key).title}».`,
        )}`
      : null;

    return { ok: true as const, telegramUrl };
  });
