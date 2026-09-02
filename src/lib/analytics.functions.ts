import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./admin-session.server";
import { fetchAll } from "./csv";
import {
  summarizeByCurrency,
  dominantCurrency,
  orderedCurrencies,
  dailyRevenue,
  topProductsBySales,
  includeOrderInAnalytics,
  analyticsRevenue,
  type OrderForAnalytics,
  type OrderItemForAnalytics,
  type TopProduct,
} from "./analytics";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const WINDOW_DAYS = 90;

/**
 * Общая выборка для обеих серверных функций ниже — заказы за 90 дней и их
 * позиции. `fetchAll` вместо простого select с limit — PostgREST молча
 * обрывает выдачу на 1000 строк (см. csv.ts), а заказов за 90 дней у живого
 * магазина вполне может быть больше.
 *
 * В выборку входят выданные заказы и живая производственная очередь
 * физических (accepted/in_production/ready): иначе задаток по торту
 * невидим в аналитике неделями. Сумма мапится через analyticsRevenue.
 */
async function loadAnalyticsData(): Promise<{
  orders: OrderForAnalytics[];
  items: OrderItemForAnalytics[];
}> {
  const s = await db();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  type OrderRow = OrderForAnalytics & {
    status: string;
    fulfillment_kind: string | null;
    paid_amount: number | null;
  };
  const rows = await fetchAll<OrderRow>(
    (from, to) =>
      s
        .from("orders")
        .select(
          "id, total, currency, discount_amount, points_used, gift_certificate_discount, created_at, status, fulfillment_kind, paid_amount",
        )
        .in("status", ["delivered", "accepted", "in_production", "ready"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to),
    "заказы",
  );
  const orders: OrderForAnalytics[] = rows.filter(includeOrderInAnalytics).map((o) => ({
    id: o.id,
    total: analyticsRevenue(o),
    currency: o.currency,
    discount_amount: o.discount_amount,
    points_used: o.points_used,
    gift_certificate_discount: o.gift_certificate_discount,
    created_at: o.created_at,
  }));

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

  return { orders, items };
}

/**
 * Финансовая аналитика для продавца (Кейс 3, №10): выручка/скидки за 30 и
 * 90 дней, дневная выручка и топ товаров — своим набором на каждую валюту,
 * в которой есть заказы (не только доминирующую), чтобы деньги в KZT/BYN/…
 * не исчезали из вида только потому, что рублёвых заказов больше числом.
 */
export const getFinancialAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { orders, items } = await loadAnalyticsData();

  const now = new Date();
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const orders30 = orders.filter((o) => o.created_at >= cutoff30);

  const dominant = dominantCurrency(orders);
  const summary30 = summarizeByCurrency(orders30);
  const summary90 = summarizeByCurrency(orders);
  const currencies = orderedCurrencies(summary90, dominant);

  const dailyRevenueByCurrency: Record<string, Array<{ date: string; revenue: number }>> = {};
  const topProductsByCurrency: Record<string, TopProduct[]> = {};
  for (const cur of currencies) {
    const curOrders30 = orders30.filter((o) => (o.currency || "—") === cur);
    dailyRevenueByCurrency[cur] = dailyRevenue(curOrders30, 30, now);

    const curOrderIds = new Set(orders.filter((o) => (o.currency || "—") === cur).map((o) => o.id));
    // Позиции тоже отфильтрованы по валюте — иначе unitsSold внутри секции
    // одной валюты считал бы штуки, проданные и в других валютах тоже
    // (topProductsBySales сам по себе валютно-нейтральный, см. его комментарий).
    const curItems = items.filter((it) => curOrderIds.has(it.order_id));
    topProductsByCurrency[cur] = topProductsBySales(curItems, curOrderIds);
  }

  return {
    windowDays: WINDOW_DAYS,
    dominantCurrency: dominant,
    currencies,
    summary30,
    summary90,
    dailyRevenueByCurrency,
    topProductsByCurrency,
  };
});

const ConvertedInput = z.object({ targetCurrency: z.string().min(2).max(6) });

