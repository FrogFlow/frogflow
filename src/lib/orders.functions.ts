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

  // inProduction — Блок 6, находка 6.4: главный экран считал только
  // awaiting_*/delivered/delivering, физическая производственная очередь
  // (accepted/in_production/ready) была ему не видна вовсе — «47 тортов в
  // работе» показывались как «Ждут подтверждения 0».
  const [products, total, awaiting, delivered, delivering, inProduction] = await Promise.all([
    countProducts(),
    countOrders(),
    countOrders(["awaiting_payment", "awaiting_confirmation"]),
    countOrders(["delivered"]),
    countOrders(["delivering"]),
    countOrders(["accepted", "in_production", "ready"]),
  ]);

  return { products, total, awaiting, delivered, delivering, inProduction };
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
      .select("fulfillment_kind, total, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      const { acceptOrder, amountDueNow, recordPayment } = await import("./fulfillment.server");
      // Статус ДО acceptOrder — она его меняет. "awaiting_payment" значит,
      // что покупатель ещё не присылал чек: продавец здесь принимает заказ
      // "на доверие", а не подтверждает получение денег, поэтому платёж
      // писать не в чём (Блок 1, находка 1.2). "awaiting_confirmation" —
      // чек был прислан, тут запись платежа законна.
      const hadProof = order.status !== "awaiting_payment";
      const result = await acceptOrder(data.id);
      // alreadyAccepted — это либо двойной клик, либо повторный webhook: во
      // обоих случаях запись платежа второй раз задвоила бы paid_amount
      // (Блок 1, находка 1.1).
      if (!result.alreadyAccepted && hadProof) {
        const due = await amountDueNow({
          total: Number(order.total),
          fulfillment_kind: order.fulfillment_kind,
        });
        // recordPayment сама не бросает при исчерпанных попытках CAS —
        // возвращает false (Блок 1, находка 1.8), .catch() ловил только
        // исключения.
        const paid = await recordPayment(data.id, due).catch((e) => {
          console.error("[orders] recordPayment failed", data.id, e);
          return false;
        });
        if (!paid) console.error("[orders] recordPayment returned false", data.id);
      }
      const { dismissAdminOrderNotifications } = await import("./admin-order-notify.server");
      await dismissAdminOrderNotifications(data.id).catch((e) =>
        console.error("[orders] dismiss admin notify failed", data.id, e),
      );
      return result;
    }
    const { deliverOrder } = await import("./orders.server");
    const delivered = await deliverOrder(data.id);
    const { dismissAdminOrderNotifications } = await import("./admin-order-notify.server");
    await dismissAdminOrderNotifications(data.id).catch((e) =>
      console.error("[orders] dismiss admin notify failed", data.id, e),
    );
    return delivered;
  });

/**
 * Внести оплату вручную (остаток по задатку, оплата наличными при выдаче) —
 * единственная точка входа, которая позволяет продавцу закрыть разрыв между
 * paid_amount и total после того, как все автоматические пути уже
 * отработали (Блок 1, находка 1.5 / Блок 7, находка 7.2). Не даёт уйти в
 * минус и не даёт превысить total — сумма "к доплате" считается на клиенте
 * из total-paid_amount, но сервер всё равно перепроверяет сам, без доверия
 * к присланному числу.
 */
export const recordManualPayment = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), amount: z.number().positive() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("total, paid_amount, fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Заказ не найден");
    const remaining = Number(order.total) - (Number(order.paid_amount) || 0);
    if (data.amount > remaining + 0.01) {
      throw new Error(`Сумма больше остатка: осталось внести ${remaining.toFixed(2)}`);
    }
    const { recordPayment } = await import("./fulfillment.server");
    const ok = await recordPayment(data.id, data.amount);
    if (!ok) throw new Error("Не удалось записать платёж, попробуйте ещё раз");
    return { ok: true as const };
  });

/**
 * Блок 7, находка 7.3 (сознательно отложена) — завести заказ вручную
 * по-прежнему нельзя: кондитер, принявший заказ по телефону или в
 * комментариях Instagram, не может ввести его в систему без покупателя,
 * прошедшего через бота. Полноценная реализация — новый server fn
 * (выбор товара/варианта/количества, опционально дата/адрес для
 * физического заказа, контакт покупателя) плюс форма в этой странице —
 * заметная по объёму фича, а не точечная правка; остальные пять находок
 * этого блока (7.1, 7.2, 7.4, 7.5) уже сделаны в Блоке 1.
 */

