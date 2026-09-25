import { describe, it, expect } from "vitest";
import { tengeToRubles, wantsRubles } from "../src/lib/consultant-v2/currency";
import { priceRub } from "../src/lib/consultant/rate";

/**
 * 25.09, тест на прайсе BOVI: на «сколько в рублях?» модель назвала рубли
 * одиннадцати подушкам, шесть — чужие (SENSE LOW за 85 000 ₸ — «4 494 ₽»
 * стаканчика Blomus). Тенге были верные. В v2 рубли считает код.
 */
describe("tengeToRubles", () => {
  const rate = 4.45;
  const rub = (kzt: number) => `${priceRub(kzt, rate).toLocaleString("ru-RU")} ₽`;

  it("каждая сумма в тенге — в рубли по формуле магазина", () => {
    const text = "• SENSE LOW — 85 000 ₸\n• Swing Extra Light — 50 000 ₸";
    expect(tengeToRubles(text, rate)).toBe(`• SENSE LOW — ${rub(85000)}\n• Swing Extra Light — ${rub(50000)}`);
  });

  it("понимает неразрывные пробелы, «тг» и «тенге»", () => {
    expect(tengeToRubles("85 000 ₸", rate)).toBe(rub(85000));
    expect(tengeToRubles("за 27000 тг", rate)).toBe(`за ${rub(27000)}`);
    expect(tengeToRubles("всего 79 000 тенге", rate)).toBe(`всего ${rub(79000)}`);
  });

  it("размеры и другие числа не трогает; без курса текст прежний", () => {
    expect(tengeToRubles("50х100, 2 шт", rate)).toBe("50х100, 2 шт");
    expect(tengeToRubles("85 000 ₸", null)).toBe("85 000 ₸");
  });
});

describe("wantsRubles", () => {
  it("попросил рубли — рубли и дальше, попросил тенге — обратно", () => {
    expect(wantsRubles("сколько в рублях?", {}, undefined)).toBe(true);
    expect(wantsRubles("а белые есть?", { v2_rub: true }, undefined)).toBe(true);
    expect(wantsRubles("а в тенге?", { v2_rub: true }, undefined)).toBe(false);
    expect(wantsRubles("Доставка в Россию есть?", {}, undefined)).toBe(true);
  });

  it("покупатель сказал, что он из России", () => {
    expect(wantsRubles("белые есть?", {}, { country: "Россия" })).toBe(true);
    expect(wantsRubles("белые есть?", {}, { country: "Казахстан" })).toBe(false);
    expect(wantsRubles("белые есть?", {}, undefined)).toBe(false);
  });
});
