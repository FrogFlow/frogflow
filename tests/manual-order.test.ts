import { describe, expect, it } from "vitest";
import {
  manualCustomerTelegramId,
  manualCustomerUserKey,
  manualOrderStatus,
  manualOrderTotal,
} from "../src/lib/manual-order";
import { formatDateTimeIso } from "../src/lib/datetime";

describe("manualOrderTotal", () => {
  it("складывает позиции и комиссию доставки", () => {
    expect(manualOrderTotal([15000, 2000], 1500)).toBe(18500);
  });

  it("без позиций даёт только доставку", () => {
    expect(manualOrderTotal([], 1500)).toBe(1500);
  });
});

describe("manualOrderStatus", () => {
  it("0 ₸ — ждём оплату, иначе сразу в работу", () => {
    expect(manualOrderStatus(0)).toBe("awaiting_payment");
    expect(manualOrderStatus(3000)).toBe("accepted");
  });
});

describe("manualCustomerTelegramId", () => {
  it("один телефон схлопывается в один id", () => {
    expect(manualCustomerTelegramId("+7 777 123-45-67")).toBe(
      manualCustomerTelegramId("87771234567"),
    );
  });

  it("отрицательный, чтобы не попасть в Telegram-рассылку", () => {
    expect(manualCustomerTelegramId("87771234567")).toBeLessThan(0);
  });

  it("без телефона разные entropy дают разных покупателей", () => {
    expect(manualCustomerTelegramId(null, "a")).not.toBe(manualCustomerTelegramId(null, "b"));
  });

  it("user_key и telegram_id строятся от одного ключа", () => {
    expect(manualCustomerUserKey("87771234567")).toBe("manual:7771234567");
  });
});

describe("formatDateTimeIso", () => {
  it("кладёт полночь UTC в календарный день магазина", () => {
    expect(formatDateTimeIso("2026-01-10T21:00:00.000Z", "Asia/Almaty")).toBe(
      "2026-01-11 02:00:00",
    );
  });
});
