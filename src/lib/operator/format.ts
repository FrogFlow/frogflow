/** Место в хранилище: гигабайты с десятыми, ниже гигабайта — целые мегабайты. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} ГБ`;
  return `${Math.round(bytes / 1024 ** 2)} МБ`;
}

/** Сколько дней назад, целыми сутками. null — события не было. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
