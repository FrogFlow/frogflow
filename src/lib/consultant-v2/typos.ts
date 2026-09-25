/**
 * Опечатки в запросе поиска.
 *
 * Покупатели пишут на слух: «палатенца», «пальтеца», «падушки», «адеяло».
 * Поиск по прайсу ищет по основам слов и на такое отвечает пустой выдачей, а
 * модель по пустой выдаче говорит «такого нет» (24.09, живой диалог BOVI:
 * «Пальто в нашем ассортименте нет» в ответ на «Пальтеца»).
 *
 * Здесь запрос сверяется со словами прайса после выравнивания на слух (безударные
 * «о/а» и «е/и/я» совпадают, мягкий знак не пишется) и с допуском в одну-две
 * буквы. Поправка применяется, только когда исходный запрос не нашёл ничего:
 * найденное по словам покупателя важнее догадки.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";

const ENDING_RE =
  /(?:ами|ями|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ом|ем|ую|юю|ах|ях|ам|ям|ов|ев|ей|а|я|о|е|ы|и|у|ю|ь)$/;

function plainStem(word: string): string {
  const lower = word.toLowerCase().replace(/ё/g, "е");
  return lower.length > 4 ? lower.replace(ENDING_RE, "") : lower;
}

/** Основа слова, выровненная на слух: «полотенца» и «пальтеца» → близкие строки. */
export function soundStem(word: string): string {
  return plainStem(word)
    .replace(/[ьъ]/g, "")
    .replace(/о/g, "а")
    .replace(/[еяэ]/g, "и")
    .replace(/(.)\1+/g, "$1");
}

/** Расстояние Дамерау — Левенштейна: вставка, удаление, замена, перестановка соседних. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

type Vocabulary = Map<string, string>; // основа на слух → слово из прайса

const cache = new WeakMap<ConsultantProduct[], Vocabulary>();

function vocabularyOf(catalog: ConsultantProduct[]): Vocabulary {
  const cached = cache.get(catalog);
  if (cached) return cached;
  const count = new Map<string, Map<string, number>>();
  for (const p of catalog) {
    for (const word of `${p.name} ${p.category ?? ""}`.split(/[^А-Яа-яЁё]+/)) {
      if (word.length < 5) continue;
      const key = soundStem(word);
      const forms = count.get(key) ?? new Map<string, number>();
      forms.set(word.toLowerCase(), (forms.get(word.toLowerCase()) ?? 0) + 1);
      count.set(key, forms);
    }
  }
  const vocabulary: Vocabulary = new Map();
  for (const [key, forms] of count) {
    // Самая частая форма слова — её и подставляем в запрос.
    vocabulary.set(key, [...forms].sort((a, b) => b[1] - a[1])[0][0]);
  }
  cache.set(catalog, vocabulary);
  return vocabulary;
}

/**
 * Запрос с исправленными опечатками или null, если исправлять нечего.
 * Слово правится, только если в прайсе его нет, а близкое по звучанию есть —
 * одно, без соперника на том же расстоянии.
 */
export function correctQuery(query: string, catalog: ConsultantProduct[]): string | null {
  const vocabulary = vocabularyOf(catalog);
  let changed = false;
  const out = query.replace(/[А-Яа-яЁё]{5,}/g, (word) => {
    const key = soundStem(word);
    const known = vocabulary.get(key);
    if (known) {
      // На слух слово из прайса, а пишется иначе: «палатенца» → «полотенце».
      if (plainStem(known) === plainStem(word)) return word;
      changed = true;
      return known;
    }
    const limit = key.length >= 6 ? 2 : 1;
    let best: string | null = null;
    let bestDistance = limit + 1;
    let tie = false;
    for (const [candidate, form] of vocabulary) {
      if (Math.abs(candidate.length - key.length) > limit) continue;
      const distance = editDistance(key, candidate);
      if (distance < bestDistance) {
        best = form;
        bestDistance = distance;
        tie = false;
      } else if (distance === bestDistance && form !== best) {
        tie = true;
      }
    }
    if (!best || tie || bestDistance > limit) return word;
    changed = true;
    return best;
  });
  return changed ? out : null;
}

// ── Латинские марки и модели, написанные русскими буквами ──────────────────
//
// 25.09, тест v2: «А акванова Маск?» — бот ответил «таких нет в наличии, есть
// только Aquanova London», хотя Maks стоит в прайсе, и цену ему бот назвал
// строкой выше. Покупатель пишет модель кириллицей и на слух, в прайсе она
// латиницей: поиск их не сопоставлял.

const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/** Латиница, выровненная на слух: «qu» и «кв», «c» и «к», «y» и «и» — одно. */
function latinFold(latin: string): string {
  return latin
    .toLowerCase()
    .replace(/qu/g, "kv")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/ph/g, "f")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}

