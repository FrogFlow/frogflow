/**
 * Баллы за покупки (Кейс 3, №3).
 *
 * Баланс живёт на bot_users.loyalty_points, списание и начисление — CAS по
 * текущему значению (тот же приём, что used_count у promo_codes). Списание
 * применяется при оформлении заказа как ещё одна скидка поверх промокода;
 * начисление — после того, как заказ реально выдан (см. orders.server.ts),
 * идемпотентно через orders.points_earned (CAS 0 → N: повторный вызов на
 * том же заказе ничего не начислит второй раз).
 *
 * Отдельно от bot.server.ts и orders.server.ts по той же причине, что и
 * referrals.server.ts — нужен обоим, прямой импорт друг у друга дал бы цикл.
 */
import { tg } from "./telegram.server";
import { computePointsEarned, computePointsDiscount } from "./loyalty";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function loyaltyEarnPercent(): Promise<number> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "loyalty_earn_percent")
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 5;
}

async function creditPoints(telegramId: number, delta: number): Promise<boolean> {
  if (delta <= 0) return true;
  const s = await db();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: user } = await s
      .from("bot_users")
      .select("loyalty_points")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (!user) return false;
    const current = user.loyalty_points ?? 0;
    const { data: updated } = await s
      .from("bot_users")
      .update({ loyalty_points: current + delta })
      .eq("telegram_id", telegramId)
      .eq("loyalty_points", current)
      .select("telegram_id")
      .maybeSingle();
    if (updated) return true;
  }
  console.error("[loyalty] creditPoints: не удалось начислить за 3 попытки", { telegramId, delta });
  return false;
}

/**
 * Списание при оформлении заказа. Баланс читается заново прямо перед
 * списанием (не тот, что показывался в корзине несколько шагов назад) —
 * CAS ловит гонку с параллельным заказом того же покупателя. В отличие от
 * промокода списание не блокирует оформление: если гонка всё же случилась,
 * просто едем дальше без скидки баллами, а не рушим заказ.
 */
export async function redeemPointsForOrder(
  telegramId: number,
  subtotal: number,
): Promise<{ discount: number }> {
  const s = await db();
  const { data: user } = await s
    .from("bot_users")
    .select("loyalty_points")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  const balance = user?.loyalty_points ?? 0;
  const discount = computePointsDiscount(subtotal, balance);
  if (discount <= 0) return { discount: 0 };
  const { data: updated } = await s
    .from("bot_users")
    .update({ loyalty_points: balance - discount })
    .eq("telegram_id", telegramId)
    .eq("loyalty_points", balance)
    .select("telegram_id")
    .maybeSingle();
  if (!updated) return { discount: 0 };
  return { discount };
}

/**
 * Вызывается сразу после того, как заказ реально перешёл в delivered.
 * Идемпотентность — на самом заказе (points_earned: 0 → N ровно один раз),
 * поэтому повторный вызов на том же orderId (повтор доставки, гонка воркеров)
 * не начислит баллы дважды.
 */
export async function awardPointsForDelivery(orderId: number, telegramId: number): Promise<void> {
  const s = await db();
  const { data: order } = await s.from("orders").select("total").eq("id", orderId).maybeSingle();
  if (!order) return;
  const percent = await loyaltyEarnPercent();
  const points = computePointsEarned(Number(order.total), percent);
  if (points <= 0) return;

  const { data: claimed } = await s
    .from("orders")
    .update({ points_earned: points })
    .eq("id", orderId)
    .eq("points_earned", 0)
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  const credited = await creditPoints(telegramId, points);
  if (!credited) return;
  await tg("sendMessage", {
    chat_id: telegramId,
    text: `🏆 Вам начислено ${points} баллов за покупку. Баллами можно оплатить часть следующего заказа.`,
  }).catch(() => {});
}
