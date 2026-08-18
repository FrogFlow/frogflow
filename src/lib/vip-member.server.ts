/** Per-user VIP tariff assignment (e.g. legacy cheap price via hidden link). */

// supabaseAdmin is the client itself, not a factory — ReturnType<> doesn't
// apply to it, and `typeof import(...)` in type position already resolves
// the module synchronously, so no Awaited<> wrapper either.
type SupabaseAdmin = (typeof import("@/integrations-supabase/client.server"))["supabaseAdmin"];

type MemberUser = {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export async function assignMemberTariff(
  s: SupabaseAdmin,
  telegram_id: number,
  user: MemberUser,
  tariff_id: string,
  source: "deep_link" | "payment" | "admin" = "deep_link",
) {
  const { error } = await s.from("vip_member_profiles").upsert(
    {
      telegram_id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      assigned_tariff_id: tariff_id,
      assigned_at: new Date().toISOString(),
      assigned_source: source,
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) console.error("[vip-member] assign failed", error);
}

export async function getMemberAssignedTariff(s: SupabaseAdmin, telegram_id: number) {
  const { data } = await s
    .from("vip_member_profiles")
    .select("*, vip_tariffs(*)")
    .eq("telegram_id", telegram_id)
    .maybeSingle();

  const tariff = data?.vip_tariffs ?? null;
  if (!data?.assigned_tariff_id || !tariff?.is_active) return null;
  return tariff;
}
