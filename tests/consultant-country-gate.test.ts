import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "../src/lib/consultant/catalog-import";
import { decideConsultantReply } from "../src/lib/consultant/handle-message";
import { matchCountry } from "../src/lib/consultant/intent";
import { DELIVERY_SCOPE_REPLY, TZ_COPY } from "../src/lib/consultant/copy";
import type { ConsultantState } from "../src/lib/consultant/state";

const shop = parseCatalogCsv(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/consultant-instagram-test.csv"),
    "utf8",
  ),
).products;

const say = (text: string, state: ConsultantState = {}) =>
  decideConsultantReply(text, state, { catalog: shop, rate: 4.45 });

/**
 * Разбор всех 140 сообщений за 19–22.09: шесть диалогов из сорока четырёх
 * оборвались ровно на вопросе «из какой вы страны», и все шесть открывались
 * просьбой назвать цену или сделать заказ:
 *
 *   «Здравствуйте, можно узнать цену»
 *   «У вас можно оптом закуп сделать?»
 *   «Здравствуйте. Можно узнать стоимость»
 *   «Как сделать заказ на синтетические коврики? Узнать цену…»
 *   «Добрый день! У вас опт есть?»
 *   «Здравствуйте, можно парочку ковриков для ног в ванную заказать»
 *
 * Каждому вместо ответа показали анкету, и каждый ушёл. 14% всех диалогов.
 */
describe("страну спрашиваем не первым ходом", () => {
  it("вопрос про товар получает товар, а не анкету", async () => {
    const res = await say("А подушки у вас есть?");
    expect(res?.kind).toBe("product");
    expect(res?.text).not.toBe(TZ_COPY.askCountry);
    expect(res?.patch.country).toBe("KZ");
    expect(res?.patch.country_assumed).toBe(true);
  });

  it("приветствие, «старт» и «начать заново» ведут к делу", async () => {
    for (const text of ["Здравствуйте", "начать заново"]) {
      const res = await say(text);
      expect(res?.text, text).toBe(TZ_COPY.askProduct);
      expect(res?.kind, text).not.toBe("country");
    }
  });

  /**
   * Отметка «страну предположили» гасла на втором сообщении: country
   * подтягивался из состояния и выглядел как названный покупателем.
   */
  it("отметку снимает только названная страна, а не следующая реплика", async () => {
    const first = await say("Здравствуйте");
    expect(first?.patch.country_assumed).toBe(true);

    const second = await say("полотенца", { ...first?.patch } as ConsultantState);
    expect(second?.patch.country).toBe("KZ");
    expect(second?.patch.country_assumed, "молчание про страну её не подтверждает").toBe(true);

    const named = await say("я из России", { ...second?.patch } as ConsultantState);
    expect(named?.patch.country).toBe("RU");
    expect(named?.patch.country_assumed).toBe(false);
  });

  /**
   * Комментарий в intent.ts обещал это с самого начала — «слова „Россия",
   * „в рублях" и российские города переключают страну», — а в регулярке
   * слова не было. Пока анкета стояла первым ходом, это не всплывало. Теперь
   * просьба о рублях — главный сигнал от покупателя из РФ.
   */
  it("«в рублях» переключает страну на Россию", () => {
    expect(matchCountry("А в рублях можно?")).toBe("RU");
    expect(matchCountry("Напиши цену в рублях")).toBe("RU");
    expect(matchCountry("сколько это в рублях")).toBe("RU");
    expect(matchCountry("Казахстан")).toBe("KZ");
  });

  it("доставка в третью страну — ответ, а не встречный вопрос", async () => {
    const res = await say("Делаете доставку в Израиль? Спасибо");
    expect(res?.text).toBe(DELIVERY_SCOPE_REPLY);
    expect(res?.kind).not.toBe("country");

    const short = await say("Израиль", { conversation_state: "awaiting_country" });
    expect(short?.text).toBe(DELIVERY_SCOPE_REPLY);
  });

  it("страна бренда за страну покупателя не считается", async () => {
    const res = await say("Мне голландские с птичками понравились");
    expect(res?.text).not.toBe(DELIVERY_SCOPE_REPLY);
  });
});
