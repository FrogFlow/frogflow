import { describe, expect, it } from "vitest";
import { buildInstagramInboxMessageBody } from "../src/lib/zernio.server";

describe("buildInstagramInboxMessageBody", () => {
  it("does not attach a message tag to a regular Direct reply", () => {
    const body = buildInstagramInboxMessageBody("account-1", "hello");

    expect(body).toEqual({ accountId: "account-1", message: "hello" });
    expect(body).not.toHaveProperty("messagingType");
    expect(body).not.toHaveProperty("messageTag");
  });
});
