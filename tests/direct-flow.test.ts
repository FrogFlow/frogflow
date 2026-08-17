import { describe, it, expect } from "vitest";
import {
  extractProductNumber,
  productNumberFrom,
  matchCountry,
  extractEmail,
  isAffirmative,
  classifyIncoming,
} from "../src/lib/direct-flow";

/** Список стран взят из настоящих payment_methods клиента. */
const countries = [
  { code: "KZ", name: "🇰🇿 Казахстан" },
  { code: "RU", name: "🇷🇺 Россия" },
  { code: "BY", name: "🇧🇾 Беларусь" },
  { code: "KG", name: "🇰🇬 Кыргызстан" },
  { code: "UZ", name: "🇺🇿 Узбекистан" },
  { code: "OTHER", name: "Другая страна" },
];

describe("extractProductNumber", () => {
  it("принимает номер в том виде, в каком его пишут покупатели", () => {
    for (const input of ["196", "196.", "196)", "№196", "# 196", " 196 "]) {
      expect(extractProductNumber(input)).toBe("196");
    }
  });

  it("снимает ведущие нули — товар «018» покупатель напишет как «18»", () => {
    expect(extractProductNumber("018")).toBe("18");
    expect(extractProductNumber("18")).toBe("18");
    expect(extractProductNumber("006")).toBe("6");
  });

  it("не принимает за номер обычный текст", () => {
    for (const input of ["здравствуйте", "хочу 196 штук", "1 класс математика", ""]) {
      expect(extractProductNumber(input)).toBeNull();
    }
  });
});

describe("productNumberFrom", () => {
  it("достаёт номер из ключевых слов и из названия", () => {
    expect(productNumberFrom("018, пазлы, карточки, буквы")).toBe("18");
    expect(productNumberFrom("196. Рабочие листы по естествознанию")).toBe("196");
  });

  it("возвращает null, когда номера нет", () => {
    expect(productNumberFrom("Алфавит- вырежи, склей №0014")).toBeNull();
    expect(productNumberFrom(null)).toBeNull();
  });
});

describe("matchCountry", () => {
  it("понимает порядковый номер из показанного списка", () => {
    expect(matchCountry("1", countries)?.code).toBe("KZ");
    expect(matchCountry("2.", countries)?.code).toBe("RU");
    expect(matchCountry("6", countries)?.code).toBe("OTHER");
  });

  it("понимает название, в том числе с флагом и не до конца", () => {
    expect(matchCountry("Казахстан", countries)?.code).toBe("KZ");
    expect(matchCountry("🇰🇿 Казахстан", countries)?.code).toBe("KZ");
    expect(matchCountry("казах", countries)?.code).toBe("KZ");
    expect(matchCountry("россия", countries)?.code).toBe("RU");
  });

  it("понимает код страны", () => {
    expect(matchCountry("kz", countries)?.code).toBe("KZ");
  });

  it("не угадывает наугад", () => {
    expect(matchCountry("не знаю", countries)).toBeNull();
    expect(matchCountry("99", countries)).toBeNull();
    // Двух букв мало: под них подошло бы слишком многое.
    expect(matchCountry("ка", countries)).toBeNull();
  });
});

describe("extractEmail", () => {
  it("находит адрес в реплике", () => {
    expect(extractEmail("моя почта anna@mail.ru")).toBe("anna@mail.ru");
    expect(extractEmail("  Anna.Petrova@GMAIL.com ")).toBe("anna.petrova@gmail.com");
  });

  it("не принимает за почту то, что ею не является", () => {
    for (const input of ["анна собака мейл ру", "@annavenglovskaia", "почта", ""]) {
      expect(extractEmail(input)).toBeNull();
    }
  });
});

describe("classifyIncoming", () => {
  it("номер товара опознаётся как номер", () => {
    expect(classifyIncoming("196")).toEqual({ kind: "product_number", number: "196" });
  });

  it("односложный ответ воронке — не поисковый запрос", () => {
    expect(classifyIncoming("Да").kind).toBe("affirmative");
    expect(classifyIncoming("хочу!").kind).toBe("affirmative");
    expect(isAffirmative("+")).toBe(true);
  });

  it("всё остальное — вопрос, а не молчаливый поиск по каталогу", () => {
    const result = classifyIncoming("Здравствуйте, а скидка есть?");
    expect(result.kind).toBe("question");
    if (result.kind === "question") {
      expect(result.text).toBe("Здравствуйте, а скидка есть?");
    }
  });
});
