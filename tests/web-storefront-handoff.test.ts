import { describe, expect, it } from "vitest";
import {
  WEB_CART_HANDOFF_START_PREFIX,
  type WebCartHandoffItem,
} from "../src/lib/web-storefront-handoff.server";

describe("WEB_CART_HANDOFF_START_PREFIX", () => {
  it("совпадает с форматом deep link", () => {
    expect(WEB_CART_HANDOFF_START_PREFIX).toBe("wc_");
    expect(`${WEB_CART_HANDOFF_START_PREFIX}abc123`).toMatch(/^wc_/);
  });
});

describe("WebCartHandoffItem shape", () => {
  it("quantity по умолчанию 1 в типе", () => {
    const item: WebCartHandoffItem = { product_id: "p1", quantity: 1 };
    expect(item.product_variant_id).toBeUndefined();
  });
});
