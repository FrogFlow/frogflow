import { describe, it, expect } from "vitest";
import { buildAutomationBody } from "../src/lib/zernio.server";

/**
 * Сборка тела запроса к автоматизации — место, где легко навредить в обе
 * стороны: не вычистишь null — уйдёт «на все посты» как значение поля;
 * вычистишь слишком усердно — оператор не сможет очистить публичный ответ,
 * а пустой список ключевых слов («срабатывать на любой комментарий»)
 * превратится в его отсутствие.
 */
const base = { accountId: "acc-1", name: "Правило", dmMessage: "Привет!", keywords: ["хочу"] };

describe("buildAutomationBody", () => {
  it("опускает null у идентификаторов поста — это автоматизация на все посты", () => {
    const body = buildAutomationBody({ ...base, platformPostId: null, postId: null });
    expect(body).not.toHaveProperty("platformPostId");
    expect(body).not.toHaveProperty("postId");
  });

  it("сохраняет пустую строку — ею оператор очищает поле", () => {
    const body = buildAutomationBody({ ...base, commentReply: "", clickTag: "" });
    expect(body.commentReply).toBe("");
    expect(body.clickTag).toBe("");
  });

  it("сохраняет пустой список ключевых слов — это «любой комментарий»", () => {
    const body = buildAutomationBody({ ...base, keywords: [] });
    expect(body.keywords).toEqual([]);
  });

  it("приводит ключевые слова к нижнему регистру и убирает пустые", () => {
    const body = buildAutomationBody({ ...base, keywords: ["Хочу", "  ЦЕНА  ", "", "   "] });
    expect(body.keywords).toEqual(["хочу", "цена"]);
  });

  it("требует текст сообщения — без него отправлять нечего", () => {
    expect(() => buildAutomationBody({ ...base, dmMessage: "   " })).toThrow(/обязателен/i);
  });

  it("с кнопками предел 640 символов", () => {
    const buttons = [{ type: "postback" as const, title: "Купить", payload: "BUY" }];
    expect(() =>
      buildAutomationBody({ ...base, dmMessage: "я".repeat(641), buttons }),
    ).toThrow(/640/);
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(640), buttons })).not.toThrow();
  });

  it("без кнопок предел 1000 символов", () => {
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(1001) })).toThrow(/1000/);
    expect(() => buildAutomationBody({ ...base, dmMessage: "я".repeat(1000) })).not.toThrow();
  });

  it("проверяет длину и у вариантов текста — они ротируются наравне с основным", () => {
    expect(() =>
      buildAutomationBody({ ...base, dmMessageVariations: ["я".repeat(1001)] }),
    ).toThrow(/вариантов/i);
  });
});
