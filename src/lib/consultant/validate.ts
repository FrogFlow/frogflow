import { containsForbiddenPhrase } from "./intent";
import type { ConsultantProduct } from "./catalog";
import { foldText } from "./synonyms";

const PRICE_TOKEN_RE = /\d[\d\s]{2,}/g;

const SHIPPING_QUOTE_RE =
  /стоимост[ьи]\s+доставк\w*\s*[:—\-–]?\s*\d|доставк\w{0,8}\s*[:—\-–]?\s*\d|доставка\s+(?:стоит|обойд|составит|будет\s+\d)/i;

const COLOR_STEMS = [
  "бел",
  "сер",
  "черн",
  "чёрн",
  "бежев",
  "син",
  "голуб",
  "розов",
  "красн",
  "зелен",
  "зелён",
  "коричнев",
  "желт",
  "жёлт",
  "оранж",
  "фиолет",
  "золот",
  "серебрян",
  "молочн",
  "кремов",
  "хаки",
  "бордо",
  "графит",
  "песочн",
  "мятн",
  "пудров",
  "лаванд",
] as const;

const COLOR_CLAIM_RE = /в наличии|есть в|доступен|можем предложить|есть цвет|цвет/i;

function hasColorStem(text: string, stem: string): boolean {
  return new RegExp(`(^|[^a-zа-яё])${stem}[а-яё]*`, "i").test(text);
}

export function collectKnownFacts(
  products: ConsultantProduct[],
  extraNumbers: number[] = [],
): Set<string> {
  const facts = new Set<string>();
  for (const n of extraNumbers) {
    facts.add(String(n));
    facts.add(n.toLocaleString("ru-RU"));
  }
  const prices: number[] = [];
  for (const p of products) {
    facts.add(String(p.price_kzt));
    facts.add(p.price_kzt.toLocaleString("ru-RU"));
    prices.push(p.price_kzt);
    if (p.stock_qty != null) facts.add(String(p.stock_qty));
    facts.add(p.size);
    for (const c of p.colors) facts.add(c.toLowerCase());
    facts.add(p.name.toLowerCase());
    facts.add(foldText(p.name));
  }
  // Allow pairwise and 3-item sums for basket sets / kits
  for (let i = 0; i < prices.length; i++) {
    for (let j = i; j < prices.length; j++) {
      const sum2 = prices[i] + prices[j];
      facts.add(String(sum2));
      facts.add(sum2.toLocaleString("ru-RU"));
      for (let k = j; k < prices.length && k < i + 4; k++) {
        const sum3 = sum2 + prices[k];
        facts.add(String(sum3));
        facts.add(sum3.toLocaleString("ru-RU"));
      }
    }
  }
  return facts;
}

export function replyUsesUnknownPrice(text: string, known: Set<string>): boolean {
  // Strip phone numbers like +7 701 123 45 67, 8 (701) 123-45-67, etc.
  const withoutPhones = text.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}/g, " ");
  // Strip 4-digit years like 2024, 2025, 2026
  const withoutYears = withoutPhones.replace(/\b202[0-9]\b/g, " ");
  const tokens = withoutYears.match(PRICE_TOKEN_RE) ?? [];
  for (const raw of tokens) {
    const compact = raw.replace(/\s/g, "");
    const n = Number(compact);
    if (!Number.isFinite(n)) continue;
    if (n < 1000) continue;
    if (known.has(compact) || known.has(raw.trim()) || known.has(n.toLocaleString("ru-RU"))) {
      continue;
    }
    return true;
  }
  return false;
}

export function replyQuotesShippingCost(text: string): boolean {
  if (/по\s+тарифам|тарифам\s+сдэк|оплачивается\s+при\s+получении|рассчитывается\s+курьер/i.test(text)) {
    return false;
  }
  return SHIPPING_QUOTE_RE.test(text);
}

export function replyUsesUnknownColor(text: string, known: Set<string>): boolean {
  if (!COLOR_CLAIM_RE.test(text)) return false;
  const lower = text.toLowerCase();
  const knownJoined = [...known].join(" ").toLowerCase();
  for (const stem of COLOR_STEMS) {
    if (!hasColorStem(lower, stem)) continue;
    if (hasColorStem(knownJoined, stem)) continue;
    // Check if the color is actually being negated or marked as unavailable (e.g. "бежевого цвета нет", "закончился")
    const negatedColorRe = new RegExp(
      `(?:нет|закончил|не\\s+осталось|не\\s+(?:доступен|в\\s+наличии|представлен)|кроме)[^.!?\\n]*?${stem}`,
      "i",
    );
    const colorAfterNegatedRe = new RegExp(
      `${stem}[а-яё]*\\s+[^.!?\\n]*?(?:нет|закончил|не\\s+(?:доступен|в\\s+наличии))`,
      "i",
    );
    if (negatedColorRe.test(lower) || colorAfterNegatedRe.test(lower)) {
      continue;
    }
    return true;
  }
  return false;
}

export function cleanForbiddenPhrases(text: string): string {
  let res = text;
  const clichés = [
    "прекрасный выбор",
    "отличный выбор",
    "замечательный выбор",
    "будем рады помочь",
    "буду рад помочь",
    "передаю ваш диалог менеджеру",
    "передаю менеджеру",
  ];
  for (const phrase of clichés) {
    const re = new RegExp(`(^|[.!?]\\s*)${phrase}[.!?…]*\\s*`, "gi");
    res = res.replace(re, "$1");
  }
  res = res.replace(/^(?:отлично|прекрасно|замечательно)[!.,\s]*/i, "");
  res = res.trim();
  if (res.length > 0) {
    res = res.charAt(0).toUpperCase() + res.slice(1);
  }
  return res;
}

export function replyUsesUnknownProductName(_text: string, _products: ConsultantProduct[]): boolean {
  return false;
}

export function replyInventedInStock(text: string, products: ConsultantProduct[]): boolean {
  const stripped = text.replace(/(?:нет|не)\s+в\s+наличии/gi, "");
  if (!/есть в наличии|в наличии/i.test(stripped)) return false;
  if (products.length === 0) return true;
  return products.every((p) => !p.stock);
}

export function validateConsultantReply(
  text: string,
  knownProducts: ConsultantProduct[],
  extraNumbers: number[] = [],
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 1200) return { ok: false, reason: "too_long" };
  if (replyQuotesShippingCost(trimmed)) return { ok: false, reason: "shipping_quote" };
  const known = collectKnownFacts(knownProducts, extraNumbers);
  if (replyUsesUnknownPrice(trimmed, known)) return { ok: false, reason: "unknown_price" };
  if (replyUsesUnknownColor(trimmed, known)) return { ok: false, reason: "unknown_color" };
  if (replyInventedInStock(trimmed, knownProducts)) return { ok: false, reason: "unknown_stock" };
  return { ok: true };
}
