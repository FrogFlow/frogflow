import { afterEach, describe, expect, it } from "vitest";
import { parseSynonymGroups, setDynamicSynonyms } from "../src/lib/consultant/synonyms";
import { findProducts } from "../src/lib/consultant/catalog";

/**
 * Список стран от продавца. Названия взяты из живого прайса дословно.
 *
 * Главная тонкость: одна страна — несколько брендов. Португалия это и Bovi,
 * и Graccioza; Италия — Rivolta и Dorelan; Германия — Sander и Traumina.
 * Сведение к одному бренду теряло бы половину ответа, а объединение брендов
 * в одну группу путало бы их: спросили Bovi — не должно приезжать Graccioza.
 */
const SELLER_LIST = [
  "bovi, португальские, португалия",
  "graccioza, португальские, португалия",
  "weseta, швейцарские, швейцария",
  "pip, голландские, голландия, нидерланды",
  "rivolta, итальянские, италия",
  "dorelan, итальянские, италия",
  "sander, немецкие, германия",
  "traumina, немецкие, германия",
].join("\n");

const p = (name: string, category: string) => ({
  id: name.toLowerCase().replace(/\s+/g, "-").slice(0, 40),
  name,
  category,
  size: "",
  colors: [],
  price_kzt: 24000,
  stock: true,
});

const CATALOG = [
  p("BOVI Наволочки 2 шт CAETANO 50х75, 100% сатин, цвет бежевый", "Постельное бельё"),
  p("WESETA Полотенце махровое DOUCEUR 30x30, серый", "Полотенца"),
  p("Bedding House PIP Покрывало стёганое, хлопок Kairi Bloom 180х220", "Покрывала"),
  p("RIVOLTA IMPERIALE полотенце махровое 100x150, цвет белый", "Полотенца"),
  p("Graccioza Egoist коврик в ванную 60x100 цвет fog", "Коврики"),
  p("Dorelan матрас пенный SFERA R5 200х200", "Матрасы"),
  p("SANDER Дорожка LIAISON 41х82 овал, цвет 29 молочный", "Скатерти"),
  p("Traumina одеяло пуховое Plume BIO Daune 200х220 WK1", "Одеяла"),
  p("Uchino Полотенце Zero Twist 50x100, серый", "Полотенца"),
];

const names = (q: string) => findProducts({ query: q }, CATALOG).all.map((x) => x.name);

describe("страна бренда из списка продавца", () => {
  afterEach(() => setDynamicSynonyms([]));

  it("до списка страна не ищется вовсе", () => {
    expect(names("голландские полотенца")).toEqual([]);
  });

  it("одна страна — все её бренды", () => {
    setDynamicSynonyms(parseSynonymGroups(SELLER_LIST));
    const portugal = names("португальские");
    expect(portugal).toHaveLength(2);
    expect(portugal.join(" ")).toMatch(/BOVI/);
    expect(portugal.join(" ")).toMatch(/Graccioza/);

    const italy = names("итальянские");
    expect(italy.join(" ")).toMatch(/RIVOLTA/);
    expect(italy.join(" ")).toMatch(/Dorelan/);

    const germany = names("немецкие");
    expect(germany.join(" ")).toMatch(/SANDER/);
    expect(germany.join(" ")).toMatch(/Traumina/);
  });

  it("бренд по имени не тянет соседа по стране", () => {
    setDynamicSynonyms(parseSynonymGroups(SELLER_LIST));
    expect(names("bovi")).toHaveLength(1);
    expect(names("bovi")[0]).toMatch(/BOVI/);
    expect(names("dorelan")).toHaveLength(1);
  });

  it("страна вместе с категорией сужает, а не расширяет", () => {
    setDynamicSynonyms(parseSynonymGroups(SELLER_LIST));
    // У Португалии есть и наволочки, и коврик — спросили полотенца, значит их.
    expect(names("итальянские полотенца")).toEqual([
      "RIVOLTA IMPERIALE полотенце махровое 100x150, цвет белый",
    ]);
  });

  it("падежи и название страны словом", () => {
    setDynamicSynonyms(parseSynonymGroups(SELLER_LIST));
    for (const q of ["голландское покрывало", "из Голландии", "нидерланды"]) {
      expect(names(q).join(" "), q).toMatch(/PIP/);
    }
  });

  it("бренд без страны в списке ищется как раньше", () => {
    setDynamicSynonyms(parseSynonymGroups(SELLER_LIST));
    expect(names("uchino")).toHaveLength(1);
    // Японию продавец не называл — и выдумывать её за него нельзя.
    expect(names("японские")).toEqual([]);
  });
});
