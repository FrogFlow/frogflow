import { describe, it, expect } from "vitest";
import { zonedDateTimeToUtcIso } from "../src/lib/datetime";

/**
 * CSV-экспорт заказов (export.functions.ts) сравнивает выбранный оператором
 * диапазон дат с orders.created_at (timestamptz) — раньше строкой без
 * таймзоны (`${date}T00:00:00`), которую Postgres трактует как UTC. Для
 * магазина в Asia/Almaty (UTC+5/+6, умолчание) это на несколько часов
 * сдвигало границы «дня»: экспорт «за 1 сентября» либо терял заказы раннего
 * утра, либо прихватывал часть вечера 31 августа/2 сентября — в зависимости
 * от знака смещения. zonedDateTimeToUtcIso считает настоящий момент начала/
 * конца календарного дня В ТАЙМЗОНЕ МАГАЗИНА.
 */
describe("zonedDateTimeToUtcIso", () => {
  it("полночь Алматы (UTC+5) — на 5 часов раньше полуночи UTC того же числа", () => {
    const iso = zonedDateTimeToUtcIso("2026-09-01", "00:00:00", "Asia/Almaty");
    expect(iso).toBe("2026-08-31T19:00:00.000Z");
  });

  it("конец дня Алматы (23:59:59) — на 5 часов раньше конца дня UTC", () => {
    const iso = zonedDateTimeToUtcIso("2026-09-01", "23:59:59", "Asia/Almaty");
    expect(iso).toBe("2026-09-01T18:59:59.000Z");
  });

  it("UTC — граница дня совпадает буквально, без сдвига", () => {
    expect(zonedDateTimeToUtcIso("2026-09-01", "00:00:00", "UTC")).toBe("2026-09-01T00:00:00.000Z");
    expect(zonedDateTimeToUtcIso("2026-09-01", "23:59:59", "UTC")).toBe("2026-09-01T23:59:59.000Z");
  });

  it("отрицательное смещение (США, UTC-5) — позже полуночи UTC того же числа", () => {
    // America/New_York в сентябре — летнее время, EDT = UTC-4.
    const iso = zonedDateTimeToUtcIso("2026-09-01", "00:00:00", "America/New_York");
    expect(iso).toBe("2026-09-01T04:00:00.000Z");
  });

  it("полночь и 31 августа 23:59:59 Алматы попадают в один и тот же UTC-час — граница не рвёт сутки пополам", () => {
    const startOfSep1 = new Date(
      zonedDateTimeToUtcIso("2026-09-01", "00:00:00", "Asia/Almaty"),
    ).getTime();
    const endOfAug31 = new Date(
      zonedDateTimeToUtcIso("2026-08-31", "23:59:59", "Asia/Almaty"),
    ).getTime();
    // Конец 31 августа на секунду раньше начала 1 сентября — без пропуска и без нахлёста.
    expect(startOfSep1 - endOfAug31).toBe(1000);
  });
});
