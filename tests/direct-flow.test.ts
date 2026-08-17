import { describe, it, expect } from "vitest";
import {
  isCancel,
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

  /**
   * Ровно тот случай, на котором бот зацикливался при живой проверке: человек
   * задал вопрос, бот предложил заказать, человек отказался — и получал в
   * ответ приветствие с самого начала.
   */
  it("отказ закрывает разговор, а не начинает его заново", () => {
    for (const input of [
      "не нужно",
      "не надо",
      "Нет",
      "нет.",
      "спасибо",
      "Спасибо!",
      "понятно",
      "хорошо",
      "всё",
    ]) {
      expect(classifyIncoming(input).kind, input).toBe("dismissal");
    }
  });

  it("отказ не путается с согласием", () => {
    expect(classifyIncoming("да").kind).toBe("affirmative");
    expect(classifyIncoming("нет").kind).toBe("dismissal");
    expect(classifyIncoming("не хочу").kind).toBe("dismissal");
  });

  it("длинная фраза с «спасибо» внутри остаётся вопросом", () => {
    // «Спасибо, а когда будет новый набор?» — это вопрос, а не прощание.
    expect(classifyIncoming("Спасибо, а когда будет новый набор?").kind).toBe("question");
  });
});

/**
 * Выход из сценария. При живой проверке человек застрял на выборе страны:
 * «/start» отвечало «Не понял страну», и выйти было нечем — любая реплика на
 * этом шаге считалась попыткой назвать страну.
 */
describe("isCancel", () => {
  it("понимает все обычные способы выйти", () => {
    for (const input of [
      "отмена",
      "Отмена!",
      "отменить",
      "стоп",
      "сброс",
      "заново",
      "/start",
      "хватит",
    ]) {
      expect(isCancel(input), input).toBe(true);
    }
  });

  it("не принимает за отмену обычную реплику", () => {
    for (const input of ["Казахстан", "1", "018", "не понял", "отменяется ли заказ?"]) {
      expect(isCancel(input), input).toBe(false);
    }
  });
});
