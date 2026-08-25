/**
 * Отзывы и рейтинг товаров (Кейс 3, №5) — чистые функции без БД.
 */

export function isValidRating(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

export function starsForRating(rating: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(rating)));
  return "⭐".repeat(clamped) + "☆".repeat(5 - clamped);
}

export function formatRatingSummary(avg: number | null, count: number): string | null {
  if (!count || avg === null) return null;
  return `⭐ ${avg.toFixed(1)} (${count})`;
}
