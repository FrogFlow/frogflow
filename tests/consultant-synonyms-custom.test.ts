import { afterEach, describe, expect, it } from "vitest";
import {
  expandToken,
  formatSynonymGroups,
  parseSynonymGroups,
  setDynamicSynonyms,
} from "../src/lib/consultant/synonyms";
import { findProducts } from "../src/lib/consultant/catalog";

/**
 * Покупатель спросил «голландские полотенца» — бот ответил, что таких нет.
 * А это PIP Studio. Страна происхождения в прайсе не хранится вовсе, и знать
 * её коду неоткуда: «голландские — это PIP Studio» — сведения магазина, а не
 * языка. Поэтому список ведёт продавец.
 */
const product = (name: string, category = "Полотенца") => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  category,
  size: "50x100",
  colors: ["белый"],
  price_kzt: 24000,
  stock: true,
});

const CATALOG = [
  product("Полотенце PIP Studio Royal 50x100"),
  product("Полотенце Uchino Zero Twist 50x100"),
  product("Матрас Dorelan EPIC R3 COMFORT 182x202", "Матрасы"),
];

afterEach(() => setDynamicSynonyms([]));

describe("разбор списка из панели", () => {
  it("строка — группа, первое слово каноническое", () => {
    expect(parseSynonymGroups("pip, голландские, голландия\ndorelan, итальянские")).toEqual([
      ["pip", "голландские", "голландия"],
      ["dorelan", "итальянские"],
    ]);
  });

  it("точка с запятой тоже разделитель, пустое отбрасывается", () => {
    expect(parseSynonymGroups("pip; голландские;;  \n\n   \nuchino, японские")).toEqual([
      ["pip", "голландские"],
      ["uchino", "японские"],
    ]);
  });

  it("строка из одного слова группой не считается", () => {
    // Синоним без пары бессмыслен и только путал бы поиск.
    expect(parseSynonymGroups("pip\nuchino, японские")).toEqual([["uchino", "японские"]]);
  });

  it("обратно собирается в тот же вид", () => {
    const text = "pip, голландские, голландия\ndorelan, итальянские";
    expect(formatSynonymGroups(parseSynonymGroups(text))).toBe(text);
  });
});

describe("поиск по словам продавца", () => {
  it("«голландские» находят PIP Studio", () => {
    expect(findProducts({ query: "голландские полотенца" }, CATALOG).all).toEqual([]);
    setDynamicSynonyms(parseSynonymGroups("pip, голландские, голландия"));
    const found = findProducts({ query: "голландские полотенца" }, CATALOG).all;
    expect(found.map((p) => p.name)).toEqual(["Полотенце PIP Studio Royal 50x100"]);
  });

  it("падежи работают без отдельной записи", () => {
    // Стеммер сводит «голландских» и «голландское» к той же основе.
    setDynamicSynonyms(parseSynonymGroups("pip, голландские"));
    for (const q of ["голландских полотенец", "голландское полотенце"]) {
      expect(findProducts({ query: q }, CATALOG).all.map((p) => p.name), q).toEqual([
        "Полотенце PIP Studio Royal 50x100",
      ]);
    }
  });

  it("слова продавца важнее зашитых", () => {
    setDynamicSynonyms(parseSynonymGroups("dorelan, матрас"));
    expect(expandToken("матрас")).toBe("dorelan");
  });

  it("зашитые синонимы продолжают работать рядом", () => {
    setDynamicSynonyms(parseSynonymGroups("pip, голландские"));
    // «towel» → «полотенце» из зашитого словаря никуда не делось.
    expect(findProducts({ query: "towel" }, CATALOG).all).toHaveLength(2);
  });

  it("пустой список ничего не ломает", () => {
    setDynamicSynonyms([]);
    expect(findProducts({ query: "uchino" }, CATALOG).all.map((p) => p.name)).toEqual([
      "Полотенце Uchino Zero Twist 50x100",
    ]);
  });
});
