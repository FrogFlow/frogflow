export function normalizeMiniAppPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim().slice(0, 32);
  return /^\+?[0-9 ()-]{7,32}$/.test(phone) ? phone : null;
}

export function isValidMiniAppIsoDate(value: unknown, minDate: string): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value >= minDate;
}

export function normalizeMiniAppText(
  value: unknown,
  maxLength = 500,
  required = false,
): string | null {
  if (typeof value !== "string") return required ? null : "";
  const normalized = value.trim().slice(0, maxLength);
  return required && !normalized ? null : normalized;
}

export function isMiniAppFulfillmentType(value: unknown): value is "pickup" | "delivery" {
  return value === "pickup" || value === "delivery";
}

export function isMiniAppPaymentMethod(value: unknown): value is "robokassa" | "manual" {
  return value === "robokassa" || value === "manual";
}
