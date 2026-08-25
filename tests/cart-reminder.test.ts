import { describe, it, expect } from "vitest";
import { shouldSendCartReminder } from "../src/lib/cart-reminder";

const NOW = new Date("2026-01-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("shouldSendCartReminder", () => {
  it("напоминалка выключена (0 часов) — не напоминаем никогда", () => {
    expect(shouldSendCartReminder(hoursAgo(100), NOW, 0, null)).toBe(false);
  });

  it("корзина ещё свежая — рано напоминать", () => {
    expect(shouldSendCartReminder(hoursAgo(2), NOW, 6, null)).toBe(false);
  });

  it("порог прошёл, напоминаний ещё не было — напоминаем", () => {
    expect(shouldSendCartReminder(hoursAgo(7), NOW, 6, null)).toBe(true);
  });

  it("уже напоминали после последней активности в корзине — не повторяем", () => {
    expect(shouldSendCartReminder(hoursAgo(10), NOW, 6, hoursAgo(1))).toBe(false);
  });

  it("напоминали, но потом корзина обновилась — можно напомнить снова", () => {
    // Напоминание было 9 часов назад, а корзину тронули 7 часов назад — свежее.
    expect(shouldSendCartReminder(hoursAgo(7), NOW, 6, hoursAgo(9))).toBe(true);
  });
});
