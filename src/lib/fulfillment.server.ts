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

const NOTICE_FOR_STATUS: Record<string, (orderId: number) => string> = {
  accepted: (id) => `✅ Заказ #${id} принят в работу. Сообщим, когда он будет готов.`,
  in_production: (id) => `👩‍🍳 Заказ #${id} в работе.`,
  ready: (id) => `📦 Заказ #${id} готов! Уточните у продавца детали получения.`,
  delivered: (id) => `🙏 Спасибо за покупку! Заказ #${id} выдан.`,
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
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!claimed) {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("orders")
      .select("status")
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
    throw new Error(`Заказ #${orderId} нельзя принять в работу (статус: ${existing.status})`);
  }

  const { notifyOrderCustomer } = await import("./orders.server");
  await notifyOrderCustomer(orderId, NOTICE_FOR_STATUS.accepted(orderId)).catch((e) =>
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
    .select("status, telegram_id, platform")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("Order not found");

  const from = current.status;
  const to = NEXT_STATUS[from];
  if (!to) throw new Error(`Заказ #${orderId} нельзя продвинуть дальше (статус: ${from})`);

  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error(`Заказ #${orderId} уже изменился — обновите страницу и попробуйте снова`);
  }

  const { notifyOrderCustomer } = await import("./orders.server");
  await notifyOrderCustomer(orderId, NOTICE_FOR_STATUS[to](orderId)).catch((e) =>
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
