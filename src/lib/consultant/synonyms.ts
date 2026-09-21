/** Нормализация и синонимы домашнего текстиля — поиск не ломается на «полотенца». */

const YO = { ё: "е", Ё: "е" } as const;

export function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ёЁ]/g, (ch) => YO[ch as keyof typeof YO] ?? ch)
    .replace(/(\d)\s*[×хХx*∗]\s*(\d)/g, "$1x$2")
    .replace(/[^a-zа-я0-9x]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Словарь семантических синонимов и сокращений (кросс-языковые термины, аббревиатуры, сленг).
 * Падежи, числа и окончания русских слов (розовый/розового, полотенце/полотенец)
 * обрабатываются автоматически стеммером stemWord, их сюда вносить не нужно.
 */
const SYNONYM_GROUPS: string[][] = [
  // «полотенец» — родительный падеж множественного числа с беглой гласной:
  // стеммер окончаний его не берёт, а спрашивают им постоянно («стоимость
  // полотенец»). Поэтому вписано отдельным словом.
  ["полотенце", "полотенец", "towel"],
  ["банное", "bath"],
  ["махровое", "махра", "terry"],
  ["постельное", "bedding", "кпб"],
  ["наволочка", "pillowcase"],
  ["простыня", "sheet"],
  ["пододеяльник", "duvet"],
  ["матрас", "матрац", "mattress", "топпер"],
  ["одеяло", "blanket"],
  ["подушка", "pillow"],
  ["халат", "robe"],
  ["плед", "throw"],
  ["посуда", "dishes"],
  ["тарелка", "plate"],
  ["кружка", "чашка", "mug", "cup"],
  ["сатин", "sateen"],
  ["хлопок", "cotton"],
  ["евро", "eu", "euro"],
  ["семейный", "семейка", "дуэт"],
  ["полутораспальный", "полуторка", "полуторный", "1.5", "1,5", "1.5-спальный"],
  ["двуспальный", "двухспальный", "2-спальный", "double"],
];

const ADJ_ENDINGS_RE = /(?:ого|его|ому|ему|ыми|ими|ых|их|ую|юю|ая|яя|ое|ее|ый|ий|ым|им|ой|ей|ые|ие)$/;
const NOUN_ENDINGS_RE = /(?:ами|ями|ах|ях|ей|ов|ев|ом|ем|а|я|у|ю|е|о|ы|и)$/;

/**
 * Стеммер русских окончаний: отсекает падежные и родовые окончания.
 * Автоматически сводит любые грамматические формы слов («розового», «розовому», «розовые» → «розов»)
 * к единой основе для любых текущих и будущих товаров каталога без ручного ведения списков синонимов.
 */
export function stemWord(word: string): string {
  const w = foldText(word);
  if (w.length <= 3) return w;
  if (ADJ_ENDINGS_RE.test(w) && w.replace(ADJ_ENDINGS_RE, "").length >= 3) {
    return w.replace(ADJ_ENDINGS_RE, "");
  }
  if (NOUN_ENDINGS_RE.test(w) && w.replace(NOUN_ENDINGS_RE, "").length >= 3) {
    return w.replace(NOUN_ENDINGS_RE, "");
  }
  return w;
}

function buildLookup(groups: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    if (!group[0]) continue;
    const canon = foldText(group[0]);
    if (!canon) continue;
    for (const w of group) {
      const folded = foldText(w);
      if (!folded) continue;
      map.set(folded, canon);
      const stemmed = stemWord(folded);
      if (!map.has(stemmed)) map.set(stemmed, canon);
    }
  }
  return map;
}

const LOOKUP = buildLookup(SYNONYM_GROUPS);

/**
 * Синонимы продавца поверх зашитых.
 *
 * Покупатель спросил «голландские полотенца» — бот ответил, что таких нет, а
 * это PIP Studio. Страна происхождения в прайсе не хранится вовсе, и знать её
 * коду неоткуда: «голландские — это PIP Studio», «итальянские — Dorelan» —
 * это сведения магазина, а не языка. Поэтому список ведёт продавец, а не мы
 * правкой кода на каждое новое слово.
 */
let DYNAMIC: Map<string, string> = new Map();

export function setDynamicSynonyms(groups: string[][]): void {
  DYNAMIC = buildLookup(groups);
}

/**
 * Разбор списка из панели. Строка — одна группа: первое слово то, что реально
 * встречается в названиях товаров, остальные — как покупатель может спросить.
 *
 *   pip, голландские, голландия
 *   dorelan, итальянские, италия
 */
export function parseSynonymGroups(text: string): string[][] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.split(/[,;]/).map((w) => w.trim()).filter(Boolean))
    .filter((group) => group.length >= 2);
}

export function formatSynonymGroups(groups: string[][]): string {
  return groups.map((g) => g.join(", ")).join("\n");
}

export function expandToken(token: string): string {
  const folded = foldText(token);
  // Список продавца важнее зашитого: им же он и правит наши умолчания.
  const direct = DYNAMIC.get(folded) ?? LOOKUP.get(folded);
  if (direct) return direct;
  const stemmed = stemWord(folded);
  const fromStem = DYNAMIC.get(stemmed) ?? LOOKUP.get(stemmed);
  if (fromStem) return fromStem;
  return stemmed;
}

export function tokenizeQuery(text: string): string[] {
  return foldText(text)
    .split(" ")
    .filter((t) => t.length > 1)
    .map(expandToken);
}

export function haystackOf(parts: string[]): string {
  return tokenizeQuery(parts.join(" ")).join(" ");
}
