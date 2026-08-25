import { tg } from "./telegram.server";

/**
 * Robokassa's success/fail redirect pages are anonymous — no signature, no
 * secret, just a plain GET/POST anyone can hit. Each render used to call
 * Telegram's getMe on every single request to build the "back to bot" link,
 * so a trivial flood of that public URL burned through the bot's Telegram
 * API rate limit. The bot's username essentially never changes, so an
 * in-memory cache with a generous TTL is enough — worst case a rename takes
 * up to CACHE_TTL_MS to show up here.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_TTL_MS = 5 * 60 * 1000;

let cached: { url: string | null; expiresAt: number } | null = null;

export async function getCachedBotUrl(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  try {
    const res = await tg("getMe", {});
    const username = (res?.result as { username?: string })?.username;
    const url = username ? `https://t.me/${username}` : null;
    cached = { url, expiresAt: Date.now() + CACHE_TTL_MS };
    return url;
  } catch {
    // Keep serving the last known-good URL, and don't retry Telegram again
    // until RETRY_TTL_MS has passed — a flood of this public page must not
    // turn into a flood of getMe calls just because the first one failed.
    const url = cached?.url ?? null;
    cached = { url, expiresAt: Date.now() + RETRY_TTL_MS };
    return url;
  }
}
