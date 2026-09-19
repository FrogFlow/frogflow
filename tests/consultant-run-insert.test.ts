import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  upserts: [] as { table: string; row: Record<string, unknown>; options: unknown }[],
}));

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, options: unknown) => {
        store.upserts.push({ table, row, options });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const { recordConsultantRun } = await import("../src/lib/consultant/runs");

/**
 * Проверить запись на живой базе из тестов нельзя, поэтому сверяем форму
 * строки с тем, что разрешает миграция 69: имя таблицы, ключ конфликта и
 * значения колонок со списком допустимых (CHECK).
 */
const ALLOWED_STATUS = ["received", "processing", "replied", "retryable_failed", "terminal_failed", "cancelled"];
const ALLOWED_DIRECTION = ["incoming", "outgoing"];
const ALLOWED_SOURCE = ["webhook", "poll", "admin_test"];

describe("строка журнала сообщений", () => {
  beforeEach(() => {
    store.upserts.length = 0;
    process.env.BOT_ID = "11111111-2222-3333-4444-555555555555";
  });

  it("пишет в consultant_message_runs с ключом магазин + сообщение", async () => {
    await recordConsultantRun({
      messageId: "mid_1",
      conversationId: "conv_1",
      accountId: "acc_1",
      userKey: "ig:user",
      source: "webhook",
      incomingText: "есть полотенца?",
      replyText: "Есть, какой размер?",
      replyKind: "product",
      model: "claude-haiku-4-5-20251001",
      usage: {
        inputTokens: 3000,
        outputTokens: 130,
        cacheCreationTokens: 0,
        cacheReadTokens: 90_000,
      },
    });
    const write = store.upserts.at(-1);
    expect(write?.table).toBe("consultant_message_runs");
    expect(write?.options).toEqual({ onConflict: "bot_id,message_id" });
    const row = write?.row as Record<string, string>;
    expect(row.bot_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(row.message_id).toBe("mid_1");
    expect(ALLOWED_STATUS).toContain(row.status);
    expect(ALLOWED_DIRECTION).toContain(row.direction);
    expect(ALLOWED_SOURCE).toContain(row.source);
    const usage = write?.row.token_usage as Record<string, number>;
    expect(usage.cache_read).toBe(90_000);
    expect(usage.usd).toBeGreaterThan(0);
  });

  it("ошибка ответа пишется отдельным статусом", async () => {
    await recordConsultantRun({
      messageId: "mid_2",
      conversationId: "conv_1",
      userKey: "ig:user",
      source: "poll",
      errorCode: "anthropic_529",
    });
    const row = store.upserts.at(-1)?.row as Record<string, unknown>;
    expect(row.status).toBe("terminal_failed");
    expect(row.sent_at).toBeNull();
    expect(row.token_usage).toEqual({});
  });

  it("без BOT_ID ничего не пишет и не падает", async () => {
    delete process.env.BOT_ID;
    await recordConsultantRun({
      messageId: "mid_3",
      conversationId: "conv_1",
      userKey: "ig:user",
      source: "webhook",
    });
    expect(store.upserts).toHaveLength(0);
  });
});
