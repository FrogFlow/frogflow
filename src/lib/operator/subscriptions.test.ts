import { describe, it, expect } from "vitest";
import {
  computeState,
  readPolicy,
  DEFAULT_POLICY,
  type OverduePolicy,
} from "./subscriptions.server";

/**
 * Состояние подписки решает, предупредить владельца или остановить его бота.
 * Ошибка здесь тихая: даты сходятся на глаз, а клиента приостановили на день
 * раньше или предупредили на день позже. Поэтому проверяются именно границы.
 *
 * Сравнение идёт по календарным дням, а не по моментам: подписка «до 1
 * сентября» не должна протухать в полночь по UTC у клиента в другом поясе.
 */

const policy = (p: Partial<OverduePolicy> = {}): OverduePolicy => ({ ...DEFAULT_POLICY, ...p });
const at = (iso: string) => new Date(iso);

describe("computeState — границы состояний", () => {
  it("без даты — no_data, а не «просрочено»", () => {
    const s = computeState(null, policy(), false);
    expect(s.state).toBe("no_data");
    expect(s.daysLeft).toBeNull();
  });

  it("день в день — ещё не просрочено", () => {
    const s = computeState("2026-09-01T00:00:00Z", policy(), true, at("2026-09-01T23:59:00Z"));
    expect(s.state).toBe("expiring");
    expect(s.daysLeft).toBe(0);
  });

  it("следующий день — уже просрочено", () => {
    const s = computeState("2026-09-01T23:00:00Z", policy(), true, at("2026-09-02T00:01:00Z"));
    expect(s.state).toBe("overdue");
    expect(s.daysLeft).toBe(-1);
  });

  it("далеко до конца — ok", () => {
    const s = computeState("2026-12-31T00:00:00Z", policy(), true, at("2026-09-01T12:00:00Z"));
    expect(s.state).toBe("ok");
  });

  /** warn_days_before = 5: на шестой день ещё «ok», на пятый уже «expiring». */
  it("граница предупреждения", () => {
    const p = policy({ warn_days_before: 5 });
    expect(computeState("2026-09-10T00:00:00Z", p, true, at("2026-09-04T10:00:00Z")).state).toBe(
      "ok",
    );
    expect(computeState("2026-09-10T00:00:00Z", p, true, at("2026-09-05T10:00:00Z")).state).toBe(
      "expiring",
    );
  });

  /** grace_days = 3: три дня просрочки ещё отсрочка, четвёртый — пора применять политику. */
  it("граница отсрочки", () => {
    const p = policy({ grace_days: 3 });
    expect(computeState("2026-09-01T00:00:00Z", p, true, at("2026-09-04T10:00:00Z")).state).toBe(
      "overdue",
    );
    expect(computeState("2026-09-01T00:00:00Z", p, true, at("2026-09-05T10:00:00Z")).state).toBe(
      "grace_over",
    );
  });

  it("нулевая отсрочка — на следующий день сразу grace_over", () => {
    const p = policy({ grace_days: 0 });
    expect(computeState("2026-09-01T00:00:00Z", p, true, at("2026-09-02T10:00:00Z")).state).toBe(
      "grace_over",
    );
  });

  /**
   * Время суток не должно влиять на состояние: у клиента в UTC+6 «сегодня»
   * начинается на шесть часов раньше, и подписка не может истечь дважды.
   */
  it("время суток не меняет состояние в пределах дня", () => {
    const states = ["00:01", "12:00", "23:59"].map(
      (t) => computeState("2026-09-05T00:00:00Z", policy(), true, at(`2026-09-05T${t}:00Z`)).state,
    );
    expect(new Set(states).size).toBe(1);
  });

  it("дата без платежей помечается как неподтверждённая", () => {
    expect(
      computeState("2026-12-31T00:00:00Z", policy(), false, at("2026-09-01T00:00:00Z"))
        .backedByPayments,
    ).toBe(false);
    expect(
      computeState("2026-12-31T00:00:00Z", policy(), true, at("2026-09-01T00:00:00Z"))
        .backedByPayments,
    ).toBe(true);
  });
});

describe("readPolicy — чтение настроек клиента", () => {
  it("пусто — значения по умолчанию", () => {
    expect(readPolicy(null)).toEqual(DEFAULT_POLICY);
    expect(readPolicy({})).toEqual(DEFAULT_POLICY);
  });

  it("suspend распознаётся, всё остальное читается как warn", () => {
    expect(readPolicy({ on_overdue: "suspend" }).on_overdue).toBe("suspend");
    expect(readPolicy({ on_overdue: "warn" }).on_overdue).toBe("warn");
    // Мусор в настройках не должен приводить к остановке бота.
    expect(readPolicy({ on_overdue: "останови" }).on_overdue).toBe("warn");
  });

  it("нечисловые сроки заменяются значениями по умолчанию", () => {
    const p = readPolicy({ warn_days_before: "пять", grace_days: null });
    expect(p.warn_days_before).toBe(DEFAULT_POLICY.warn_days_before);
    expect(p.grace_days).toBe(DEFAULT_POLICY.grace_days);
  });

  it("ноль — настоящее значение, а не «не задано»", () => {
    expect(readPolicy({ grace_days: 0 }).grace_days).toBe(0);
  });
});
