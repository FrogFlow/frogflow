/**
 * Статья базы знаний к вопросу о модели — для v2.
 *
 * В прайсе из 1С у позиции только название, размер, цвет и цена; чем модели
 * отличаются, из чего сделаны и какого они качества, знает только база
 * знаний. Общий с v1 подбор статьи (knowledgeForQuestion) ищет по маркам и
 * словам «качество», «страна», и 25.09 на «Акванова Макс и Лондон в чем
 * разница?» не нашёл ничего — ни кириллицей, ни латиницей: «разница» не его
 * слово, а London и Maks не марки. Модель в базу не полезла и ответила
 * одними размерами, хотя в статье Aquanova о London сказано: египетский
 * хлопок, 1200 г/м², силиконовые точки против скольжения.
 *
 * Здесь отбор по моделям: в вопросе о свойствах или разнице названы марки и
 * модели прайса, как угодно написанные, — берётся статья, где они
 * встречаются чаще всего. Модели не названы («а чем они отличаются?») —
 * берутся модели из последней выдачи. Подбор v1 не меняется.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import type { ConsultantKnowledgeArticle } from "@/lib/consultant/knowledge";
import { modelWordsIn } from "./typos";

/** Вопрос о свойствах товара, а не о наличии и цене. */
export const ABOUT_PRODUCT_RE =
  /разниц|отлича|отличи[ея]|сравн|лучше|хуже|мягч|мягк|ж[её]стк|впитыв|сохнет|ворс|ткан|хлоп|бамбук|сатин|перкал|наполнит|материал|состав|качеств|плотн|г\/м|из чего|что за(?=\s|$)|расскаж|подробн|характеристик|производ|откуда|уход|стирк|гарант/i;

/** Длиннее — только куски вокруг названных моделей: статья едет в каждое такое сообщение. */
const MAX_CHARS = 8000;
/** Строк после упоминания модели: в статьях из PDF за названием идут строки о нём. */
const EXCERPT_TAIL = 4;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(hay: string, term: string): number {
  const re = new RegExp(`(?:^|[^a-z])${escapeRe(term.toLowerCase())}(?![a-z])`, "g");
  return (hay.toLowerCase().match(re) ?? []).length;
}

function excerpt(content: string, terms: string[]): string {
  if (content.length <= MAX_CHARS) return content;
  const lines = content.split("\n");
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (terms.some((t) => mentions(line, t) > 0)) {
      for (let j = i; j <= Math.min(lines.length - 1, i + EXCERPT_TAIL); j++) keep.add(j);
    }
  });
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1 && out.length) out.push("…");
    out.push(lines[i]);
    last = i;
  }
  return out.join("\n").slice(0, MAX_CHARS);
}

/**
 * Пометка модели со статьёй о названных моделях или пусто: вопрос не о
 * свойствах, модели не названы, статьи о них нет или общий подбор уже
 * подложил статью о них (`attached` — его текст).
 */
export function knowledgeAboutModels(
  text: string,
  catalog: ConsultantProduct[],
  articles: ConsultantKnowledgeArticle[],
  opts: { recentProductNames?: string[]; attached?: string } = {},
): string {
  if (!ABOUT_PRODUCT_RE.test(text) || articles.length === 0) return "";
  let terms = modelWordsIn(text, catalog);
  if (terms.length === 0 && opts.recentProductNames?.length) {
    terms = modelWordsIn(opts.recentProductNames.join(" "), catalog);
  }
  if (terms.length === 0) return "";
  // Общий подбор уже подложил статью обо всех названных моделях — второй не нужно.
  if (opts.attached && terms.every((t) => mentions(opts.attached!, t) > 0)) return "";

  let best: { article: ConsultantKnowledgeArticle; named: number; score: number } | null = null;
  for (const article of articles) {
    let named = 0;
    let score = 0;
    for (const term of terms) {
      const inTitle = mentions(article.title, term) > 0;
      const inBody = mentions(article.content, term);
      if (inTitle || inBody > 0) named++;
      score += (inTitle ? 3 : 0) + Math.min(inBody, 5);
    }
    // Статья, где названо больше разных моделей, важнее той, где одна
    // встречается часто: на «Zero Twist или Air Waffle» — обзор Uchino, а не
    // справочник, где Waffle упомянут пять раз.
    if (
      named > 0 &&
      (!best || named > best.named || (named === best.named && score > best.score))
    ) {
      best = { article, named, score };
    }
  }
  if (!best || opts.attached?.includes(best.article.title)) return "";
  const body = excerpt(best.article.content, terms);
  return `[Из базы знаний о ${terms.join(", ")} — покупатель этого не видит. Отвечайте фактами отсюда; о модели, которой здесь нет, свойств не придумывайте:\n• ${best.article.title}:\n${body}]`;
}
