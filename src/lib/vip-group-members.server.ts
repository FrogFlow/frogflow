/** Telegram group member lookup helpers (getChatMember). */

import { tgVip } from "./vip-bot.server";

export type TgMemberUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_bot?: boolean;
};

export type TgChatMemberResult = {
  status: string;
  user: TgMemberUser;
};

/** Creator/admin — подписка не нужна, cron не кикает. */
export function memberStatusExemptFromSubscription(status: string): boolean {
  return status === "creator" || status === "administrator";
}

export async function fetchVipChatMember(
  groupId: string,
  telegramId: number,
): Promise<TgChatMemberResult | null> {
  const res = await tgVip("getChatMember", { chat_id: groupId, user_id: telegramId });
  if (!res.ok) return null;
  const r = res.result as TgChatMemberResult | undefined;
  if (!r?.user?.id) return null;
  return r;
}

export async function loadVipGroupId(
  // supabaseAdmin is the client itself, not a factory — ReturnType<> doesn't
  // apply to it. `typeof import(...)` in type position already resolves the
  // module synchronously, so no Awaited<> wrapper either.
  s: (typeof import("@/integrations-supabase/client.server"))["supabaseAdmin"],
): Promise<string> {
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "vip_group_id")
    .maybeSingle();
  return ((data?.value as string) || "").trim();
}
