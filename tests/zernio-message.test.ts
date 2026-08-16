import { describe, it, expect } from "vitest";
import { parseZernioMessage } from "../src/lib/zernio-message";

/**
 * Форма события взята не из головы, а из настоящей записи `zernio_logs` —
 * события `message.received` от 12.08.2026. Ровно на этой форме прежний разбор
 * и промахивался: он читал профиль отправителя из `payload.data`, поля,
 * которого Zernio не присылает вовсе.
 */
const realEvent = {
  id: "f0993c4c-1b7c-4955-80eb-f22034d5a120",
  event: "message.received",
  account: {
    id: "6a698cc9df17280d93c77269",
    platform: "instagram",
    username: "aa_teach_",
    accountId: "6a698cc9df17280d93c77269",
  },
  message: {
    id: "6a7c528b77555aae01003c47",
    text: "Куда вы пришлете материал?",
    isRead: false,
    sender: {
      id: "1564412301739124",
      name: "Анна Венгловская",
      username: "annavenglovskaia",
      contactId: "6a7b1b14e3838f1e952dbc4f",
      instagramProfile: {
        isFollower: true,
        isVerified: false,
        isFollowing: false,
        followerCount: 286,
      },
    },
    sentAt: "2026-08-12T11:01:29.779Z",
    platform: "instagram",
    direction: "incoming" as const,
    attachments: [],
    conversationId: "6a7b1b00d0fe733d1a2ab5b0",
  },
  conversation: {
    id: "6a7b1b00d0fe733d1a2ab5b0",
    participantId: "1564412301739124",
    participantName: "Анна Венгловская",
    participantUsername: "annavenglovskaia",
  },
};

describe("parseZernioMessage", () => {
  it("разбирает настоящее событие целиком", () => {
    const parsed = parseZernioMessage(realEvent);
    expect(parsed.conversationId).toBe("6a7b1b00d0fe733d1a2ab5b0");
    expect(parsed.accountId).toBe("6a698cc9df17280d93c77269");
    expect(parsed.userKey).toBe("ig_1564412301739124");
    expect(parsed.senderUsername).toBe("annavenglovskaia");
    expect(parsed.senderName).toBe("Анна Венгловская");
    expect(parsed.text).toBe("Куда вы пришлете материал?");
  });

  it("забирает профиль подписчика — то самое, что молча терялось", () => {
    const { metadata } = parseZernioMessage(realEvent);
    expect(metadata).toMatchObject({
      isFollower: true,
      isFollowing: false,
      isVerified: false,
      followerCount: 286,
      zernioContactId: "6a7b1b14e3838f1e952dbc4f",
    });
  });

  it("не выдумывает профиль, когда Instagram его не прислал", () => {
    const { metadata } = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1" } },
      account: { accountId: "a1" },
    });
    expect(metadata).toEqual({});
  });

  it("text=null у сообщения с одним вложением читается как пустая строка", () => {
    const { text } = parseZernioMessage({
      event: "message.received",
      message: {
        conversationId: "c1",
        text: null,
        sender: { id: "u1" },
        attachments: [{ type: "image", url: "https://cdn.example/i.jpg" }],
      },
      account: { accountId: "a1" },
    });
    expect(text).toBe("");
  });

  it("нажатие кнопки отдаёт payload, обычное сообщение — null", () => {
    const postback = parseZernioMessage({
      event: "message.received",
      message: {
        conversationId: "c1",
        sender: { id: "u1" },
        metadata: { interactiveType: "postback", interactiveId: "CHECKOUT" },
      },
      account: { accountId: "a1" },
    });
    expect(postback.postbackPayload).toBe("CHECKOUT");
    expect(parseZernioMessage(realEvent).postbackPayload).toBeNull();
  });

  it("подставляет имя, когда Instagram не дал ни имени, ни юзернейма", () => {
    const { senderName, userKey } = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: {} },
      account: { accountId: "a1" },
    });
    expect(senderName).toBe("друг");
    expect(userKey).toBe("ig_unknown");
  });

  it("берёт accountId как канонический, а не id", () => {
    const { accountId } = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1" } },
      account: { id: "запасной", accountId: "канонический" },
    });
    expect(accountId).toBe("канонический");
  });
});
