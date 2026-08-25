import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "./admin-session.server";
import { fetchAll } from "./csv";
import {
  summarizeByCurrency,
  dominantCurrency,
  dailyRevenue,
  topProductsBySales,
  type OrderForAnalytics,
  type OrderItemForAnalytics,
} from "./analytics";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const WINDOW_DAYS = 90;

/**
 * Финансовая аналитика для продавца (Кейс 3, №10): выручка/скидки за 30 и
 * 90 дней по валюте (см. summarizeByCurrency — не смешивает валюты),
 * дневная выручка за 30 дней и топ товаров по продажам — по доминирующей
 * валюте, чтобы график и топ оставались осмысленными в мультивалютном
 * магазине. `fetchAll` вместо простого select с limit — PostgREST молча
 * обрывает выдачу на 1000 строк (см. csv.ts), а заказов за 90 дней у живого
 * магазина вполне может быть больше.
 */
export const getFinancialAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const s = await db();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const orders = await fetchAll<OrderForAnalytics>(
    (from, to) =>
      s
        .from("orders")
        .select(
          "id, total, currency, discount_amount, points_used, gift_certificate_discount, created_at",
        )
        .eq("status", "delivered")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to),
    "заказы",
  );

  const orderIds = orders.map((o) => o.id);
  const items = orderIds.length
    ? await fetchAll<OrderItemForAnalytics>(
        (from, to) =>
          s
            .from("order_items")
            .select("order_id, product_id, name_snapshot, price_snapshot, quantity")
            .in("order_id", orderIds)
            .range(from, to),
        "позиции заказов",
      )
    : [];

  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const orders30 = orders.filter((o) => o.created_at >= cutoff30);

  const dominant = dominantCurrency(orders);
  const dominantOrders = dominant ? orders.filter((o) => (o.currency || "—") === dominant) : [];
  const dominantOrderIds = new Set(dominantOrders.map((o) => o.id));
  const dominantOrders30 = orders30.filter((o) => (o.currency || "—") === dominant);

  return {
    windowDays: WINDOW_DAYS,
    dominantCurrency: dominant,
    summary30: summarizeByCurrency(orders30),
    summary90: summarizeByCurrency(orders),
    dailyRevenue: dominant ? dailyRevenue(dominantOrders30, 30, now) : [],
    topProducts: topProductsBySales(items, dominantOrderIds),
  };
});
