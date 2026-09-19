import { describe, expect, it } from "vitest";
import {
  formatKnowledgeIndexForPrompt,
  knowledgeFitsInPrompt,
  searchKnowledge,
  type ConsultantKnowledgeArticle,
} from "../src/lib/consultant/knowledge";

/**
 * База знаний клиента — девять загруженных PDF, около двадцати процентов
 * промпта, а нужна она далеко не в каждом разговоре. В промпте остаётся
 * оглавление, текст статьи забирается инструментом.
 */
function article(over: Partial<ConsultantKnowledgeArticle> & { id: string; title: string }): ConsultantKnowledgeArticle {
  return { tags: [], content: "", updatedAt: "2026-09-19T00:00:00.000Z", ...over };
}

const BASE: ConsultantKnowledgeArticle[] = [
  article({
    id: "towels",
    title: "Махровые полотенца (Качество и плотность)",
    tags: ["полотенца", "махра", "хлопок", "плотность"],
    content: "Полотенца BOVI изготовлены из 100% гребенного длинноволокнистого хлопка. Плотность 550–600 г/м².",
  }),
  article({
    id: "care",
    title: "Рекомендации по уходу и стирке",
    tags: ["уход", "стирка", "температура"],
    content: "Деликатная стирка при температуре до 40°C жидкими гелями, без хлорсодержащих отбеливателей.",
  }),
  article({
    id: "dorelan",
    title: "Dorelan (Италия) — матрасы и топперы",
    tags: ["dorelan", "матрасы", "италия"],
    content: "Dorelan — итальянский производитель систем здорового сна премиум-класса.",
  }),
];

describe("база знаний по запросу", () => {
  it("находит статью по теме вопроса", () => {
    expect(searchKnowledge("из чего сделаны полотенца", BASE).map((a) => a.id)).toEqual(["towels"]);
    expect(searchKnowledge("как стирать", BASE).map((a) => a.id)).toContain("care");
    expect(searchKnowledge("что за бренд dorelan", BASE).map((a) => a.id)).toContain("dorelan");
  });

  it("на посторонний вопрос не выдаёт ничего", () => {
    expect(searchKnowledge("велосипед", BASE)).toEqual([]);
  });

  it("оглавление содержит названия, но не тексты статей", () => {
    const index = formatKnowledgeIndexForPrompt(BASE);
    expect(index).toContain("Махровые полотенца");
    expect(index).toContain("search_knowledge");
    expect(index).not.toContain("550–600 г/м²");
    expect(index.length).toBeLessThan(600);
  });

  it("маленькая база остаётся в промпте целиком", () => {
    expect(knowledgeFitsInPrompt(BASE)).toBe(true);
    const huge = [...BASE, article({ id: "big", title: "Большая статья", content: "x".repeat(7000) })];
    expect(knowledgeFitsInPrompt(huge)).toBe(false);
  });
});
