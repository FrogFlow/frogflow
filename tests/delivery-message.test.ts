import { describe, expect, it } from "vitest";
import {
  buildInstagramDeliveryText,
  DEFAULT_DELIVERY_NOTE,
} from "../src/lib/delivery-message";

/**
 * Просьба продавца (цифровая ниша, сентябрь 2026): в сообщении после оплаты
 * предупреждать, что повторная отправка платная. Правило её магазина, поэтому
 * текст берётся из настроек, а не зашит в код для всех пяти деплоев.
 */
const NOTE =
  "❗❗ Если вы не успели скачать материал в указанный срок или потеряли файл, повторная отправка осуществляется только на ПЛАТНОЙ основе.\n\nЕсли письма нет, проверьте папку «Спам» и напишите мне — я помогу.";

describe("сообщение о выдаче в Direct", () => {
  it("ставит приписку продавца последним абзацем", () => {
    const text = buildInstagramDeliveryText({
      displayNo: 715,
      email: "baishat1990@mail.ru",
      linkDays: 7,
      note: NOTE,
    });
    expect(text).toBe(
      "Оплата подтверждена — материалы по заказу №715 отправлены на baishat1990@mail.ru.\n\n" +
        "Ссылки в письме действуют 7 ДНЕЙ, поэтому лучше скачать файлы сразу.\n\n" +
        NOTE,
    );
  });

  it("без приписки отправляет текст по умолчанию", () => {
    const text = buildInstagramDeliveryText({
      displayNo: 12,
      email: "a@b.kz",
      linkDays: 7,
      note: "   ",
    });
    expect(text.endsWith(DEFAULT_DELIVERY_NOTE)).toBe(true);
    expect(text).not.toMatch(/ПЛАТНОЙ/);
  });

  it("срок жизни ссылок берётся из кода, а не из текста продавца", () => {
    const text = buildInstagramDeliveryText({
      displayNo: 1,
      email: "a@b.kz",
      linkDays: 3,
      note: "Ссылки живут месяц",
    });
    expect(text).toContain("действуют 3 ДНЕЙ");
  });

  it("вариант с кнопкой на страницу файлов тоже несёт приписку", () => {
    const text = buildInstagramDeliveryText({
      displayNo: 715,
      email: "baishat1990@mail.ru",
      linkDays: 7,
      note: NOTE,
      filesPageUrl: "https://shop.example/files/abc",
    });
    expect(text).toContain("Нажмите кнопку");
    expect(text).toContain("Дубликат отправили на baishat1990@mail.ru");
    expect(text.endsWith(NOTE)).toBe(true);
  });
});
