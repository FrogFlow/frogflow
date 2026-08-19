import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOwnTenantStorageKey } from "./tenant-storage-key.server";

const ORIGINAL_BOT_ID = process.env.BOT_ID;
const SELF = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("isOwnTenantStorageKey", () => {
  beforeEach(() => {
    process.env.BOT_ID = SELF;
  });
  afterEach(() => {
    if (ORIGINAL_BOT_ID === undefined) delete process.env.BOT_ID;
    else process.env.BOT_ID = ORIGINAL_BOT_ID;
  });

  it("пропускает ключ со своим bot_id-префиксом", () => {
    expect(isOwnTenantStorageKey(`${SELF}/order-1/123.jpg`)).toBe(true);
  });

  it("отклоняет ключ с чужим bot_id-префиксом", () => {
    expect(isOwnTenantStorageKey(`${OTHER}/order-1/123.jpg`)).toBe(false);
  });

  it("пропускает ключ без префикса — файлы, залитые до этой правки", () => {
    expect(isOwnTenantStorageKey("order-1/123.jpg")).toBe(true);
  });

  it("сравнение с bot_id-префиксом регистронезависимое", () => {
    expect(isOwnTenantStorageKey(`${SELF.toUpperCase()}/order-1/123.jpg`)).toBe(true);
  });

  it("отклоняет чужой префикс, даже если BOT_ID на деплое не задан", () => {
    delete process.env.BOT_ID;
    expect(isOwnTenantStorageKey(`${OTHER}/order-1/123.jpg`)).toBe(false);
  });
});
