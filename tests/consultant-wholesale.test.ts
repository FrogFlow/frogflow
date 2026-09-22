import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "../src/lib/consultant/catalog-import";
import { decideConsultantReply } from "../src/lib/consultant/handle-message";
import { matchWholesaleIntent } from "../src/lib/consultant/intent";
import { WHOLESALE_REPLY } from "../src/lib/consultant/copy";
import { promisesManagerFollowUp } from "../src/lib/consultant/validate";

const shop = parseCatalogCsv(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/consultant-instagram-test.csv"),
    "utf8",
  ),
).products;

/**
 * Выгрузка 19–22.09: оба обращения про опт получили анкету про страну и на
 * этом закончились.
 *
 *   «Здравствуйте! У вас можно оптом закуп сделать ?»  → Из какой вы страны?
 *   «Добрый день!У вас опт есть?»                      → Из какой вы страны?
 *
 * Отвечать им по рознице тоже нечем: оптового прайса у консультанта нет.
 */
describe("оптовый запрос", () => {
  it("узнаём обе живые формулировки", () => {
    expect(matchWholesaleIntent("Здравствуйте! У вас можно оптом закуп сделать ?")).toBe(true);
    expect(matchWholesaleIntent("Добрый день!У вас опт есть?")).toBe(true);
  });

  it("узнаём и остальные способы спросить то же", () => {
    for (const t of [
      "оптовые цены есть?",
      "интересует опт",
      "работаете с дилерами?",
      "мы дистрибьютор, хотим сотрудничать",
      "беру на перепродажу",
      "b2b условия",
    ]) {
      expect(matchWholesaleIntent(t), t).toBe(true);
    }
  });

  /**
   * Голое «опт» подстрокой сидит в «оптимально» и «оптика»: без проверки
   * конца слова сюда попадал бы каждый второй разговор про подбор.
   */
  it("не срабатывает на слова, где «опт» просто внутри", () => {
    for (const t of [
      "какой вариант оптимальный?",
      "оптика тут ни при чём",
      "что оптимально для двуспальной?",
    ]) {
      expect(matchWholesaleIntent(t), t).toBe(false);
    }
  });

  it("уходит менеджеру сразу, без анкеты про страну", async () => {
    const res = await decideConsultantReply("Здравствуйте! У вас можно оптом закуп сделать ?", {}, {
      catalog: shop,
      rate: 4.45,
    });
    expect(res?.text).toBe(WHOLESALE_REPLY);
    expect(res?.kind).toBe("handoff");
    expect(res?.patch.automation_paused).toBe(true);
  });

  it("ответ ловится страховкой «обещал и не сделал»", () => {
    // Задачу заводит сама ветка передачи, но если она когда-нибудь сломается,
    // задача должна завестись по тексту ответа.
    expect(promisesManagerFollowUp(WHOLESALE_REPLY)).toBe(true);
  });
});
