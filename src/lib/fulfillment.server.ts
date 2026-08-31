import { DELIVERABLE_STATUSES } from "./orders.server";

/**
 * Статусная машина физического заказа (Ниши, Блок 6) — сосед orders.server.ts,
 * а не правка внутри: deliverOrder остаётся функцией отправки файлов и не
 * знает о физических заказах вовсе.
 *
 *   awaiting_payment/awaiting_confirmation → accepted → in_production → ready → delivered
 *                                                                    ↘ rejected
 *
 * "delivered" и "rejected" — те же значения, что и у цифровых заказов, не
 * новые. Вся аналитика, баллы, реферальные награды и право на отзыв уже
 * держатся на status === "delivered" (export.functions.ts,
 * analytics.functions.ts, reviews.server.ts, referrals.server.ts) — заводить
 * отдельный терминальный статус означало бы сделать выручку кондитерской
 * невидимой для всего этого кода. rejectOrderSafely() (orders.server.ts)
 * работает без изменений: она уже гейтит переход из DELIVERABLE_STATUSES.
 */

export const PHYSICAL_STATUSES = ["accepted", "in_production", "ready"] as const;
export type PhysicalStatus = (typeof PHYSICAL_STATUSES)[number];

const NEXT_STATUS: Record<string, PhysicalStatus | "delivered"> = {
  accepted: "in_production",
  in_production: "ready",
  ready: "delivered",
};

// Аргумент — display_no/order_no ("Заказ #N", что уже видел покупатель в
// «Заказ №N создан»), а не PK orders.id: два разных числа, и подстановка PK
// сюда путает покупателя, который до этого момента видел только display_no.
const NOTICE_FOR_STATUS: Record<string, (displayNo: number) => string> = {
  accepted: (n) => `✅ Заказ #${n} принят в работу. Сообщим, когда он будет готов.`,
  in_production: (n) => `👩‍🍳 Заказ #${n} в работе.`,
  ready: (n) => `📦 Заказ #${n} готов! Уточните у продавца детали получения.`,
  delivered: (n) => `🙏 Спасибо за покупку! Заказ #${n} выдан.`,
};

/**
 * Принять оплаченный (или ожидающий оплаты — при payment_mode=on_receipt,
 * Блок 7) физический заказ в работу. Аналог deliverOrder() для digital: та
 * же CAS-развилка из DELIVERABLE_STATUSES, что и claimOrderForDelivery.
 */
export async function acceptOrder(
  orderId: number,
): Promise<{ ok: true; alreadyAccepted: boolean }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: claimed, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "accepted" })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("id, order_no, display_no")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!claimed) {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("orders")
      .select("status, order_no, display_no")
      .eq("id", orderId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Order not found");
    if (
      existing.status === "accepted" ||
      (PHYSICAL_STATUSES as readonly string[]).includes(existing.status) ||
      existing.status === "delivered"
    ) {
      return { ok: true, alreadyAccepted: true };
    }
    const displayNo = existing.display_no ?? existing.order_no ?? orderId;
    throw new Error(`Заказ #${displayNo} нельзя принять в работу (статус: ${existing.status})`);
  }

  const displayNo = claimed.display_no ?? claimed.order_no ?? orderId;
  const { notifyOrderCustomer } = await import("./orders.server");
  await notifyOrderCustomer(orderId, NOTICE_FOR_STATUS.accepted(displayNo)).catch((e) =>
    console.error("[fulfillment] notifyOrderCustomer(accepted) failed", e),
  );
  return { ok: true, alreadyAccepted: false };
}

/**
 * Продвинуть физический заказ на следующий шаг: accepted → in_production →
 * ready → delivered. CAS по текущему статусу — двойное нажатие кнопки в
 * админке не должно проматывать заказ на два шага вперёд.
 */
export async function advanceFulfillment(
  orderId: number,
): Promise<{ ok: true; status: PhysicalStatus | "delivered" }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: current, error: readErr } = await supabaseAdmin
    .from("orders")
    .select("status, telegram_id, platform, order_no, display_no")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("Order not found");

  const displayNo = current.display_no ?? current.order_no ?? orderId;
  const from = current.status;
  const to = NEXT_STATUS[from];
  if (!to) throw new Error(`Заказ #${displayNo} нельзя продвинуть дальше (статус: ${from})`);

  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error(`Заказ #${displayNo} уже изменился — обновите страницу и попробуйте снова`);
  }

  const { notifyOrderCustomer } = await import("./orders.server");
  await notifyOrderCustomer(orderId, NOTICE_FOR_STATUS[to](displayNo)).catch((e) =>
    console.error(`[fulfillment] notifyOrderCustomer(${to}) failed`, e),
  );

  if (to === "delivered") {
    // Реферальные награды и баллы сегодня начисляются только на Telegram-
    // ветке deliverOrder (orders.server.ts) — deliverOrderToWhatsApp/
    // deliverOrderByEmail их не зовут вовсе. Не расширяем это здесь, только
    // повторяем то же ограничение, а не молчаливую новую дыру.
    if (current.platform === "telegram" && current.telegram_id) {
      const { rewardReferralIfFirstDelivery } = await import("./referrals.server");
      await rewardReferralIfFirstDelivery(current.telegram_id).catch((e) =>
        console.error("[fulfillment] rewardReferralIfFirstDelivery failed", e),
      );
      const { awardPointsForDelivery } = await import("./loyalty.server");
      await awardPointsForDelivery(orderId, current.telegram_id).catch((e) =>
        console.error("[fulfillment] awardPointsForDelivery failed", e),
      );
    }
  }

  return { ok: true, status: to };
}

/**
 * Записать платёж (задаток/остаток) — CAS-цикл по образцу decrementStock()
 * в bot.server.ts: наращивание paid_amount без атомарности потеряло бы
 * деньги при двух чеках подряд.
 */
export async function recordPayment(orderId: number, amount: number): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("paid_amount")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return false;
    const current = Number(order.paid_amount) || 0;
    const { data: updated } = await supabaseAdmin
      .from("orders")
      .update({ paid_amount: current + amount })
      .eq("id", orderId)
      .eq("paid_amount", current)
      .select("id")
      .maybeSingle();
    if (updated) return true;
  }
  return false;
}

/**
 * payment_mode для физических заказов (Ниши, Блок 7) — "full", если не
 * настроено. Раньше жила приватной в bot.server.ts; переехала сюда вместе с
 * amountDueNow(), чтобы не тянуть весь bot.server.ts туда, где физический
 * заказ подтверждается не из Telegram (admin-панель, Direct-каналы).
 */
export async function loadPaymentMode(): Promise<"full" | "deposit" | "on_receipt"> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "payment_mode")
    .maybeSingle();
  return data?.value === "deposit" || data?.value === "on_receipt" ? data.value : "full";
}

/**
 * Сколько просить сейчас за заказ — единая точка правды, вместо того чтобы
 * каждое место денежного пути читало order.total напрямую (Ниши, Блок 8.2).
 * on_receipt возвращает 0, но до оплаты эта ветка недостижима — заказ уходит
 * в acceptOrder(), минуя любой из трёх send*-путей, которые вызывают эту
 * функцию.
 */
export async function amountDueNow(order: {
  total: number;
  fulfillment_kind: string;
}): Promise<number> {
  if (order.fulfillment_kind !== "physical") return order.total;
  const mode = await loadPaymentMode();
  if (mode === "on_receipt") return 0;
  if (mode === "deposit") {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "deposit_percent")
      .maybeSingle();
    const pct = Number(data?.value ?? "30");
    return Math.round(order.total * (pct / 100));
  }
  return order.total;
}
