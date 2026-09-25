import { describe, it, expect } from "vitest";
import type { ConsultantProduct } from "../src/lib/consultant/catalog";
import {
  followUpText,
  isFollowUpCandidate,
  modelName,
  recentWithFollowUp,
} from "../src/lib/consultant-v2/follow-up";

/** Одно напоминание пропавшему покупателю — в окне Instagram, не ночью. */

const zeroTwist: ConsultantProduct = {
  id: "zt",
  name: "Uchino Полотенце махровое Zero Twist, 70x140, цвет белый",
  category: "Zero Twist",
  size: "70x140",
  colors: ["белый"],
  price_kzt: 55000,
  stock: true,
};
const now = new Date("2026-09-25T08:00:00Z"); // 13:00 по Алматы
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
const base = {
  conversation_state: "consulting" as const,
  last_product_ids: ["zt"],
  last_bot_reply_at: hoursAgo(4),
};

describe("текст напоминания", () => {
  it("модель без размера и цвета", () => {
    expect(modelName(zeroTwist.name)).toBe("Uchino Полотенце махровое Zero Twist");
    expect(modelName("BOVI КПБ Soho (1 подод 140x200, 1 наволочка 50x75), цвет 275")).toBe(
      "BOVI КПБ Soho",
    );
    expect(followUpText(base, [zeroTwist])).toBe(
      "Остались вопросы по Uchino Полотенце махровое Zero Twist? Подскажу по размеру, цвету или доставке.",
    );
  });

  it("товара из выдачи уже нет в прайсе — напоминания нет", () => {
    expect(followUpText(base, [])).toBeNull();
  });
});

describe("кому напоминать", () => {
  it("разговор о товаре, тишина 4 часа — да", () => {
    expect(isFollowUpCandidate(base, now, false)).toBe(true);
  });

  it("рано, поздно (окно Instagram), ночью, на паузе, после передачи — нет", () => {
    expect(isFollowUpCandidate({ ...base, last_bot_reply_at: hoursAgo(1) }, now, false)).toBe(
      false,
    );
    expect(isFollowUpCandidate({ ...base, last_bot_reply_at: hoursAgo(23.5) }, now, false)).toBe(
      false,
    );
    expect(isFollowUpCandidate(base, now, true)).toBe(false);
    expect(isFollowUpCandidate({ ...base, automation_paused: true }, now, false)).toBe(false);
    expect(isFollowUpCandidate({ ...base, conversation_state: "handed_off" }, now, false)).toBe(
      false,
    );
    expect(isFollowUpCandidate({ ...base, last_product_ids: [] }, now, false)).toBe(false);
  });

  it("одно напоминание на одну паузу", () => {
    expect(
      isFollowUpCandidate({ ...base, v2_followup_for: base.last_bot_reply_at }, now, false),
    ).toBe(false);
  });
});

describe("история", () => {
  it("напоминание — к последней реплике бота, роли чередуются", () => {
    const recent = recentWithFollowUp(
      {
        recent: [
          { role: "customer", text: "Сколько стоит Zero Twist?" },
          { role: "assistant", text: "55 000 ₸." },
        ],
      },
      "Остались вопросы?",
    );
    expect(recent).toEqual([
      { role: "customer", text: "Сколько стоит Zero Twist?" },
      { role: "assistant", text: "55 000 ₸.\n\nОстались вопросы?" },
    ]);
  });
});
