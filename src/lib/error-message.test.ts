import { describe, it, expect } from "vitest";
import { errorMessage } from "./error-message";

/**
 * Эта функция стоит на входе почти каждого catch-блока в панели — плохой
 * текст здесь означает, что живая ошибка ("Не удалось загрузить
 * комментарии: ...") превращается в бесполезное "[object Object]" вместо
 * того, что реально пошло не так (см. живую жалобу: createServerFn иногда
 * отклоняется обычным объектом, а не Error).
 */
describe("errorMessage", () => {
  it("настоящий Error — message как есть", () => {
    expect(errorMessage(new Error("боевая ошибка"))).toBe("боевая ошибка");
  });

  it("объект с message — не Error, но текст есть", () => {
    expect(errorMessage({ message: "упало на RPC" })).toBe("упало на RPC");
  });

  it("объект с error (форма ошибок Zernio) — тоже читается", () => {
    expect(errorMessage({ error: "Invalid input" })).toBe("Invalid input");
  });

  it("message в приоритете над error, если оба есть", () => {
    expect(errorMessage({ message: "из message", error: "из error" })).toBe("из message");
  });

  it("объект без message/error — сериализуется в JSON, не в [object Object]", () => {
    expect(errorMessage({ code: 500, detail: "boom" })).toBe('{"code":500,"detail":"boom"}');
  });

  it("пустая строка в message не считается текстом — идёт дальше", () => {
    expect(errorMessage({ message: "", error: "запасной текст" })).toBe("запасной текст");
  });

  it("строка и число — просто String()", () => {
    expect(errorMessage("голая строка")).toBe("голая строка");
    expect(errorMessage(42)).toBe("42");
  });

  it("null/undefined не роняют функцию", () => {
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("циклическая структура — не падает на JSON.stringify, отдаёт String(e)", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(errorMessage(cyclic)).toBe(String(cyclic));
  });
});
