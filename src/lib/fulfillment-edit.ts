/**
 * Правка способа получения в админке. Переключение доставка → самовывоз
 * должно снять зону и комиссию с total — иначе торт «заберут сами», а в
 * сумме и в «остатке» остаётся плата за доставку.
 *
 * Обратный переход (самовывоз → доставка) комиссию сам не добавляет:
 * без выбранной зоны нечего прибавлять; продавец правит адрес, зону
 * покупатель выбирал на чекауте.
 */
export function fulfillmentTypePatch(
  order: {
    fulfillment_type: string | null;
    delivery_fee: number | null;
    total: number;
  },
  nextType: "pickup" | "delivery" | null | undefined,
): {
  fulfillment_type?: "pickup" | "delivery";
  delivery_zone_id?: null;
  delivery_zone_name?: null;
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
  }
  return patch;
}
