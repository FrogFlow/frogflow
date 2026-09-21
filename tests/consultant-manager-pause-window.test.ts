import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANAGER_PAUSE_HOURS,
  MAX_MANAGER_PAUSE_HOURS,
  MIN_MANAGER_PAUSE_HOURS,
  managerPauseExpired,
  managerPauseMs,
  normalizeManagerPauseHours,
} from "../src/lib/consultant/manager-guard";

const HOUR = 60 * 60 * 1000;

/**
 * Продавец спросил, можно ли снизить 12 часов. Можно, и цифра ушла в
 * настройки: это его компромисс, не наш. Короткое окно рискует тем, что бот
 * вклинится в разговор, который менеджер ещё ведёт; длинное — тем, что
 * вернувшийся вечером покупатель останется без ответа.
 */
describe("окно паузы после менеджера", () => {
  it("по умолчанию шесть часов вместо зашитых двенадцати", () => {
    expect(DEFAULT_MANAGER_PAUSE_HOURS).toBe(6);
    expect(managerPauseMs(DEFAULT_MANAGER_PAUSE_HOURS)).toBe(6 * HOUR);
  });

  it("берёт значение из настроек, включая строку из поля панели", () => {
    expect(normalizeManagerPauseHours(3)).toBe(3);
    expect(normalizeManagerPauseHours("3")).toBe(3);
    expect(normalizeManagerPauseHours("2,5")).toBe(2.5);
  });

  it("держит значение в границах, а мусор заменяет умолчанием", () => {
    expect(normalizeManagerPauseHours(0)).toBe(DEFAULT_MANAGER_PAUSE_HOURS);
    expect(normalizeManagerPauseHours(-5)).toBe(DEFAULT_MANAGER_PAUSE_HOURS);
    expect(normalizeManagerPauseHours("сколько-то")).toBe(DEFAULT_MANAGER_PAUSE_HOURS);
    expect(normalizeManagerPauseHours(null)).toBe(DEFAULT_MANAGER_PAUSE_HOURS);
    expect(normalizeManagerPauseHours(0.2)).toBe(MIN_MANAGER_PAUSE_HOURS);
    expect(normalizeManagerPauseHours(100)).toBe(MAX_MANAGER_PAUSE_HOURS);
  });
});

describe("когда пауза истекла", () => {
  const now = Date.parse("2026-09-21T20:00:00.000Z");
  const ago = (h: number) => new Date(now - h * HOUR).toISOString();

  it("отсчёт идёт от последнего сообщения менеджера", () => {
    expect(managerPauseExpired(ago(7), 6 * HOUR, now)).toBe(true);
    expect(managerPauseExpired(ago(5), 6 * HOUR, now)).toBe(false);
  });

  it("свежий ответ менеджера начинает отсчёт заново", () => {
    // Менеджер писал пять часов назад и ответил ещё раз десять минут назад:
    // считаем по последнему, иначе бот вклинится в живой разговор.
    expect(managerPauseExpired(ago(10 / 60), 6 * HOUR, now)).toBe(false);
  });

  it("на сниженном окне бот просыпается раньше", () => {
    const outgoing = ago(4);
    expect(managerPauseExpired(outgoing, 6 * HOUR, now)).toBe(false);
    expect(managerPauseExpired(outgoing, 3 * HOUR, now)).toBe(true);
  });

  it("без времени последнего исходящего судить не о чем — молчим", () => {
    // Zernio не отдал время: снять паузу вслепую хуже, чем подождать.
    expect(managerPauseExpired(undefined, 6 * HOUR, now)).toBe(false);
    expect(managerPauseExpired("", 6 * HOUR, now)).toBe(false);
    expect(managerPauseExpired("не дата", 6 * HOUR, now)).toBe(false);
    expect(managerPauseExpired(0, 6 * HOUR, now)).toBe(false);
  });
});
