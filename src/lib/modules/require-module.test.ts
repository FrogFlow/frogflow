import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Платный модуль должен отказывать на сервере, а не только прятать пункт меню.
 * До этой проверки тумблеры в панели были косметикой: серверные функции звались
 * напрямую мимо интерфейса. Проверка ручная уже проводилась — здесь она
 * становится постоянной.
 *
 * Подменяем чтение модулей: hasModule ходит в базу за строкой арендатора, а
 * проверять надо решение, а не запрос.
 */
const hasModule = vi.fn<(key: string) => Promise<boolean>>();
vi.mock("./modules.server", () => ({ hasModule: (k: string) => hasModule(k) }));

const requireAdmin = vi.fn<() => Promise<unknown>>();
vi.mock("../admin-session.server", () => ({ requireAdmin: () => requireAdmin() }));

const { requireModule, requireAdminWithModule } = await import("./require-module.server");

beforeEach(() => {
  // Тело в скобках обязательно. Короткая форма вернула бы результат
  // mockReset() — то есть сам мок, — а vitest считает функцию, возвращённую из
  // beforeEach, обработчиком очистки и вызывает её после каждого теста. Мок
  // вызывался бы лишний раз, и в тесте, где он бросает, это ломало прогон.
  hasModule.mockReset();
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue(undefined);
});

describe("requireModule", () => {
  it("модуль подключён — пропускает молча", async () => {
    hasModule.mockResolvedValue(true);
    await expect(requireModule("vip")).resolves.toBeUndefined();
    expect(hasModule).toHaveBeenCalledWith("vip");
  });

  it("модуль не подключён — отказывает", async () => {
    hasModule.mockResolvedValue(false);
    await expect(requireModule("vip")).rejects.toThrow(/не подключ[её]н/i);
  });

  /**
   * В отказе стоит название из реестра, а не ключ: сообщение видит владелец
   * магазина, и «vip» ему ни о чём не говорит.
   */
  it("в отказе — человеческое название модуля", async () => {
    hasModule.mockResolvedValue(false);
    await expect(requireModule("instagram")).rejects.toThrow(/Instagram-автоматизация/);
    await expect(requireModule("blocked")).rejects.toThrow(/Блокировка пользователей/);
  });

  it("проверяется именно запрошенный модуль", async () => {
    hasModule.mockResolvedValue(true);
    await requireModule("blocked");
    expect(hasModule).toHaveBeenCalledTimes(1);
    expect(hasModule).toHaveBeenCalledWith("blocked");
  });

  /**
   * Сбой чтения не должен превращаться в «модуль подключён»: ошибка обязана
   * дойти до вызывающего, иначе недоступная база откроет платные разделы всем.
   */
  it("ошибка чтения не открывает доступ", async () => {
    hasModule.mockImplementation(() => Promise.reject(new Error("база недоступна")));
    await expect(requireModule("vip")).rejects.toThrow(/база недоступна/);
  });
});

/**
 * requireAdmin() + requireModule(key) в одном месте — раньше copy-paste в 7
 * файлах (одинаковое тело, разный ключ модуля в строке).
 */
describe("requireAdminWithModule", () => {
  it("админ и модуль подключён — пропускает", async () => {
    hasModule.mockResolvedValue(true);
    await expect(requireAdminWithModule("vip")).resolves.toBeUndefined();
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(hasModule).toHaveBeenCalledWith("vip");
  });

  it("не админ — отказывает до проверки модуля", async () => {
    requireAdmin.mockRejectedValue(new Error("Unauthorized"));
    await expect(requireAdminWithModule("vip")).rejects.toThrow(/Unauthorized/);
    expect(hasModule).not.toHaveBeenCalled();
  });

  it("админ, но модуль не подключён — отказывает", async () => {
    hasModule.mockResolvedValue(false);
    await expect(requireAdminWithModule("blocked")).rejects.toThrow(/не подключ[её]н/i);
  });
});
