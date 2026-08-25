import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components-ui/chart";
import { errorMessage } from "@/lib/error-message";
import { getFinancialAnalytics } from "@/lib/analytics.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    hint: (days: number) => string;
    loading: string;
    loadError: (msg: string) => string;
    revenue30: string;
    orders30: string;
    avgOrder30: string;
    discounts30: string;
    revenue90: string;
    dailyChartTitle: string;
    topProductsTitle: string;
    unitsSoldLabel: string;
    piecesSuffix: string;
    revenueLabel: string;
    noOrders: string;
    otherCurrencies: (list: string) => string;
  }
> = {
  ru: {
    title: "Финансовая аналитика",
    hint: (days) => `За последние 30 и ${days} дней, только выданные заказы.`,
    loading: "Загрузка…",
    loadError: (msg) => `Не удалось загрузить аналитику: ${msg}`,
    revenue30: "Выручка за 30 дней",
    orders30: "Заказов за 30 дней",
    avgOrder30: "Средний чек",
    discounts30: "Скидок отдано (промо+баллы+сертификаты)",
    revenue90: "Выручка за 90 дней",
    dailyChartTitle: "Выручка по дням (30 дней)",
    topProductsTitle: "Топ товаров по продажам (90 дней)",
    unitsSoldLabel: "Продано, шт.",
    piecesSuffix: "шт.",
    revenueLabel: "Выручка",
    noOrders: "За этот период выданных заказов ещё не было.",
    otherCurrencies: (list) => `Также есть заказы в других валютах: ${list} — показаны отдельно.`,
  },
  kk: {
    title: "Қаржылық аналитика",
    hint: (days) => `Соңғы 30 және ${days} күн, тек берілген тапсырыстар.`,
    loading: "Жүктелуде…",
    loadError: (msg) => `Аналитиканы жүктеу мүмкін болмады: ${msg}`,
    revenue30: "30 күндегі түсім",
    orders30: "30 күндегі тапсырыстар",
    avgOrder30: "Орташа чек",
    discounts30: "Берілген жеңілдіктер (промо+баллдар+сертификаттар)",
    revenue90: "90 күндегі түсім",
    dailyChartTitle: "Күндік түсім (30 күн)",
    topProductsTitle: "Сатылым бойынша топ тауарлар (90 күн)",
    unitsSoldLabel: "Сатылды, дана",
    piecesSuffix: "дана",
    revenueLabel: "Түсім",
    noOrders: "Бұл кезеңде әлі берілген тапсырыстар болған жоқ.",
    otherCurrencies: (list) => `Басқа валютадағы тапсырыстар да бар: ${list} — бөлек көрсетілген.`,
  },
  en: {
    title: "Financial analytics",
    hint: (days) => `Last 30 and ${days} days, delivered orders only.`,
    loading: "Loading…",
    loadError: (msg) => `Failed to load analytics: ${msg}`,
    revenue30: "Revenue, 30 days",
    orders30: "Orders, 30 days",
    avgOrder30: "Average order value",
    discounts30: "Discounts given (promo+points+certificates)",
    revenue90: "Revenue, 90 days",
    dailyChartTitle: "Daily revenue (30 days)",
    topProductsTitle: "Top-selling products (90 days)",
    unitsSoldLabel: "Units sold",
    piecesSuffix: "pcs",
    revenueLabel: "Revenue",
    noOrders: "No delivered orders in this period yet.",
    otherCurrencies: (list) =>
      `There are also orders in other currencies: ${list} — shown separately.`,
  },
  uz: {
    title: "Moliyaviy tahlil",
    hint: (days) => `Oxirgi 30 va ${days} kun, faqat yetkazilgan buyurtmalar.`,
    loading: "Yuklanmoqda…",
    loadError: (msg) => `Tahlilni yuklab bo‘lmadi: ${msg}`,
    revenue30: "30 kunlik daromad",
    orders30: "30 kunlik buyurtmalar",
    avgOrder30: "O‘rtacha chek",
    discounts30: "Berilgan chegirmalar (promo+ballar+sertifikatlar)",
    revenue90: "90 kunlik daromad",
    dailyChartTitle: "Kunlik daromad (30 kun)",
    topProductsTitle: "Eng ko‘p sotilgan mahsulotlar (90 kun)",
    unitsSoldLabel: "Sotilgan, dona",
    piecesSuffix: "dona",
    revenueLabel: "Daromad",
    noOrders: "Bu davrda hali yetkazilgan buyurtmalar bo‘lmagan.",
    otherCurrencies: (list) =>
      `Boshqa valyutadagi buyurtmalar ham bor: ${list} — alohida ko‘rsatilgan.`,
  },
};

function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  return currency === "KZT"
    ? `${rounded.toLocaleString()} ₸`
    : `${rounded.toLocaleString()} ${currency}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4 bg-card">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function AnalyticsPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const analytics = useQuery({
    queryKey: ["financial-analytics"],
    queryFn: () => getFinancialAnalytics(),
  });

  if (analytics.isLoading) {
    return <div className="text-sm text-muted-foreground">{tr.loading}</div>;
  }
  if (analytics.isError) {
    return (
      <div className="text-sm text-destructive">{tr.loadError(errorMessage(analytics.error))}</div>
    );
  }

  const data = analytics.data;
  const dominant = data?.dominantCurrency;
  const summary30 = dominant ? data?.summary30[dominant] : undefined;
  const summary90 = dominant ? data?.summary90[dominant] : undefined;
  const otherCurrencies = Object.keys(data?.summary90 ?? {}).filter((c) => c !== dominant);

  const chartConfig: ChartConfig = {
    revenue: { label: tr.revenueLabel, color: "var(--chart-1)" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{tr.hint(data?.windowDays ?? 90)}</p>
      </div>

      {!dominant || !summary30 ? (
        <p className="text-sm text-muted-foreground">{tr.noOrders}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={tr.revenue30} value={formatMoney(summary30.revenue, dominant)} />
            <Stat label={tr.orders30} value={String(summary30.ordersCount)} />
            <Stat
              label={tr.avgOrder30}
              value={formatMoney(
                summary30.ordersCount ? summary30.revenue / summary30.ordersCount : 0,
                dominant,
              )}
            />
            <Stat label={tr.discounts30} value={formatMoney(summary30.discountsGiven, dominant)} />
          </div>

          {summary90 && (
            <Stat label={tr.revenue90} value={formatMoney(summary90.revenue, dominant)} />
          )}

          {otherCurrencies.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {tr.otherCurrencies(otherCurrencies.join(", "))}
            </p>
          )}

          <div className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">{tr.dailyChartTitle}</h2>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={data?.dailyRevenue ?? []}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => v.slice(5)}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
              </BarChart>
            </ChartContainer>
          </div>

          <div className="bg-card border rounded-lg divide-y">
            <h2 className="font-medium p-4 pb-0">{tr.topProductsTitle}</h2>
            {(data?.topProducts ?? []).map((p) => (
              <div key={p.key} className="p-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0 truncate">{p.name}</div>
                <div className="text-sm text-muted-foreground shrink-0">
                  {p.unitsSold} {tr.piecesSuffix}
                </div>
                <div className="text-sm font-medium shrink-0">
                  {formatMoney(p.revenue, dominant)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
