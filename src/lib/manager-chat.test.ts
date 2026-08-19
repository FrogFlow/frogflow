import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * handleManagerChatInbound() — единственная точка, которой bot.server.ts
 * доверяет решение «обрывать ли автоответ». Без теста эта ветка держалась
 * бы только на чтении кода: неверный порядок проверок (модуль/лог/active)
 * тихо либо не пишет сообщения в лог, либо не обрывает автоответ подключённому
 * менеджеру. Мокаются Supabase и hasModule — тем же приёмом, что уже
 * применён в operator/subscription-cron.test.ts.
 */

process.env.BOT_ID = "11111111-1111-1111-1111-111111111111";

let moduleEnabled = true;
vi.mock("./modules/modules.server", () => ({
  hasModule: async (key: string) => key === "manager_chat" && moduleEnabled,
}));

type StateRow = { bot_id: string; telegram_id: number; active: boolean };
let stateStore: StateRow[] = [];
let messagesInserted: Array<{
  telegram_id: number;
  direction: string;
  sender: string;
  text: string;
}> = [];
let rpcCalls: unknown[] = [];

vi.mock("@/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "manager_chat_state") {
        return {
          select: () => ({
            eq: (_col: string, val: number) => ({
              maybeSingle: async () => ({
                data: stateStore.find((r) => r.telegram_id === val) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "manager_chat_messages") {
        return {
          insert: async (row: (typeof messagesInserted)[number]) => {
            messagesInserted.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { error: null };
    },
  },
}));

const { handleManagerChatInbound, isManagerChatBlockingCallbacks } =
  await import("./manager-chat.server");

beforeEach(() => {
  moduleEnabled = true;
  stateStore = [];
  messagesInserted = [];
  rpcCalls = [];
});

describe("handleManagerChatInbound", () => {
  it("does nothing when the module isn't purchased — no DB call, auto-reply proceeds", async () => {
    moduleEnabled = false;
    const result = await handleManagerChatInbound(42, "Привет");
    expect(result).toBe(false);
    expect(messagesInserted).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("logs the customer's message and lets the bot reply when no manager is connected", async () => {
    const result = await handleManagerChatInbound(42, "Где мой заказ?");
    expect(result).toBe(false);
    expect(messagesInserted).toEqual([
      {
        bot_id: process.env.BOT_ID,
        telegram_id: 42,
        direction: "in",
        sender: "customer",
        text: "Где мой заказ?",
      },
    ]);
    expect(rpcCalls).toHaveLength(1);
  });

  it("logs a placeholder for text-less messages (photos, etc.)", async () => {
    await handleManagerChatInbound(42, undefined);
    expect(messagesInserted[0]?.text).toBe("[без текста]");
  });

  it("logs the message but suppresses the auto-reply once a manager is connected", async () => {
    stateStore.push({ bot_id: process.env.BOT_ID!, telegram_id: 42, active: true });
    const result = await handleManagerChatInbound(42, "Ещё вопрос");
    expect(result).toBe(true);
    expect(messagesInserted).toHaveLength(1);
  });
});

describe("isManagerChatBlockingCallbacks", () => {
  it("is false when the module is off, even if a stale active row exists", async () => {
    moduleEnabled = false;
    stateStore.push({ bot_id: process.env.BOT_ID!, telegram_id: 7, active: true });
    expect(await isManagerChatBlockingCallbacks(7)).toBe(false);
  });

  it("mirrors the active flag when the module is on", async () => {
    stateStore.push({ bot_id: process.env.BOT_ID!, telegram_id: 7, active: true });
    expect(await isManagerChatBlockingCallbacks(7)).toBe(true);
    expect(await isManagerChatBlockingCallbacks(8)).toBe(false);
  });
});
