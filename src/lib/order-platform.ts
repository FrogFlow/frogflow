export type OrderPlatform = "telegram" | "instagram" | "whatsapp" | "manual";

/**
 * Normalizes the persisted order channel for filtering in the admin panel.
 * Orders created before the platform column was introduced belong to Telegram.
 * `manual` — заказ, который продавец завела сама (телефон, не бот).
 */
export function orderPlatform(value: string | null | undefined): OrderPlatform {
  if (value === "instagram" || value === "whatsapp" || value === "manual") return value;
  return "telegram";
}

/**
 * Цифровой заказ из Instagram нельзя выдать, пока нет почты: Direct не
 * принимает документы, файлы уходят письмом. Кнопка «Подтвердить и выдать»
 * приходит продавцу сразу после чека — раньше, чем покупатель отвечает
 * адресом. Без этой проверки выдача падает, уведомление в Telegram снимается,
 * и остаётся только панель.
 */
export function instagramDigitalMissingEmail(order: {
  platform?: string | null;
  fulfillment_kind?: string | null;
  customer_email?: string | null;
}): boolean {
  if (order.platform !== "instagram") return false;
  if (order.fulfillment_kind === "physical") return false;
  return !Boolean(order.customer_email?.trim());
}
