import { describe, expect, it } from "vitest";
import { HANDOFF_TO_MANAGER_REPLY } from "../src/lib/consultant/copy";
import { cleanForbiddenPhrases } from "../src/lib/consultant/validate";
import { stripExclamationsAndEmoji } from "../src/lib/consultant/style";

/**
 * Продавец после первой ночи работы: «бот должен просто сообщить, что передаст
 * вопрос менеджеру. После этого не нужно продолжать диалог и задавать вопросы
 * вроде „есть ли у вас ещё вопросы?“ — если запрос передан менеджеру, дальше
 * диалог должен подхватить человек».
 *
 * Один и тот же текст на три случая: просьба о фото, голосовое и вопрос без
 * ответа. Разные формулировки на одно и то же действие только путали бы.
 */
describe("единый ответ при передаче менеджеру", () => {
  it("говорит ровно то, о чём просил продавец", () => {
    expect(HANDOFF_TO_MANAGER_REPLY).toContain("передам ваш вопрос менеджеру");
    expect(HANDOFF_TO_MANAGER_REPLY).toContain("свяжется");
  });

  it("не продолжает разговор", () => {
    // Ни вопроса в конце, ни предложения помочь с чем-то ещё.
    expect(HANDOFF_TO_MANAGER_REPLY).not.toContain("?");
    expect(HANDOFF_TO_MANAGER_REPLY).not.toMatch(/ещё|еще|помочь|вернусь/i);
  });

  it("переживает общую чистку текста без потерь", () => {
    // Запрет восклицаний и эмодзи — более раннее требование того же продавца,
    // поэтому «Спасибо!» из его формулировки записано без знака.
    expect(stripExclamationsAndEmoji(HANDOFF_TO_MANAGER_REPLY)).toBe(HANDOFF_TO_MANAGER_REPLY);
    // Фильтр штампов ловит «передаю менеджеру» — наша формулировка в будущем
    // времени и под него не попадает.
    expect(cleanForbiddenPhrases(HANDOFF_TO_MANAGER_REPLY)).toBe(HANDOFF_TO_MANAGER_REPLY);
  });
});
