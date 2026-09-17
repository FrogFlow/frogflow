import { describe, expect, it } from "vitest";
import {
  brandVocabulary,
  fixBrandSpelling,
  polishConsultantReply,
  stripExclamationsAndEmoji,
} from "../src/lib/consultant/style";
import {
  priceFloorInScope,
  suggestForBudget,
  type ConsultantProduct,
} from "../src/lib/consultant/catalog";

function p(over: Partial<ConsultantProduct> & { id: string; name: string }): ConsultantProduct {
  return { category: "", size: "", colors: [], price_kzt: 100_000, stock: true, ...over };
}

/** Срез боевого каталога вокруг случая «одеяло за 100 000 ₸». */
const CATALOG: ConsultantProduct[] = [
  p({ id: "b1", name: "Traumina одеяло шерстяное Cube Camel 155х200 WK1", category: "одеяла", size: "155х200", price_kzt: 170_000 }),
  p({ id: "b2", name: "Traumina одеяло из функц. волокна Exclusive Faser 155х200 WK1", category: "одеяла", size: "155х200", price_kzt: 180_000 }),
  p({ id: "pil", name: "Traumina подушка из функц. волокна Cube Junior Natur 40х60", category: "Гипоаллергенные", size: "40х60", price_kzt: 30_000 }),
  p({ id: "d1", name: "Dorelan матрас LEVANT R4 SOFT 160x200", category: "матрасы", size: "160x200", price_kzt: 1_200_000 }),
];

describe("подбор по бюджету не выходит из категории", () => {
  it("на одеяло за 100 000 не предлагает подушку за 30 000", () => {
    const picks = suggestForBudget(CATALOG, 100_000, 2, "одеяла");
    // Одеял дешевле 170 000 в каталоге нет — значит в бюджет не попадает
    // ничего, и подушка из другой категории тут не ответ.
    expect(picks.map((x) => x.id)).not.toContain("pil");
    expect(picks).toHaveLength(0);
  });

  it("без указания категории поведение прежнее — это сборка набора", () => {
    expect(suggestForBudget(CATALOG, 100_000).map((x) => x.id)).toContain("pil");
  });

  it("сообщает ценовое дно категории, когда в бюджет не попало ничего", () => {
    const floor = priceFloorInScope({ category: "одеяла" }, CATALOG);
    expect(floor?.cheapest.price_kzt).toBe(170_000);
    expect(floor?.count).toBe(2);
  });

  it("потолок цены не влияет на расчёт дна", () => {
    const floor = priceFloorInScope({ category: "одеяла", max_price_kzt: 100_000 }, CATALOG);
    expect(floor?.cheapest.price_kzt).toBe(170_000);
  });
});

describe("бренды латиницей", () => {
  const brands = brandVocabulary(CATALOG);

  it("собирает марки из названий каталога", () => {
    expect(brands).toContain("Traumina");
    expect(brands).toContain("Dorelan");
  });

  it("возвращает транслитерацию к фабричному написанию", () => {
    expect(fixBrandSpelling("Травмина летние одеяла от 170 000 ₸", brands)).toBe(
      "Traumina летние одеяла от 170 000 ₸",
    );
    expect(fixBrandSpelling("матрасы Дорелан в наличии", brands)).toBe(
      "матрасы Dorelan в наличии",
    );
    // Регистр исходного слова сохраняется: со строчной — марка тоже строчная.
    expect(fixBrandSpelling("есть матрасы дорелан", brands)).toBe("есть матрасы dorelan");
  });

  it("не трогает обычные русские слова", () => {
    const text = "Одеяло шерстяное, доставка по Казахстану, оформление заказа";
    expect(fixBrandSpelling(text, brands)).toBe(text);
  });

  it("правильное написание оставляет как есть", () => {
    const text = "Traumina Cube Junior Natur 40x60";
    expect(fixBrandSpelling(text, brands)).toBe(text);
  });

  /**
   * Живой случай от продавца: в перечне категорий бот написал «Матрасы и
   * topper» и «Постельное belle». Слова TOPPER и Belle попали в словарь марок
   * из середины названий («Dorelan TOPPER RE:ACTIVE», «Sander Belle Epoque»),
   * и транслитерация русских слов дотянулась до них.
   */
  const WITH_COLLECTIONS: ConsultantProduct[] = [
    ...CATALOG,
    p({ id: "t1", name: "Dorelan TOPPER RE:ACTIVE 160x200", category: "топперы" }),
    p({ id: "s1", name: "Sander Belle Epoque скатерть", category: "скатерти" }),
  ];

  it("перечень категорий не переводится в латиницу", () => {
    const vocabulary = brandVocabulary(WITH_COLLECTIONS);
    const list = "Матрасы и топперы\nПостельное бельё\nПолотенца\nНаматрасники\nПледы\nХалаты";
    expect(fixBrandSpelling(list, vocabulary)).toBe(list);
  });

  it("в словарь марок попадает только первое латинское слово названия", () => {
    const vocabulary = brandVocabulary(WITH_COLLECTIONS);
    expect(vocabulary).toContain("Dorelan");
    expect(vocabulary).toContain("Sander");
    expect(vocabulary).not.toContain("TOPPER");
    expect(vocabulary).not.toContain("Belle");
  });

  it("марку по-прежнему возвращает к фабричному написанию", () => {
    const vocabulary = brandVocabulary(WITH_COLLECTIONS);
    expect(fixBrandSpelling("топперы Дорелан в наличии", vocabulary)).toBe(
      "топперы Dorelan в наличии",
    );
  });
});

describe("восклицательные знаки и эмодзи", () => {
  it("убирает эмодзи и восклицания из прощания", () => {
    const farewell =
      "До свидания! Спасибо за обращение в BOVI.\n\nЕсли у вас возникнут вопросы — пишите в любое время. Мы всегда готовы помочь! 😊";
    const out = stripExclamationsAndEmoji(farewell);
    expect(out).not.toMatch(/!/);
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(out).toContain("До свидания. Спасибо за обращение в BOVI.");
  });

  it("не оставляет двойных пробелов и точек после зачистки", () => {
    expect(stripExclamationsAndEmoji("Спасибо! 😊 Уточните номер")).toBe("Спасибо. Уточните номер");
    expect(stripExclamationsAndEmoji("Готово!!! Пишите")).toBe("Готово. Пишите");
  });

  it("не превращает «?!» в «?.»", () => {
    expect(stripExclamationsAndEmoji("Правда?! Уточню")).toBe("Правда? Уточню");
  });

  it("обычный текст не портит", () => {
    const text = "Полотенце банное 70x140, белый — 16 900 ₸. Оформить заказ?";
    expect(stripExclamationsAndEmoji(text)).toBe(text);
  });

  it("доводка делает обе правки разом", () => {
    expect(polishConsultantReply("Травмина — отличный выбор! 🌸", CATALOG)).toBe(
      "Traumina — отличный выбор.",
    );
  });
});
