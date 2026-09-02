/** Telegram messages that belong to one admin order notification pack. */
export type AdminNotifyTgRef = { chat_id: string; message_id: number; buttons?: boolean };

export type AdminNotifyPack = {
  refs: AdminNotifyTgRef[];
  deleteAfter: string | null;
};

/** Keep the pack visible after confirm/reject so the seller can mark it for colleagues. */
export const ADMIN_NOTIFY_DISMISS_DELAY_MS = 5 * 60 * 1000;

export function adminNotifySettingKey(orderId: number): string {
  return `admin_notify_tg:${orderId}`;
}

export function isAdminNotifySettingKey(key: string): boolean {
  return key.startsWith("admin_notify_tg:");
}

function refsFromUnknown(value: unknown): AdminNotifyTgRef[] {
  if (!Array.isArray(value)) return [];
  const refs: AdminNotifyTgRef[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const chatId = (row as AdminNotifyTgRef).chat_id;
    const messageId = (row as AdminNotifyTgRef).message_id;
    if (typeof chatId !== "string" || !chatId || !Number.isInteger(messageId)) continue;
    refs.push({
      chat_id: chatId,
      message_id: messageId,
      ...((row as AdminNotifyTgRef).buttons ? { buttons: true } : {}),
    });
  }
  return refs;
}

export function parseAdminNotifyPack(raw: string | null | undefined): AdminNotifyPack {
  const empty: AdminNotifyPack = { refs: [], deleteAfter: null };
  if (!raw?.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return { refs: refsFromUnknown(parsed), deleteAfter: null };
    }
    if (!parsed || typeof parsed !== "object") return empty;
    const record = parsed as { refs?: unknown; deleteAfter?: unknown };
    return {
      refs: refsFromUnknown(record.refs),
      deleteAfter:
        typeof record.deleteAfter === "string" && record.deleteAfter ? record.deleteAfter : null,
    };
  } catch {
    return empty;
  }
}

export function parseAdminNotifyRefs(raw: string | null | undefined): AdminNotifyTgRef[] {
  return parseAdminNotifyPack(raw).refs;
}

export function isAdminNotifyDue(pack: AdminNotifyPack, now = Date.now()): boolean {
  if (!pack.deleteAfter) return false;
  const at = Date.parse(pack.deleteAfter);
  return Number.isFinite(at) && at <= now;
}

export function collectTgMessageIds(result: unknown): number[] {
  if (!result) return [];
  const rows = Array.isArray(result) ? result : [result];
  const ids: number[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { message_id?: unknown }).message_id;
    if (typeof id === "number" && Number.isInteger(id)) ids.push(id);
  }
  return ids;
}

export function mergeAdminNotifyRefs(
  current: AdminNotifyTgRef[],
  extra: AdminNotifyTgRef[],
): AdminNotifyTgRef[] {
  const byToken = new Map<string, AdminNotifyTgRef>();
  for (const ref of [...current, ...extra]) {
    const token = `${ref.chat_id}:${ref.message_id}`;
    const prev = byToken.get(token);
    byToken.set(token, {
      chat_id: ref.chat_id,
      message_id: ref.message_id,
      ...(prev?.buttons || ref.buttons ? { buttons: true } : {}),
    });
  }
  return [...byToken.values()];
}
