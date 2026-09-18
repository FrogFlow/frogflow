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

export function cleanScriptHallucinations(text: string): string {
  if (!text) return "";
  const scriptIdx = text.search(/(?:^|\n)\s*(?:customer|client|user|клиент|покупатель|пользователь|assistant|ассистент)\s*:/i);
  if (scriptIdx !== -1) {
    return text.slice(0, scriptIdx).trim();
  }
  return text;
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

/**
 * Матрасы средней жёсткости сняты с производства — продавец просил не
 * упоминать их вовсе. Из каталога они вычищены (catalog.ts,
 * isDiscontinuedProduct), но те же линейки описаны в PDF базы знаний, а она
 * целиком уходит в промпт: модель может назвать MEDIUM, ничего не искав.
 * Поэтому запрет не только правилом в промпте, но и механически — здесь.
 *
 * Вырезается предложение, где матрас предлагается в средней жёсткости.
 * Честный отказ («матрасов средней жёсткости сейчас нет») остаётся: это
 * ровно то, что нужно ответить, когда клиент спросил про неё сам.
 */
const MATTRESS_WORD_RE = /(?<![а-яё])матрас|mattress/i;

/**
 * Линейки матрасов из ассортимента магазина. Слово «матрас» модель в
 * предложении часто опускает — пишет «Могу предложить TRESOR R2 MEDIUM», и
 * проверка только по слову «матрас» такую фразу пропускала. Топперы
 * (MOUSSE, GREEM, RE:ACTIVE) и наматрасники Traumina в список не входят
 * намеренно: их средняя жёсткость с производства не снята.
 */
const MATTRESS_LINE_RE =
  /(?<![a-zа-яё])(?:former|levant|tresor|sfera|epic|frankenstolz)(?![a-zа-яё])/i;

function mentionsMattress(sentence: string): boolean {
  return MATTRESS_WORD_RE.test(sentence) || MATTRESS_LINE_RE.test(sentence);
}

// \w в JavaScript — только латиница: «средн\w*» на слове «средней» не
// срабатывает. Поэтому окончания перечислены кириллическим классом.
const MEDIUM_HARDNESS_RE =
  /(?<![a-zа-яё])medium(?![a-zа-яё])|средн[а-яё]*\s+(?:по\s+)?(?:жёстк|жестк)[а-яё]*|(?:жёстк|жестк)[а-яё]*\s+средн[а-яё]*/i;

const HARDNESS_DENIAL_RE =
  /(?<![а-яё])нет(?![а-яё])|не\s+прода|сн[ня]т[а-яё]*\s+с\s+производств|не\s+выпуска|закончил|не\s+остал|больше\s+не|отсутству/i;

export function offersDiscontinuedMattress(sentence: string): boolean {
  if (!mentionsMattress(sentence)) return false;
  if (!MEDIUM_HARDNESS_RE.test(sentence)) return false;
  return !HARDNESS_DENIAL_RE.test(sentence);
}

/** Ответ на случай, когда от текста после вырезания ничего не осталось. */
export const DISCONTINUED_MEDIUM_MATTRESS_REPLY =
  "Матрасов средней жёсткости сейчас нет — эту линейку сняли с производства. Есть комфортные (Soft) и упругие (Firm), показать варианты?";

/** Убирает из текста предложения, на которые сработало условие. */
function dropSentences(text: string, drop: (sentence: string) => boolean): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(/(?<=[.!?…])\s+/);
    const keptParts = parts.filter((part) => !drop(part));
    const joined = keptParts.join(" ").trim();
    // Строка ушла целиком — убираем её вместе с переводом строки, чтобы в
    // ответе не осталось дырки из пустых абзацев.
    if (keptParts.length !== parts.length && !joined) continue;
    kept.push(joined);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function cleanDiscontinuedMattressOffers(text: string): string {
  return dropSentences(text, offersDiscontinuedMattress);
}

/**
 * Отговорка про каталог.
 *
 * Продавец о живом ответе: «спросил про это конкретное полотенце — про
 * качество самой компании сказал хорошо, по тому файлу, а тут нельзя так
 * говорить: не знаю, спросите у менеджера. Сколько есть инфо, пусть даст».
 * Покупателю не объясняют устройство нашей базы — ему отвечают тем, что
 * известно. Предложение с такой отговоркой вырезается, остальной ответ (имя
 * коллекции, цвет, цена, слова о марке из базы знаний) остаётся.
 */
const CATALOG_EXCUSE_RE =
  /в (?:нашем\s+)?каталоге\s+(?:не\s+(?:указан|прописан|содержится|представлен)|нет\s+(?:детальн|подробн|информац)|отсутству)|(?:детальн|подробн)[а-яё]*\s+характеристик[а-яё]*[^.]{0,40}не\s+указан|у\s+меня\s+нет\s+(?:детальн[а-яё]*\s+)?информации\s+о\s+(?:состав|материал)/i;

export function isCatalogExcuse(sentence: string): boolean {
  return CATALOG_EXCUSE_RE.test(sentence);
}

export function cleanCatalogExcuses(text: string): string {
  const cleaned = dropSentences(text, isCatalogExcuse);
  // Если от ответа ничего не осталось, отговорка была всем ответом — тогда
  // лучше исходный текст, чем пустое сообщение.
  return cleaned.trim() ? cleaned : text;
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
  if (/(?:^|\n)\s*(?:customer|client|user|клиент|покупатель|пользователь|assistant|ассистент)\s*:/i.test(trimmed)) {
    return { ok: false, reason: "script_hallucination" };
  }
  return { ok: true };
}
