import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * sweepSubscriptions() сама решает, приостанавливать ли бота и списывать ли
 * внимание оператора на предупреждение — без единого теста эта логика
 * держалась только на чтении кода. Мокаются Supabase и внутренний API
 * деплоя (см. tests/zernio-account-disconnected.test.ts — тот же приём):
 * сама суть проверки — какое действие выбирается и не повторяется ли оно
 * в тот же день, а не семантика PostgREST.
 */

type BotRow = {
  id: string;
  bot_name: string;
  status: string;
  settings: Record<string, unknown> | null;
  subscription_expires_at: string | null;
  app_url: string | null;
  internal_secret: string | null;
  owner_telegram_id: number | null;
};

type EventRow = {
  bot_id: string;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
};

let botsStore: BotRow[] = [];
let eventsStore: EventRow[] = [];
let notifyOk = true;

vi.mock("../../integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "bots") {
        return {
          select: async (_cols: string) => ({ data: botsStore, error: null }),
          update: (patch: Partial<BotRow>) => ({
            eq: async (_col: string, val: string) => {
              const bot = botsStore.find((b) => b.id === val);
              if (bot) Object.assign(bot, patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === "bot_events") {
        return {
          select: (_cols: string) => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: (col: string, val: string) => {
                filters[col] = val;
                return builder;
              },
              limit: async (_n: number) => {
                const matches = eventsStore.filter(
                  (e) =>
                    (!filters.bot_id || e.bot_id === filters.bot_id) &&
                    (!filters["payload->>sweep_marker"] ||
                      e.payload.sweep_marker === filters["payload->>sweep_marker"]),
                );
                return { data: matches, error: null };
              },
            };
            return builder;
          },
          insert: async (row: EventRow) => {
            eventsStore.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`неожиданная таблица в моке: ${table}`);
    },
  },
}));

vi.mock("./internal-client.server", () => ({
  callInternal: vi.fn(async () =>
    notifyOk
      ? { ok: true, body: {} }
      : { ok: false, kind: "unreachable", error: "деплой не отвечает" },
  ),
}));

function makeBot(overrides: Partial<BotRow> = {}): BotRow {
  return {
    id: "bot-1",
    bot_name: "Тест",
    status: "active",
    settings: null,
    subscription_expires_at: null,
    app_url: "https://example.test",
    internal_secret: "secret",
    owner_telegram_id: 123,
    ...overrides,
  };
}

beforeEach(() => {
  botsStore = [];
  eventsStore = [];
  notifyOk = true;
});

describe("sweepSubscriptions", () => {
  it("оплаченный бот не трогает", async () => {
    botsStore = [makeBot({ subscription_expires_at: "2999-01-01" })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions();
    expect(res).toHaveLength(1);
    expect(res[0].action).toBe("skipped");
    expect(res[0].state).toBe("ok");
  });

  it("истекает скоро — предупреждает, не трогая статус", async () => {
    const now = new Date("2026-09-01T00:00:00Z");
    botsStore = [makeBot({ subscription_expires_at: "2026-09-03" })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions(now);
    expect(res[0].action).toBe("warned");
    expect(botsStore[0].status).toBe("active");
    expect(eventsStore.some((e) => e.kind === "message" && e.payload.sweep_marker)).toBe(true);
  });

  it("просрочка дольше отсрочки с политикой suspend — приостанавливает и уведомляет", async () => {
    const now = new Date("2026-09-10T00:00:00Z");
    botsStore = [
      makeBot({
        subscription_expires_at: "2026-09-01",
        settings: { on_overdue: "suspend" },
      }),
    ];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions(now);
    expect(res[0].action).toBe("suspended");
    expect(botsStore[0].status).toBe("suspended");
  });

  it("та же просрочка с политикой warn — только предупреждает, не приостанавливает", async () => {
    const now = new Date("2026-09-10T00:00:00Z");
    botsStore = [
      makeBot({ subscription_expires_at: "2026-09-01", settings: { on_overdue: "warn" } }),
    ];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions(now);
    expect(res[0].action).toBe("warned");
    expect(botsStore[0].status).toBe("active");
  });

  it("повторный запуск в тот же день не дублирует действие", async () => {
    const now = new Date("2026-09-03T00:00:00Z");
    botsStore = [makeBot({ subscription_expires_at: "2026-09-05" })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const first = await sweepSubscriptions(now);
    expect(first[0].action).toBe("warned");

    const second = await sweepSubscriptions(now);
    expect(second[0].action).toBe("skipped");
    expect(second[0].detail).toBe("уже сделано для этого периода");
  });

  it("новый оплаченный период после предупреждения — предупреждает заново", async () => {
    botsStore = [makeBot({ subscription_expires_at: "2026-09-05" })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    await sweepSubscriptions(new Date("2026-09-03T00:00:00Z"));

    // Клиент продлил подписку на новый период — маркер для старой даты не подходит.
    botsStore[0].subscription_expires_at = "2026-10-05";
    const res = await sweepSubscriptions(new Date("2026-10-03T00:00:00Z"));
    expect(res[0].action).toBe("warned");
  });

  it("недоставленное предупреждение не помечается сделанным — повторится на следующем запуске", async () => {
    notifyOk = false;
    const now = new Date("2026-09-03T00:00:00Z");
    botsStore = [makeBot({ subscription_expires_at: "2026-09-05" })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions(now);
    expect(res[0].action).toBe("failed");
    expect(eventsStore).toHaveLength(0);

    notifyOk = true;
    const retry = await sweepSubscriptions(now);
    expect(retry[0].action).toBe("warned");
  });

  it("уже приостановленного бота повторно не трогает", async () => {
    const now = new Date("2026-09-10T00:00:00Z");
    botsStore = [makeBot({ status: "suspended", subscription_expires_at: "2026-09-01" })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions(now);
    expect(res[0].action).toBe("skipped");
    expect(res[0].detail).toBe("нет повода");
  });

  it("без даты подписки — пропускает", async () => {
    botsStore = [makeBot({ subscription_expires_at: null })];
    const { sweepSubscriptions } = await import("./subscription-cron.server");
    const res = await sweepSubscriptions();
    expect(res[0].action).toBe("skipped");
    expect(res[0].state).toBe("no_data");
  });
});
