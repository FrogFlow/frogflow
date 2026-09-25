/**
 * Проверка черновика ответа v2 перед отправкой.
 *
 * Модель решает, что сказать; код сверяет с данными то, что сверяется
 * механически, и при расхождении даёт модели одну попытку переписать.
 * Покупатель видит только исправленный ответ. Это не фильтры, которые правят
 * текст за модель (путь v1 с семнадцатью чистками), а проверка, после которой
 * пишет снова она сама.
 *
 * Что проверяется — то, что эталонный набор 25.09 находил в ответах Haiku:
 * - цена чужой позиции (сверка с прайсом, price-check.ts);
 * - пересказ служебного покупателю («система сама переведёт в рубли»);
 * - два вопроса в одном сообщении;
 * - «ты» и «привет» вместо «вы»;
 * - «Беру?» от лица бота;
 * - вопрос о бюджете: магазин просил не спрашивать, а Haiku спрашивает
 *   («Какой размер и примерный бюджет?», прогон 25.09);
 * - «Передаю менеджеру» без вызова передачи: покупателю обещан человек, а
 *   задачи у менеджера нет (прогон v2.6, «Беру белое Zero Twist 70х140»);
 * - оценки из базы знаний и длина: на «Риволта — какое качество?» Haiku
 *   трижды из трёх пересказала статью с «премиальный», «элегантный» и
 *   «лучшие отели», однажды на 570 знаков (прогон 25.09, 03:03). Запрет в
 *   промпте стоял, в прогоне это ловилось, а до покупателя доходило.
 *
 * - страна марки не та, что в списке марок магазина: «Dorelan и Traumina
 *   (Италия)», «Weseta (Голландия)» (прогон 25.09, 13:20) — Traumina немецкая,
 *   Weseta швейцарская;
 * - марка кириллицей: «Травматина мягкая» вместо Traumina.
 *
 * Черновик проверяется, только когда модель менеджера не звала.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import { checkPrices, indexCatalog, type CatalogIndex } from "./price-check";
import { editDistance, latinFold, translitFold } from "./typos";

export type DraftProblem = {
  kind:
    | "price"
    | "service"
    | "questions"
    | "address"
    | "persona"
    | "promise"
    | "budget"
    | "ads"
    | "length"
    | "country"
    | "latin";
  detail: string;
};

const indexCache = new WeakMap<ConsultantProduct[], CatalogIndex>();

function indexFor(catalog: ConsultantProduct[]): CatalogIndex {
  let index = indexCache.get(catalog);
  if (!index) {
    index = indexCatalog(catalog.filter((p) => p.stock));
    indexCache.set(catalog, index);
  }
  return index;
}

const SERVICE_RE =
  /(?:^|[^а-яёәіңғүұқөһ])систем\S*|цены буду писать|в тенге считаем|пометк|инструкци|промпт/i;
// Границы слова — с казахскими буквами: «түсін» — не «ты».
const INFORMAL_RE =
  /(?:^|[^а-яёәіңғүұқөһ])(?:ты|тебе|тебя|твой|твоя|твои|привет)(?:[^а-яёәіңғүұқөһ]|$)/i;
const BERU_RE = /(?:^|[^а-яёәіңғүұқөһ])беру(?:[^а-яёәіңғүұқөһ]|$)/i;
/** Оценки вместо фактов. «Рекомендуется стирать при 40°» — факт, «рекомендую» — оценка. */
export const AD_WORDS_RE =
  /красив|премиальн|премиум|уникальн|элегантн|идеальн|отличн(?:ый|ая|ое|ые|ого)|прекрасн|роскошн|шикарн|великолепн|многовеков|хороший выбор|рекомендую|качественн/gi;
/** Одно-три предложения; длиннее — это уже пересказ статьи или список. */
export const DRAFT_MAX_CHARS = 500;
const PROMISE_RE =
  /менеджер\S*[^.?]{0,40}(?:подключ|оформ|свяж|напиш|пришл|ответ|вед[её]т)|(?:переда[юм]|подключу|позову)\S*[^.?]{0,20}менеджер/i;

