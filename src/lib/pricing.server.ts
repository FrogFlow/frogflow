/**
 * Цена товара для конкретного покупателя — одна функция на оба бота.
 *
 * Правила задаёт продавец в админке, и они ровно такие (это видно и по самой
 * форме: поле «Цены для разных стран (вручную)» подписано валютой страны, а
 * пустое поле значит «авто по курсу»):
 *
 *  1. есть ручная цена страны — берём её, она указана в валюте этой страны;
 *  2. нет — переводим базовую цену по курсу в валюту страны;
 *  3. страна ещё неизвестна — считаем по стране продавца, а НЕ по базовой цене.
 *
 * Третий пункт и есть исправление. Базовая цена у клиента намеренно выше
 * настоящей: у материала за 500 ₸ в основном поле стоит 700, а «500» задано в
 * цене для Казахстана, чтобы для других стран курс считался от 700. Пока
 * страна неизвестна, оба бота показывали именно 700 — то есть завышенную цену
 * почти всем покупателям, потому что большинство как раз из Казахстана.
 *
 * А покупателю из России цена показывалась в тенге: сценарий в Direct вообще не
 * умел переводить валюту, он лишь искал ручную цену и падал на базовую вместе с
 * её валютой. Теперь конвертация одна и та же в обоих ботах.
 */

import type { Json } from "@/integrations-supabase/types";

export type Money = { amount: number; currency: string };

export type PricedProduct = {
  price: number | string;
  currency?: string | null;
  country_prices?: Json | null;
};

/**
 * Ручная цена страны из country_prices.
 *
 * Форма админки пишет туда плоскую карту `{"KZ": 600}` — число в валюте страны.
 * Старый вид `{"KZ": {price, currency}}` в живых данных не встречается, но
 * разбирается: цена в базе живёт годами, и падать на неё нельзя.
 */
export function manualCountryPrice(table: Json | null | undefined, code: string): number | null {
  if (!table || typeof table !== "object" || Array.isArray(table)) return null;
  const entry = (table as Record<string, Json>)[code];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const amount = Number((entry as Record<string, Json>).price);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  const plain = Number(entry);
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}

type Methods = { currencies: Map<string, string>; defaultCode: string | null };

let cache: { ts: number; methods: Methods } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Валюты стран и страна по умолчанию — из реквизитов продавца.
 *
 * Кэш на пять минут: цена считается для каждой позиции корзины, и ходить в базу
 * за одним и тем же справочником по разу на строку незачем. Деплой обслуживает
 * одного арендатора, так что кэш не может смешать двух клиентов.
 */
async function loadMethods(): Promise<Methods> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.methods;

  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("payment_methods")
    .select("country_code, currency, sort_order")
    .eq("is_active", true)
    // Порядок должен быть однозначным: у одного клиента две страны с sort_order 0,
    // и без второго ключа «страна по умолчанию» менялась бы от запроса к запросу.
    .order("sort_order", { ascending: true })
    .order("country_code", { ascending: true });

  const currencies = new Map<string, string>();
  let defaultCode: string | null = null;
  for (const row of data ?? []) {
    const code = row.country_code?.toUpperCase();
    if (!code) continue;
    if (!currencies.has(code)) currencies.set(code, row.currency || "KZT");
    // Страна по умолчанию — первая в списке реквизитов, то есть домашняя страна
    // продавца. «Другая страна» на эту роль не годится: её валюта — доллар.
    if (!defaultCode && code !== "OTHER") defaultCode = code;
  }

  const methods = { currencies, defaultCode };
  cache = { ts: Date.now(), methods };
  return methods;
}

/** Сбросить кэш справочника — нужен тестам и правкам реквизитов. */
export function resetPricingCache() {
  cache = null;
}

/** Валюта, в которой платит покупатель из этой страны. */
export async function currencyForCountry(code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const { currencies } = await loadMethods();
  return currencies.get(code.toUpperCase()) ?? null;
}

/** Домашняя страна продавца — по ней считаем, пока страна покупателя неизвестна. */
export async function defaultCountryCode(): Promise<string | null> {
  const { defaultCode } = await loadMethods();
  return defaultCode;
}

/**
 * Цена товара для покупателя из страны `countryCode`.
 *
 * `null` в стране — «ещё не спросили»: считаем по домашней стране продавца.
 */
export async function resolvePrice(
  product: PricedProduct,
  countryCode: string | null | undefined,
): Promise<Money> {
  const base = Number(product.price) || 0;
  const baseCurrency = String(product.currency || "KZT").toUpperCase();

  const code = (countryCode || (await defaultCountryCode()) || "").toUpperCase();
  if (!code) return { amount: Math.round(base), currency: baseCurrency };

  const currency = (await currencyForCountry(code)) || baseCurrency;

  const manual = manualCountryPrice(product.country_prices, code);
  if (manual !== null) return { amount: Math.round(manual), currency };

  if (currency === baseCurrency) return { amount: Math.round(base), currency };

  const { convertAmount } = await import("./currency.server");
  return { amount: await convertAmount(base, baseCurrency, currency), currency };
}
