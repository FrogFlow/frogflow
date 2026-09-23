import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "../src/lib/consultant/catalog-import";
import { decideConsultantReply, LONG_DIALOGUE_TURNS } from "../src/lib/consultant/handle-message";
import { LONG_DIALOGUE_REPLY } from "../src/lib/consultant/copy";
import { priceRub } from "../src/lib/consultant/rate";
import {
  cleanEmptyPraise,
  cleanUpsellPressure,
  fixRubleMislabels,
  isChatter,
} from "../src/lib/consultant/validate";

const weekday = new Date("2026-09-22T12:00:00Z");
const toRub = (kzt: number) => priceRub(kzt, 4.45, weekday);

/**
 * Живой диалог 22.09, покупательница из России. К десятому сообщению бот
 * назвал пледы «от 140 000 до 320 000 ₽» — это точные цены пледов Eagle в
 * тенге. Продавец: «путает цены в рублях и в тенге, в конце опять выдал цены
 * в тенге, но как в рублях. У нас так с клиентами нельзя — больше не
 * вернутся».
 */
describe("тенге, подписанные рублями", () => {
  const kzt = [140_000, 320_000, 27_000, 52_000, 230_000];

  it("живой ответ про пледы пересчитывается по курсу", () => {
    expect(fixRubleMislabels("Пледы Eagle — цены от 140 000 до 320 000 ₽.", kzt, toRub)).toBe(
      `Пледы Eagle — цены от ${toRub(140_000).toLocaleString("ru-RU")} до ${toRub(320_000).toLocaleString("ru-RU")} ₽.`,
    );
  });

  it("одиночная цена и «руб.» тоже", () => {
    expect(fixRubleMislabels("Цена 52 000 руб.", kzt, toRub)).toBe(
      `Цена ${toRub(52_000).toLocaleString("ru-RU")} руб.`,
    );
  });

  it("правильные рублёвые цены и суммы не трогаем", () => {
    const ok = "• 35x50 — 6 387 ₽\n• 50x80 — 12 300 ₽\nВместе 18 687 ₽";
    expect(fixRubleMislabels(ok, kzt, toRub)).toBe(ok);
    const both = "Graccioza Egoist 80x160: 230 000 ₸ = 54 406 ₽";
    expect(fixRubleMislabels(both, kzt, toRub)).toBe(both);
  });

  it("число, которое есть и в тенге, и в рублях, считается рублёвым", () => {
    // 12 300 — законная цена в рублях; то, что где-то есть товар за 12 300 ₸,
    // не повод его пересчитывать.
    expect(fixRubleMislabels("50x80 — 12 300 ₽", [52_000, 12_300], toRub)).toBe("50x80 — 12 300 ₽");
  });
});

/**
 * Продавец 23.09: «Давайте уберем возможность бота пространно обсуждать и
 * вести праздные беседы с клиентом. Только по сути».
 */
describe("болтовня вокруг цены", () => {
  it("живой ответ на «55 т за коврик — это уже слишком»", () => {
    const live =
      "Я вас понимаю, совсем не обидно. 55 тысяч рублей за коврик — это действительно серьезная сумма, " +
      "и не каждому по карману. У нас есть Kleen-tex 60х90 см — 14 193 ₽. " +
      "Или может быть, вас интересует что-то совсем другое из текстиля?";
    expect(cleanEmptyPraise(live)).toBe("У нас есть Kleen-tex 60х90 см — 14 193 ₽.");
  });

  it("узнаём остальные фразы из того же диалога", () => {
    for (const s of [
      "Спасибо за понимание.",
      "Ха, понимаю вас.",
      "Да, в Казахстане цены в тенге звучат внушительно, но это совсем другой масштаб валюты.",
      "Вполне разумные цены для премиального японского качества.",
      "Да, я работаю с ценами в рублях для России.",
      "Но я вас понимаю — если совсем накладно, то лучше не брать, чем потом жалеть о потраченных деньгах.",
      "Интересуют ли вас эти полотенца, или я могу помочь с чем-то ещё?",
    ]) {
      expect(isChatter(s), s).toBe(true);
    }
  });

  it("ответ по делу не трогаем", () => {
    for (const s of [
      "Полотенце Uchino Merveille 50х80 — 12 300 ₽.",
      "Какой размер вас интересует?",
      "Доставка в Россию — СДЭК, по тарифам СДЭК.",
    ]) {
      expect(isChatter(s), s).toBe(false);
    }
  });

  it("«или беру оба?» — тоже дожим", () => {
    expect(cleanUpsellPressure("Какой размер вас больше интересует, или беру оба?")).toBe(
      "Какой размер вас больше интересует?",
    );
  });
});

const shop = parseCatalogCsv(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/consultant-instagram-test.csv"),
    "utf8",
  ),
).products;

describe("длинный разговор уходит менеджеру", () => {
  it(`после ${LONG_DIALOGUE_TURNS} ответов — мягкая передача`, async () => {
    const res = await decideConsultantReply(
      "Пледы были интересные у вас",
      { country: "RU", bot_turns: LONG_DIALOGUE_TURNS },
      { catalog: shop, rate: 4.45 },
    );
    expect(res?.text).toBe(LONG_DIALOGUE_REPLY);
    expect(res?.kind).toBe("handoff");
    expect(res?.patch.automation_paused).toBe(true);
  });

  it("до порога отвечает как обычно", async () => {
    const res = await decideConsultantReply(
      "А подушки у вас есть?",
      { country: "KZ", bot_turns: LONG_DIALOGUE_TURNS - 1 },
      { catalog: shop, rate: 4.45 },
    );
    expect(res?.text).not.toBe(LONG_DIALOGUE_REPLY);
  });
});
