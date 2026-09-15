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

const SYNONYM_GROUPS: string[][] = [
  [
    "полотенце",
    "полотенца",
    "полотенец",
    "полотенцем",
    "towel",
    "towels",
    "банное",
    "банный",
    "банные",
    "махровое",
    "махровый",
    "махровые",
  ],
  ["постельное", "постель", "постелка", "белье", "бельё", "bedding", "кпб"],
  ["наволочка", "наволочки", "наволочек", "наволочку", "pillowcase"],
  ["простыня", "простынь", "простыни", "простыней", "простыню", "sheet"],
  ["пододеяльник", "пододеяльники", "пододеяльника", "пододеяльников", "duvet"],
  ["матрас", "матрац", "матрасы", "матраса", "mattress", "топпер"],
  ["одеяло", "одеяла", "одеялу", "одеялом", "blanket"],
  ["подушка", "подушки", "подушку", "подушке", "подушкой", "pillow"],
  ["посуда", "dishes"],
  ["тарелка", "тарелки"],
  ["кружка", "кружки", "чашка", "чашки"],
  ["плед", "пледы", "покрывало", "покрывала", "throw"],
  ["белый", "белая", "белое", "белые", "белом"],
  ["серый", "серая", "серое", "серые"],
  ["бежевый", "бежевая", "бежевое", "бежевые"],
  ["розовый", "розовая", "розовое", "розовые"],
  ["синий", "синяя", "синее", "синие", "голубой", "голубая", "голубое"],
  ["желтый", "желтая", "желтое", "желтые", "жёлтый", "жёлтая"],
  ["графит", "графитовый", "графитовая", "графитовое"],
  ["халат", "халаты", "robe"],
  ["молочный", "молочная", "молочное", "молочного"],
  ["евро", "eu", "euro"],
  ["семейный", "семейное", "семейка", "дуэт"],
  ["полуторка", "полуторный", "1.5", "1,5", "полутораспальный", "1.5-спальный"],
  ["двуспальный", "двухспальный", "2-спальный", "double"],
  ["сатин", "сатиновый", "сатиновое", "sateen"],
  ["хлопок", "хлопковый", "хлопковое", "cotton"],
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

const LOOKUP = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canon = foldText(group[0]);
  for (const w of group) {
    const folded = foldText(w);
    LOOKUP.set(folded, canon);
    const stemmed = stemWord(folded);
    if (!LOOKUP.has(stemmed)) {
      LOOKUP.set(stemmed, canon);
    }
  }
}

export function expandToken(token: string): string {
  const folded = foldText(token);
  const direct = LOOKUP.get(folded);
  if (direct) return direct;
  const stemmed = stemWord(folded);
  const fromStem = LOOKUP.get(stemmed);
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
