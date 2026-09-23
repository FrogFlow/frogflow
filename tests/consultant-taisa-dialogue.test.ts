import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "../src/lib/consultant/catalog-import";
import {
  decideConsultantReply,
  IDLE_REMARKS_LIMIT,
  LONG_DIALOGUE_TURNS,
} from "../src/lib/consultant/handle-message";
import { HANDOFF_TO_MANAGER_REPLY, LONG_DIALOGUE_REPLY } from "../src/lib/consultant/copy";
import {
  asksForPhotoOnly,
  cleanEmptyPraise,
  isIdleRemark,
  promisesPhotoFromManager,
  stripLeadingAcknowledgement,
} from "../src/lib/consultant/validate";

/**
 * Живой диалог 23.09, @taisa_sultanova_95. Продавец: «Совсем плохо стало.
 * И „понял“ говорит постоянно. Хуже, чем было пару дней назад».
 */
describe("пересказ служебных пометок", () => {
  it("первый ответ живого диалога вычищается до сути", () => {
    const live =
      "Понял. Цены буду называть в тенге, страну не спрашиваю. Если в ответе будут цены, " +
      "добавлю строку про расчёт в рублях.\n\nЧем помочь?";
    expect(cleanEmptyPraise(live)).toBe("Чем помочь?");
  });

  it("«Понял» в начале ответа снимается в любом виде", () => {
    expect(stripLeadingAcknowledgement("Понял. В каком посте вы видели полотенце?")).toBe(
      "В каком посте вы видели полотенце?",
    );
    expect(stripLeadingAcknowledgement("Понял, вам нужны лицевые полотенца.")).toBe("Вам нужны лицевые полотенца.");
    expect(stripLeadingAcknowledgement("Понимаю. Полотенца PIP — жаккард.")).toBe("Полотенца PIP — жаккард.");
  });

  it("ответ из одного «Хорошо» не превращается в пустоту", () => {
    expect(stripLeadingAcknowledgement("Хорошо")).toBe("Хорошо");
  });
});

describe("«Вы можете мне скинуть» — это просьба о фото", () => {
  it("глагол без дополнения — фото", () => {
    for (const t of ["Вы можете мне скинуть", "Скиньте пожалуйста", "пришлите", "Можете показать?"]) {
      expect(asksForPhotoOnly(t), t).toBe(true);
    }
  });

  it("когда есть что прислать — не фото", () => {
    for (const t of ["Пришлите реквизиты", "Скиньте номер карты", "Размеры то что вы скинули"]) {
      expect(asksForPhotoOnly(t), t).toBe(false);
    }
  });

  it("обещание модели «фото пришлёт менеджер» распознаётся", () => {
    expect(promisesPhotoFromManager("Фотографии товара может прислать менеджер — он свяжется с вами.")).toBe(true);
    expect(promisesPhotoFromManager("Менеджер пришлёт фото.")).toBe(true);
    expect(promisesPhotoFromManager("Менеджер свяжется с вами для оформления заказа.")).toBe(false);
  });
});

const shop = parseCatalogCsv(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/consultant-instagram-test.csv"),
    "utf8",
  ),
).products;

describe("передача менеджеру: пустые реплики, а не число ходов", () => {
  it("живая просьба о фото сразу уходит менеджеру", async () => {
    const res = await decideConsultantReply("Вы можете мне скинуть", { country: "KZ" }, { catalog: shop, rate: 4.45 });
    expect(res?.text).toBe(HANDOFF_TO_MANAGER_REPLY);
    expect(res?.kind).toBe("handoff");
  });

  it("покупательницу, которая выбирает, на девятом сообщении не отрезаем", async () => {
    const res = await decideConsultantReply(
      "Кроме 30/50",
      { country: "KZ", bot_turns: 8, idle_turns: 1 },
      { catalog: shop, rate: 4.45 },
    );
    expect(res?.text).not.toBe(LONG_DIALOGUE_REPLY);
  });

  it(`после ${IDLE_REMARKS_LIMIT} пустых реплик следующая пустая уходит менеджеру`, async () => {
    const res = await decideConsultantReply(
      "Я думала у Мисс Мари дорого , а вы переплюнули 😄",
      { country: "RU", bot_turns: 9, idle_turns: IDLE_REMARKS_LIMIT },
      { catalog: shop, rate: 4.45 },
    );
    expect(res?.text).toBe(LONG_DIALOGUE_REPLY);
  });

  it("содержательный вопрос после пустых реплик — отвечаем", async () => {
    const res = await decideConsultantReply(
      "А подушки у вас есть?",
      { country: "KZ", bot_turns: 9, idle_turns: IDLE_REMARKS_LIMIT },
      { catalog: shop, rate: 4.45 },
    );
    expect(res?.text).not.toBe(LONG_DIALOGUE_REPLY);
  });

  it(`жёсткий предел — ${LONG_DIALOGUE_TURNS} ответов`, async () => {
    const res = await decideConsultantReply(
      "А подушки у вас есть?",
      { country: "KZ", bot_turns: LONG_DIALOGUE_TURNS },
      { catalog: shop, rate: 4.45 },
    );
    expect(res?.text).toBe(LONG_DIALOGUE_REPLY);
  });

  it("пустые реплики из обоих живых диалогов", () => {
    for (const t of ["Они очень дорогие", "Дорого все равно", "Фуууув 😄 у меня уже инфаркт", "хорошо", "😄"]) {
      expect(isIdleRemark(t), t).toBe(true);
    }
    for (const t of ["Кроме 30/50", "По светлее тона лицевые и банные", "Цвет ходовой", "Это в рублях ? 🥹"]) {
      expect(isIdleRemark(t), t).toBe(false);
    }
  });
});
