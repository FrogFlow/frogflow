import { describe, it, expect } from "vitest";
import {
  commentMatchesAutomation,
  commentAgeVerdict,
  FALLBACK_MIN_AGE_MS,
  FALLBACK_MAX_AGE_MS,
} from "./comment-dm-fallback";

/**
 * Ошибка здесь либо пропускает резервную DM мимо реального совпадения
 * (клиент снова не получает ответ), либо шлёт её человеку, чей комментарий
 * ничего общего с правилом не имел, — обе цены высоки для чистой функции без
 * побочных эффектов, стоит тестировать саму логику.
 */
describe("commentMatchesAutomation", () => {
  it("пустой список ключевых слов — совпадает любой комментарий", () => {
    expect(commentMatchesAutomation("что угодно", [], "contains")).toBe(true);
    expect(commentMatchesAutomation("что угодно", undefined, "exact")).toBe(true);
  });

  it("contains: совпадает по вхождению подстроки, без учёта регистра", () => {
    expect(commentMatchesAutomation("хочу ГОД себе", ["год"], "contains")).toBe(true);
    expect(commentMatchesAutomation("совсем другое", ["год"], "contains")).toBe(false);
  });

  it("exact: совпадает только при полном равенстве текста и ключевого слова", () => {
    expect(commentMatchesAutomation("год", ["Год"], "exact")).toBe(true);
    expect(commentMatchesAutomation("хочу год себе", ["год"], "exact")).toBe(false);
  });

  it("exact: пробелы по краям комментария не мешают совпадению", () => {
    expect(commentMatchesAutomation("  год  ", ["год"], "exact")).toBe(true);
  });

  it("совпадает любое из нескольких ключевых слов", () => {
    expect(commentMatchesAutomation("хочу цена", ["год", "цена"], "contains")).toBe(true);
  });

  it("пустая строка среди ключевых слов не совпадает со всем подряд", () => {
    expect(commentMatchesAutomation("год", ["", "цена"], "contains")).toBe(false);
  });
});

describe("commentAgeVerdict", () => {
  const now = new Date("2026-01-15T12:00:00Z");

  it("слишком новый комментарий — даём Zernio шанс сработать первым", () => {
    const justNow = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    expect(commentAgeVerdict(justNow, now)).toBe("too_new");
  });

  it("комментарий в разумном окне — можно пробовать резервную отправку", () => {
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    expect(commentAgeVerdict(anHourAgo, now)).toBe("eligible");
  });

  it("комментарий старше 7-дневного окна private-reply — не пытаемся", () => {
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(commentAgeVerdict(eightDaysAgo, now)).toBe("too_old");
  });

  it("неразбираемая дата — не отправляем вслепую", () => {
    expect(commentAgeVerdict("не дата", now)).toBe("too_old");
  });

  it("границы окна согласованы с экспортированными константами", () => {
    const justUnderMin = new Date(now.getTime() - (FALLBACK_MIN_AGE_MS - 1000)).toISOString();
    const justOverMin = new Date(now.getTime() - (FALLBACK_MIN_AGE_MS + 1000)).toISOString();
    const justUnderMax = new Date(now.getTime() - (FALLBACK_MAX_AGE_MS - 1000)).toISOString();
    const justOverMax = new Date(now.getTime() - (FALLBACK_MAX_AGE_MS + 1000)).toISOString();
    expect(commentAgeVerdict(justUnderMin, now)).toBe("too_new");
    expect(commentAgeVerdict(justOverMin, now)).toBe("eligible");
    expect(commentAgeVerdict(justUnderMax, now)).toBe("eligible");
    expect(commentAgeVerdict(justOverMax, now)).toBe("too_old");
  });
});
