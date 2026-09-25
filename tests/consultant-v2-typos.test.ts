import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import {
  correctQuery,
  editDistance,
  latinModelsIn,
  latinModelsNote,
  soundStem,
  normalizeCatalogQuery,
  FAMILY_SET_RE,
  familySets,
} from "../src/lib/consultant-v2/typos";

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

describe("марки и модели русскими буквами", () => {
  const rugs = [
    p("Aquanova Коврик в ванную LONDON 60x100, цвет 43 белый", "Коврики"),
    p("Aquanova Коврик в ванную Maks 60х60, цвет 10 слон.кость", "Коврики"),
    p("Kleen-Tex коврик в прихожую Car Protector Set Premium 90х100", "Коврики"),
    ...catalog,
  ];

  it("25.09: «акванова Маск» — это Aquanova Maks, и пометка называет позицию", () => {
    expect(latinModelsIn("А акванова Маск?", rugs)).toEqual(["Aquanova", "Maks"]);
    expect(latinModelsNote("А акванова Маск?", rugs)).toContain(
      "Aquanova Коврик в ванную Maks 60х60",
    );
    expect(latinModelsIn("траумина", rugs)).toEqual(["Traumina"]);
  });

  it("обычные слова переписки — не модели («есть» не Set, «рублях» не Ruby)", () => {
    expect(latinModelsIn("Есть коврики в ванную?", rugs)).toEqual([]);
    expect(latinModelsIn("Можно в рублях? Спасибо большое", rugs)).toEqual([]);
    expect(latinModelsNote("Хорошо, давайте его", rugs)).toBe("");
  });
});

describe("постельное бельё: «подод» в прайсе и семейные комплекты", () => {
  const bedding = [
    p("BOVI КПБ ALLEGRA (1 подод 155x200, 1 наволочка 50x75), цвет белый", "Постельное белье BOVI"),
    p(
      "BOVI КПБ BRISE (2 подод 155x200, 2 наволочки 50x75, простынь 280х290), цвет зеленый",
      "Постельное белье BOVI",
    ),
    p("Traumina одеяло шерстяное Cube Camel 155х200", "Одеяла"),
  ];

  it("пододеяльник как ни напиши — «подод»; одеяло, подушка, подарок — как есть", () => {
    expect(normalizeCatalogQuery("2 пододеяльника 155x200", bedding)).toBe("2 подод 155x200");
    expect(normalizeCatalogQuery("пародеяльника", bedding)).toBe("подод");
    expect(normalizeCatalogQuery("пударьник", bedding)).toBe("подод");
    expect(normalizeCatalogQuery("одеяло 155х200", bedding)).toBe("одеяло 155х200");
    expect(normalizeCatalogQuery("подушка и подарок", bedding)).toBe("подушка и подарок");
    // В прайсе без «подод» — запрос не трогаем.
    expect(normalizeCatalogQuery("пододеяльник", catalog)).toBe("пододеяльник");
  });

  it("семейный комплект — «семейный», «где 2 одеяла», «два пододеяльника»", () => {
    expect(FAMILY_SET_RE.test("семейный комплект")).toBe(true);
    expect(FAMILY_SET_RE.test("Размер где 2 одеяла")).toBe(true);
    expect(FAMILY_SET_RE.test("комплект с двумя пододеяльниками")).toBe(true);
    expect(FAMILY_SET_RE.test("одеяло 155х200")).toBe(false);
    expect(familySets(bedding).map((x) => x.name)).toEqual([bedding[1].name]);
  });
});