/**
 * Исправить данные получения физического заказа (Блок 7, находка 7.1) —
 * покупательница позвонила перенести на субботу, продавцу нужно место
 * поправить в интерфейсе, а не в Supabase напрямую. Меняет только поля
 * получения, не трогает деньги/статус — для этого есть recordManualPayment/
 * advanceOrderFulfillment/rejectOrder.
 */
export const updateOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.number().int(),
        fulfillmentAt: z.string().min(1).nullable(),
        address: z.string().max(500).nullable(),
        note: z.string().max(500).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    const { error } = await s
      .from("orders")
      .update({
        fulfillment_at: data.fulfillmentAt,
        fulfillment_address: data.address,
        fulfillment_note: data.note,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Продвинуть физический заказ: accepted → in_production → ready → delivered. */
export const advanceOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const s = await db();
    // Гейт по fulfillment_kind (Блок 3, находка 3.5) — без него цифровой
    // заказ можно было провести accepted → in_production → ready →
    // delivered (эти статусы у digital никогда не пишутся штатно, но
    // ничто в этой функции раньше не мешало вызвать её на любом id), минуя
    // deliverOrder целиком — заказ становится delivered, начисляются
    // баллы/реферал, а ни один файл не отправлен.
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind !== "physical") {
      throw new Error("Это не физический заказ — статус продвигается только у физических товаров");
    }
    const { advanceFulfillment } = await import("./fulfillment.server");
    return await advanceFulfillment(data.id);
  });

/** Откатить физический заказ на шаг назад — исправить промах кнопкой (Блок 3, находка 3.6). */
export const revertOrderFulfillment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { revertFulfillment } = await import("./fulfillment.server");
    return await revertFulfillment(data.id);
  });

export const redeliverOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    // Гейт по fulfillment_kind (Блок 3, находка 3.4) — deliverOrder(force)
    // пишет status:"delivering" без фильтра по текущему статусу вовсе:
    // на физическом заказе это выдёргивало бы его, например, из
    // in_production в "выдаётся", помечало все позиции отправленными без
    // единого файла (их и нет) и уводило в delivered с начислением баллов.
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      throw new Error(
        "Это физический заказ — файлов для повторной отправки нет, статус ведите кнопками принять/в работу/готов/выдан",
      );
    }
    const { deliverOrder } = await import("./orders.server");
    // Full re-send from the beginning (files, not links)
    return await deliverOrder(data.id, { force: true, resume: false });
  });

/** Continue a stuck «Выдаётся» order from delivery_index (next batch of files). */
export const continueDeliveryOrder = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    // Тот же гейт, что и в redeliverOrder выше (Блок 3, находка 3.4).
    const s = await db();
    const { data: order, error } = await s
      .from("orders")
      .select("fulfillment_kind")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (order?.fulfillment_kind === "physical") {
      throw new Error(
        "Это физический заказ — файлов для выдачи нет, статус ведите кнопками принять/в работу/готов/выдан",
      );
    }
    const { deliverOrder } = await import("./orders.server");
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
    const { dismissAdminOrderNotifications } = await import("./admin-order-notify.server");
    await dismissAdminOrderNotifications(data.id).catch((e) =>
      console.error("[orders] dismiss admin notify failed", data.id, e),
    );
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
    // Заказ с внесённой оплатой (задаток, полная оплата) удалять нельзя —
    // это тихо стирает единственный след, что деньги были получены (Блок 7,
    // находка 7.4). Отменить такой заказ — через "Отклонить" (rejectOrder),
    // она сохраняет строку и её paid_amount.
    const { data: order, error: readErr } = await s
      .from("orders")
      .select("paid_amount")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (order && Number(order.paid_amount) > 0) {
      throw new Error(
        "У заказа есть внесённая оплата — удалять нельзя, иначе пропадёт запись о деньгах. Отклоните заказ вместо удаления.",
      );
    }
    await s.from("order_items").delete().eq("order_id", data.id);
    const { error } = await s.from("orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    // Не сбрасываем sequence — это опасно при параллельных заказах
    return { ok: true as const };
  });
