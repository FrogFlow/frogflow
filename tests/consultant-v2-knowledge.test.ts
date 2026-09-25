import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import type { ConsultantKnowledgeArticle } from "../src/lib/consultant/knowledge";
import { knowledgeAboutModels } from "../src/lib/consultant-v2/knowledge";
import { modelWordsIn } from "../src/lib/consultant-v2/typos";

/**
 * Живой тест 25.09: «Акванова Макс и Лондон в чем разница?» — бот ответил
 * одними размерами, статья Aquanova в базе знаний к вопросу не подложилась.
 */
const p = (name: string, category = ""): ConsultantProduct => ({
  id: name,
  name,
  category,
  size: "",
  colors: [],
  price_kzt: 1000,
  stock: true,
});
const catalog = [
  p("Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый", "Коврики LONDON"),
  p("Aquanova Коврик в ванную Maks 60х60, цвет 10 слон.кость", "Коврики LONDON"),
  p("Uchino Полотенце махровое Zero Twist 70x140", "Zero Twist"),
  p("Uchino Полотенце вафельное Air Waffle 60x100", "Air Waffle"),
  p("Graccioza коврик в ванную 60x100", "Коврики"),
  p("BOVI КПБ Soho", "Постельное белье BOVI"),
  p("BOVI Простыня 240x260", "Простыни Bovi"),
  p("BOVI Наволочка 50x70", "Наволочки"),
];
const a = (title: string, content: string): ConsultantKnowledgeArticle => ({
  id: title,
  title,
  tags: [],
  content,
  updatedAt: "",
});
const articles = [
  a(
    "Aquanova Collection Overview",
    "КОВРИКИ\nLondon: 100% гребенной египетский хлопок (1200 г/м²). Силиконовые точки против скольжения.",
  ),
  a(
    "UCHINO Collection Overview",
    "Zero Twist: пряжа без кручения, 380 г/м².\nAir Waffle: вафельное, 200–245 г/м².",
  ),
  a("Справочник по плотности полотенец", "Air Waffle, Waffle, Waffle, Waffle — лёгкие, 200 г/м²."),
];

describe("марки и модели прайса в сообщении", () => {
  it("кириллицей и латиницей в любом регистре — как в прайсе", () => {
    expect(modelWordsIn("Акванова Макс и Лондон в чем разница?", catalog)).toEqual([
      "Aquanova",
      "Maks",
      "LONDON",
    ]);
    expect(modelWordsIn("aquanova maks и london", catalog)).toEqual(["Aquanova", "Maks", "LONDON"]);
  });
});

describe("статья базы знаний к вопросу о моделях", () => {
  it("«в чем разница» с моделями кириллицей — статья о них", () => {
    const note = knowledgeAboutModels("Акванова Макс и Лондон в чем разница?", catalog, articles);
    expect(note).toContain("Aquanova Collection Overview");
    expect(note).toContain("египетский хлопок");
    expect(note).toContain("свойств не придумывайте");
  });

  it("статья, где названо больше разных моделей, важнее частых упоминаний одной", () => {
    const note = knowledgeAboutModels(
      "Чем отличается Zero Twist от Air Waffle?",
      catalog,
      articles,
    );
    expect(note).toContain("UCHINO Collection Overview");
  });

  it("«а чем они отличаются?» — модели из последней выдачи", () => {
    const note = knowledgeAboutModels("а чем они отличаются?", catalog, articles, {
      recentProductNames: [catalog[0].name, catalog[1].name],
    });
    expect(note).toContain("Aquanova Collection Overview");
  });

  it("вопрос о наличии и цене — без статьи", () => {
    expect(knowledgeAboutModels("Сколько стоит Zero Twist?", catalog, articles)).toBe("");
    expect(knowledgeAboutModels("Коврики для ванной есть?", catalog, articles)).toBe("");
  });

  it("о марке статьи нет — пусто, а не чужая статья", () => {
    expect(knowledgeAboutModels("Какое качество у Graccioza?", catalog, articles)).toBe("");
  });

  it("общий подбор уже подложил статью о тех же моделях — вторая не нужна", () => {
    const attached =
      "• Справочник по плотности полотенец:\n  Zero Twist — плотнее. Air Waffle — лёгкие.";
    expect(
      knowledgeAboutModels("Чем отличается Zero Twist от Air Waffle?", catalog, articles, {
        attached,
      }),
    ).toBe("");
  });

  it("длинная статья — куски вокруг моделей, а не целиком", () => {
    const long = a(
      "Aquanova большой каталог",
      `${"Прочее о марке.\n".repeat(700)}London: египетский хлопок.\nСиликоновые точки.\n${"Ещё прочее.\n".repeat(200)}`,
    );
    const note = knowledgeAboutModels("Из чего Лондон?", catalog, [long]);
    expect(note).toContain("London: египетский хлопок.");
    expect(note.length).toBeLessThan(2000);
  });
});
