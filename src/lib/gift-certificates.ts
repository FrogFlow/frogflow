/**
 * Подарочные сертификаты (Кейс 3, №7) — чистые функции без БД.
 *
 * Сертификат выдаёт продавец вручную через админку (после оплаты вне бота —
 * банковский перевод, наличные, жест лояльности) и отдаёт код покупателю;
 * тот вводит код при оформлении заказа как скидку на фиксированную сумму,
 * тем же способом, что и промокод (Кейс 3, №1).
 */

export function normalizeGiftCertificateCode(input: string): string {
  return input.trim().toUpperCase();
}

export function computeGiftCertificateDiscount(subtotal: number, amount: number): number {
  if (subtotal <= 0 || amount <= 0) return 0;
  return Math.min(subtotal, amount);
}

export function generateGiftCertificateCode(): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GIFT-${suffix}`;
}
