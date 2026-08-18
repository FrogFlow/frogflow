import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * handleZernioAccountDisconnected — единственный способ узнать, что бот в
 * Direct молча перестал отвечать (истёкший или отозванный токен Zernio).
 * Проверяется мокками: сама функция чистая с точки зрения побочных
 * эффектов (app_settings + Telegram), а не завязана на семантику PostgREST,
 * как CAS в direct-purchase.server.ts, — мокать здесь безопасно и достаточно.
 */

const settingsStore = new Map<string, string>();
const sentMessages: Array<{ chat_id: string; text: string }> = [];
const keyOf = (botId: string, key: string) => `${botId}::${key}`;

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "app_settings") throw new Error(`неожиданная таблица в моке: ${table}`);
      return {
        select: () => {
          const filters: Record<string, string> = {};
          const builder = {
            eq: (col: string, val: string) => {
              filters[col] = val;
              return builder;
            },
            maybeSingle: async () => {
              const value = settingsStore.get(keyOf(filters.bot_id, filters.key));
              return { data: value !== undefined ? { value } : null, error: null };
            },
          };
          return builder;
        },
        upsert: async (row: { bot_id: string; key: string; value: string }) => {
          settingsStore.set(keyOf(row.bot_id, row.key), row.value);
          return { data: null, error: null };
        },
      };
    },
  },
}));

vi.mock("../src/lib/telegram.server", () => ({
  tg: vi.fn(async (_method: string, params: { chat_id: string; text: string }) => {
    sentMessages.push(params);
    return { ok: true };
  }),
}));

beforeEach(() => {
  settingsStore.clear();
  sentMessages.length = 0;
  process.env.BOT_ID = "bot-1";
});

describe("handleZernioAccountDisconnected", () => {
  it("уведомляет продавца по всем адресам из admin_chat_id", async () => {
    settingsStore.set(keyOf("bot-1", "admin_chat_id"), "111,222");
    const { handleZernioAccountDisconnected } = await import("../src/lib/zernio-bot.server");
    await handleZernioAccountDisconnected({ account: { accountId: "acc-1", username: "shop" } });

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages.map((m) => m.chat_id)).toEqual(["111", "222"]);
    expect(sentMessages[0].text).toContain("@shop");
  });

  it("без настроенного admin_chat_id ничего не отправляет", async () => {
    const { handleZernioAccountDisconnected } = await import("../src/lib/zernio-bot.server");
    await handleZernioAccountDisconnected({ account: { accountId: "acc-1" } });
    expect(sentMessages).toHaveLength(0);
  });

  it("не повторяет уведомление о том же аккаунте раньше шести часов", async () => {
    settingsStore.set(keyOf("bot-1", "admin_chat_id"), "111");
    const { handleZernioAccountDisconnected } = await import("../src/lib/zernio-bot.server");

    await handleZernioAccountDisconnected({ account: { accountId: "acc-1" } });
    expect(sentMessages).toHaveLength(1);

    await handleZernioAccountDisconnected({ account: { accountId: "acc-1" } });
    expect(sentMessages).toHaveLength(1); // второй раз промолчал
  });

  it("другой аккаунт уведомляется даже пока первый ещё в кулдауне", async () => {
    settingsStore.set(keyOf("bot-1", "admin_chat_id"), "111");
    const { handleZernioAccountDisconnected } = await import("../src/lib/zernio-bot.server");

    await handleZernioAccountDisconnected({ account: { accountId: "acc-1" } });
    await handleZernioAccountDisconnected({ account: { accountId: "acc-2" } });
    expect(sentMessages).toHaveLength(2);
  });
});
