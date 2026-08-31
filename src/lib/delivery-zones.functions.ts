import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const listDeliveryZones = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const { data, error } = await s.from("delivery_zones").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
});

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  price: z.number().min(0),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

export const saveDeliveryZone = createServerFn({ method: "POST" })
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    if (data.id) {
      const { error } = await s
        .from("delivery_zones")
        .update({
          name: data.name,
          price: data.price,
          sort_order: data.sort_order,
          is_active: data.is_active,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await s.from("delivery_zones").insert({
        name: data.name,
        price: data.price,
        sort_order: data.sort_order,
        is_active: data.is_active,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const deleteDeliveryZone = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const { error } = await s.from("delivery_zones").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
