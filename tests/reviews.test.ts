import { describe, it, expect } from "vitest";
import { isValidRating, starsForRating, formatRatingSummary } from "../src/lib/reviews";

describe("isValidRating", () => {
  it("принимает только целые числа от 1 до 5", () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(5)).toBe(true);
    expect(isValidRating(3)).toBe(true);
  });

  it("отвергает нецелые и выходящие за диапазон значения", () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(3.5)).toBe(false);
    expect(isValidRating(-1)).toBe(false);
  });
});

describe("starsForRating", () => {
  it("рисует нужное число закрашенных и пустых звёзд", () => {
    expect(starsForRating(5)).toBe("⭐⭐⭐⭐⭐");
    expect(starsForRating(1)).toBe("⭐☆☆☆☆");
    expect(starsForRating(3)).toBe("⭐⭐⭐☆☆");
  });

  it("округляет и не выходит за границы 1..5", () => {
    expect(starsForRating(4.6)).toBe("⭐⭐⭐⭐⭐");
    expect(starsForRating(0)).toBe("⭐☆☆☆☆");
    expect(starsForRating(9)).toBe("⭐⭐⭐⭐⭐");
  });
});

describe("formatRatingSummary", () => {
  it("форматирует среднюю оценку с одним знаком после запятой", () => {
    expect(formatRatingSummary(4.8, 12)).toBe("⭐ 4.8 (12)");
    expect(formatRatingSummary(5, 1)).toBe("⭐ 5.0 (1)");
  });

  it("без отзывов — ничего не показываем", () => {
    expect(formatRatingSummary(null, 0)).toBe(null);
    expect(formatRatingSummary(4.5, 0)).toBe(null);
  });
});