const COUNTRIES: [RegExp, string][] = [
  [/^итал/i, "Италия"],
  [/^(?:герман|немец|немецк)/i, "Германия"],
  [/^япон/i, "Япония"],
  [/^(?:голланд|нидерланд)/i, "Нидерланды"],
  [/^швейцар/i, "Швейцария"],
  [/^португал/i, "Португалия"],
  [/^бельги/i, "Бельгия"],
  [/^австри/i, "Австрия"],
  [/^испан/i, "Испания"],
  [/^(?:англ|британ)/i, "Англия"],
  [/^франц/i, "Франция"],
  [/^(?:турц|турец)/i, "Турция"],
];

/** Страна по слову: «итальянские», «Италия», «немецкий» — или null. */
export function countryOf(word: string): string | null {
  const w = word.trim();
  for (const [re, country] of COUNTRIES) if (re.test(w)) return country;
  return null;
}

/**
 * Страны марок из списка марок магазина (синонимы): «traumina, немецкие,
 * германия» → traumina → Германия. Ключ — марка в нижнем регистре.
 */
export function brandCountries(groups: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of groups) {
    const brand = group[0]?.trim().toLowerCase();
    if (!brand || !/[a-z]/.test(brand)) continue;
    const country = group.slice(1).map(countryOf).find(Boolean);
    if (country) out.set(brand, country);
  }
  return out;
}

function brandsIn(segment: string, countries: Map<string, string>): string[] {
  const hay = segment.toLowerCase();
  return [...countries.keys()].filter((b) =>
    new RegExp(`(?:^|[^a-z])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z]|$)`).test(hay),
  );
}

/** «Марка (Страна)» и «итальянские Марка» — страна не та, что в списке марок. */
export function countryMistakes(text: string, countries: Map<string, string>): string[] {
  if (countries.size === 0) return [];
  const out = new Set<string>();
  const check = (brands: string[], stated: string) => {
    for (const b of brands) {
      const real = countries.get(b);
      if (real && real !== stated) out.add(`${b} — ${real}, не ${stated}`);
    }
  };
  for (const m of text.matchAll(/\(([^()]{3,40})\)/g)) {
    const stated = m[1]
      .split(/[\s,]+/)
      .map(countryOf)
      .find(Boolean);
    if (!stated) continue;
    const before = text.slice(0, m.index);
    const cut = Math.max(
      ...[".", ":", ";", "\n", "•", ",", "(", ")"].map((c) => before.lastIndexOf(c)),
    );
    check(brandsIn(before.slice(cut + 1), countries), stated);
  }
  for (const m of text.matchAll(
    /(итальянск|немецк|японск|голландск|швейцарск|португальск|бельгийск|австрийск|испанск|английск|французск|турецк)[а-яё]*\s+(?:(?:марк|бренд|производител)[а-яё]*\s+)?([A-Za-z][A-Za-z-]+)/gi,
  )) {
    const stated = countryOf(m[1]);
    if (stated) check([m[2].toLowerCase()], stated);
  }
  return [...out];
}

/**
 * Марки прайса — первое слово названия, если название начинается латиницей
 * («Traumina подушка…», «RIVOLTA IMPERIALE…»). Модели внутри названия
 * («… CLARA», «… LUXOR») сюда не попадают: с ними «класса» и «лучшие»
 * сходили за марку.
 */
export function catalogBrands(catalog: ConsultantProduct[]): string[] {
  const out = new Map<string, string>();
  for (const p of catalog) {
    const first = /^[A-Za-z][A-Za-z-]+/.exec(p.name.trim())?.[0];
    if (first && first.length >= 5 && !out.has(first.toLowerCase()))
      out.set(first.toLowerCase(), first);
  }
  return [...out.values()];
}

