/**
 * Финансовая аналитика для продавца (Кейс 3, №10) — чистые вычисления, без
 * БД. Суммы обязательно группируются по валюте: у мультивалютного магазина
 * (модуль multi_currency) заказы могут быть в разных валютах, и складывать
 * их напрямую значило бы получить бессмысленное число.
 */

export type OrderForAnalytics = {
  id: number;
  total: number;
  currency: string;
  discount_amount: number;
  points_used: number;
  gift_certificate_discount: number;
  created_at: string;
};

export type CurrencySummary = { revenue: number; ordersCount: number; discountsGiven: number };

export function summarizeByCurrency(orders: OrderForAnalytics[]): Record<string, CurrencySummary> {
  const result: Record<string, CurrencySummary> = {};
  for (const o of orders) {
    const cur = o.currency || "—";
    const entry = (result[cur] ??= { revenue: 0, ordersCount: 0, discountsGiven: 0 });
    entry.revenue += Number(o.total) || 0;
    entry.ordersCount += 1;
    entry.discountsGiven +=
      (Number(o.discount_amount) || 0) +
      (Number(o.points_used) || 0) +
      (Number(o.gift_certificate_discount) || 0);
  }
  return result;
}

/** Валюта, в которой оформлено больше всего заказов — для графика и топа товаров одним рядом. */
export function dominantCurrency(orders: OrderForAnalytics[]): string | null {
  const counts = new Map<string, number>();
  for (const o of orders) {
    const cur = o.currency || "—";
    counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cur, count] of counts) {
    if (count > bestCount) {
      best = cur;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Все валюты, в которых есть заказы, доминирующая первой — порядок секций
 * на странице аналитики (Блок «показать каждую валюту отдельно»). Остальные
 * — по числу заказов по убыванию, чтобы у продавца сверху были валюты,
 * которыми реально пользуются, а не алфавит.
 */
export function orderedCurrencies(
  summary: Record<string, CurrencySummary>,
  dominant: string | null,
): string[] {
  return Object.keys(summary).sort((a, b) => {
    if (a === dominant) return -1;
    if (b === dominant) return 1;
    return summary[b].ordersCount - summary[a].ordersCount || a.localeCompare(b);
  });
}

export function dailyRevenue(
  orders: OrderForAnalytics[],
  days: number,
  now: Date,
): Array<{ date: string; revenue: number }> {
  const byDay = new Map<string, number>();
  for (const o of orders) {
    const day = o.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (Number(o.total) || 0));
  }
  const result: Array<{ date: string; revenue: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, revenue: byDay.get(key) ?? 0 });
  }
  return result;
}

export type OrderItemForAnalytics = {
  order_id: number;
  product_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  quantity: number;
};

export type TopProduct = { key: string; name: string; unitsSold: number; revenue: number };

/**
 * Топ по количеству проданного — валютно-нейтральная метрика, работает
 * даже в мультивалютном магазине. Выручка считается только по позициям из
 * заказов в revenueOrderIds (обычно — заказы доминирующей валюты), чтобы не
 * смешать разные валюты в одной сумме.
 */
export function topProductsBySales(
  items: OrderItemForAnalytics[],
  revenueOrderIds: Set<number>,
  limit = 10,
): TopProduct[] {
  const byKey = new Map<string, TopProduct>();
  for (const it of items) {
    const key = it.product_id ?? `name:${it.name_snapshot}`;
    const entry = byKey.get(key) ?? { key, name: it.name_snapshot, unitsSold: 0, revenue: 0 };
    entry.unitsSold += Number(it.quantity) || 0;
    if (revenueOrderIds.has(it.order_id)) {
      entry.revenue += (Number(it.price_snapshot) || 0) * (Number(it.quantity) || 0);
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, limit);
}
