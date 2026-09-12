export type RateSourceKind = "vtb" | "nbk" | "manual" | "other";

export function rateSourceKind(source: string | undefined): RateSourceKind {
  if (!source) return "other";
  if (source === "manual") return "manual";
  if (/nationalbank\.kz/i.test(source)) return "nbk";
  if (/vtb/i.test(source)) return "vtb";
  return "other";
}

/**
 * Курс покупки RUB в ₸: JSON, RSS НБРК или HTML кассы VTB.
 * Страница VTB `/personal/currency/` сейчас 404 — HTML-ветка на живом сайте
 * часто не срабатывает.
 */
export function parseVtbBuyRate(body: string): number | null {
  const json = tryJsonRate(body);
  if (json != null) return json;
  const nbk = parseNbkRubRate(body);
  if (nbk != null) return nbk;

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

/** Официальный RUB/KZT из RSS НБРК (`<title>RUB</title><description>5.33</description>`). */
export function parseNbkRubRate(body: string): number | null {
  for (const chunk of body.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = chunk[1];
    if (!/<title>\s*RUB\s*<\/title>/i.test(item)) continue;
    const desc = item.match(/<description>\s*([\d.,]+)\s*<\/description>/i);
    const quantRaw = item.match(/<quant>\s*([\d.,]+)\s*<\/quant>/i);
    if (!desc) return null;
    const raw = Number(desc[1].replace(",", "."));
    const quant = Number((quantRaw?.[1] ?? "1").replace(",", "."));
    const n = quant > 1 ? raw / quant : raw;
    if (n > 1 && n < 20) return n;
    return null;
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
