import { tg } from "./telegram.server";
import {
  ADMIN_NOTIFY_DISMISS_DELAY_MS,
  adminNotifySettingKey,
  isAdminNotifyDue,
  isAdminNotifySettingKey,
  mergeAdminNotifyRefs,
  parseAdminNotifyPack,
  type AdminNotifyPack,
  type AdminNotifyTgRef,
} from "./admin-order-notify";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function loadAdminNotifyPack(orderId: number): Promise<AdminNotifyPack> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", adminNotifySettingKey(orderId))
    .maybeSingle();
  return parseAdminNotifyPack(data?.value);
}

async function saveAdminNotifyPack(orderId: number, pack: AdminNotifyPack): Promise<void> {
  const s = await db();
  const key = adminNotifySettingKey(orderId);
  if (!pack.refs.length && !pack.deleteAfter) {
    await s.from("app_settings").delete().eq("key", key);
    return;
  }
  await s.from("app_settings").upsert({ key, value: JSON.stringify(pack) });
}

export async function rememberAdminNotifyMessages(
  orderId: number,
  refs: AdminNotifyTgRef[],
): Promise<void> {
  if (!refs.length) return;
  try {
    const pack = await loadAdminNotifyPack(orderId);
    pack.refs = mergeAdminNotifyRefs(pack.refs, refs);
    await saveAdminNotifyPack(orderId, pack);
  } catch (e) {
    console.error("[bot] failed to remember admin notify messages", orderId, e);
  }
}

async function stripAdminNotifyButtons(refs: AdminNotifyTgRef[]): Promise<void> {
  for (const ref of refs) {
    if (!ref.buttons) continue;
    try {
      await tg("editMessageReplyMarkup", {
        chat_id: ref.chat_id,
        message_id: ref.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    } catch (e) {
      console.error("[bot] failed to strip admin notify buttons", ref, e);
    }
  }
}

async function deleteAdminNotifyMessages(refs: AdminNotifyTgRef[]): Promise<void> {
  for (const ref of refs) {
    try {
      await tg("deleteMessage", { chat_id: ref.chat_id, message_id: ref.message_id });
    } catch (e) {
      console.error("[bot] failed to delete admin notify message", ref, e);
    }
  }
}

/**
 * After confirm/reject: drop the buttons immediately, keep the pack for
 * ADMIN_NOTIFY_DISMISS_DELAY_MS so the seller can mark it for colleagues,
 * then the minute cron deletes it.
 */
export async function scheduleAdminOrderNotifyDismiss(
  orderId: number,
  extra: AdminNotifyTgRef[] = [],
): Promise<void> {
  try {
    const pack = await loadAdminNotifyPack(orderId);
    pack.refs = mergeAdminNotifyRefs(
      pack.refs,
      extra.map((ref) => ({ ...ref, buttons: true })),
    );
    if (!pack.deleteAfter || !Number.isFinite(Date.parse(pack.deleteAfter))) {
      pack.deleteAfter = new Date(Date.now() + ADMIN_NOTIFY_DISMISS_DELAY_MS).toISOString();
    }
    await saveAdminNotifyPack(orderId, pack);
    await stripAdminNotifyButtons(pack.refs);
  } catch (e) {
    console.error("[bot] failed to schedule admin notify dismiss", orderId, e);
  }
}

/** Immediate delete — used by the due-pack sweep, not by confirm/reject. */
export async function dismissAdminOrderNotifications(
  orderId: number,
  extra: AdminNotifyTgRef[] = [],
): Promise<void> {
  const s = await db();
  const key = adminNotifySettingKey(orderId);
  let pack: AdminNotifyPack = { refs: [], deleteAfter: null };
  try {
    pack = await loadAdminNotifyPack(orderId);
  } catch (e) {
    console.error("[bot] failed to load admin notify messages", orderId, e);
  }
  const refs = mergeAdminNotifyRefs(pack.refs, extra);
  await deleteAdminNotifyMessages(refs);
  try {
    await s.from("app_settings").delete().eq("key", key);
  } catch (e) {
    console.error("[bot] failed to clear admin notify messages", orderId, e);
  }
}

export async function flushDueAdminOrderNotifications(
  now = Date.now(),
): Promise<{ scanned: number; dismissed: number }> {
  const s = await db();
  const { data, error } = await s.from("app_settings").select("key, value");
  if (error) throw new Error(error.message);
  const due = (data ?? []).filter((row) => {
    const key = String(row.key ?? "");
    if (!isAdminNotifySettingKey(key)) return false;
    return isAdminNotifyDue(parseAdminNotifyPack(row.value), now);
  });
  let dismissed = 0;
  for (const row of due) {
    const orderId = Number(String(row.key).slice("admin_notify_tg:".length));
    if (!Number.isInteger(orderId) || orderId <= 0) continue;
    await dismissAdminOrderNotifications(orderId);
    dismissed += 1;
  }
  return { scanned: due.length, dismissed };
}
