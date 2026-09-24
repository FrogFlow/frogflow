import { describe, it, expect } from "vitest";
import { cleanRubleHedge, promisesManagerFollowUp } from "../src/lib/consultant/validate";

/**
 * Живой случай 24.09: на «В рублях» бот назвал обе цены по курсу и дописал
 * «Точную сумму в рублях подтвердит менеджер». По тексту обещания в список
 * задач ушла пустая задача «В рублях», хотя ответ покупатель уже получил.
 */
describe("cleanRubleHedge", () => {
  const live =
    "Для вас по курсу:\n\n" +
    "• BOVI КПБ PECAN 240x220, бежевый - 52 040 ₽\n" +
    "• BOVI КПБ PECAN 155x200, голубой - 68 598 ₽\n\n" +
    "Точную сумму в рублях подтвердит менеджер.";

  it("оговорка уходит, цены остаются, задачи менеджеру нет", () => {
    const out = cleanRubleHedge(live);
    expect(out).not.toMatch(/менеджер/);
    expect(out).toContain("52 040 ₽");
    expect(out).toContain("68 598 ₽");
    expect(promisesManagerFollowUp(out)).toBe(false);
  });

  it("без суммы в рублях не трогаем: там менеджер и есть ответ", () => {
    const text = "Стоимость в рублях подтвердит менеджер.";
    expect(cleanRubleHedge(text)).toBe(text);
  });

  it("другие фразы про менеджера рядом с рублями не режем", () => {
    const text = "Полотенце 50х80 - 12 300 ₽.\n\nФото пришлёт менеджер.";
    expect(cleanRubleHedge(text)).toBe(text);
  });
});
