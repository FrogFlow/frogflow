import { describe, expect, it } from "vitest";
import { parseZernioMessage } from "../src/lib/zernio-message";

/**
 * Формы взяты из живых событий BOVI, а не придуманы.
 *
 * Покупатель ответил на сторис «Здравствуйте. Можно узнать стоимость» и
 * получил вопрос про страну вместо цены. Разбор вебхука эту форму знал, но
 * событие пришло опросом инбокса, где её не читали. Ответ на рилс не
 * распознавался вовсе ни одним из путей.
 */
const base = {
  event: "message.received",
  account: { platform: "instagram", accountId: "acc1" },
  conversation: { id: "conv1" },
};

describe("ответ на сторис", () => {
  it("читается из metadata.storyReply — настоящей формы Zernio", () => {
    const parsed = parseZernioMessage({
      ...base,
      metadata: {
        storyReply: {
          storyId: "18630872026051195",
          storyUrl: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=18630872026051195",
        },
      },
      message: { id: "m1", text: "Здравствуйте. Можно узнать стоимость", sender: { id: "u1" } },
    } as never);
    expect(parsed.storyId).toBe("18630872026051195");
    expect(parsed.storyMediaUrl).toContain("asset_id=18630872026051195");
  });
});

describe("ответ на рилс", () => {
  it("читается из вложения: reel_video_id и ссылка на рилс", () => {
    const parsed = parseZernioMessage({
      ...base,
      message: {
        id: "m2",
        text: "",
        sender: { id: "u2" },
        attachments: [
          {
            type: "video",
            url: "https://www.instagram.com/reel/Dcaih_PMAZ2/",
            payload: {
              url: "https://www.instagram.com/reel/Dcaih_PMAZ2/",
              reel_video_id: "18113576638999210",
              title: "Почему эти голландские полотенца раскупают быстрее",
            },
          },
        ],
      },
    } as never);
    // Идентификатором становится шорткод из ссылки, а не числовой
    // reel_video_id: именно шорткод кладёт в привязку панель, когда продавец
    // вставляет туда ссылку на рилс. Чтение reel_video_id остаётся запасным
    // путём — на случай вложения без разбираемой ссылки.
    expect(parsed.storyId).toBe("Dcaih_PMAZ2");
    expect(parsed.storyMediaUrl).toBe("https://www.instagram.com/reel/Dcaih_PMAZ2/");
  });

  it("без ссылки берётся числовой reel_video_id", () => {
    const parsed = parseZernioMessage({
      ...base,
      message: {
        id: "m2b",
        text: "",
        sender: { id: "u2" },
        attachments: [{ type: "video", payload: { reel_video_id: "18113576638999210" } }],
      },
    } as never);
    expect(parsed.storyId).toBe("18113576638999210");
  });

  it("присланное покупателем фото идентификатором публикации не становится", () => {
    const parsed = parseZernioMessage({
      ...base,
      message: {
        id: "m3",
        text: "вот такое хочу",
        sender: { id: "u3" },
        attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/some-photo.jpg", payload: {} }],
      },
    } as never);
    // Фото покупателя — не публикация. Раньше ссылка попадала в
    // storyMediaUrl, поиск привязки ничего не находил и подставлял последнюю
    // отмеченную публикацию (24.09: коврики Kleen-Tex на фото полотенец).
    expect(parsed.storyId).toBeNull();
    expect(parsed.storyMediaUrl).toBeNull();
  });

  it("живое событие 24.09: фото из директа (lookaside, asset_id) — не публикация", () => {
    const url =
      "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=919539860941147&signature=Ab1QUikU";
    const parsed = parseZernioMessage({
      ...base,
      message: {
        id: "m5",
        text: null,
        sender: { id: "u5" },
        attachments: [{ type: "image", url, payload: { url } }],
      },
    } as never);
    expect(parsed.storyId).toBeNull();
    expect(parsed.storyMediaUrl).toBeNull();
  });
});

describe("обычное сообщение", () => {
  it("контекста публикации не получает", () => {
    const parsed = parseZernioMessage({
      ...base,
      message: { id: "m4", text: "Добрый день, у вас опт есть?", sender: { id: "u4" } },
    } as never);
    expect(parsed.storyId).toBeNull();
    expect(parsed.storyMediaUrl).toBeNull();
  });
});