function translitFold(cyrillic: string): string {
  return latinFold([...cyrillic.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join(""));
}

/**
 * Частые слова переписки. Их латинская запись случайно похожа на модели
 * («есть» → Set, «рублях» → Ruby, «большое» → Blossom), а моделью они не бывают.
 */
const CHAT_WORDS = new Set(
  (
    "есть какие какой какая каких можно спасибо большое большой фото фотка видео рублях рубли рублей " +
    "тенге давайте давай хорошо цена цены цену сколько стоит стоят размер размеры размера цвет цвета " +
    "здравствуйте добрый доброе день вечер утро привет пожалуйста нужно нужен нужна нужны хочу хотела " +
    "покажите показать наличии наличие доставка доставку заказ заказать оформить беру этот этой эта " +
    "это этого такой такие такая тоже также только очень дорого дешевле подешевле лучше белый белые " +
    "серый серые бежевый маме мамы подарок подарка ванную ванны ванна точно может называется просто " +
    "еще ещё сейчас когда где куда откуда почему спасибки благодарю отлично понятно ясно вообще"
  ).split(" "),
);

type LatinWords = { folded: Map<string, string>; names: string[] };

const latinCache = new WeakMap<ConsultantProduct[], LatinWords>();

/** Латинские слова прайса реже, чем у каждой четвёртой позиции: марки и модели. */
function latinWordsOf(catalog: ConsultantProduct[]): LatinWords {
  const cached = latinCache.get(catalog);
  if (cached) return cached;
  const count = new Map<string, number>();
  for (const p of catalog) {
    // Латинское слово короче четырёх букв («Set», «PIP») на слух не угадать.
    for (const word of new Set(p.name.split(/[^A-Za-z]+/).filter((w) => w.length >= 4))) {
      count.set(word, (count.get(word) ?? 0) + 1);
    }
  }
  const folded = new Map<string, string>();
  for (const [word, n] of count) {
    if (n > catalog.length / 4) continue;
    const key = latinFold(word);
    if (!folded.has(key)) folded.set(key, word);
  }
  const words = { folded, names: catalog.map((p) => p.name) };
  latinCache.set(catalog, words);
  return words;
}

/** Латинское слово прайса, которое покупатель написал кириллицей, или null. */
function latinFor(word: string, latin: LatinWords): string | null {
  const key = translitFold(word);
  if (key.length < 3) return null;
  const exact = latin.folded.get(key);
  if (exact) return exact;
  const limit = key.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = limit + 1;
  let tie = false;
  for (const [candidate, original] of latin.folded) {
    if (Math.abs(candidate.length - key.length) > limit) continue;
    const distance = editDistance(key, candidate);
    if (distance < bestDistance) {
      best = original;
      bestDistance = distance;
      tie = false;
    } else if (distance === bestDistance && original !== best) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

/**
 * Марки и модели из прайса, которые покупатель, похоже, назвал русскими
 * буквами: «акванова Маск» → Aquanova, Maks. Слова, которые есть в прайсе
 * по-русски («коврик», «полотенце»), не трогаются.
 */
export function latinModelsIn(text: string, catalog: ConsultantProduct[]): string[] {
  const vocabulary = vocabularyOf(catalog);
  const latin = latinWordsOf(catalog);
  const found: string[] = [];
  for (const word of text.match(/[А-Яа-яЁё]{4,}/g) ?? []) {
    if (CHAT_WORDS.has(word.toLowerCase()) || vocabulary.has(soundStem(word))) continue;
    const match = latinFor(word, latin);
    if (match && !found.includes(match)) found.push(match);
  }
  return found;
}

/**
 * Марки и модели прайса в сообщении — как они записаны в прайсе, латиницей:
 * и написанные кириллицей («акванова Лондон»), и латиницей в любом регистре
 * («aquanova maks»).
 */
export function modelWordsIn(text: string, catalog: ConsultantProduct[]): string[] {
  const latin = latinWordsOf(catalog);
  const found = latinModelsIn(text, catalog);
  for (const word of text.match(/[A-Za-z]{4,}/g) ?? []) {
    const match = latin.folded.get(latinFold(word));
    if (match && !found.includes(match)) found.push(match);
  }
  return found;
}

/**
 * Пометка модели: какие позиции прайса покупатель, похоже, имеет в виду.
 * Пусто — если в сообщении нет марок и моделей кириллицей.
 */
export function latinModelsNote(text: string, catalog: ConsultantProduct[]): string {
  const models = latinModelsIn(text, catalog);
  if (models.length === 0) return "";
  const names = catalog
    .filter((p) => p.stock && models.every((m) => new RegExp(`\\b${m}\\b`, "i").test(p.name)))
    .map((p) => p.name);
  const sample = [...new Set(names)].slice(0, 3);
  return sample.length
    ? `[Похоже, покупатель пишет по-русски о ${models.join(" ")}: в прайсе есть ${sample.join("; ")}. Ищите латиницей.]`
    : `[Похоже, покупатель пишет по-русски о ${models.join(" ")} — ищите латиницей.]`;
}

/**
 * «Пододеяльник» в запросе — «подод», как в прайсе BOVI («КПБ … (2 подод
 * 155x200, …)»). 25.09, прогон: «2 пододеяльника», «пародеяльника» и
 * «семейный комплект» поиск не находил — модель потратила на них все ходы и
 * отправила покупателю «Поищу иначе:».
 */
/** «пододеяльник», «пародеяльника», «паддеяльник», «пударьник» — на слух одно. */
const DUVET_COVER_WORD_RE = /^(?:п[оау][дтр]{1,2}[оа]?д?[еи]я?л|пудар)/i;

export function normalizeCatalogQuery(query: string, catalog: ConsultantProduct[]): string {
  if (!catalog.some((p) => /подод/i.test(p.name))) return query;
  return query.replace(/[А-Яа-яЁё]+/g, (word) => (DUVET_COVER_WORD_RE.test(word) ? "подод" : word));
}

/** Семейный комплект: «семейный», «2 пододеяльника», «где два одеяла». */
export const FAMILY_SET_RE = /семейн|(?:\b2|дв[аеу]\S*)\s*(?:подод|под[оа]деял|пододеял|одеял)/i;

/** Комплекты с двумя пододеяльниками в наличии — по названию из прайса. */
export function familySets(catalog: ConsultantProduct[]): ConsultantProduct[] {
  return catalog.filter((p) => p.stock && /(?:^|[^\d])2\s*подод/i.test(p.name));
}
