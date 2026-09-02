import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components-ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components-ui/tabs";
import { errorMessage } from "@/lib/error-message";
import { getFinancialAnalytics, getFinancialAnalyticsConverted } from "@/lib/analytics.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import { useVertical } from "@/lib/verticals/use-vertical";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

type CurrencySummary = { revenue: number; ordersCount: number; discountsGiven: number };
type TopProduct = { key: string; name: string; unitsSold: number; revenue: number };
type DailyPoint = { date: string; revenue: number };

const copy: Record<
  Locale,
  {
    title: string;
    hint: (days: number) => string;
    hintPhysical: (days: number) => string;
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
    noOrdersPhysical: string;
    sectionTitle: (currency: string) => string;
    combinedTitle: string;
    combinedTabLabel: string;
    combinedHint: string;
    combinedTargetLabel: string;
    unconvertedWarning: (list: string) => string;
  }
> = {
  ru: {
    title: "Финансовая аналитика",
    hint: (days) => `За последние 30 и ${days} дней, только выданные заказы.`,
    hintPhysical: (days) =>
      `За последние 30 и ${days} дней: выданные заказы целиком и задатки по заказам в работе.`,
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
    noOrdersPhysical: "За этот период заказов (выданных и в работе с задатком) ещё не было.",
    sectionTitle: (currency) => `Статистика в ${currency}`,
    combinedTitle: "Общий свод по всем валютам",
    combinedTabLabel: "Общий свод",
    combinedHint: "Всё пересчитано в одну валюту по сегодняшнему курсу.",
    combinedTargetLabel: "Пересчитать в:",
    unconvertedWarning: (list) =>
      `Не удалось пересчитать курс для: ${list} — эти суммы не вошли в свод ниже.`,
  },
  kk: {
    title: "Қаржылық аналитика",
    hint: (days) => `Соңғы 30 және ${days} күн, тек берілген тапсырыстар.`,
    hintPhysical: (days) =>
      `Соңғы 30 және ${days} күн: берілген тапсырыстар толық және дайындалып жатқандардың алдын ала төлемі.`,
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
    noOrdersPhysical:
      "Бұл кезеңде берілген және дайындалып жатқан (алдын ала төлеммен) тапсырыстар жоқ.",
    sectionTitle: (currency) => `${currency} валютасындағы статистика`,
    combinedTitle: "Барлық валюта бойынша жалпы қорытынды",
    combinedTabLabel: "Жалпы қорытынды",
    combinedHint: "Барлығы бүгінгі бағам бойынша бір валютаға қайта есептелген.",
    combinedTargetLabel: "Мына валютаға қайта есептеу:",
    unconvertedWarning: (list) =>
      `Бағамды қайта есептеу мүмкін болмады: ${list} — бұл сомалар төмендегі қорытындыға кірмеді.`,
  },
  en: {
    title: "Financial analytics",
    hint: (days) => `Last 30 and ${days} days, delivered orders only.`,
    hintPhysical: (days) =>
      `Last 30 and ${days} days: delivered orders in full plus deposits on orders still in production.`,
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
    noOrdersPhysical: "No orders in this period yet (delivered or in production with a deposit).",
    sectionTitle: (currency) => `Stats in ${currency}`,
    combinedTitle: "Combined total across all currencies",
    combinedTabLabel: "Combined",
    combinedHint: "Everything converted into one currency at today's rate.",
    combinedTargetLabel: "Convert into:",
    unconvertedWarning: (list) =>
      `Couldn't convert the rate for: ${list} — those amounts are not included in the total below.`,
  },
  uz: {
    title: "Moliyaviy tahlil",
    hint: (days) => `Oxirgi 30 va ${days} kun, faqat yetkazilgan buyurtmalar.`,
    hintPhysical: (days) =>
      `Oxirgi 30 va ${days} kun: yetkazilgan buyurtmalar to‘liq va ishlab chiqarishdagi oldindan to‘lovlar.`,
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
    noOrdersPhysical:
      "Bu davrda yetkazilgan yoki oldindan to‘lovli ishlab chiqarishdagi buyurtmalar yo‘q.",
    sectionTitle: (currency) => `${currency} valyutasidagi statistika`,
    combinedTitle: "Barcha valyutalar bo‘yicha umumiy svod",
    combinedTabLabel: "Umumiy svod",
    combinedHint: "Hammasi bugungi kurs bo‘yicha bitta valyutaga qayta hisoblangan.",
    combinedTargetLabel: "Shu valyutaga o‘tkazish:",
    unconvertedWarning: (list) =>
      `Kursni qayta hisoblab bo‘lmadi: ${list} — bu summalar quyidagi svodga kirmagan.`,
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

/**
 * Полный блок цифр (карточки + график + топ товаров) для одной валюты —
 * используется и для каждой реальной валюты по отдельности, и для общего
 * свода после пересчёта в одну. Один компонент, а не копия JSX дважды.
 */
function CurrencyBlock({
  title,
  currency,
  summary30,
  summary90,
  daily,
  topProducts,
  tr,
}: {
  title: string;
  currency: string;
  summary30: CurrencySummary;
  summary90: CurrencySummary | undefined;
  daily: DailyPoint[];
  topProducts: TopProduct[];
  tr: (typeof copy)["ru"];
}) {
  const chartConfig: ChartConfig = {
    revenue: { label: tr.revenueLabel, color: "var(--chart-1)" },
  };

  return (
    <div className="space-y-4">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={tr.revenue30} value={formatMoney(summary30.revenue, currency)} />
        <Stat label={tr.orders30} value={String(summary30.ordersCount)} />
        <Stat
          label={tr.avgOrder30}
          value={formatMoney(
            summary30.ordersCount ? summary30.revenue / summary30.ordersCount : 0,
            currency,
          )}
        />
        <Stat label={tr.discounts30} value={formatMoney(summary30.discountsGiven, currency)} />
      </div>

      {summary90 && <Stat label={tr.revenue90} value={formatMoney(summary90.revenue, currency)} />}

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h3 className="font-medium">{tr.dailyChartTitle}</h3>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <BarChart data={daily}>
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
        <h3 className="font-medium p-4 pb-0">{tr.topProductsTitle}</h3>
        {topProducts.map((p) => (
          <div key={p.key} className="p-3 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0 truncate">{p.name}</div>
            <div className="text-sm text-muted-foreground shrink-0">
              {p.unitsSold} {tr.piecesSuffix}
            </div>
            <div className="text-sm font-medium shrink-0">{formatMoney(p.revenue, currency)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CombinedSection({
  currencies,
  defaultTarget,
  tr,
}: {
  currencies: string[];
  defaultTarget: string;
  tr: (typeof copy)["ru"];
}) {
  const [target, setTarget] = useState(defaultTarget);
  const converted = useQuery({
    queryKey: ["financial-analytics-converted", target],
    queryFn: () => getFinancialAnalyticsConverted({ data: { targetCurrency: target } }),
    enabled: !!target,
  });

  // Только валюты, в которых реально были заказы, — переводить в валюту,
  // которой магазин никогда не пользовался, продавцу незачем.
  const options = currencies.length > 0 ? currencies : [defaultTarget];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{tr.combinedTitle}</h2>
          <p className="text-sm text-muted-foreground mt-1">{tr.combinedHint}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {tr.combinedTargetLabel}
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="border rounded-md px-2 py-1.5 bg-background"
          >
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {converted.isLoading ? (
        <p className="text-sm text-muted-foreground">{tr.loading}</p>
      ) : converted.isError ? (
        <p className="text-sm text-destructive">{tr.loadError(errorMessage(converted.error))}</p>
      ) : converted.data ? (
        <>
          {converted.data.unconverted.length > 0 && (
            <p className="text-xs text-amber-600">
              {tr.unconvertedWarning(converted.data.unconverted.join(", "))}
            </p>
          )}
          <CurrencyBlock
            title=""
            currency={converted.data.targetCurrency}
            summary30={converted.data.summary30}
            summary90={converted.data.summary90}
            daily={converted.data.dailyRevenue}
            topProducts={converted.data.topProducts}
            tr={tr}
          />
        </>
      ) : null}
    </div>
  );
}

function AnalyticsPage() {
  const { locale } = useAdminLocale();
  const { isPhysicalShop } = useVertical();
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
  const currencies = data?.currencies ?? [];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {(isPhysicalShop ? tr.hintPhysical : tr.hint)(data?.windowDays ?? 90)}
        </p>
      </div>

      {!dominant || currencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isPhysicalShop ? tr.noOrdersPhysical : tr.noOrders}
        </p>
      ) : (
        <Tabs defaultValue={dominant}>
          <TabsList className="flex-wrap h-auto">
            {currencies.map((cur) => (
              <TabsTrigger key={cur} value={cur}>
                {cur}
              </TabsTrigger>
            ))}
            <TabsTrigger value="__combined">{tr.combinedTabLabel}</TabsTrigger>
          </TabsList>

          {currencies.map((cur) => (
            <TabsContent key={cur} value={cur} className="space-y-4 pt-4">
              <CurrencyBlock
                title=""
                currency={cur}
                summary30={data.summary30[cur]}
                summary90={data.summary90[cur]}
                daily={data.dailyRevenueByCurrency[cur] ?? []}
                topProducts={data.topProductsByCurrency[cur] ?? []}
                tr={tr}
              />
            </TabsContent>
          ))}

          <TabsContent value="__combined" className="space-y-4 pt-4">
            <CombinedSection currencies={currencies} defaultTarget={dominant} tr={tr} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
