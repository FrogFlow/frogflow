import { getStoredVtbRate, rememberStoredVtbRate, type StoredVtbRate } from "./rate";
import { parseVtbBuyRate, rateSourceKind, type RateSourceKind } from "./vtb-parse";

export { parseNbkRubRate, parseVtbBuyRate, rateSourceKind } from "./vtb-parse";
export type { RateSourceKind } from "./vtb-parse";

export const VTB_RATE_KEY = "consultant_vtb_buy_rate";

const FETCH_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; FrogFlowConsultant/1.0)";

export const NBK_RATES_URLS = [
  "https://www.nationalbank.kz/rss/rates_all.xml",
  "https://nationalbank.kz/rss/rates_all.xml",
] as const;

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

async function readRateFromUrl(url: string): Promise<number | null> {
  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xml,application/json;q=0.9,*/*;q=0.8",
      "user-agent": UA,
    },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) return null;
  return parseVtbBuyRate(await res.text());
}

/**
 * Сначала касса VTB / CONSULTANT_VTB_RATE_URL. Страница
 * `/personal/currency/` у банка сейчас 404, главная курс не содержит —
 * без запасного источника кнопка всегда писала «Курс не получен».
 * Дальше официальный RSS НБРК.
 */
export async function fetchVtbBuyRate(): Promise<{ rate: number; source: string } | null> {
  const vtbUrls = [
    process.env.CONSULTANT_VTB_RATE_URL?.trim(),
    "https://www.vtb-bank.kz/personal/currency/",
    "https://vtb-bank.kz/personal/currency/",
    "https://www.vtb-bank.kz/",
  ].filter((u): u is string => Boolean(u));

  for (const url of vtbUrls) {
    try {
      const rate = await readRateFromUrl(url);
      if (rate) return { rate, source: url };
    } catch {
      /* следующий источник */
    }
  }

  for (const url of NBK_RATES_URLS) {
    try {
      const rate = await readRateFromUrl(url);
      if (rate) return { rate, source: url };
    } catch {
      /* следующий источник */
    }
  }
  return null;
}

export async function refreshVtbRate(): Promise<{
  ok: boolean;
  stored: StoredVtbRate | null;
  fetched: boolean;
  kind?: RateSourceKind;
  error?: string;
}> {
  const fetched = await fetchVtbBuyRate();
  if (fetched) {
    const stored = await saveVtbRate(fetched.rate, fetched.source);
    return { ok: true, stored, fetched: true, kind: rateSourceKind(fetched.source) };
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
