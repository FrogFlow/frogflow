import { describe, expect, it } from "vitest";
import {
  asksForPhotoOnly,
  asksForProductPhoto,
  hasAnswerableQuestion,
} from "../src/lib/consultant/validate";

/**
 * Продавец о живом диалоге: «здесь конкретный вопрос с фотографией — можно
 * написать ответ по размерам и цене и сказать, что фото пришлёт менеджер».
 *
 * То есть просьбу о фото молча отдавать человеку можно только тогда, когда
 * кроме неё в сообщении ничего нет. Иначе ответ, который у бота есть,
 * теряется, а покупатель ждёт менеджера ради того, что можно сказать сразу.
 */
describe("вопрос с фотографией внутри", () => {
  const live = "Здравствуйте, какие есть коврики в ванную фото, размеры и цены, пожалуйста";

  it("та самая фраза: просьба о фото есть, но отвечать есть чем", () => {
    expect(asksForProductPhoto(live)).toBe(true);
    expect(hasAnswerableQuestion(live)).toBe(true);
    expect(asksForPhotoOnly(live)).toBe(false);
  });

  it("другие вопросы с фото внутри", () => {
    for (const q of [
      "Можно фото и цену этого матраса?",
      "Скиньте фотки и размеры полотенец",
      "Есть фото? И сколько стоит?",
      "Пришлите картинки, какие расцветки есть",
    ]) {
      expect(asksForPhotoOnly(q), q).toBe(false);
    }
  });
});

describe("чистая просьба о фото", () => {
  it("передаётся человеку молча — отвечать нечем", () => {
    for (const q of [
      "Можно их видео или фото?",
      "Скиньте фотки пожалуйста",
      "Есть фото в интерьере?",
      "Пришлите видео как выглядит",
    ]) {
      expect(asksForPhotoOnly(q), q).toBe(true);
    }
  });

  it("сообщение без просьбы о фото сюда не попадает вовсе", () => {
    expect(asksForPhotoOnly("Какие есть коврики и цены?")).toBe(false);
    expect(asksForPhotoOnly("Здравствуйте")).toBe(false);
  });
});

describe("приписка про фото", () => {
  it("не продолжает разговор и не извиняется", async () => {
    const { PHOTO_FROM_MANAGER_NOTE } = await import("../src/lib/consultant/copy");
    expect(PHOTO_FROM_MANAGER_NOTE).toMatch(/пришл[её]т менеджер/i);
    expect(PHOTO_FROM_MANAGER_NOTE).not.toContain("?");
    // Извинения за отсутствие фото продавцу не нужны: раньше бот писал «к
    // сожалению, я не могу отправлять фото» и звал в бутик вместо ответа.
    expect(PHOTO_FROM_MANAGER_NOTE).not.toMatch(/сожал|не\s+могу|бутик/i);
  });

  it("переживает чистку текста без потерь", async () => {
    const { PHOTO_FROM_MANAGER_NOTE } = await import("../src/lib/consultant/copy");
    const { stripExclamationsAndEmoji } = await import("../src/lib/consultant/style");
    const { cleanUpsellPressure } = await import("../src/lib/consultant/validate");
    expect(stripExclamationsAndEmoji(PHOTO_FROM_MANAGER_NOTE)).toBe(PHOTO_FROM_MANAGER_NOTE);
    expect(cleanUpsellPressure(PHOTO_FROM_MANAGER_NOTE)).toBe(PHOTO_FROM_MANAGER_NOTE);
  });
});
