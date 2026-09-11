import { containsForbiddenPhrase } from "./intent";
import type { ConsultantProduct } from "./catalog";

const PRICE_TOKEN_RE = /\d[\d\s]{2,}/g;

const SHIPPING_QUOTE_RE =
  /стоимост[ьи]\s+доставк|доставк\w{0,8}\s+\d|доставка\s+(стоит|обойд|составит|будет\s+\d)|рассчита\w*\s+доставк|доставка\s+\d/i;

/** Основы цветов — ловим «розовом», не только «розовый». */
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
  for (const n of extraNumbers) facts.add(String(n));
  for (const p of products) {
    facts.add(String(p.price_kzt));
    facts.add(p.price_kzt.toLocaleString("ru-RU"));
    if (p.stock_qty != null) facts.add(String(p.stock_qty));
    facts.add(p.size);
    for (const c of p.colors) facts.add(c.toLowerCase());
    facts.add(p.name.toLowerCase());
  }
  return facts;
}

/**
 * Не отправляем ответ, если модель вставила число, которого не было в tools.
 * Короткие числа (размер 70, 140) пропускаем, если они есть в фактах или < 1000
 * и похожи на размер — иначе режем любой «похожий на цену» токен ≥ 1000.
 */
export function replyUsesUnknownPrice(text: string, known: Set<string>): boolean {
  const tokens = text.match(PRICE_TOKEN_RE) ?? [];
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
  return SHIPPING_QUOTE_RE.test(text);
}

export function replyUsesUnknownColor(text: string, known: Set<string>): boolean {
  if (!COLOR_CLAIM_RE.test(text)) return false;
  const lower = text.toLowerCase();
  const knownJoined = [...known].join(" ").toLowerCase();
  for (const stem of COLOR_STEMS) {
    if (!hasColorStem(lower, stem)) continue;
    if (hasColorStem(knownJoined, stem)) continue;
    return true;
  }
  return false;
}

export function validateConsultantReply(
  text: string,
  knownProducts: ConsultantProduct[],
  extraNumbers: number[] = [],
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (containsForbiddenPhrase(trimmed)) return { ok: false, reason: "forbidden_phrase" };
  if (replyQuotesShippingCost(trimmed)) return { ok: false, reason: "shipping_quote" };
  const known = collectKnownFacts(knownProducts, extraNumbers);
  if (replyUsesUnknownPrice(trimmed, known)) {
    return { ok: false, reason: "unknown_price" };
  }
  if (replyUsesUnknownColor(trimmed, known)) {
    return { ok: false, reason: "unknown_color" };
  }
  return { ok: true };
}
