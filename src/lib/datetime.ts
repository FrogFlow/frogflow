/** Display timezone for VIP dates (admin + Telegram). Override with APP_TIMEZONE. */
export function appTimeZone(): string {
  return (process.env.APP_TIMEZONE || "Asia/Almaty").trim() || "Asia/Almaty";
}

/**
 * Calendar-day arithmetic on YYYY-MM-DD. Does not use wall-clock +24h, so
 * "tomorrow" stays the next calendar day in the shop TZ even around DST
 * or when today was already converted with toLocaleDateString.
 */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD HH:mm:ss in a named timezone — for CSV, not UTC-срез ISO. */
export function formatDateTimeIso(date: Date | string, timeZone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("sv-SE", { timeZone }).replace(", ", " ");
}

/** Format date for users/admins in a fixed TZ (Vercel UTC ≠ browser local). */
export function formatDateTimeRu(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { timeZone: appTimeZone() });
}

/**
 * Начало/конец календарного дня магазина (YYYY-MM-DD, в его таймзоне) — как
 * настоящий момент времени в UTC, а не как голая строка без зоны.
 *
 * Раньше диапазон дат экспорта (export.functions.ts) сравнивался с
 * `orders.created_at` (timestamptz) через `${date}T00:00:00`/`T23:59:59` без
 * зоны вовсе — Postgres трактует такую строку как UTC. Для магазина не в
 * UTC (по умолчанию Asia/Almaty, UTC+5/+6) это на несколько часов сдвигало
 * границы диапазона: экспорт «за 1 сентября» либо терял ранние заказы дня,
 * либо прихватывал несколько часов из соседних суток.
 *
 * Двойная конвертация — стандартный приём без библиотеки таймзон:
 * `guess` берёт запрошенные дату/время как если бы они уже были UTC, затем
 * смотрим, как этот момент выглядит в целевой зоне, и меряем расхождение —
 * оно и есть смещение зоны в этот момент (устойчиво к DST, обычной зоне
 * магазина не грозящему, но не завязано на это допущение).
 */
export function zonedDateTimeToUtcIso(
  dateIso: string,
  timeStr: "00:00:00" | "23:59:59",
  timeZone: string,
): string {
  const guess = new Date(`${dateIso}T${timeStr}Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  // Полночь Intl иногда отдаёт как "24" в 24-часовом формате отдельных локалей.
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asIfLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = guess.getTime() - asIfLocal;
  return new Date(guess.getTime() + offsetMs).toISOString();
}
