import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import {
  checkForm,
  checkHandoff,
  checkPrices,
  checkRubles,
  indexCatalog,
} from "../src/lib/consultant-v2/eval/checks";
import { priceRub } from "../src/lib/consultant/rate";

/**
 * Проверки эталонного набора — на ответах теста 25.09 (Haiku 4.5, v2).
 * Ошибки, найденные тогда руками, проверки обязаны находить сами, и не
 * находить ошибок там, где их нет.
 */

let n = 0;
const p = (
  name: string,
  size: string,
  price: number,
  colors: string[] = [],
): ConsultantProduct => ({
  id: `P${++n}`,
  name,
  category: "",
  size,
  colors,
  price_kzt: price,
  stock: true,
});

const catalog: ConsultantProduct[] = [
  p("Traumina подушка из функц. волокна Swing 50х70", "50х70", 60000),
  p("Traumina подушка из функц. волокна Swing light 50х70", "50х70", 55000),
  p("Traumina подушка из функц. волокна Swing Extra Light 50х70", "50х70", 50000),
  p("Traumina подушка из функц. волокна Nature & Fresh 50х70", "50х70", 60000),
  p("Traumina подушка пуховая Classic Daune Medium 50x70", "50x70", 85000),
  p("Traumina подушка пуховая Classic Daune Soft 50x70", "50x70", 120000),
  p("Uchino Полотенце вафельное Air Waffle, 70x140, белый", "70x140", 40000),
  p("Uchino Полотенце вафельное Air Waffle, 70x140, серый", "70x140", 40000),
  p("Uchino Полотенце махра+марля Gauze Dot, 70х140, белый", "70х140", 40000),
  p("Uchino Полотенце махровое Zero Twist, 70x140, белый", "70x140", 55000),
  p("Bedding House PIP Полотенце махровое Les Fleurs 55х100, цвет беж", "55х100", 15000, [
    "бежевый",
  ]),
  p("Bedding House PIP Полотенце махровое Les Fleurs 70х140, цвет белый", "70х140", 30000, [
    "белый",
  ]),
  p("Traumina одеяло шерстяное Cube Camel 155х200 WK1", "155х200", 170000),
  p("Traumina одеяло шерстяное Cube Camel 155х200 WK2", "155х200", 190000),
  p("RIVOLTA IMPERIALE полотенце махровое 60x100, цвет серый", "60x100", 20000, ["серый"]),
  p("RIVOLTA IMPERIALE полотенце махровое 60x100 , цвет бронза", "60x100", 20000, ["бронза"]),
  p("Graccioza Egoist коврик в ванную 60x100 цвет white/белый", "60x100", 110000, ["white/белый"]),
  p("Uchino Полотенце махровое для ног Merveille. цвет белый 35х50", "35х50", 27000, ["белый"]),
  p("Uchino Полотенце махровое для ног Merveille. цвет белый 50х80", "50х80", 52000, ["белый"]),
  // Шум: прайс BOVI большой, и редкие слова должны оставаться редкими.
  ...Array.from({ length: 60 }, (_, i) =>
    p(`BOVI КПБ модель ${i} полотенце подушка`, "200x220", 300000 + i),
  ),
];
const index = indexCatalog(catalog);

describe("цены в ответе против прайса", () => {
  it("25.09 «в тенге покажите»: цены соседних строк найдены, верные не тронуты", () => {
    const reply = [
      "В тенге:",
      "",
      "ПОЛОТЕНЦА 70х140 белые:",
      "• UCHINO Air Waffle - 40 000 ₸ (вафельное, лёгкое)",
      "• UCHINO Gauze Dot - 40 000 ₸ (махра+марля)",
      "• UCHINO Zero Twist - 55 000 ₸ (премиум махровое)",
      "• PIP Les Fleurs - 30 000 ₸ (португальское махровое)",
      "",
      "ПОДУШКИ мягкие 50х70:",
      "• Traumina Swing Light - 50 000 ₸ (гипоаллергенная, лёгкая)",
      "• Traumina Swing - 60 000 ₸ (гипоаллергенная, комфортная)",
      "• Traumina Nature & Fresh - 60 000 ₸ (с эвкалиптом)",
      "• Traumina Classic Daune Soft - 85 000 ₸ (пуховая, самая мягкая)",
    ].join("\n");
    const flags = checkPrices(reply, index);
    expect(flags).toHaveLength(2);
    expect(flags[0].detail).toMatch(/Swing light 50х70» за 55\s000/);
    expect(flags[1].detail).toMatch(/Classic Daune Soft 50x70» за 120\s000/);
  });

  it("не придирается: размер, цвет и фабричный код можно не называть", () => {
    expect(checkPrices("• PIP Les Fleurs - 30 000 ₸", index)).toEqual([]);
    expect(checkPrices("• PIP Les Fleurs - 15 000 ₸", index)).toEqual([]);
    expect(
      checkPrices("• Traumina Cube Camel 155х200 (шерстяное, лёгкое) - 170 000 ₸", index),
    ).toEqual([]);
    expect(
      checkPrices("Да, белые есть. Вот варианты:\n• RIVOLTA 60x100 - 20 000 ₸", index),
    ).toEqual([]);
  });

  it("размер в строке решает: чужой размер — ошибка", () => {
    expect(checkPrices("• Merveille 35х50 — 52 000 ₸", index)).toHaveLength(1);
    expect(checkPrices("• Merveille 35х50 — 27 000 ₸, 50х80 — 52 000 ₸", index)).toEqual([]);
  });

  it("итог, предел бюджета и сумма двух цен — не цены позиций", () => {
    const reply =
      "• Merveille 35х50 — 27 000 ₸\n• Merveille 50х80 — 52 000 ₸\nЕсли взять оба размера комплектом, общая стоимость будет 79 000 ₸.";
    expect(checkPrices(reply, index)).toEqual([]);
    expect(checkPrices("Одеяла до 200 000 ₸ есть.", index)).toEqual([]);
  });

  it("суммы, которой в прайсе нет вовсе, не пропускает", () => {
    expect(checkPrices("Доставка обойдётся в 12 345 ₸.", index)[0]?.detail).toContain(
      "такой цены в прайсе нет",
    );
  });
});

