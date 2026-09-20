import { describe, expect, it } from "vitest";
import { normalizeInboxMessage, type ZernioInboxMessage } from "../src/lib/zernio.server";

/**
 * Zernio отдаёт не больше ста сообщений за раз. С сортировкой по возрастанию
 * это сто ПЕРВЫХ: в живом диалоге BOVI самое свежее исходящее в таком ответе
 * было от 15 сентября, хотя менеджер писал сегодня. Поэтому запрашиваем
 * последние, а порядок наружу восстанавливаем сами.
 */
function sortAscending(messages: ZernioInboxMessage[]): ZernioInboxMessage[] {
  return messages
    .map(normalizeInboxMessage)
    .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
}

describe("порядок сообщений переписки", () => {
  it("ответ от новых к старым разворачивается в хронологический", () => {
    const desc: ZernioInboxMessage[] = [
      { id: "3", message: "третье", createdAt: "2026-09-20T09:12:00.000Z" },
      { id: "2", message: "второе", createdAt: "2026-09-20T09:11:00.000Z" },
      { id: "1", message: "первое", createdAt: "2026-09-20T09:10:00.000Z" },
    ];
    expect(sortAscending(desc).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("ответ уже в хронологическом порядке не портится", () => {
    const asc: ZernioInboxMessage[] = [
      { id: "1", message: "первое", createdAt: "2026-09-20T09:10:00.000Z" },
      { id: "2", message: "второе", createdAt: "2026-09-20T09:11:00.000Z" },
    ];
    expect(sortAscending(asc).map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("последним оказывается самое свежее — его и проверяет защита", () => {
    const mixed: ZernioInboxMessage[] = [
      { id: "old", message: "старое", createdAt: "2026-09-15T19:57:05.464Z", direction: "outgoing" },
      { id: "new", message: "сейчас не работаем", createdAt: "2026-09-20T09:12:20.000Z", direction: "outgoing" },
    ];
    expect(sortAscending(mixed).at(-1)?.id).toBe("new");
  });
});