/**
 * Общий свод по всем валютам разом, пересчитанный в одну выбранную —
 * по текущему курсу (convertAmount, тот же конвертер, что уже считает цены
 * в мультивалютном каталоге). Исторический курс на момент каждого заказа
 * нигде не хранится — это был бы отдельный кейс, здесь сознательно не
 * решается: цифра отвечает на вопрос «сколько это стоило бы сегодня»,
 * не «сколько стоило тогда».
 *
 * Валюта, для которой курс недоступен (сбой API конвертации), не тихо
 * пропадает из суммы — её код попадает в unconverted, и панель обязана
 * показать явное предупреждение, а не выдать заниженную сумму как полную.
 */
export const getFinancialAnalyticsConverted = createServerFn({ method: "GET" })
  .validator((d: unknown) => ConvertedInput.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const target = data.targetCurrency.toUpperCase();
    const { convertAmount } = await import("./currency.server");

    const { orders, items } = await loadAnalyticsData();

    const now = new Date();
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const orders30 = orders.filter((o) => o.created_at >= cutoff30);

    const summary30 = summarizeByCurrency(orders30);
    const summary90 = summarizeByCurrency(orders);

    const unconverted = new Set<string>();

    async function convertSummary(summary: ReturnType<typeof summarizeByCurrency>) {
      let revenue = 0;
      let ordersCount = 0;
      let discountsGiven = 0;
      for (const [cur, s] of Object.entries(summary)) {
        ordersCount += s.ordersCount;
        if (cur === target) {
          revenue += s.revenue;
          discountsGiven += s.discountsGiven;
          continue;
        }
        const [rev, disc] = await Promise.all([
          convertAmount(s.revenue, cur, target),
          convertAmount(s.discountsGiven, cur, target),
        ]);
        if (rev === null || disc === null) {
          unconverted.add(cur);
          continue;
        }
        revenue += rev;
        discountsGiven += disc;
      }
      return { revenue, ordersCount, discountsGiven };
    }

    const converted30 = await convertSummary(summary30);
    const converted90 = await convertSummary(summary90);

    // Дневная выручка: по каждой валюте свой ряд (dailyRevenue уже даёт
    // все 30 дней, включая нулевые), пересчитываем и складываем по дате.
    const currenciesIn30 = [...new Set(orders30.map((o) => o.currency || "—"))];
    const dailyByDate = new Map<string, number>();
    for (const cur of currenciesIn30) {
      const series = dailyRevenue(
        orders30.filter((o) => (o.currency || "—") === cur),
        30,
        now,
      );
      for (const d of series) {
        if (!d.revenue) continue;
        const converted = cur === target ? d.revenue : await convertAmount(d.revenue, cur, target);
        if (converted === null) {
          unconverted.add(cur);
          continue;
        }
        dailyByDate.set(d.date, (dailyByDate.get(d.date) ?? 0) + converted);
      }
    }
    const dailyRevenueConverted = dailyRevenue(orders30, 30, now).map((d) => ({
      date: d.date,
      revenue: dailyByDate.get(d.date) ?? 0,
    }));

    // Топ товаров: штуки — валютно-нейтральный ранкинг (как и раньше), а
    // выручку на топ-10 досчитываем по всем валютам и переводим в target —
    // конвертируем только для реально попавших в топ позиций, не для
    // всего каталога.
    const top10 = topProductsBySales(items, new Set());
    const top10Keys = new Set(top10.map((p) => p.key));
    const orderCurrency = new Map(orders.map((o) => [o.id, o.currency || "—"]));
    const revenueByProduct = new Map<string, number>();
    for (const it of items) {
      const key = it.product_id ?? `name:${it.name_snapshot}`;
      if (!top10Keys.has(key)) continue;
      const amount = (Number(it.price_snapshot) || 0) * (Number(it.quantity) || 0);
      if (!amount) continue;
      const cur = orderCurrency.get(it.order_id) ?? "—";
      const converted = cur === target ? amount : await convertAmount(amount, cur, target);
      if (converted === null) {
        unconverted.add(cur);
        continue;
      }
      revenueByProduct.set(key, (revenueByProduct.get(key) ?? 0) + converted);
    }
    const topProductsConverted: TopProduct[] = top10.map((p) => ({
      ...p,
      revenue: revenueByProduct.get(p.key) ?? 0,
    }));

    return {
      windowDays: WINDOW_DAYS,
      targetCurrency: target,
      summary30: converted30,
      summary90: converted90,
      dailyRevenue: dailyRevenueConverted,
      topProducts: topProductsConverted,
      unconverted: [...unconverted],
    };
  });
