/**
 * Промокоды — скидка на весь заказ (не на отдельные позиции корзины).
 * Чистая часть логики отдельно от бота/базы, чтобы считать скидку и
 * проверять коды можно было тестом без Supabase — см. bot.server.ts
 * (findValidPromoCode/redeemPromoCode) для части с базой.
 */

export type PromoDiscountType = "percent" | "fixed";

export type PromoCodeRow = {
  discount_type: PromoDiscountType;
  discount_value: number;
};

/** Промокоды нечувствительны к регистру — и при вводе, и при сохранении в админке. */
export function normalizePromoCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Скидка в валюте заказа. Округлена до целого (та же точность, что у сумм
 * заказа везде в проекте) и никогда не превышает саму сумму — фиксированная
 * скидка больше стоимости заказа не уводит итог в минус.
 */
export function computePromoDiscount(subtotal: number, promo: PromoCodeRow): number {
  if (subtotal <= 0) return 0;
  const raw =
    promo.discount_type === "percent"
      ? subtotal * (promo.discount_value / 100)
      : promo.discount_value;
  return Math.min(subtotal, Math.max(0, Math.round(raw)));
}
