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
 * Черновик проверяется, только когда модель менеджера не звала.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import { checkPrices, indexCatalog, type CatalogIndex } from "./price-check";

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
    | "length";
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
  /красив|премиальн|элегантн|идеальн|отличн(?:ый|ая|ое|ые|ого)|прекрасн|роскошн|шикарн|великолепн|хороший выбор|рекомендую|качественн/gi;
/** Одно-три предложения; длиннее — это уже пересказ статьи или список. */
export const DRAFT_MAX_CHARS = 500;
const PROMISE_RE =
  /менеджер\S*[^.?]{0,40}(?:подключ|оформ|свяж|напиш|пришл|ответ|вед[её]т)|(?:переда[юм]|подключу|позову)\S*[^.?]{0,20}менеджер/i;

export function draftProblems(text: string, catalog: ConsultantProduct[]): DraftProblem[] {
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
      case "promise":
        return "• Вы обещаете покупателю менеджера, но не вызвали handoff_to_manager. Нужен менеджер — вызовите его с причиной; не нужен — не обещайте.";
    }
  });
  return `[Черновик не отправлен:\n${lines.join("\n")}\nНапишите ответ целиком заново с этими исправлениями — покупатель увидит только новый вариант.]`;
}
