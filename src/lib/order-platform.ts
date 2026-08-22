export type OrderPlatform = "telegram" | "instagram" | "whatsapp";

/**
 * Normalizes the persisted order channel for filtering in the admin panel.
 * Orders created before the platform column was introduced belong to Telegram.
 */
export function orderPlatform(value: string | null | undefined): OrderPlatform {
  if (value === "instagram" || value === "whatsapp") return value;
  return "telegram";
}
