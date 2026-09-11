import { getStoredVtbRate, type StoredVtbRate } from "./rate";

export const VTB_RATE_KEY = "consultant_vtb_buy_rate";

const FETCH_MS = 12_000;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function saveVtbRate(rate: number, source: string): Promise<StoredVtbRate> {
  const stored: StoredVtbRate & { source: string } = {
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
  return stored;
}

/**
 * Курс покупки RUB в ₸ у VTB KZ. Публичного JSON у банка нет — берём
 * страницу/URL из ENV, выдираем число. Упал запрос — возвращаем null,
 * вызывающий оставляет последний удачный.
 */
export function parseVtbBuyRate(body: string): number | null {
  const json = tryJsonRate(body);
  if (json != null) return json;

  const compact = body.replace(/\s+/g, " ");
  const nearRub =
    compact.match(/RUB[^]{0,240}?(?:покуп\w*|buy)[^]{0,80}?(\d+[.,]\d{1,4})/i) ??
    compact.match(/(?:покуп\w*|buy)[^]{0,80}?RUB[^]{0,80}?(\d+[.,]\d{1,4})/i) ??
    compact.match(/российск\w*\s+рубл\w*[^]{0,160}?(\d+[.,]\d{1,4})/i);
  if (nearRub) {
    const n = Number(nearRub[1].replace(",", "."));
    if (n > 1 && n < 20) return n;
  }
  return null;
}

function tryJsonRate(body: string): number | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      rate?: unknown;
      buy?: unknown;
      rub?: { buy?: unknown };
    };
    const raw = parsed.rate ?? parsed.buy ?? parsed.rub?.buy;
    const n = Number(raw);
    if (n > 1 && n < 20) return n;
  } catch {
    return null;
  }
  return null;
}

export async function fetchVtbBuyRate(): Promise<{ rate: number; source: string } | null> {
  const urls = [
    process.env.CONSULTANT_VTB_RATE_URL?.trim(),
    "https://www.vtb-bank.kz/personal/currency/",
    "https://www.vtb-bank.kz/",
  ].filter((u): u is string => Boolean(u));

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "text/html,application/json;q=0.9",
          "user-agent": "FrogFlowConsultant/1.0",
        },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const rate = parseVtbBuyRate(text);
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
  error?: string;
}> {
  const fetched = await fetchVtbBuyRate();
  if (fetched) {
    const stored = await saveVtbRate(fetched.rate, fetched.source);
    return { ok: true, stored, fetched: true };
  }
  const last = await getStoredVtbRate();
  return {
    ok: Boolean(last),
    stored: last,
    fetched: false,
    error: last ? "fetch_failed_kept_last" : "fetch_failed_no_fallback",
  };
}
