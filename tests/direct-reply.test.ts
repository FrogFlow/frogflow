import { beforeEach, describe, expect, it, vi } from "vitest";

const updateCalls: unknown[] = [];

function supabaseChain(result: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.update = (value: unknown) => {
    updateCalls.push(value);
    return builder;
  };
  builder.eq = () => builder;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "bot_users") throw new Error(`unexpected table: ${table}`);
      return supabaseChain({ data: { state: {} }, error: null });
    },
  },
}));

const sendZernioInboxMessage = vi.fn();
vi.mock("../src/lib/zernio.server", () => ({ sendZernioInboxMessage }));

beforeEach(() => {
  updateCalls.length = 0;
  sendZernioInboxMessage.mockReset();
});

describe("sendDirectReply", () => {
  it("does not mark an answer as sent when Zernio rejects it", async () => {
    sendZernioInboxMessage.mockResolvedValue({ ok: false, error: "Zernio API Error 403" });
    const { sendDirectReply } = await import("../src/lib/direct-purchase.server");

    const result = await sendDirectReply({
      conversationId: "conversation-1",
      accountId: "account-1",
      userKey: "ig-user-1",
      text: "Чек получил",
      platform: "instagram",
    });

    expect(result).toBe(false);
    expect(sendZernioInboxMessage).toHaveBeenCalledOnce();
    expect(updateCalls).toHaveLength(0);
  });

  it("stores the deduplication marker only after successful delivery", async () => {
    sendZernioInboxMessage.mockResolvedValue({ ok: true });
    const { sendDirectReply } = await import("../src/lib/direct-purchase.server");

    const result = await sendDirectReply({
      conversationId: "conversation-1",
      accountId: "account-1",
      userKey: "ig-user-1",
      text: "Чек получил",
      platform: "instagram",
    });

    expect(result).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      state: { last_reply: expect.any(String), last_reply_at: expect.any(String) },
    });
  });
});
