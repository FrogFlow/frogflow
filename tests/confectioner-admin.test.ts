import { describe, it, expect } from "vitest";
import { fulfillmentTypePatch } from "../src/lib/fulfillment-edit";
import { matchesPickupFilter } from "../src/lib/pickup-filter";

describe("fulfillmentTypePatch — доставка ↔ самовывоз", () => {
  it("доставка → самовывоз снимает зону и комиссию с total", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "delivery", delivery_fee: 1500, total: 21500 },
        "pickup",
      ),
    ).toEqual({
      fulfillment_type: "pickup",
      delivery_zone_id: null,
      delivery_zone_name: null,
      delivery_fee: 0,
      total: 20000,
    });
  });

  it("повторное сохранение самовывоза не вычитает комиссию второй раз", () => {
    expect(
      fulfillmentTypePatch({ fulfillment_type: "pickup", delivery_fee: 0, total: 20000 }, "pickup"),
    ).toEqual({ fulfillment_type: "pickup" });
  });

  it("самовывоз → доставка не выдумывает комиссию без зоны", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "pickup", delivery_fee: 0, total: 20000 },
        "delivery",
      ),
    ).toEqual({ fulfillment_type: "delivery" });
  });
});

describe("matchesPickupFilter", () => {
  const today = "2026-09-02";
  const tomorrow = "2026-09-03";
  const cake = {
    fulfillment_kind: "physical" as const,
    fulfillment_at: "2026-09-02T00:00:00.000Z",
    status: "in_production",
  };

  it("сегодня/завтра не показывают уже выданные торты", () => {
    expect(matchesPickupFilter({ ...cake, status: "delivered" }, "today", today, tomorrow)).toBe(
      false,
    );
    expect(matchesPickupFilter(cake, "today", today, tomorrow)).toBe(true);
  });

  it("без даты — только открытые физические без fulfillment_at", () => {
    expect(
      matchesPickupFilter(
        { ...cake, fulfillment_at: null, status: "accepted" },
        "nodate",
        today,
        tomorrow,
      ),
    ).toBe(true);
    expect(matchesPickupFilter(cake, "nodate", today, tomorrow)).toBe(false);
  });

  it("просрочено — дата в прошлом и заказ ещё открыт", () => {
    expect(
      matchesPickupFilter(
        { ...cake, fulfillment_at: "2026-09-01T00:00:00.000Z" },
        "overdue",
        today,
        tomorrow,
      ),
    ).toBe(true);
    expect(
      matchesPickupFilter(
        { ...cake, fulfillment_at: "2026-09-01T00:00:00.000Z", status: "delivered" },
        "overdue",
        today,
        tomorrow,
      ),
    ).toBe(false);
  });
});
