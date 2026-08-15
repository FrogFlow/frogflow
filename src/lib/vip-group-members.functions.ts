import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchVipChatMember, loadVipGroupId } from "./vip-group-members.server";

/**
 * Раздел платный: мало быть админом своего бота — модуль должен быть
 * подключён. Без второй проверки тумблер в панели оператора прячет только
 * пункт меню, а серверную функцию по-прежнему можно вызвать напрямую.
 */
async function requireAdminWithModule() {
  const { requireAdmin } = await import("./admin-session.server");
  const { requireModule } = await import("./modules/require-module.server");
  await requireAdmin();
  await requireModule("vip");
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type VipGroupMemberLookup = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  member_status: string;
  is_in_group: boolean;
};

// Pure string check — kept out of vip-group-members.server.ts so this module
// (imported by a route component, not just behind createServerFn) doesn't
// drag the server-only Telegram Bot API calls into the client bundle.
function memberStatusIsInGroup(status: string): boolean {
  return status === "member" || status === "administrator" || status === "creator" || status === "restricted";
}

function toLookup(member: NonNullable<Awaited<ReturnType<typeof fetchVipChatMember>>>): VipGroupMemberLookup {
  return {
    telegram_id: member.user.id,
    username: member.user.username ?? null,
    first_name: member.user.first_name ?? null,
    last_name: member.user.last_name ?? null,
    member_status: member.status,
    is_in_group: memberStatusIsInGroup(member.status),
  };
}

export const lookupVipGroupMemberFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        telegram_id: z
          .string()
          .min(1)
          .regex(/^\d{5,15}$/, "Telegram ID должен быть числом"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdminWithModule();
    const s = await db();
    const groupId = await loadVipGroupId(s);
    if (!groupId) throw new Error("Не настроен ID VIP группы в /admin/vip/settings");

    const telegramId = parseInt(data.telegram_id, 10);
    const member = await fetchVipChatMember(groupId, telegramId);
    if (!member) {
      throw new Error(
        "Пользователь не найден в VIP-группе. Убедитесь что ID верный и человек состоит в группе (или бот — админ).",
      );
    }

    if (member.user.is_bot) {
      throw new Error("Это бот — проверять не нужно.");
    }

    return toLookup(member);
  });

// createServerFn's own tree-shaking only covers its own handler; a plain
// exported function in the same statically-imported module is not protected
// and drags the .server import (Telegram Bot API calls) into the client
// bundle. createServerOnlyFn gets the same stripping without turning this
// into an RPC endpoint of its own — it's an internal helper, not a route.
/** Used by users-search fallback — caller must be admin. */
export const lookupGroupMemberForSearch = createServerOnlyFn(async (telegramId: number) => {
  const s = await db();
  const groupId = await loadVipGroupId(s);
  if (!groupId) return null;

  const member = await fetchVipChatMember(groupId, telegramId);
  if (!member?.user || member.user.is_bot) return null;

  return toLookup(member);
});
