import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { normalizePromoCode } from "./promo-codes";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const listPromoCodes = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(40),
  discount_type: z.enum(["percent", "fixed"]),
  discount_value: z.number().positive(),
  max_uses: z.number().int().positive().nullable(),
  valid_until: z.string().nullable(),
  is_active: z.boolean().default(true),
});

export const savePromoCode = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const code = normalizePromoCode(data.code);
    const row = {
      code,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      max_uses: data.max_uses,
      valid_until: data.valid_until,
      is_active: data.is_active,
    };
    if (data.id) {
      const { error } = await s.from("promo_codes").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await s.from("promo_codes").insert(row);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deletePromoCode = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("promo_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
