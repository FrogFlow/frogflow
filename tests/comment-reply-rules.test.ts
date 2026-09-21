import { describe, expect, it } from "vitest";
import {
  COMMENT_REPLY_MAX_CHARS,
  pickReplyText,
  pickRuleForComment,
  ruleMatchesComment,
  validateRule,
  type CommentReplyRule,
} from "../src/lib/comment-reply-rules";

/**
 * Клиент просит урезанную автоматизацию Instagram: на комментарий отвечаем
 * публично, в Direct не пишем вообще. Автоматизации Zernio так не умеют —
 * там публичный ответ это добавка к обязательному сообщению в личку.
 */
const rule = (over: Partial<CommentReplyRule> = {}): CommentReplyRule => ({
  id: "crr_1",
  name: "Цена",
  keywords: ["цена", "сколько"],
  matchMode: "contains",
  platformPostId: null,
  replies: ["Написали вам в Direct", "Ответили в личные сообщения"],
  isActive: true,
  createdAt: new Date().toISOString(),
  ...over,
});

describe("совпадение правила с комментарием", () => {
  it("ищет вхождение слова", () => {
    expect(ruleMatchesComment(rule(), "А какая цена?")).toBe(true);
    expect(ruleMatchesComment(rule(), "Сколько стоит?")).toBe(true);
    expect(ruleMatchesComment(rule(), "Красиво")).toBe(false);
  });

  it("режим exact сверяет строку целиком", () => {
    const exact = rule({ matchMode: "exact", keywords: ["цена"] });
    expect(ruleMatchesComment(exact, "цена")).toBe(true);
    expect(ruleMatchesComment(exact, "  Цена  ")).toBe(true);
    expect(ruleMatchesComment(exact, "а цена какая")).toBe(false);
  });

  it("пустой список слов — любой комментарий", () => {
    expect(ruleMatchesComment(rule({ keywords: [] }), "что угодно")).toBe(true);
  });

  it("выключенное правило не срабатывает", () => {
    expect(ruleMatchesComment(rule({ isActive: false }), "цена")).toBe(false);
  });

  it("пустой комментарий не считается совпадением", () => {
    // Без этого правило «на любой комментарий» отвечало бы на фото без текста.
    expect(ruleMatchesComment(rule({ keywords: [] }), "   ")).toBe(false);
  });
});

describe("выбор правила", () => {
  const forPost = rule({ id: "crr_post", platformPostId: "17900", replies: ["Ответ поста"] });
  const forAll = rule({ id: "crr_all", platformPostId: null, replies: ["Общий ответ"] });

  it("правило поста важнее правила на все посты", () => {
    expect(pickRuleForComment([forAll, forPost], "цена", "17900")?.id).toBe("crr_post");
  });

  it("на чужом посте работает общее правило", () => {
    expect(pickRuleForComment([forAll, forPost], "цена", "88888")?.id).toBe("crr_all");
  });

  it("правило поста на другом посте не срабатывает", () => {
    expect(pickRuleForComment([forPost], "цена", "88888")).toBeNull();
  });

  it("ни одно слово не подошло — правила нет", () => {
    expect(pickRuleForComment([forAll, forPost], "красота какая", "17900")).toBeNull();
  });
});

describe("чередование вариантов ответа", () => {
  it("варианты идут по кругу", () => {
    const r = rule({ replies: ["Первый", "Второй", "Третий"] });
    expect(pickReplyText(r, 0)).toBe("Первый");
    expect(pickReplyText(r, 1)).toBe("Второй");
    expect(pickReplyText(r, 2)).toBe("Третий");
    // Instagram давит одинаковые ответы подряд — поэтому по кругу, а не один.
    expect(pickReplyText(r, 3)).toBe("Первый");
  });

  it("один вариант — всегда он", () => {
    expect(pickReplyText(rule({ replies: ["Единственный"] }), 7)).toBe("Единственный");
  });

  it("пустые строки в вариантах не выбираются", () => {
    expect(pickReplyText(rule({ replies: ["  ", "Настоящий"] }), 0)).toBe("Настоящий");
    expect(pickReplyText(rule({ replies: ["", "   "] }), 0)).toBeNull();
  });
});

describe("что мешает сохранить правило", () => {
  it("без названия", () => {
    expect(validateRule({ name: "  ", replies: ["текст"] })).toMatch(/название/i);
  });

  it("без единого текста ответа", () => {
    expect(validateRule({ name: "Цена", replies: ["  "] })).toMatch(/хотя бы один/i);
  });

  it("слишком длинный ответ", () => {
    const long = "я".repeat(COMMENT_REPLY_MAX_CHARS + 1);
    expect(validateRule({ name: "Цена", replies: [long] })).toMatch(/длиннее/i);
  });

  it("правильное правило проходит", () => {
    expect(validateRule({ name: "Цена", replies: ["Написали в Direct"] })).toBeNull();
  });
});
