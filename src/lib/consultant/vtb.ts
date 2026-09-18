import { getStoredVtbRate, rememberStoredVtbRate, type StoredVtbRate } from "./rate";
import {
  parseVtbRateQuote,
  rateSourceKind,
  type RateSourceKind,
  type VtbRateQuote,
} from "./vtb-parse";

export { parseVtbBuyRate, parseVtbRateQuote, rateSourceKind } from "./vtb-parse";
export type { RateSourceKind } from "./vtb-parse";

export const VTB_RATE_KEY = "consultant_vtb_buy_rate";
export const VTB_LAST_ERROR_KEY = "consultant_vtb_last_error";

/**
 * Одна попытка — шесть секунд, весь обход источников — не больше двадцати.
 * Раньше таймаут был 12 секунд на попытку при шести попытках: в худшем
 * случае крон висел больше минуты и падал по лимиту Vercel, не успев ни
 * записать курс, ни обновить каталог, который идёт в том же запросе.
 */
const FETCH_MS = 6_000;
const TOTAL_BUDGET_MS = 20_000;

export type VtbAttemptLog = {
  at: string;
  ok: boolean;
  attempts: string[];
};

/** Что было при последней попытке — чтобы в панели не гадать, почему курс старый. */
export async function saveVtbAttemptLog(log: VtbAttemptLog): Promise<void> {
  const s = await db();
  await s.from("app_settings").upsert({
    key: VTB_LAST_ERROR_KEY,
    value: JSON.stringify(log),
    updated_at: log.at,
  });
}

export async function loadVtbAttemptLog(): Promise<VtbAttemptLog | null> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", VTB_LAST_ERROR_KEY)
    .maybeSingle();
  if (!data?.value?.trim()) return null;
  try {
    const parsed = JSON.parse(data.value) as Partial<VtbAttemptLog>;
    if (!parsed.at) return null;
    return {
      at: String(parsed.at),
      ok: Boolean(parsed.ok),
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts.map(String).slice(0, 8) : [],
    };
  } catch {
    return null;
  }
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function saveVtbRate(
  rate: number,
  source: string,
  sell?: number,
): Promise<StoredVtbRate> {
  const stored: StoredVtbRate = {
    rate,
    updatedAt: new Date().toISOString(),
    source,
    ...(sell && sell > 0 ? { sell } : {}),
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

async function readRateFromUrl(url: string, sendReferer = true): Promise<VtbRateQuote | null> {
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
  return parseVtbRateQuote(await res.text());
}

/**
 * Получение курса покупки рубля исключительно из официального API ВТБ Казахстан (online-api.vtb.kz).
 * Никаких сторонних банков или НБРК — клиенту требуется строго курс покупки ВТБ.
 */
export async function fetchVtbBuyRate(): Promise<{
  rate: number;
  sell?: number;
  source: string;
  log?: string[];
} | null> {
  const log: string[] = [];
  const startedAt = Date.now();
  const envUrl = process.env.CONSULTANT_VTB_RATE_URL?.trim();
  const normalizedEnvUrl =
    envUrl && /online\.vtb\.kz\/unauth\/exchange-rates/i.test(envUrl)
      ? VTB_ONLINE_API_URL
      : envUrl;

  /**
   * Ретранслятор в Казахстане, если он у клиента есть.
   *
   * ВТБ Казахстан обрывает соединение со всех адресов вне страны — проверено
   * и из нашей сети, и через сторонний загрузчик: не наш IP в чёрном списке,
   * а вся заграница. Деплой стоит в Сеуле (regions icn1 в vercel.json),
   * поэтому прямой запрос к online-api.vtb.kz из прода не проходит, сколько
   * бы заголовков мы ни подобрали. Лечится только запросом с казахстанского
   * адреса: CONSULTANT_VTB_RELAY_URL — любой адрес внутри Казахстана,
   * который отдаёт ответ ВТБ как есть (JSON или HTML). Он идёт первым, но
   * прямые адреса остаются: переедет деплой в Казахстан — заработают они.
   */
  const relayUrl = process.env.CONSULTANT_VTB_RELAY_URL?.trim();

  const sources: { url: string; withReferer: boolean; label: string }[] = [];
  if (relayUrl) sources.push({ url: relayUrl, withReferer: false, label: `ретранслятор ${relayUrl}` });
  for (const url of [VTB_ONLINE_API_URL, "https://online-api.vtb.kz/api/exchange-rate/by-currencyMob", normalizedEnvUrl]) {
    if (!url) continue;
    sources.push({ url, withReferer: true, label: url });
    sources.push({ url, withReferer: false, label: `${url} (без referer)` });
  }

  for (const source of sources) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      log.push("дальше не пробовали: вышло время на обход источников");
      break;
    }
    try {
      const quote = await readRateFromUrl(source.url, source.withReferer);
      if (quote) {
        log.push(`${source.label}: OK (покупка ${quote.buy}${quote.sell ? `, продажа ${quote.sell}` : ""})`);
        await saveVtbAttemptLog({ at: new Date().toISOString(), ok: true, attempts: log });
        return { rate: quote.buy, sell: quote.sell, source: source.url, log };
      }
      log.push(`${source.label}: ответ получен, но курса рубля в нём нет`);
    } catch (err: unknown) {
      log.push(`${source.label}: ${errorText(err)}`);
    }
  }

  console.warn("[vtb-rate] VTB API fetch failed:", log);
  await saveVtbAttemptLog({ at: new Date().toISOString(), ok: false, attempts: log });
  return null;
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // «fetch failed» без причины в панели бесполезно: разворачиваем в то, что
  // происходит на самом деле — Казахстан обрывает соединение из-за границы.
  if (/timeout|timed out|aborted/i.test(raw)) return "не ответил за 6 секунд (таймаут)";
  if (/fetch failed|ECONNRESET|reset|EAI_AGAIN|ENOTFOUND|socket/i.test(raw)) {
    return `соединение не установлено (${raw})`;
  }
  return raw;
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
    const stored = await saveVtbRate(fetched.rate, fetched.source, fetched.sell);
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
