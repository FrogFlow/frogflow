import { PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./chart";

export type DonutSegment = {
  key: string;
  label: string;
  bytes: number;
  /** CSS color (var(--donut-N), var(--muted), …) — see styles.css. */
  color: string;
};

/**
 * Кольцевая диаграмма занятого места (навык dataviz: категориальные цвета
 * только из validate_palette.js-провалидированного набора --donut-1..8 в
 * styles.css, поэтому НЕ --chart-1..5 — тот не проходит проверку на
 * соседних парах). Подписи рядом с кольцом обязательны (не только цвет) —
 * три средних тона держат контраст ниже 3:1 к светлой поверхности.
 */
export function StorageDonut({
  segments,
  centerLabel,
  centerSublabel,
  formatValue,
  size = 144,
}: {
  segments: DonutSegment[];
  centerLabel: string;
  centerSublabel?: string;
  /** Значение сегмента в подсказке при наведении — байты форматирует вызывающий код. */
  formatValue: (bytes: number) => string;
  size?: number;
}) {
  const nonEmpty = segments.filter((s) => s.bytes > 0);
  const config: ChartConfig = Object.fromEntries(
    segments.map((s) => [s.key, { label: s.label, color: s.color }]),
  );

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ChartContainer
        config={config}
        className="aspect-square"
        style={{ width: size, height: size }}
      >
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => (
                  <div className="flex w-full items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.payload.color }}
                    />
                    <span className="text-muted-foreground">{item.payload.label}</span>
                    <span className="ml-auto font-medium tabular-nums text-foreground">
                      {formatValue(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Pie
            data={nonEmpty}
            dataKey="bytes"
            nameKey="key"
            innerRadius="65%"
            outerRadius="100%"
            strokeWidth={2}
            stroke="var(--card)"
          >
            {nonEmpty.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <span className="text-sm font-medium leading-tight">{centerLabel}</span>
        {centerSublabel && (
          <span className="text-xs text-muted-foreground leading-tight">{centerSublabel}</span>
        )}
      </div>
    </div>
  );
}

const DONUT_COLOR_SLOTS = 8;

/**
 * Раздаёт категориальные слоты --donut-1..8 по порядку (навык dataviz:
 * фиксированный порядок, не циклический выбор по хэшу) и сворачивает
 * остаток в один сегмент «Остальные» серым — так восьмой цвет никогда не
 * присваивается «на глаз», а девятая категория не ломает палитру.
 */
export function buildDonutSegments<T>(
  items: T[],
  getKey: (item: T) => string,
  getLabel: (item: T) => string,
  getBytes: (item: T) => number,
  otherLabel = "Остальные",
): DonutSegment[] {
  const sorted = [...items].sort((a, b) => getBytes(b) - getBytes(a));
  const head = sorted.slice(0, DONUT_COLOR_SLOTS);
  const rest = sorted.slice(DONUT_COLOR_SLOTS);
  const segments = head.map((item, i) => ({
    key: getKey(item),
    label: getLabel(item),
    bytes: getBytes(item),
    color: `var(--donut-${i + 1})`,
  }));
  const restBytes = rest.reduce((sum, item) => sum + getBytes(item), 0);
  if (restBytes > 0) {
    segments.push({
      key: "__other__",
      label: otherLabel,
      bytes: restBytes,
      color: "var(--muted-foreground)",
    });
  }
  return segments;
}

/** Строка легенды: цветной кружок + подпись + значение — всегда видна, не только по ховеру. */
export function DonutLegendRow({
  segment,
  valueLabel,
}: {
  segment: DonutSegment;
  valueLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: segment.color }}
      />
      <span className="truncate">{segment.label}</span>
      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{valueLabel}</span>
    </div>
  );
}
