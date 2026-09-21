import { describe, expect, it } from "vitest";
import { findReplyTarget, pruneReplyTargets, type ReplyTarget } from "../src/lib/consultant/manager-reply";

/**
 * Бот прислал менеджеру вопрос покупателя, менеджер написал ответ в чат бота —
 * и получил приветствие консультанта с выбором страны, потому что на Telegram
 * работает тот же консультант. Покупатель не получил ничего.
 *
 * Теперь менеджер отвечает свайпом на само уведомление, и текст уходит
 * покупателю. Связь держится на паре «чат менеджера + номер сообщения»:
 * уведомление уходит нескольким людям, у каждого свой номер сообщения, а
 * диалог покупателя за ними один.
 */
const target = (over: Partial<ReplyTarget> = {}): ReplyTarget => ({
  chatId: "508136156",
  messageId: 4821,
  userKey: "ig_2293092458119482",
  taskId: "tsk_abc",
  at: new Date().toISOString(),
  ...over,
});

describe("поиск диалога по свайп-ответу", () => {
  const list = [
    target(),
    target({ chatId: "7256670713", messageId: 991, userKey: "ig_2293092458119482" }),
    target({ chatId: "508136156", messageId: 4822, userKey: "ig_1403377207879852" }),
  ];

  it("находит покупателя по чату и номеру сообщения", () => {
    expect(findReplyTarget(list, "508136156", 4821)?.userKey).toBe("ig_2293092458119482");
    expect(findReplyTarget(list, "508136156", 4822)?.userKey).toBe("ig_1403377207879852");
  });

  it("у разных менеджеров разные номера одного и того же диалога", () => {
    expect(findReplyTarget(list, "7256670713", 991)?.userKey).toBe("ig_2293092458119482");
  });

  it("чужой номер в своём чате не подходит", () => {
    // Иначе ответ на постороннее сообщение улетел бы покупателю.
    expect(findReplyTarget(list, "7256670713", 4821)).toBeNull();
    expect(findReplyTarget(list, "508136156", 9999)).toBeNull();
  });

  it("обычное сообщение без ответа диалога не находит", () => {
    expect(findReplyTarget(list, "508136156", undefined)).toBeNull();
  });

  it("число и строка чата — одно и то же", () => {
    expect(findReplyTarget(list, 508136156, 4821)?.userKey).toBe("ig_2293092458119482");
  });
});

describe("список адресов не растёт бесконечно", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const daysAgo = (d: number) => new Date(now - d * 864e5).toISOString();

  it("выкидывает старше недели", () => {
    const list = [
      target({ at: daysAgo(8), messageId: 1 }),
      target({ at: daysAgo(2), messageId: 2 }),
    ];
    expect(pruneReplyTargets(list, now).map((t) => t.messageId)).toEqual([2]);
  });

  it("держит не больше ста двадцати, оставляя свежие", () => {
    const many = Array.from({ length: 200 }, (_, i) => target({ messageId: i, at: daysAgo(1) }));
    const kept = pruneReplyTargets(many, now);
    expect(kept).toHaveLength(120);
    expect(kept[kept.length - 1].messageId).toBe(199);
  });

  it("битую дату не тащит дальше", () => {
    expect(pruneReplyTargets([target({ at: "не дата" })], now)).toEqual([]);
  });
});
