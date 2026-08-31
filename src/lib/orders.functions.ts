import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchAll } from "./csv";

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
  //
  // PostgREST сам молча обрывает любой единичный select на 1000 строках —
  // при 497 заказах это ещё не било, но это вопрос времени; fetchAll читает
  // страницами, пока страница приходит полной (Блок 3.3).
  return fetchAll(
    (from, to) =>
      s
        .from("orders")
        .select("*, order_items(id, name_snapshot, price_snapshot, quantity)")
        .order("created_at", { ascending: false })
        .range(from, to),
    "заказы",
  );
});

/** Точные счётчики для дашборда: считаются в базе, а не по загруженному списку. */
export const getDashboardStats = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const s = await db();

  const countOrders = async (statusIn?: string[]) => {
    let q = s.from("orders").select("*", { count: "exact", head: true });
    if (statusIn) q = q.in("status", statusIn);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const countProducts = async () => {
    const { count, error } = await s.from("products").select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const [products, total, awaiting, delivered, delivering] = await Promise.all([
    countProducts(),
    countOrders(),
    countOrders(["awaiting_payment", "awaiting_confirmation"]),
    countOrders(["delivered"]),
    countOrders(["delivering"]),
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
    await requireAdmin();
    const s = await db();
    // Снимок fulfillment_kind на заказе (не на товаре — товар мог смениться
    // задним числом), тем же приёмом, что и в bot.server.ts confirm:.
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind, total")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      const { acceptOrder, amountDueNow, recordPayment } = await import("./fulfillment.server");
      const result = await acceptOrder(data.id);
      const due = await amountDueNow({
        total: Number(order.total),
        fulfillment_kind: order.fulfillment_kind,
      });
      await recordPayment(data.id, due).catch((e) =>
        console.error("[orders] recordPayment failed", data.id, e),
      );
      return result;
    }
    const { deliverOrder } = await import("./orders.server");
    return await deliverOrder(data.id);
  });

/** Продвинуть физический заказ: accepted → in_production → ready → delivered. */
export const advanceOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { advanceFulfillment } = await import("./fulfillment.server");
    return await advanceFulfillment(data.id);
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
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), note: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    const { notifyOrderCustomer, rejectOrderSafely } = await import("./orders.server");
    await requireAdmin();
    // Only touch admin_note when the admin actually typed one — it also
    // carries the `proof_auto` OCR marker, which an unconditional write
    // here used to erase on every reject.
    const claim = await rejectOrderSafely(data.id, data.note);
    if (!claim.ok) {
      throw new Error(`Заказ #${data.id} нельзя отклонить: статус уже «${claim.status}».`);
    }
    const order = claim.order;

    /**
     * Пишем туда, откуда пришёл заказ.
     *
     * Раньше здесь была прямая отправка в Telegram по `order.telegram_id`. У
     * покупателя из Instagram этот идентификатор синтетический, чата с таким
     * номером нет — и об отклонении он не узнавал вовсе: просто ждал материалы,
     * которых не будет. А отклонения тут обычное дело: чек нечитаемый, сумма не
     * та.
     */
    const notified = await notifyOrderCustomer(
      data.id,
      `❌ Ваш заказ №${order?.order_no ?? data.id} отклонён.\n${data.note ? `\nПричина: ${data.note}\n` : ""}\nЕсли это ошибка — напишите продавцу.`,
    );

    // Instagram запрещает писать позже 24 часов с последнего сообщения
    // покупателя, поэтому сообщить удаётся не всегда. Отклонение при этом
    // состоялось, и продавец должен знать, что человека придётся окликнуть сам.
    return { ok: true as const, customerNotified: notified };
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
