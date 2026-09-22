import { describe, expect, it } from "vitest";
import { alreadyAnsweredIncoming, type ConsultantState } from "../src/lib/consultant/state";

/**
 * Живой случай 22.09, 12:53. Покупатель переслал рилс и спросил «Сколько
 * стоит?», через восемнадцать секунд ответил на сторис теми же словами.
 *
 * Первый вопрос пришёл без контекста — рилс прилетел отдельным сообщением с
 * пустым текстом, — и бот честно переспросил, какой товар. Второй нёс и
 * контекст, и привязку к товарам, но его проглотила защита от дублей: у неё
 * правило «тот же текст меньше чем через двадцать секунд — ретрай вебхука».
 * В журнале сообщений строки за 12:53:46 нет вовсе.
 */
const now = Date.parse("2026-09-22T07:53:46.000Z");
const secondsAgo = (n: number) => new Date(now - n * 1000).toISOString();

const answered = (over: Partial<ConsultantState> = {}): ConsultantState => ({
  last_customer_text: "Сколько стоит?",
  last_bot_reply: "Уточните, пожалуйста, какой товар вас интересует.",
  last_bot_reply_at: secondsAgo(18),
  ...over,
});

describe("тот же текст про другую публикацию", () => {
  it("дублем не считается", () => {
    const state = answered({ last_story_id: undefined });
    expect(
      alreadyAnsweredIncoming(state, "Сколько стоит?", now, "webhook", "18630872026051195"),
    ).toBe(false);
  });

  it("и наоборот: был вопрос про сторис, стал без публикации", () => {
    const state = answered({ last_story_id: "18630872026051195" });
    expect(alreadyAnsweredIncoming(state, "Сколько стоит?", now, "webhook", undefined)).toBe(false);
  });

  it("другая публикация — тоже другой вопрос", () => {
    const state = answered({ last_story_id: "18630872026051195" });
    expect(alreadyAnsweredIncoming(state, "Сколько стоит?", now, "webhook", "DdjJAeGtjCc")).toBe(
      false,
    );
  });
});

describe("настоящий повтор доставки", () => {
  it("та же публикация и тот же текст — по-прежнему дубль", () => {
    // Ради этого защита и существует: вебхук повторяет доставку, и без неё
    // покупатель получал два одинаковых ответа подряд.
    const state = answered({ last_story_id: "18630872026051195" });
    expect(
      alreadyAnsweredIncoming(state, "Сколько стоит?", now, "webhook", "18630872026051195"),
    ).toBe(true);
  });

  it("обычный текст без публикаций — дубль как раньше", () => {
    const state = answered();
    expect(alreadyAnsweredIncoming(state, "Сколько стоит?", now, "webhook")).toBe(true);
  });

  it("другой текст дублем не был и не станет", () => {
    const state = answered();
    expect(alreadyAnsweredIncoming(state, "А в рублях?", now, "webhook")).toBe(false);
  });
});
