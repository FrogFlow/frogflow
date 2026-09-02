/** Живые физические заказы — ещё не выданы и не отклонены. */
export const OPEN_PHYSICAL_STATUSES = new Set([
  "awaiting_payment",
  "awaiting_confirmation",
  "accepted",
  "in_production",
  "ready",
  "delivering",
]);

export type PickupFilter = "all" | "today" | "tomorrow" | "overdue" | "nodate";

export function matchesPickupFilter(
  order: {
    fulfillment_kind?: string | null;
    fulfillment_at: string | null;
    status: string;
  },
  filter: PickupFilter,
  todayIso: string,
  tomorrowIso: string,
): boolean {
  if (filter === "all") return true;
  if (order.fulfillment_kind !== "physical") return false;
  const day = order.fulfillment_at ? String(order.fulfillment_at).slice(0, 10) : null;
  if (filter === "nodate") return !day && OPEN_PHYSICAL_STATUSES.has(order.status);
  if (!day || !OPEN_PHYSICAL_STATUSES.has(order.status)) return false;
  if (filter === "today") return day === todayIso;
  if (filter === "tomorrow") return day === tomorrowIso;
  return day < todayIso;
}
