import { describe, expect, it } from "vitest";
import { orderPlatform } from "../src/lib/order-platform";

describe("orderPlatform", () => {
  it("keeps Instagram and WhatsApp orders in their own channels", () => {
    expect(orderPlatform("instagram")).toBe("instagram");
    expect(orderPlatform("whatsapp")).toBe("whatsapp");
  });

  it("treats legacy and unknown orders as Telegram", () => {
    expect(orderPlatform(null)).toBe("telegram");
    expect(orderPlatform(undefined)).toBe("telegram");
    expect(orderPlatform("telegram")).toBe("telegram");
    expect(orderPlatform("unknown")).toBe("telegram");
  });
});
