import { describe, expect, it } from "vitest";
import { instagramDigitalMissingEmail, orderPlatform } from "../src/lib/order-platform";

describe("orderPlatform", () => {
  it("keeps Instagram and WhatsApp orders in their own channels", () => {
    expect(orderPlatform("instagram")).toBe("instagram");
    expect(orderPlatform("whatsapp")).toBe("whatsapp");
    expect(orderPlatform("manual")).toBe("manual");
  });

  it("treats legacy and unknown orders as Telegram", () => {
    expect(orderPlatform(null)).toBe("telegram");
    expect(orderPlatform(undefined)).toBe("telegram");
    expect(orderPlatform("telegram")).toBe("telegram");
    expect(orderPlatform("unknown")).toBe("telegram");
  });
});

describe("instagramDigitalMissingEmail", () => {
  it("ждёт почту только у цифрового Instagram-заказа без адреса", () => {
    expect(
      instagramDigitalMissingEmail({
        platform: "instagram",
        fulfillment_kind: "digital",
        customer_email: null,
      }),
    ).toBe(true);
    expect(
      instagramDigitalMissingEmail({
        platform: "instagram",
        fulfillment_kind: "digital",
        customer_email: "  ",
      }),
    ).toBe(true);
  });

  it("не блокирует Telegram, WhatsApp, физический заказ и уже указанную почту", () => {
    expect(
      instagramDigitalMissingEmail({
        platform: "instagram",
        fulfillment_kind: "digital",
        customer_email: "a@b.c",
      }),
    ).toBe(false);
    expect(
      instagramDigitalMissingEmail({
        platform: "instagram",
        fulfillment_kind: "physical",
        customer_email: null,
      }),
    ).toBe(false);
    expect(
      instagramDigitalMissingEmail({
        platform: "whatsapp",
        fulfillment_kind: "digital",
        customer_email: null,
      }),
    ).toBe(false);
    expect(
      instagramDigitalMissingEmail({
        platform: "telegram",
        fulfillment_kind: "digital",
        customer_email: null,
      }),
    ).toBe(false);
  });
});
