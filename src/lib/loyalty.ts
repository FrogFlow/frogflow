/**
 * Баллы за покупки: 1 балл = 1 единица валюты заказа. Начисление — процент
 * от итоговой суммы после доставки, списание — до суммы заказа, не больше
 * доступного баланса.
 */

export function computePointsEarned(orderTotal: number, earnPercent: number): number {
  if (orderTotal <= 0 || earnPercent <= 0) return 0;
  return Math.floor(orderTotal * (earnPercent / 100));
}

export function computePointsDiscount(subtotal: number, pointsBalance: number): number {
  if (subtotal <= 0 || pointsBalance <= 0) return 0;
  return Math.min(subtotal, Math.floor(pointsBalance));
}

/**
 * Списание в Direct: уменьшаем полную сумму заказа, а задаток/«к оплате»
 * вызывающий пересчитывает уже от нового итога (как Telegram уменьшает
 * orders.total до показа реквизитов).
 */
export function applyLoyaltyToFullAmount(
  fullAmount: number,
  pointsBalance: number,
  usePoints: boolean,
): { fullAmount: number; pointsUsed: number } {
  if (!usePoints) return { fullAmount, pointsUsed: 0 };
  const pointsUsed = computePointsDiscount(fullAmount, pointsBalance);
  return { fullAmount: fullAmount - pointsUsed, pointsUsed };
}
