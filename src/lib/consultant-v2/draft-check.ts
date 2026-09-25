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
 * - «Беру?» от лица бота.
 */
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import { checkPrices, indexCatalog, type CatalogIndex } from "./price-check";

export type DraftProblem = {
  kind: "price" | "service" | "questions" | "address" | "persona";
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
  /(?:^|[^а-яё])систем\S*|цены буду писать|в тенге считаем|пометк|инструкци|промпт/i;
const INFORMAL_RE = /(?:^|[^а-яё])(?:ты|тебе|тебя|твой|твоя|твои|привет)(?:[^а-яё]|$)/i;
const BERU_RE = /(?:^|[^а-яё])беру(?:[^а-яё]|$)/i;

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
    }
  });
  return `[Черновик не отправлен:\n${lines.join("\n")}\nНапишите ответ целиком заново с этими исправлениями — покупатель увидит только новый вариант.]`;
}
