// Free FX rates from open.er-api.com (no API key), cached in app_settings.
const CACHE_KEY = "fx_rates_usd_v1";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

type Cached = { ts: number; rates: Record<string, number> };

async function loadCache(): Promise<Cached | null> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", CACHE_KEY)
    .maybeSingle();
  if (!data?.value) return null;
  try {
    return JSON.parse(data.value) as Cached;
  } catch {
    return null;
  }
}

async function saveCache(c: Cached) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const value = JSON.stringify(c);

  // Deliberately not an upsert: ON CONFLICT has to name the exact unique
  // constraint, and app_settings' key changes from (key) to (bot_id, key)
  // partway through the migration — either spelling would be wrong on one side
  // of it. Update-then-insert works under both, so the rate cache keeps
  // working while the phases are applied. A lost race here just re-fetches.
  const { data: existing } = await supabaseAdmin
    .from("app_settings")
    .select("key")
    .eq("key", CACHE_KEY)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from("app_settings").update({ value }).eq("key", CACHE_KEY);
  } else {
    await supabaseAdmin.from("app_settings").insert({ key: CACHE_KEY, value });
  }
}

async function fetchRates(): Promise<Record<string, number>> {
  const r = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!r.ok) throw new Error(`FX api ${r.status}`);
  const j = (await r.json()) as { result?: string; rates?: Record<string, number> };
  if (j.result !== "success" || !j.rates) throw new Error("FX api bad payload");
  return j.rates;
}

let inMemoryCache: { ts: number; rates: Record<string, number> } | null = null;
const MEMORY_TTL = 10 * 60 * 1000; // 10 min

async function getRates(): Promise<Record<string, number>> {
  if (inMemoryCache && Date.now() - inMemoryCache.ts < MEMORY_TTL) {
    return inMemoryCache.rates;
  }

  const cached = await loadCache();
  if (cached && Date.now() - cached.ts < TTL_MS) {
    inMemoryCache = { ts: Date.now(), rates: cached.rates };
    return cached.rates;
  }
  
  try {
    const rates = await fetchRates();
    await saveCache({ ts: Date.now(), rates });
    inMemoryCache = { ts: Date.now(), rates };
    return rates;
  } catch (e) {
    if (cached) {
      inMemoryCache = { ts: Date.now(), rates: cached.rates };
      return cached.rates; // fall back to stale
    }
    throw e;
  }
}

// Convert `amount` from `from` currency to `to` currency. Rounds to whole units.
export async function convertAmount(amount: number, from: string, to: string): Promise<number> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (!amount || f === t) return Math.round(amount);
  
  try {
    const rates = await getRates();
    const rf = rates[f];
    const rt = rates[t];
    if (!rf || !rt) return Math.round(amount); // unknown currency — keep as-is
    const usd = amount / rf;
    const result = usd * rt;
    return Math.round(result);
  } catch (e) {
    console.error("[convertAmount] failed", e);
    return Math.round(amount); // fallback to original amount on failure
  }
}