/** Марка прайса, написанная кириллицей: «Травматина» — это Traumina. */
export function cyrillicBrands(text: string, brands: string[]): string[] {
  const folded = brands.filter((b) => b.length >= 5).map((b) => ({ b, f: latinFold(b) }));
  const out = new Set<string>();
  for (const word of text.match(/[А-Яа-яЁё]{5,}/g) ?? []) {
    const f = translitFold(word);
    for (const { b, f: bf } of folded) {
      if (f.slice(0, 3) !== bf.slice(0, 3)) continue;
      // Чем короче марка, тем точнее совпадение: у короткой одна-две правки
      // дают любое слово («белья» — Bellana). Три — только для длинной марки
      // и слова не короче неё («Травматина» — Traumina; «травмы» — нет).
      const limit = bf.length >= 8 ? (f.length >= bf.length ? 3 : 2) : bf.length >= 6 ? 1 : 0;
      if (editDistance(f, bf) <= limit) out.add(`${word} → ${b}`);
    }
  }
  return [...out];
}

export type DraftContext = { brandCountries?: Map<string, string>; brands?: string[] };

export function draftProblems(
  text: string,
  catalog: ConsultantProduct[],
  ctx: DraftContext = {},
): DraftProblem[] {
  const problems: DraftProblem[] = [];
  for (const flag of checkPrices(text, indexFor(catalog)))
    problems.push({ kind: "price", detail: flag.detail });
  const service = SERVICE_RE.exec(text);
  if (service) problems.push({ kind: "service", detail: service[0].trim() });
  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > 1) problems.push({ kind: "questions", detail: String(questions) });
  if (INFORMAL_RE.test(text)) problems.push({ kind: "address", detail: "" });
  if (BERU_RE.test(text)) problems.push({ kind: "persona", detail: "" });
  if (PROMISE_RE.test(text)) problems.push({ kind: "promise", detail: "" });
  if (/бюджет[^.?]*\?/i.test(text)) problems.push({ kind: "budget", detail: "" });
  const ads = [...new Set((text.match(AD_WORDS_RE) ?? []).map((w) => w.toLowerCase()))];
  if (ads.length) problems.push({ kind: "ads", detail: ads.join(", ") });
  if (text.trim().length > DRAFT_MAX_CHARS)
    problems.push({ kind: "length", detail: String(text.trim().length) });
  const wrongCountry = countryMistakes(text, ctx.brandCountries ?? new Map());
  if (wrongCountry.length) problems.push({ kind: "country", detail: wrongCountry.join("; ") });
  const cyrillic = cyrillicBrands(text, ctx.brands ?? []);
  if (cyrillic.length) problems.push({ kind: "latin", detail: cyrillic.join("; ") });
  return problems;
}

/** Пометка модели: что не так с черновиком. Покупатель её не видит. */
export function draftFixNote(problems: DraftProblem[]): string {
  const lines = problems.map((p) => {
    switch (p.kind) {
      case "price":
        return `• Цена не той позиции: ${p.detail}. Возьмите цену из выдачи поиска.`;
      case "service":
        return `• «${p.detail}» — служебное, покупателю об этом не пишут.`;
      case "questions":
        return "• В ответе больше одного вопроса — оставьте один.";
      case "address":
        return "• К покупателю — на «вы», без «привет».";
      case "persona":
        return "• «Беру» — слово покупателя, от себя его не пишите.";
      case "budget":
        return "• Бюджет не спрашивайте — спросите, что важно в товаре (размер, цвет, для чего).";
      case "ads":
        return `• Оценки (${p.detail}) уберите: покупателю нужны факты — страна, состав, плотность, уход.`;
      case "length":
        return `• Ответ длинный (${p.detail} знаков): оставьте главное, одно-три предложения.`;
      case "country":
        return `• Страна марки не та: ${p.detail}. Страну берите из списка марок в промпте; марки, которой там нет, страну не называйте.`;
      case "latin":
        return `• Марку пишите латиницей, как в прайсе: ${p.detail}.`;
      case "promise":
        return "• Вы обещаете покупателю менеджера, но не вызвали handoff_to_manager. Нужен менеджер — вызовите его с причиной; не нужен — не обещайте.";
    }
  });
  return `[Черновик не отправлен:\n${lines.join("\n")}\nНапишите ответ целиком заново с этими исправлениями — покупатель увидит только новый вариант.]`;
}
