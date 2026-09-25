import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import { correctQuery, editDistance, soundStem } from "../src/lib/consultant-v2/typos";

/**
 * Опечатки на слух: «Пальтеца» (живой диалог BOVI 24.09) поиск не находил,
 * и бот отвечал «пальто у нас нет».
 */
const p = (name: string, category = ""): ConsultantProduct => ({
  id: name,
  name,
  category,
  size: "",
  colors: [],
  price_kzt: 1000,
  stock: true,
});
const catalog = [
  p("Uchino Полотенце махровое Zero Twist 70x140", "Zero Twist"),
  p("Uchino Полотенце вафельное Air Waffle 60x100", "Air Waffle"),
  p("Traumina подушка пуховая Classic Daune Soft 50x70", "Пуховые"),
  p("Traumina одеяло шерстяное Cube Camel 155х200", "Одеяла с натуральными наполнителем"),
  p("Graccioza коврик в ванную 60x100", "Коврики"),
  p("BOVI КПБ Soho", "Постельное белье BOVI"),
];

describe("опечатки в запросе поиска", () => {
  it("на слух: безударные гласные и мягкий знак не различаются", () => {
    expect(soundStem("палатенца")).toBe(soundStem("полотенце"));
    expect(soundStem("падушки")).toBe(soundStem("подушка"));
    expect(editDistance(soundStem("пальтеца"), soundStem("полотенце"))).toBeLessThanOrEqual(2);
  });

  it("слово с опечаткой меняется на слово из прайса", () => {
    expect(correctQuery("Пальтеца", catalog)).toBe("полотенце");
    expect(correctQuery("палатенца", catalog)).toBe("полотенце");
    expect(correctQuery("падушки для сна", catalog)).toBe("подушка для сна");
    expect(correctQuery("адеяло", catalog)).toBe("одеяло");
    expect(correctQuery("каврик в ванну", catalog)).toBe("коврик в ванну");
    expect(correctQuery("махравое", catalog)).toBe("махровое");
  });

  it("верно написанное и незнакомое без близкого слова не трогает", () => {
    expect(correctQuery("полотенца", catalog)).toBeNull();
    expect(correctQuery("одеяла", catalog)).toBeNull();
    expect(correctQuery("скатерть", catalog)).toBeNull();
    expect(correctQuery("Uchino", catalog)).toBeNull();
  });
});
