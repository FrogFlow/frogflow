import type { ConsultantProduct } from "./catalog";

/**
 * Приведение ответа к тому, как продавец просит разговаривать с покупателем:
 * бренды латиницей, без восклицательных знаков и без эмодзи.
 *
 * Правила про это в промпте есть, но модель их нарушает — «Травмина» вместо
 * «Traumina» приехала в том же сообщении, где строкой выше стояло правильное
 * «Traumina Cube Junior Natur». Поэтому здесь механика, а не только просьба.
 */

const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translit(word: string): string {
  return word
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("");
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Слова, которые в названиях товаров не бренды, а размеры и служебное. */
const NOT_A_BRAND = new Set(["см", "cm", "wk", "set", "new", "the", "and"]);

/**
 * Латинские слова из названий каталога — рабочий список брендов и коллекций.
 * Второго списка не заводим: он устареет на первой же новой марке в прайсе.
 */
export function brandVocabulary(catalog: ConsultantProduct[]): string[] {
  const seen = new Map<string, string>();
  for (const p of catalog) {
    for (const raw of p.name.split(/[^A-Za-z]+/)) {
      if (raw.length < 5) continue;
      const key = raw.toLowerCase();
      if (NOT_A_BRAND.has(key) || seen.has(key)) continue;
      seen.set(key, raw);
    }
  }
  return [...seen.values()];
}

/**
 * Кириллическое написание бренда возвращается к фабричному.
 *
 * Порог подобран узко: слово от пяти букв и расхождение не больше одной
 * правки на пять символов. «Травмина» → travmina против traumina это одна
 * правка, а обычные русские слова до брендов так близко не подходят.
 */
export function fixBrandSpelling(text: string, brands: string[]): string {
  if (!text || brands.length === 0) return text;
  const lower = brands.map((b) => [b.toLowerCase(), b] as const);
  return text.replace(/[А-Яа-яЁё]{5,}/g, (word) => {
    const lat = translit(word);
    let best: { brand: string; dist: number } | null = null;
    for (const [low, original] of lower) {
      const limit = Math.max(1, Math.floor(low.length / 5));
      if (Math.abs(low.length - lat.length) > limit) continue;
      const dist = editDistance(lat, low);
      if (dist <= limit && (!best || dist < best.dist)) best = { brand: original, dist };
    }
    if (!best) return word;
    // Заглавная в начале сохраняется: «Травмина» → «Traumina», «травмина» → «traumina».
    return /^[А-ЯЁ]/.test(word) ? best.brand : best.brand.toLowerCase();
  });
}

/** Эмодзи и пиктограммы, которые продавец просил убрать из сообщений покупателю. */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu;

/**
 * Восклицательные знаки и эмодзи из текста покупателю.
 *
 * Просьба продавца дословно: «Восторженных сообщений с восклицательными
 * знаками не делать. Эмодзи запретить». Не трогает уведомления менеджеру —
 * там пиктограммы служат метками и остаются (см. notify.ts).
 */
export function stripExclamationsAndEmoji(text: string): string {
  if (!text) return text;
  return text
    .replace(EMOJI_RE, "")
    // «Правда?!» → «Правда?», а не «Правда?.».
    .replace(/\?!+/g, "?")
    .replace(/!+/g, ".")
    // После снятия эмодзи остаются двойные пробелы и пробел перед знаком.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:?])/g, "$1")
    // «Спасибо.. Уточните» → «Спасибо. Уточните».
    .replace(/\.{2,}(?!\.)/g, ".")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** Полная доводка ответа перед отправкой покупателю. */
export function polishConsultantReply(text: string, catalog: ConsultantProduct[]): string {
  return stripExclamationsAndEmoji(fixBrandSpelling(text, brandVocabulary(catalog)));
}
