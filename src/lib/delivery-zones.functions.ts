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

/**
 * Сколько ещё не закрытых заказов ссылаются на эту зону (Блок 9, находка
 * 9.3) — раньше удаление зоны не предупреждало вообще ни о чём. История
 * этих заказов не пострадает от самого удаления (delivery_zone_name —
 * снимок на момент выбора, а не живая ссылка), но продавец должен видеть,
 * скольких открытых заказов это касается, прежде чем нажать "Удалить".
 *
 * Без брошенных чекаутов, которые всё равно уйдут ближайшей ночной уборкой
 * (nightly_orders_maintenance, MIGRATION-57) — иначе продавец видел
 * пугающее число и откладывал удаление мёртвой зоны, хотя реальных заказов
 * на ней не было ни одного. Условие OR — точное отрицание DELETE-условия
 * той же функции: заказ учитывается, если НЕ выполняется одновременно всё
 * из «старый + без даты получения + не ручной ввод».
 */
export const countOrdersUsingZone = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const s = await db();
    const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await s
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("delivery_zone_id", data.id)
      .not("status", "in", "(delivered,rejected)")
      .or(
        `status.not.in.(awaiting_confirmation,awaiting_payment),created_at.gte.${staleCutoff},fulfillment_at.not.is.null,platform.eq.manual`,
      );
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
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
