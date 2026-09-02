type Bucket = { startedAt: number; count: number };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/**
 * Per-instance burst protection. Telegram initData remains the security
 * boundary; this limiter protects a warm serverless instance from accidental
 * double taps and simple request floods.
 */
export function consumeMiniAppRateLimit(
  scope: "cart" | "checkout" | "proof" | "orders" | "search" | "library",
  telegramId: number,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const limit =
    scope === "proof"
      ? 5
      : scope === "search"
        ? 8
        : scope === "library"
          ? 30
          : scope === "checkout"
            ? 20
            : scope === "orders"
              ? 30
              : 90;
  const key = `${scope}:${telegramId}`;

  if (now - lastSweep > windowMs) {
    lastSweep = now;
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
    }
  }

  const current = buckets.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return { ok: true };
  }
  if (current.count >= limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000)),
    };
  }
  current.count += 1;
  return { ok: true };
}
