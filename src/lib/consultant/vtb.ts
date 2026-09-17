import { getStoredVtbRate, rememberStoredVtbRate, type StoredVtbRate } from "./rate";
import { parseVtbBuyRate, rateSourceKind, type RateSourceKind } from "./vtb-parse";

export { parseVtbBuyRate, rateSourceKind } from "./vtb-parse";
export type { RateSourceKind } from "./vtb-parse";

export const VTB_RATE_KEY = "consultant_vtb_buy_rate";

const FETCH_MS = 12_000;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function saveVtbRate(rate: number, source: string): Promise<StoredVtbRate> {
  const stored: StoredVtbRate = {
    rate,
    updatedAt: new Date().toISOString(),
    source,
  };
  const s = await db();
  await s.from("app_settings").upsert({
    key: VTB_RATE_KEY,
    value: JSON.stringify(stored),
    updated_at: stored.updatedAt,
  });
  rememberStoredVtbRate(stored);
  return stored;
}

export const VTB_ONLINE_API_URL = "https://online-api.vtb.kz/api/exchange-rate/by-currencyMob/";

async function readRateFromUrl(url: string, sendReferer = true): Promise<number | null> {
  const headers: Record<string, string> = {
    accept: "application/json,text/html,application/xml;q=0.9,*/*;q=0.8",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  if (sendReferer && /vtb\.kz/i.test(url)) {
    headers.referer = "https://online.vtb.kz/unAuth/exchange-rates";
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) return null;
  return parseVtbBuyRate(await res.text());
}

/**
 * Получение курса покупки рубля исключительно из официального API ВТБ Казахстан (online-api.vtb.kz).
 * Никаких сторонних банков или НБРК — клиенту требуется строго курс покупки ВТБ.
 */
export async function fetchVtbBuyRate(): Promise<{ rate: number; source: string; log?: string[] } | null> {
  const log: string[] = [];
  const envUrl = process.env.CONSULTANT_VTB_RATE_URL?.trim();
  const normalizedEnvUrl =
    envUrl && /online\.vtb\.kz\/unauth\/exchange-rates/i.test(envUrl)
      ? VTB_ONLINE_API_URL
      : envUrl;

  const vtbUrls = [
    VTB_ONLINE_API_URL,
    "https://online-api.vtb.kz/api/exchange-rate/by-currencyMob",
    normalizedEnvUrl,
  ].filter((u): u is string => Boolean(u));

  for (const url of vtbUrls) {
    try {
      const rate = await readRateFromUrl(url, true);
      if (rate) {
        log.push(`${url}: OK (${rate})`);
        return { rate, source: url, log };
      }
    } catch (err: any) {
      log.push(`${url} (with referer): ${err?.message || err}`);
    }

    try {
      const rate = await readRateFromUrl(url, false);
      if (rate) {
        log.push(`${url} (plain): OK (${rate})`);
        return { rate, source: url, log };
      }
    } catch (err: any) {
      log.push(`${url} (plain): ${err?.message || err}`);
    }
  }

  console.warn("[vtb-rate] VTB API fetch failed:", log);
  return null;
}

export async function refreshVtbRate(): Promise<{
  ok: boolean;
  stored: StoredVtbRate | null;
  fetched: boolean;
  kind?: RateSourceKind;
  error?: string;
  log?: string[];
}> {
  const fetched = await fetchVtbBuyRate();
  if (fetched) {
    const stored = await saveVtbRate(fetched.rate, fetched.source);
    return { ok: true, stored, fetched: true, kind: rateSourceKind(fetched.source), log: fetched.log };
  }
  const last = await getStoredVtbRate();
  return {
    ok: Boolean(last),
    stored: last,
    fetched: false,
    kind: last ? rateSourceKind(last.source) : undefined,
    error: last ? "fetch_failed_kept_last" : "fetch_failed_no_fallback",
  };
}
