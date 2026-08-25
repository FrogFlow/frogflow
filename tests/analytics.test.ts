import { describe, it, expect } from "vitest";
import {
  summarizeByCurrency,
  dominantCurrency,
  dailyRevenue,
  topProductsBySales,
  type OrderForAnalytics,
  type OrderItemForAnalytics,
} from "../src/lib/analytics";

function order(overrides: Partial<OrderForAnalytics>): OrderForAnalytics {
  return {
    id: 1,
    total: 1000,
    currency: "KZT",
    discount_amount: 0,
    points_used: 0,
    gift_certificate_discount: 0,
    created_at: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeByCurrency", () => {
  it("группирует выручку и скидки по валюте, не смешивая их", () => {
    const orders = [
      order({ id: 1, total: 1000, currency: "KZT", discount_amount: 100 }),
      order({ id: 2, total: 2000, currency: "KZT", points_used: 50 }),
      order({ id: 3, total: 30, currency: "USD", gift_certificate_discount: 5 }),
    ];
    const result = summarizeByCurrency(orders);
    expect(result.KZT).toEqual({ revenue: 3000, ordersCount: 2, discountsGiven: 150 });
    expect(result.USD).toEqual({ revenue: 30, ordersCount: 1, discountsGiven: 5 });
  });

  it("пустой список — пустой результат", () => {
    expect(summarizeByCurrency([])).toEqual({});
  });
});

describe("dominantCurrency", () => {
  it("возвращает валюту с наибольшим числом заказов", () => {
    const orders = [
      order({ currency: "KZT" }),
      order({ currency: "KZT" }),
      order({ currency: "USD" }),
    ];
    expect(dominantCurrency(orders)).toBe("KZT");
  });

  it("пустой список — null", () => {
    expect(dominantCurrency([])).toBe(null);
  });
});

describe("dailyRevenue", () => {
  it("возвращает ряд из N дней, включая дни без заказов (0)", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const orders = [
      order({ total: 500, created_at: "2026-01-10T08:00:00.000Z" }),
      order({ total: 300, created_at: "2026-01-10T20:00:00.000Z" }),
      order({ total: 200, created_at: "2026-01-08T08:00:00.000Z" }),
    ];
    const series = dailyRevenue(orders, 3, now);
    expect(series).toEqual([
      { date: "2026-01-08", revenue: 200 },
      { date: "2026-01-09", revenue: 0 },
      { date: "2026-01-10", revenue: 800 },
    ]);
  });
});

describe("topProductsBySales", () => {
  it("сортирует по количеству проданного, суммирует выручку только для указанных заказов", () => {
    const items: OrderItemForAnalytics[] = [
      { order_id: 1, product_id: "p1", name_snapshot: "Товар 1", price_snapshot: 100, quantity: 2 },
      { order_id: 2, product_id: "p1", name_snapshot: "Товар 1", price_snapshot: 100, quantity: 1 },
      { order_id: 1, product_id: "p2", name_snapshot: "Товар 2", price_snapshot: 500, quantity: 1 },
    ];
    const result = topProductsBySales(items, new Set([1]));
    expect(result[0]).toEqual({ key: "p1", name: "Товар 1", unitsSold: 3, revenue: 200 });
    expect(result[1]).toEqual({ key: "p2", name: "Товар 2", unitsSold: 1, revenue: 500 });
  });

  it("товар без product_id группируется по названию, а не теряется", () => {
    const items: OrderItemForAnalytics[] = [
      {
        order_id: 1,
        product_id: null,
        name_snapshot: "Удалённый товар",
        price_snapshot: 50,
        quantity: 1,
      },
    ];
    const result = topProductsBySales(items, new Set([1]));
    expect(result).toEqual([
      { key: "name:Удалённый товар", name: "Удалённый товар", unitsSold: 1, revenue: 50 },
    ]);
  });

  it("ограничивает результат limit позициями", () => {
    const items: OrderItemForAnalytics[] = Array.from({ length: 15 }, (_, i) => ({
      order_id: 1,
      product_id: `p${i}`,
      name_snapshot: `Товар ${i}`,
      price_snapshot: 10,
      quantity: 15 - i,
    }));
    expect(topProductsBySales(items, new Set([1])).length).toBe(10);
  });
});
