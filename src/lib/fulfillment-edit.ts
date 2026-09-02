/**
 * Правка способа получения в админке. Переключение доставка → самовывоз
 * должно снять зону и комиссию с total — иначе торт «заберут сами», а в
 * сумме и в «остатке» остаётся плата за доставку.
 *
 * Обратный переход (самовывоз → доставка) прибавляет комиссию выбранной
 * зоны. Без зоны меняется только тип: сервер updateOrderFulfillment
 * требует зону, чтобы не оставить доставку с нулевой доставкой молча.
 */

export type FulfillmentZonePatch = {
  id: string;
  name: string;
  price: number;
};

export function fulfillmentTypePatch(
  order: {
    fulfillment_type: string | null;
    delivery_fee: number | null;
    total: number;
  },
  nextType: "pickup" | "delivery" | null | undefined,
  zone?: FulfillmentZonePatch | null,
): {
  fulfillment_type?: "pickup" | "delivery";
  delivery_zone_id?: string | null;
  delivery_zone_name?: string | null;
  delivery_fee?: number;
  total?: number;
} {
  if (!nextType) return {};
  const patch: ReturnType<typeof fulfillmentTypePatch> = { fulfillment_type: nextType };
  if (nextType === "pickup" && order.fulfillment_type === "delivery") {
    const fee = Number(order.delivery_fee) || 0;
    patch.delivery_zone_id = null;
    patch.delivery_zone_name = null;
    patch.delivery_fee = 0;
    patch.total = Math.max(0, Number(order.total) - fee);
    return patch;
  }
  if (nextType === "delivery" && zone) {
    const oldFee = Number(order.delivery_fee) || 0;
    const newFee = Number(zone.price) || 0;
    patch.delivery_zone_id = zone.id;
    patch.delivery_zone_name = zone.name;
    patch.delivery_fee = newFee;
    patch.total = Math.max(0, Number(order.total) - oldFee + newFee);
  }
  return patch;
}
