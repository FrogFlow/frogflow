import { tg } from "./telegram.server";
import {
  adminNotifySettingKey,
  mergeAdminNotifyRefs,
  parseAdminNotifyRefs,
  type AdminNotifyTgRef,
} from "./admin-order-notify";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function rememberAdminNotifyMessages(
  orderId: number,
  refs: AdminNotifyTgRef[],
): Promise<void> {
  if (!refs.length) return;
  try {
    const s = await db();
    const key = adminNotifySettingKey(orderId);
    const { data } = await s.from("app_settings").select("value").eq("key", key).maybeSingle();
    const next = mergeAdminNotifyRefs(parseAdminNotifyRefs(data?.value), refs);
    await s.from("app_settings").upsert({ key, value: JSON.stringify(next) });
  } catch (e) {
    console.error("[bot] failed to remember admin notify messages", orderId, e);
  }
}

/**
 * Удаляет пачку Telegram-уведомлений по заказу (сводка, состав, чек, обложки)
 * после «принять» / «отклонить» — и из бота, и из панели.
 */
export async function dismissAdminOrderNotifications(
  orderId: number,
  extra: AdminNotifyTgRef[] = [],
): Promise<void> {
  const s = await db();
  const key = adminNotifySettingKey(orderId);
  let stored: AdminNotifyTgRef[] = [];
  try {
    const { data } = await s.from("app_settings").select("value").eq("key", key).maybeSingle();
    stored = parseAdminNotifyRefs(data?.value);
  } catch (e) {
    console.error("[bot] failed to load admin notify messages", orderId, e);
  }
  const refs = mergeAdminNotifyRefs(stored, extra);
  for (const ref of refs) {
    try {
      await tg("deleteMessage", { chat_id: ref.chat_id, message_id: ref.message_id });
    } catch (e) {
      console.error("[bot] failed to delete admin notify message", ref, e);
    }
  }
  try {
    await s.from("app_settings").delete().eq("key", key);
  } catch (e) {
    console.error("[bot] failed to clear admin notify messages", orderId, e);
  }
}
