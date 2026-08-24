import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Рассылку вообще нельзя было создать — ни разу, ни у одного из семи клиентов.
 *
 * `createBroadcast` проверяет, не идёт ли уже другая рассылка, и делала это так:
 *
 *     const active = await s.from("broadcasts")… .maybeSingle();
 *     if (active) throw new Error("Уже идёт другая рассылка…");
 *
 * `await` над построителем PostgREST отдаёт не найденную строку, а конверт
 * `{data, error, count, status, statusText}`. Конверт истинный всегда, в том
 * числе когда `data === null`. То есть проверка срабатывала на пустой очереди,
 * и функция бросала на каждом вызове. Подтверждалось живой базой: в таблице
 * `broadcasts` было ноль строк при том, что модуль продан и включён.
 *
 * Тест держит ровно этот контракт: при пустой очереди рассылка создаётся.
 * Второй тест — что настоящая занятая очередь по-прежнему отклоняется, иначе
 * «починка» свелась бы к удалению проверки.
 */

type BroadcastRow = { id: string; status: string; channel: string };

const tables: {
  bot_users: Array<{ telegram_id: number | null; platform: string }>;
  orders: Array<{ user_key?: string; status: string; platform: string }>;
  broadcasts: BroadcastRow[];
  broadcast_recipients: Array<Record<string, unknown>>;
} = { bot_users: [], orders: [], broadcasts: [], broadcast_recipients: [] };

/**
 * Двойник построителя PostgREST. Важное свойство: терминальные методы
 * возвращают **конверт**, как настоящий клиент, — иначе тест не смог бы
 * поймать исходную ошибку, ради которой он написан.
 */
function makeQuery(table: keyof typeof tables) {
  const eq: Array<[string, unknown]> = [];
  const inFilters: Array<[string, unknown[]]> = [];

  const rows = () =>
    (tables[table] as Array<Record<string, unknown>>).filter(
      (row) =>
        eq.every(([column, value]) => row[column] === value) &&
        inFilters.every(([column, values]) => values.includes(row[column])),
    );

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      eq.push([column, value]);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      inFilters.push([column, values]);
      return builder;
    },
    limit: () => builder,
    insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
      const list = Array.isArray(payload) ? payload : [payload];
      for (const row of list) {
        (tables[table] as Array<Record<string, unknown>>).push({
          id: `generated-${tables[table].length + 1}`,
          ...row,
        });
      }
      const inserted = tables[table][tables[table].length - 1];
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted, error: null }),
        }),
        then: (resolve: (r: { data: null; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: null, error: null })),
      };
    },
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: rows(), error: null })),
  };
  return builder;
}

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table as keyof typeof tables) },
}));

const { createBroadcast } = await import("../src/lib/broadcast.server");

const payload = {
  message_text: "Новые материалы к 1 сентября",
  photo_paths: [],
  product_ids: [],
  show_catalog: true,
  audience_type: "all" as const,
};

beforeEach(() => {
  tables.bot_users = [{ telegram_id: 111, platform: "telegram" }];
  tables.orders = [];
  tables.broadcasts = [];
  tables.broadcast_recipients = [];
});

describe("createBroadcast — проверка занятой очереди", () => {
  it("при пустой очереди создаёт рассылку, а не бросает «уже идёт другая»", async () => {
    const broadcast = await createBroadcast(payload);
    expect(broadcast).toBeTruthy();
    expect(tables.broadcasts).toHaveLength(1);
    expect(tables.broadcast_recipients).toHaveLength(1);
  });

  it("настоящую занятую очередь по-прежнему отклоняет", async () => {
    tables.broadcasts = [{ id: "running", status: "sending", channel: "telegram" }];
    await expect(createBroadcast(payload)).rejects.toThrow(/Уже идёт другая рассылка/);
  });

  it("рассылка в другом канале не считается занятой очередью", async () => {
    // Очередь занята WhatsApp'ом — телеграмная рассылка при этом создаётся:
    // проверка идёт по каналу, а не по таблице целиком.
    tables.broadcasts = [{ id: "running-wa", status: "sending", channel: "whatsapp" }];
    const broadcast = await createBroadcast(payload);
    expect(broadcast).toBeTruthy();
  });
});
