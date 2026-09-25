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
