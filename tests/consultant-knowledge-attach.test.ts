import { describe, expect, it } from "vitest";
import {
  catalogKeySet,
  knowledgeFitsInPrompt,
  searchKnowledgeScored,
  type ConsultantKnowledgeArticle,
} from "../src/lib/consultant/knowledge";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";

const article = (
  id: string,
  title: string,
  content: string,
  tags: string[] = [],
): ConsultantKnowledgeArticle => ({ id, title, tags, content });

/** Урезанный слепок боевой базы: те же названия, что у BOVI. */
const KB = [
  article(
    "density",
    "Справочник по плотности полотенец",
    "Плотность махровых изделий (GSM). Uchino: Zero Twist ~380 г/м², " +
      "Classic ~600 г/м². RIVOLTA Imperiale 700 г/м².",
    ["плотность", "gsm", "махра"],
  ),
  article("care", "Рекомендации по уходу и стирке", "Стирка при 40 градусах, без кондиционера."),
  article("uchino", "1UCHINO Collection Overview", "Японский бренд, полые нити.".repeat(300)),
];

const catalog: ConsultantProduct[] = [
  {
    id: "t1",
    name: "Uchino Полотенце махровое для ног Merveille 50х80, белый",
    category: "Полотенца Uchino",
    size: "50x80",
    colors: ["белый"],
    price_kzt: 52000,
    stock: true,
  },
  {
    id: "p1",
    name: "Подушка BOVI 50x70",
    category: "Подушки",
    size: "50x70",
    colors: [],
    price_kzt: 12900,
    stock: true,
  },
];

const ignore = catalogKeySet(catalog);
const best = (q: string) => searchKnowledgeScored(q, KB, 1, ignore)[0];
const attaches = (q: string) => Boolean(best(q) && best(q)!.score >= 3);

/**
 * Живой разбор 19–22.09: пять передач менеджеру подряд про одно и то же —
 * плотность полотенец Uchino и RIVOLTA. Статья «Справочник по плотности
 * полотенец» в базе лежит, но база у BOVI 46 тысяч знаков при лимите 6 000,
 * поэтому в промпт едет одно оглавление, а текст модель должна забрать
 * инструментом search_knowledge. Пять раз подряд не забрала.
 */
describe("статья базы знаний подкладывается сама", () => {
  it("живые вопросы про плотность находят справочник", () => {
    for (const q of [
      "Какая у них плотность?",
      "Плотность их какая?",
      "RIVOLTA IMPERIALE махровое 100x150, цвет белый — 60 000 ₸ какая плотность?",
    ]) {
      expect(attaches(q), q).toBe(true);
      expect(best(q)!.article.id, q).toBe("density");
    }
  });

  /**
   * Тут вся соль. «Есть полотенца?» и «какая плотность?» оба один раз
   * попадают в название «Справочник по плотности полотенец» — по сырому
   * счёту они неразличимы. Слова каталога из счёта выброшены, и вопрос про
   * товар перестаёт тянуть статью за собой.
   */
  it("вопрос про товар статью не тянет", () => {
    for (const q of ["есть полотенца?", "А подушки у вас есть?", "Мне нужно большое"]) {
      expect(attaches(q), q).toBe(false);
    }
  });

  it("уход и стирка — тоже свойство, которого нет в прайсе", () => {
    expect(attaches("как стирать полотенца?")).toBe(true);
    expect(best("как стирать полотенца?")!.article.id).toBe("care");
  });

  it("база BOVI в промпт целиком не влезает — значит подстановка нужна", () => {
    expect(knowledgeFitsInPrompt(KB)).toBe(false);
    // Маленькая база едет в промпт как была, подставлять нечего.
    expect(knowledgeFitsInPrompt([article("x", "Короткая", "Две строки.")])).toBe(true);
  });

  it("словарь каталога собирается из названий и категорий", () => {
    expect(ignore.has("полот")).toBe(false);
    expect(ignore.has("поло")).toBe(true);
    expect(ignore.has("плот")).toBe(false);
  });
});