describe("рубли", () => {
  const base = { kind: "clarify", handoff: null, rate: 4.45 };

  it("25.09: рубли от модели и оговорка «уточнит менеджер» — замечания", () => {
    const text =
      "В рублях (примерно):\n• UCHINO Air Waffle - 8 960 ₽\n\nТочный расчёт по курсу магазина уточнит менеджер при оформлении.";
    const flags = checkRubles({ ...base, text }, {});
    expect(flags.map((f) => f.check)).toEqual(["рубли", "рубли"]);
    expect(flags[0].detail).toContain("написала модель");
  });

  it("рубли кода по формуле проходят, чужие — нет", () => {
    const right = `• Air Waffle - ${priceRub(40000, 4.45).toLocaleString("ru-RU")} ₽`;
    expect(
      checkRubles(
        { ...base, text: right, historyText: "• Air Waffle - 40 000 ₸" },
        { rubles: true },
      ),
    ).toEqual([]);
    const wrong = "• Air Waffle - 9 000 ₽";
    expect(
      checkRubles({ ...base, text: wrong, historyText: "• Air Waffle - 40 000 ₸" }, {}),
    ).toHaveLength(1);
  });

  it("просили рубли — а в ответе тенге; просили тенге — а в ответе рубли", () => {
    expect(checkRubles({ ...base, text: "40 000 ₸" }, { rubles: true })).toHaveLength(1);
    const rub = `${priceRub(40000, 4.45).toLocaleString("ru-RU")} ₽`;
    expect(
      checkRubles({ ...base, text: rub, historyText: "40 000 ₸" }, { rubles: false }),
    ).toHaveLength(1);
  });
});

describe("форма ответа", () => {
  const out = (text: string) => ({ text, kind: "clarify", handoff: null, rate: 4.45 });

  it("25.09: два вопроса, бюджет, рекламные слова, длинный список на широкий вопрос", () => {
    const checks = (text: string, broad = false) =>
      checkForm(out(text), { broad }, false).map((f) => f.check);
    expect(
      checks("Есть хорошие варианты. Какой бюджет и что важно - помягче или с поддержкой?"),
    ).toContain("бюджет");
    expect(checks("Какой размер нравится? И нужно ли в рублях?")).toContain("вопросы");
    expect(checks("Есть красивые варианты. ИТАЛЬЯНСКИЕ RIVOLTA (элегантные)")).toContain(
      "рекламные слова",
    );
    const list = ["• a 1 000 ₸", "• b 2 000 ₸", "• c 3 000 ₸", "• d 4 000 ₸"].join("\n");
    expect(checks(list, true)).toContain("широкий вопрос");
    expect(checks(list, false)).not.toContain("широкий вопрос");
  });

  it("как пишет менеджер BOVI — без замечаний", () => {
    expect(checkForm(out("50х100 и 70х140. Какой цвет?"), {}, false)).toEqual([]);
    expect(checkForm(out("Есть подешевле, показать?"), {}, false)).toEqual([]);
    expect(checkForm(out("Здравствуйте. Что подсказать?"), {}, true)).toEqual([]);
  });
});

describe("передача менеджеру", () => {
  it("25.09 «Опт - это не ко мне»: причина верная, но покупателю не сказано, что подключится менеджер", () => {
    const flags = checkHandoff(
      {
        text: "Опт - это не ко мне.",
        kind: "handoff",
        handoff: { reason: "wholesale", summary: "опт" },
        rate: null,
      },
      { handoff: "wholesale" },
    );
    expect(flags).toHaveLength(1);
  });

  it("лишняя передача и нужная, но не сделанная", () => {
    const handedOff = {
      text: "Подключу менеджера.",
      kind: "handoff",
      handoff: { reason: "no_answer", summary: "" },
      rate: null,
    };
    expect(checkHandoff(handedOff, {})[0]?.detail).toContain("лишняя передача");
    const answered = { text: "Есть.", kind: "clarify", handoff: null, rate: null };
    expect(checkHandoff(answered, { handoff: "purchase" })[0]?.detail).toContain(
      "нужна передача purchase",
    );
    expect(
      checkHandoff(
        { ...handedOff, handoff: { reason: "purchase", summary: "" } },
        { handoff: "purchase" },
      ),
    ).toEqual([]);
  });
});
