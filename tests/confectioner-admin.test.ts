import { describe, it, expect } from "vitest";
import { fulfillmentTypePatch } from "../src/lib/fulfillment-edit";
import { matchesPickupFilter } from "../src/lib/pickup-filter";
import { remainingDueNow } from "../src/lib/fulfillment.server";
import { addDaysToIsoDate } from "../src/lib/datetime";

describe("remainingDueNow — задаток не двоится после «Внести оплату»", () => {
  it("без внесённого пишет весь задаток", () => {
    expect(remainingDueNow(3000, 0)).toBe(3000);
    expect(remainingDueNow(3000, null)).toBe(3000);
  });

  it("после ручной записи задатка больше ничего не дописывает", () => {
    expect(remainingDueNow(3000, 3000)).toBe(0);
  });

  it("дописывает только недостающую часть задатка", () => {
    expect(remainingDueNow(3000, 1000)).toBe(2000);
  });

  it("не пишет отрицательное, если внесено больше задатка", () => {
    expect(remainingDueNow(3000, 4000)).toBe(0);
  });

  it("on_receipt / нулевой due — ничего", () => {
    expect(remainingDueNow(0, 0)).toBe(0);
    expect(remainingDueNow(Number.NaN, 0)).toBe(0);
  });
});

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

  it("самовывоз → доставка с зоной прибавляет комиссию к total", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "pickup", delivery_fee: 0, total: 20000 },
        "delivery",
        { id: "zone-1", name: "Центр", price: 1500 },
      ),
    ).toEqual({
      fulfillment_type: "delivery",
      delivery_zone_id: "zone-1",
      delivery_zone_name: "Центр",
      delivery_fee: 1500,
      total: 21500,
    });
  });

  it("смена зоны пересчитывает комиссию, не складывая её поверх старой", () => {
    expect(
      fulfillmentTypePatch(
        { fulfillment_type: "delivery", delivery_fee: 1500, total: 21500 },
        "delivery",
        { id: "zone-2", name: "Окраина", price: 2500 },
      ),
    ).toEqual({
      fulfillment_type: "delivery",
      delivery_zone_id: "zone-2",
      delivery_zone_name: "Окраина",
      delivery_fee: 2500,
      total: 22500,
    });
  });
});

describe("matchesPickupFilter", () => {
  const today = "2026-09-02";
  const tomorrow = addDaysToIsoDate(today, 1);
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
