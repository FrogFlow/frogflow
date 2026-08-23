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

  it("использует Mongo-style _id, если accountId и id отсутствуют", () => {
    const { accountId } = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1" } },
      account: { _id: "mongo-account-id" },
    });
    expect(accountId).toBe("mongo-account-id");
  });
});

/**
 * Нажатия кнопок и строк списка — с настоящих событий из `zernio_logs`.
 *
 * Прежняя версия этих тестов была написана по выдуманной форме: `metadata`
 * лежал внутри `message`. Тесты зеленели, а продукт не работал — в 11 476
 * сохранённых событиях `message.metadata` не встречается ни разу, ни на одной
 * платформе. Zernio кладёт метаданные в корень события, и ключи у платформ
 * разные:
 *
 *   Instagram — `postbackPayload`;
 *   WhatsApp  — `interactiveId` при `interactiveType` = list_reply/button_reply.
 *
 * Цена ошибки: в WhatsApp бот «зависал» после выбора категории, в Instagram
 * кнопки молчали всё время — 38 настоящих нажатий за две недели без единого
 * ответа. Ровно то, о чём предупреждает комментарий в шапке разбора: такое
 * ловит только тест на настоящей форме события.
 *
 * Формы ниже скопированы из журнала дословно, включая то, что подпись кнопки
 * дублируется в `message.text`.
 */
describe("parseZernioMessage — нажатия", () => {
  /** Событие 2026-08-21T22:02:49Z, выбор строки списка в каталоге. */
  const waListReply = {
    event: "message.received",
    account: {
      id: "6a80f53e77555aae0129893e",
      accountId: "6a80f53e77555aae0129893e",
      platform: "whatsapp",
      username: "+7 700 510 2751",
    },
    message: {
      id: "6a88cb0a77555aae01248f8e",
      text: "⛺ ЛАГЕРЬ И ВНЕУРОЧКА",
      platform: "whatsapp",
      direction: "incoming" as const,
      sender: { id: "77056682751", name: "Яков" },
      conversationId: "6a80f5503d30e4d0048a4d54",
    },
    metadata: {
      interactiveId: "CAT:e37096e4-195b-4fde-9a41-effff658fe01:0",
      interactiveType: "list_reply",
      quotedMessageId: "wamid.HBgL…",
    },
    conversation: { id: "6a80f5503d30e4d0048a4d54", participantId: "77056682751" },
  };

  /** Событие из журнала: нажатие «Оформить заказ» в Instagram Direct. */
  const igPostback = {
    event: "message.received",
    account: { accountId: "6a698cc9df17280d93c77269", platform: "instagram" },
    message: {
      text: "Тапсырысты рәсімдеу",
      sender: { id: "1564412301739124" },
      conversationId: "6a7b1b00d0fe733d1a2ab5b0",
    },
    metadata: { postbackPayload: "CHECKOUT", postbackTitle: "Тапсырысты рәсімдеу" },
  };

  it("строка списка WhatsApp читается из корня события", () => {
    const parsed = parseZernioMessage(waListReply);
    expect(parsed.platform).toBe("whatsapp");
    expect(parsed.userKey).toBe("wa_77056682751");
    expect(parsed.senderPhone).toBe("77056682751");
    expect(parsed.postbackPayload).toBe("CAT:e37096e4-195b-4fde-9a41-effff658fe01:0");
  });

  it("подпись строки приходит текстом и остаётся в text, не подменяя payload", () => {
    // Обработчик обязан различать эти два поля: подпись — не реплика
    // покупателя, и скармливать её шагу сценария нельзя.
    const parsed = parseZernioMessage(waListReply);
    expect(parsed.text).toBe("⛺ ЛАГЕРЬ И ВНЕУРОЧКА");
    expect(parsed.postbackPayload).not.toBe(parsed.text);
  });

  it("кнопка Instagram читается по своему ключу postbackPayload", () => {
    const parsed = parseZernioMessage(igPostback);
    expect(parsed.platform).toBe("instagram");
    expect(parsed.postbackPayload).toBe("CHECKOUT");
    expect(parsed.text).toBe("Тапсырысты рәсімдеу");
  });

  it("кнопка чужой автоматизации Zernio отдаётся как есть", () => {
    // `ACT::…` присылают родные Comment-to-DM автоматизации. Их наш бот не
    // обслуживает, но обязан узнать, чтобы не принять подпись за реплику.
    const parsed = parseZernioMessage({
      ...igPostback,
      message: { ...igPostback.message, text: "Я подписался (ась)" },
      metadata: {
        postbackPayload: "ACT::cc82e5ebd3b465e3243fde66982ba8d0",
        postbackTitle: "Я подписался (ась)",
      },
    });
    expect(parsed.postbackPayload).toBe("ACT::cc82e5ebd3b465e3243fde66982ba8d0");
  });

  it("кнопка WhatsApp (button_reply) читается так же, как строка списка", () => {
    const parsed = parseZernioMessage({
      ...waListReply,
      message: { ...waListReply.message, text: "В корзину" },
      metadata: { interactiveType: "button_reply", interactiveId: "BUY:42" },
    });
    expect(parsed.postbackPayload).toBe("BUY:42");
  });

  it("запасное чтение из message.metadata работает, если форма вернётся", () => {
    const { metadata, ...withoutTopLevel } = waListReply;
    const parsed = parseZernioMessage({
      ...withoutTopLevel,
      message: { ...waListReply.message, metadata },
    });
    expect(parsed.postbackPayload).toBe("CAT:e37096e4-195b-4fde-9a41-effff658fe01:0");
  });

  it("обычное сообщение нажатием не считается", () => {
    const parsed = parseZernioMessage({
      ...waListReply,
      metadata: undefined,
      message: { ...waListReply.message, text: "Здравствуйте" },
    });
    expect(parsed.postbackPayload).toBeNull();
    expect(parsed.text).toBe("Здравствуйте");
  });

  it("нативная корзина Meta разбирается из корня события", () => {
    const parsed = parseZernioMessage({
      ...waListReply,
      message: { ...waListReply.message, text: null },
      metadata: {
        order: {
          catalog_id: "194836987003835",
          text: "срочно",
          product_items: [
            { product_retailer_id: "sku-1", quantity: 2, item_price: 1500, currency: "KZT" },
          ],
        },
      },
    });
    expect(parsed.nativeOrder).toEqual({
      catalogId: "194836987003835",
      note: "срочно",
      items: [{ retailerId: "sku-1", quantity: 2, price: 1500, currency: "KZT" }],
    });
  });

  it("неизвестная платформа не роняет разбор и считается instagram", () => {
    const parsed = parseZernioMessage({
      event: "message.received",
      message: { conversationId: "c1", sender: { id: "u1" } },
      account: { accountId: "a1", platform: "tiktok" },
    });
    expect(parsed.platform).toBe("instagram");
    expect(parsed.userKey).toBe("ig_u1");
  });
});
