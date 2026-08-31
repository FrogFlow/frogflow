import { describe, it, expect } from "vitest";
import {
  daysInMonth,
  parseFulfillmentDateInput,
  addDaysToIsoDate,
  isoDateToDisplay,
} from "../src/lib/fulfillment.server";

/**
 * Дата-математика чекаута физического заказа (Ниши, Блок 8) — общая для
 * Telegram и Direct-каналов с переезда в fulfillment.server.ts (Блок 8.3).
 * Чистые функции, без похода в базу — раньше не были покрыты тестом вовсе.
 */

describe("daysInMonth", () => {
  it("считает длину обычных месяцев", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("учитывает високосный год для февраля", () => {
    expect(daysInMonth(2024, 2)).toBe(29); // високосный
    expect(daysInMonth(2025, 2)).toBe(28); // обычный
    expect(daysInMonth(2000, 2)).toBe(29); // делится на 400 — високосный
    expect(daysInMonth(1900, 2)).toBe(28); // делится на 100, но не на 400
  });
});

describe("parseFulfillmentDateInput", () => {
  it("разбирает ДД.ММ.ГГГГ", () => {
    expect(parseFulfillmentDateInput("05.09.2026")).toBe("2026-09-05");
    expect(parseFulfillmentDateInput("31.12.2026")).toBe("2026-12-31");
    expect(parseFulfillmentDateInput("1.1.2026")).toBe("2026-01-01");
  });

  it("отклоняет несуществующую дату", () => {
    expect(parseFulfillmentDateInput("31.04.2026")).toBeNull(); // в апреле 30 дней
    expect(parseFulfillmentDateInput("29.02.2025")).toBeNull(); // не високосный
    expect(parseFulfillmentDateInput("29.02.2024")).toBe("2024-02-29"); // високосный — валидна
    expect(parseFulfillmentDateInput("32.01.2026")).toBeNull();
    expect(parseFulfillmentDateInput("15.13.2026")).toBeNull();
    expect(parseFulfillmentDateInput("00.01.2026")).toBeNull();
  });

  it("отклоняет нераспознанный формат", () => {
    for (const input of ["2026-09-05", "5 сентября", "", "завтра", "05.09.26"]) {
      expect(parseFulfillmentDateInput(input)).toBeNull();
    }
  });
});

describe("addDaysToIsoDate", () => {
  it("прибавляет дни в пределах месяца", () => {
    expect(addDaysToIsoDate("2026-09-01", 3)).toBe("2026-09-04");
  });

  it("переносит через границу месяца и года", () => {
    expect(addDaysToIsoDate("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDaysToIsoDate("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("переносит через 29 февраля високосного года", () => {
    expect(addDaysToIsoDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysToIsoDate("2024-02-28", 2)).toBe("2024-03-01");
  });

  it("0 дней возвращает ту же дату", () => {
    expect(addDaysToIsoDate("2026-09-05", 0)).toBe("2026-09-05");
  });
});

describe("isoDateToDisplay", () => {
  it("переводит YYYY-MM-DD в ДД.ММ.ГГГГ", () => {
    expect(isoDateToDisplay("2026-09-05")).toBe("05.09.2026");
    expect(isoDateToDisplay("2026-01-01")).toBe("01.01.2026");
  });
});
