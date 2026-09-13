/** Нормализация и синонимы домашнего текстиля — поиск не ломается на «полотенца». */

const YO = { ё: "е", Ё: "е" } as const;

export function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ёЁ]/g, (ch) => YO[ch as keyof typeof YO] ?? ch)
    .replace(/(\d)\s*[×хХx]\s*(\d)/g, "$1x$2")
    .replace(/[^a-zа-я0-9x]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SYNONYM_GROUPS: string[][] = [
  ["полотенце", "полотенца", "полотенец", "полотенцем", "towel", "towels"],
  ["постельное", "постель", "постелка", "белье", "бельё", "bedding"],
  ["матрас", "матрац", "матрасы", "матраса", "mattress"],
  ["одеяло", "одеяла", "одеялу", "одеялом", "blanket"],
  ["подушка", "подушки", "подушку", "подушке", "подушкой", "pillow"],
  ["посуда", "dishes"],
  ["тарелка", "тарелки"],
  ["кружка", "кружки", "чашка", "чашки"],
  ["плед", "пледы", "throw"],
  ["белый", "белая", "белое", "белые", "белом"],
  ["серый", "серая", "серое", "серые"],
  ["бежевый", "бежевая", "бежевое", "бежевые"],
  ["розовый", "розовая", "розовое", "розовые"],
  ["синий", "синяя", "синее", "синие"],
  ["желтый", "желтая", "желтое", "желтые", "жёлтый", "жёлтая"],
  ["графит", "графитовый", "графитовая", "графитовое"],
  ["халат", "халаты", "robe"],
];

const LOOKUP = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canon = foldText(group[0]);
  for (const w of group) LOOKUP.set(foldText(w), canon);
}

export function expandToken(token: string): string {
  const folded = foldText(token);
  return LOOKUP.get(folded) ?? folded;
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
