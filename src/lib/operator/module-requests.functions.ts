import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./guard.server";
import { moduleDef, type ModuleKey } from "@/lib/modules/registry";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type PendingModuleRequest = {
  bot_id: string;
  module_key: ModuleKey;
  module_title: string;
  requested_at: string;
};

/**
 * Заявки «Заказать подключение» из клиентских панелей (/admin/modules), ещё
 * не отмеченные оператором как обработанные. Панель оператора видит все
 * бота сразу — service_role проходит мимо RLS module_requests так же, как
 * уже проходит мимо admin_login_attempts.
 */
export const listPendingModuleRequestsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("module_requests")
    .select("bot_id, module_key, requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const key = r.module_key as ModuleKey;
    // Реестр модулей может измениться после того, как заявка уже легла в
    // базу (модуль переименован/убран) — не роняем панель оператора из-за
    // одной устаревшей строки, показываем сырой ключ как есть.
    let title: string = key;
    try {
      title = moduleDef(key).title;
    } catch {
      // оставляем сырой ключ
    }
    return { bot_id: r.bot_id, module_key: key, module_title: title, requested_at: r.requested_at };
  }) satisfies PendingModuleRequest[];
});

const ResolveInput = z.object({ botId: z.string().uuid(), moduleKey: z.string().min(1) });

/** Отмечает заявку обработанной — обычно после того, как оператор включил модуль или связался с клиентом. */
export const resolveModuleRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => ResolveInput.parse(d))
  .handler(async ({ data }) => {
    await requireOperator();
    const s = await db();
    const { error } = await s
      .from("module_requests")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("bot_id", data.botId)
      .eq("module_key", data.moduleKey)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
