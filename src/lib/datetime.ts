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

/** Format date for users/admins in a fixed TZ (Vercel UTC ≠ browser local). */
export function formatDateTimeRu(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { timeZone: appTimeZone() });
}
