import { describe, expect, it } from "vitest";
import { normalizeInboxMessage } from "../src/lib/zernio.server";
import { findManagerMessage } from "../src/lib/consultant/manager-guard";
import type { ConsultantState } from "../src/lib/consultant/state";

/**
 * Zernio присылает текст сообщения под именем text, а время под sentAt —
 * это видно в журнале вебхуков (поля id, text, isRead, sender, sentAt,
 * sentVia, platform, direction). Весь наш код читал message и createdAt, то
 * есть для него такое сообщение было пустым. Отсюда и бот, не замечающий
 * менеджера: сообщений в переписке он «не видел» вовсе.
 */
describe("форма сообщения из переписки Zernio", () => {
  it("текст и время читаются под обоими именами", () => {
    const fromWebhookShape = normalizeInboxMessage({
      id: "1",
      text: "сейчас не работаем",
      sentAt: "2026-09-20T09:12:20.000Z",
      direction: "outgoing",
    });
    expect(fromWebhookShape.message).toBe("сейчас не работаем");
    expect(fromWebhookShape.createdAt).toBe("2026-09-20T09:12:20.000Z");

    const oldShape = normalizeInboxMessage({
      id: "2",
      message: "здравствуйте",
      createdAt: "2026-09-20T09:00:00.000Z",
      direction: "incoming",
    });
    expect(oldShape.message).toBe("здравствуйте");
    expect(oldShape.createdAt).toBe("2026-09-20T09:00:00.000Z");
  });

  it("менеджер находится и в сообщении из вебхучной формы", () => {
    const state: ConsultantState = {
      last_bot_reply: "У нас в наличии полотенца разных размеров",
      last_bot_reply_at: "2026-09-19T20:07:35.000Z",
    };
    const raw = [
      { id: "1", text: "сейчас не работаем", sentAt: "2026-09-20T09:12:20.000Z", direction: "outgoing" as const },
      { id: "2", text: "А окей", sentAt: "2026-09-20T09:12:39.000Z", direction: "incoming" as const },
    ];
    // Без нормализации сообщение пустое и менеджер не находится.
    expect(findManagerMessage(raw, state, Date.parse("2026-09-20T09:12:45.000Z"))).toBeNull();
    // После нормализации — находится.
    const found = findManagerMessage(
      raw.map(normalizeInboxMessage),
      state,
      Date.parse("2026-09-20T09:12:45.000Z"),
    );
    expect(found?.text).toBe("сейчас не работаем");
  });
});
