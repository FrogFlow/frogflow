import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export const listOrders = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const s = await db();
  // Без потолка: он резал историю до 200 заказов, и всё, что старше, просто
  // пропадало из админки — а заказы тут живут годами и нужны для разбора
  // обращений. Выборка идёт под ключом арендатора, то есть только свои строки.
  const { data, error } = await s
    .from("orders")
    .select("*, order_items(id, name_snapshot, price_snapshot, quantity)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

/** Точные счётчики для дашборда: считаются в базе, а не по загруженному списку. */
export const getDashboardStats = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const s = await db();

  const countExact = async (table: "orders" | "products", filter?: (q: any) => any) => {
    let q = s.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const [products, total, awaiting, delivered, delivering] = await Promise.all([
    countExact("products"),
    countExact("orders"),
    countExact("orders", (q) =>
      q.in("status", ["awaiting_payment", "awaiting_confirmation"]),
    ),
    countExact("orders", (q) => q.eq("status", "delivered")),
    countExact("orders", (q) => q.eq("status", "delivering")),
  ]);

  return { products, total, awaiting, delivered, delivering };
});

export const getOrder = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return order;
  });

export const confirmOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { deliverOrder } = await import("./orders.server");
    await requireAdmin();
    return await deliverOrder(data.id);
  });

export const redeliverOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { deliverOrder } = await import("./orders.server");
    await requireAdmin();
    // Full re-send from the beginning (files, not links)
    return await deliverOrder(data.id, { force: true, resume: false });
  });

/** Continue a stuck «Выдаётся» order from delivery_index (next batch of files). */
export const continueDeliveryOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { deliverOrder } = await import("./orders.server");
    await requireAdmin();
    return await deliverOrder(data.id, { force: true, resume: true });
  });

export const rejectOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int(), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { tg } = await import("./telegram.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .update({ status: "rejected", admin_note: data.note ?? null })
      .eq("id", data.id)
      .select("telegram_id, order_no")
      .single();
    if (error) throw new Error(error.message);
    await tg("sendMessage", {
      chat_id: order!.telegram_id,
      text: `❌ Ваш заказ #${(order as any)?.order_no ?? data.id} отклонён.\n${data.note ? `\nПричина: ${data.note}\n` : ""}\nЕсли это ошибка — напишите продавцу.`,
    });
    return { ok: true as const };
  });

/** Nudge buyer: re-send current payment options for an awaiting_payment order. */
export const remindPaymentOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { remindOrderPayment } = await import("./bot.server");
    await requireAdmin();
    return await remindOrderPayment(data.id);
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    await s.from("order_items").delete().eq("order_id", data.id);
    const { error } = await s.from("orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    // Не сбрасываем sequence — это опасно при параллельных заказах
    return { ok: true as const };
  });
