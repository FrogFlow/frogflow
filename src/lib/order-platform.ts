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
