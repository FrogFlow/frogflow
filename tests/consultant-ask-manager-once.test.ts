import { describe, expect, it, vi } from "vitest";

const addConsultantTask = vi.fn(async () => ({ id: "tsk_1" }));
const fileConsultantQuestion = vi.fn(async () => ({ task: { id: "tsk_1" }, notified: true }));
vi.mock("../src/lib/consultant/tasks", () => ({ addConsultantTask, fileConsultantQuestion }));
vi.mock("../src/lib/consultant/rate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/consultant/rate")>()),
  getFreshVtbRate: async () => null,
}));

import { executeConsultantTool } from "../src/lib/consultant/tools";
import {
  articleAboutBrand,
  pickArticleForQuestion,
  type ConsultantKnowledgeArticle,
} from "../src/lib/consultant/knowledge";
import { withManagerHandoff } from "../src/lib/consultant/validate";
import { HANDOFF_TO_MANAGER_REPLY } from "../src/lib/consultant/copy";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";

/**
 * Живой тест 23.09: «Риволта это бренд какой страны? И расскажите о
 * качестве». Менеджеру пришли два уведомления подряд и в панели легли две
 * задачи: одну завёл инструмент ask_manager (пересказ модели), вторую —
 * передача диалога (слова покупателя).
 */
describe("ask_manager — одна задача на вопрос", () => {
  it("инструмент задачу не заводит, а передаёт суть дальше", async () => {
    const res = await executeConsultantTool(
      "ask_manager",
      { question: "Какое качество полотенец Rivolta IMPERIALE?" },
      { userKey: "ig_1" },
    );
    expect(res.handoff).toBe(true);
    expect(res.result).toMatchObject({ reason: "question", question: "Какое качество полотенец Rivolta IMPERIALE?" });
    expect(fileConsultantQuestion).not.toHaveBeenCalled();
    expect(addConsultantTask).not.toHaveBeenCalled();
  });
});

/**
 * Там же: страна марки была в списке продавца (rivolta — италия), а ветка
 * передачи выбросила всё, что написала модель, и оставила одну дежурную фразу.
 */
describe("ответ модели при передаче менеджеру сохраняется", () => {
  it("известная часть + строка о передаче", () => {
    expect(withManagerHandoff("Rivolta — итальянская марка.", HANDOFF_TO_MANAGER_REPLY)).toBe(
      `Rivolta — итальянская марка.\n\n${HANDOFF_TO_MANAGER_REPLY}`,
    );
  });

  it("модель сама пообещала менеджера — второй раз не добавляем", () => {
    const own = "Rivolta — итальянская марка. Про технологию производства уточню у менеджера.";
    expect(withManagerHandoff(own, HANDOFF_TO_MANAGER_REPLY)).toBe(own);
    expect(withManagerHandoff(HANDOFF_TO_MANAGER_REPLY, HANDOFF_TO_MANAGER_REPLY)).toBe(
      HANDOFF_TO_MANAGER_REPLY,
    );
  });

  it("модель ничего не написала — одна дежурная фраза, как раньше", () => {
    expect(withManagerHandoff("", HANDOFF_TO_MANAGER_REPLY)).toBe(HANDOFF_TO_MANAGER_REPLY);
    expect(withManagerHandoff("   ", HANDOFF_TO_MANAGER_REPLY)).toBe(HANDOFF_TO_MANAGER_REPLY);
  });
});

const article = (id: string, title: string, content: string, tags: string[] = []): ConsultantKnowledgeArticle => ({
  id,
  title,
  tags,
  content,
});

/** Слепок боевой базы BOVI: те же названия и те же ключевые фразы. */
const KB = [
  article(
    "bovi",
    "Фабрики и производители BOVI",
    "BOVI — бренд домашнего текстиля премиум-класса. Производится в Португалии и Турции.",
    ["производитель", "фабрика", "бренд", "португалия", "турция"],
  ),
  article(
    "density",
    "Справочник по плотности полотенец",
    "Uchino (Япония): Zero Twist ~380 г/м². Rivolta Carmignani (Италия) — знаменитый итальянский " +
      "производитель премиального текстиля для отелей класса люкс. Bella Terry: 570 г/м².",
    ["плотность", "gsm"],
  ),
  article("care", "Рекомендации по уходу и стирке", "Стирка при 40 градусах."),
];

const product = (name: string): ConsultantProduct => ({
  id: name,
  name,
  category: "Полотенца",
  size: "100x150",
  colors: [],
  price_kzt: 60000,
  stock: true,
});
const catalog = [
  product("RIVOLTA IMPERIALE полотенце махровое 100x150, цвет белый"),
  product("Uchino Полотенце махровое Zero Twist 70x140"),
];

describe("статья о марке, про которую спрашивают", () => {
  it("живой вопрос кириллицей получает справочник с Rivolta, а не статью о BOVI", () => {
    const got = pickArticleForQuestion("Риволта это бренд какой страны? И расскажите о качестве", KB, catalog);
    expect(got?.id).toBe("density");
  });

  it("плотность Uchino остаётся справочником — он о ней и говорит", () => {
    expect(pickArticleForQuestion("Какая плотность у полотенец Uchino", KB, catalog)?.id).toBe("density");
  });

  it("товарный вопрос с маркой статью не тянет", () => {
    expect(pickArticleForQuestion("есть полотенца Rivolta?", KB, catalog)).toBeNull();
    expect(pickArticleForQuestion("Rivolta 100x150 белый сколько стоит?", KB, catalog)).toBeNull();
  });

  it("статья, найденная по словам, но молчащая о марке, не подкладывается", () => {
    // Лучше без подсказки, чем с подсказкой про чужую страну.
    const onlyBovi = [KB[0]];
    expect(pickArticleForQuestion("Риволта это бренд какой страны?", onlyBovi, catalog)).toBeNull();
  });

  it("без вопроса о свойствах марка статью не выбирает", () => {
    expect(articleAboutBrand("rivolta белый", KB, ["RIVOLTA"])).toBeNull();
  });
});
