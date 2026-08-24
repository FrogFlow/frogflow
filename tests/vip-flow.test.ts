import { describe, it, expect } from "vitest";
import {
  inviteExpireDate,
  addTariffDuration,
  addWarnOffset,
  resolveWarnWindows,
  pickLatestPerUser,
  resolveVipExtension,
  TEST_MODE_DEFAULT_MINUTES,
} from "../src/lib/vip-flow";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("inviteExpireDate", () => {
  it("зажимает снизу: короткая подписка (тест-режим) даёт хотя бы 10 минут на переход", () => {
    const now = 1_000_000_000_000;
    const expiresAt = new Date(now + MIN); // подписка на 1 минуту
    const result = inviteExpireDate(expiresAt, now);
    expect(result * 1000 - now).toBe(10 * MIN);
  });

  it("зажимает сверху: многомесячная подписка не даёт ссылку жить дольше 24 часов", () => {
    const now = 1_000_000_000_000;
    const expiresAt = new Date(now + 90 * DAY);
    const result = inviteExpireDate(expiresAt, now);
    expect(result * 1000 - now).toBe(DAY);
  });

  it("между 10 минутами и 24 часами — берёт срок подписки как есть", () => {
    const now = 1_000_000_000_000;
    const expiresAt = new Date(now + 3 * HOUR);
    const result = inviteExpireDate(expiresAt, now);
    expect(result * 1000 - now).toBe(3 * HOUR);
  });

  it("ровно на границах не пересекает их", () => {
    const now = 1_000_000_000_000;
    expect(inviteExpireDate(new Date(now + 10 * MIN), now) * 1000 - now).toBe(10 * MIN);
    expect(inviteExpireDate(new Date(now + DAY), now) * 1000 - now).toBe(DAY);
  });
});

describe("addTariffDuration", () => {
  it("в обычном режиме считает дни тарифа", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const result = addTariffDuration(base, { duration_days: 30 }, false);
    expect(result.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("без duration_days подставляет 30 дней по умолчанию", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const result = addTariffDuration(base, null, false);
    expect(result.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("в тест-режиме считает МИНУТЫ, а не дни — это и есть источник прод-инцидента", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const result = addTariffDuration(base, { duration_minutes: 5, duration_days: 30 }, true);
    expect(result.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("без duration_minutes в тест-режиме подставляет единое умолчание", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const result = addTariffDuration(base, { duration_days: 30 }, true);
    expect(result.getTime() - base.getTime()).toBe(TEST_MODE_DEFAULT_MINUTES * MIN);
  });

  it("duration_minutes: 0 не даёт нулевой срок — тоже уходит в умолчание", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const result = addTariffDuration(base, { duration_minutes: 0 }, true);
    expect(result.getTime() - base.getTime()).toBe(TEST_MODE_DEFAULT_MINUTES * MIN);
  });
});

describe("addWarnOffset", () => {
  it("в обычном режиме сдвигает на дни", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    expect(addWarnOffset(base, 3, false).toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("в тест-режиме сдвигает на минуты — окна предупреждений тоже уезжают", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    expect(addWarnOffset(base, 3, true).toISOString()).toBe("2026-01-01T00:03:00.000Z");
  });
});

describe("resolveWarnWindows", () => {
  it("использует переданные значения как есть, если они валидны и упорядочены", () => {
    expect(resolveWarnWindows("3", "1")).toEqual({ warnDays: 3, warnDays2: 1 });
  });

  it("подставляет умолчания 3/1 на пустые строки", () => {
    expect(resolveWarnWindows("", "")).toEqual({ warnDays: 3, warnDays2: 1 });
  });

  it("подставляет умолчания на нечисловой мусор", () => {
    expect(resolveWarnWindows("abc", "xyz")).toEqual({ warnDays: 3, warnDays2: 1 });
  });

  it("отбрасывает значения меньше 1", () => {
    expect(resolveWarnWindows("0", "-5")).toEqual({ warnDays: 3, warnDays2: 1 });
  });

  it("подтягивает второе окно ближе первого, если оно сохранено равным или больше", () => {
    // Продовый кейс: у клиента когда-то сохранили 3/1, потом первое окно сузили до 2,
    // а второе руками не поправили — оно не должно остаться на уровне первого.
    expect(resolveWarnWindows("2", "3")).toEqual({ warnDays: 2, warnDays2: 1 });
    expect(resolveWarnWindows("2", "2")).toEqual({ warnDays: 2, warnDays2: 1 });
  });

  it("не опускает второе окно ниже 1 даже при warnDays=1", () => {
    expect(resolveWarnWindows("1", "1")).toEqual({ warnDays: 1, warnDays2: 1 });
  });
});

describe("pickLatestPerUser", () => {
  it("возвращает пустой список на null", () => {
    expect(pickLatestPerUser(null)).toEqual([]);
  });

  it("оставляет по одной строке на пользователя — с самой поздней датой истечения", () => {
    const rows = [
      { telegram_id: 1, expires_at: "2026-01-10T00:00:00Z", tag: "old" },
      { telegram_id: 1, expires_at: "2026-02-10T00:00:00Z", tag: "new" },
      { telegram_id: 2, expires_at: "2026-01-15T00:00:00Z", tag: "only" },
    ];
    const result = pickLatestPerUser(rows);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.telegram_id === 1)?.tag).toBe("new");
    expect(result.find((r) => r.telegram_id === 2)?.tag).toBe("only");
  });
});

describe("resolveVipExtension", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("активная подписка: продление считается от текущего срока истечения", () => {
    const sub = { status: "active", expires_at: "2026-07-01T00:00:00Z" };
    const { wasInactive, baseSafe, shortenedPast } = resolveVipExtension(sub, 10, now);
    expect(wasInactive).toBe(false);
    expect(baseSafe.toISOString()).toBe("2026-07-11T00:00:00.000Z");
    expect(shortenedPast).toBe(false);
  });

  it("истёкшая/неактивная подписка: продление считается от «сейчас», не от старой даты", () => {
    const sub = { status: "expired", expires_at: "2026-01-01T00:00:00Z" };
    const { wasInactive, baseSafe } = resolveVipExtension(sub, 10, now);
    expect(wasInactive).toBe(true);
    expect(baseSafe.toISOString()).toBe("2026-06-25T12:00:00.000Z");
  });

  it("active, но expires_at уже в прошлом — тоже считается неактивной (past due)", () => {
    const sub = { status: "active", expires_at: "2026-06-01T00:00:00Z" };
    const { wasInactive, baseSafe } = resolveVipExtension(sub, 5, now);
    expect(wasInactive).toBe(true);
    expect(baseSafe.toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });

  it("уменьшение, уводящее дату в прошлое — помечается shortenedPast", () => {
    const sub = { status: "active", expires_at: "2026-06-16T00:00:00Z" };
    const { shortenedPast, baseSafe } = resolveVipExtension(sub, -2, now);
    expect(shortenedPast).toBe(true);
    expect(baseSafe.getTime()).toBeLessThan(now.getTime());
  });

  it("уменьшение, оставляющее дату в будущем — не помечается shortenedPast", () => {
    const sub = { status: "active", expires_at: "2026-07-01T00:00:00Z" };
    const { shortenedPast } = resolveVipExtension(sub, -2, now);
    expect(shortenedPast).toBe(false);
  });
});
