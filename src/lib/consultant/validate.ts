import { containsForbiddenPhrase } from "./intent";
import type { ConsultantProduct } from "./catalog";

const PRICE_TOKEN_RE = /\d[\d\s]{2,}/g;

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

export function validateConsultantReply(
  text: string,
  knownProducts: ConsultantProduct[],
  extraNumbers: number[] = [],
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (containsForbiddenPhrase(trimmed)) return { ok: false, reason: "forbidden_phrase" };
  if (replyUsesUnknownPrice(trimmed, collectKnownFacts(knownProducts, extraNumbers))) {
    return { ok: false, reason: "unknown_price" };
  }
  return { ok: true };
}
