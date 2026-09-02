/** Telegram messages that belong to one admin order notification pack. */
export type AdminNotifyTgRef = { chat_id: string; message_id: number };

export function adminNotifySettingKey(orderId: number): string {
  return `admin_notify_tg:${orderId}`;
}

export function isAdminNotifySettingKey(key: string): boolean {
  return key.startsWith("admin_notify_tg:");
}

export function parseAdminNotifyRefs(raw: string | null | undefined): AdminNotifyTgRef[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is AdminNotifyTgRef => {
      if (!row || typeof row !== "object") return false;
      const chatId = (row as AdminNotifyTgRef).chat_id;
      const messageId = (row as AdminNotifyTgRef).message_id;
      return typeof chatId === "string" && chatId.length > 0 && Number.isInteger(messageId);
    });
  } catch {
    return [];
  }
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
  const seen = new Set<string>();
  const next: AdminNotifyTgRef[] = [];
  for (const ref of [...current, ...extra]) {
    const token = `${ref.chat_id}:${ref.message_id}`;
    if (seen.has(token)) continue;
    seen.add(token);
    next.push(ref);
  }
  return next;
}
