import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Кому уходит телеграм-рассылка.
 *
 * Здесь чинилась настоящая ошибка, а не гипотетическая. Покупатели из
 * Instagram и WhatsApp лежат в той же `bot_users`, что и телеграмные, но
 * `telegram_id` у них синтетический — отрицательный хеш от ключа либо вовсе
 * NULL. Выборка аудитории брала всех подряд, поэтому рассылка «всем» честно
 * пыталась писать в чаты, которых не существует.
 *
 * На живой базе на момент починки: 2489 телеграмных записей и 2341
 * инстаграмных, из которых 1183 с отрицательным id и 1158 с NULL. То есть
 * почти половина «получателей» получить ничего не могла в принципе, а продавец
 * видел раздутое число отправленных и пачку ошибок.
 *
 * Тест держит именно этот контракт: наружу уходят только настоящие
 * Telegram-чаты, а фильтр по платформе доезжает до запроса.
 */

type Row = { telegram_id: number | null; state?: unknown; user_key?: string };

/** Что лежит в таблицах фальшивой базы. */
const tables: { bot_users: Row[]; orders: Array<Row & { status: string; platform: string }> } = {
  bot_users: [],
  orders: [],
};

/** Какие фильтры реально применил код — проверяем, что платформа доехала. */
const applied: Array<{ table: string; eq: Array<[string, unknown]> }> = [];

/**
 * Минимальный двойник PostgREST-построителя: копит `.eq()` и отдаёт строки,
 * отфильтрованные теми же условиями. Настоящий клиент сюда не подходит — тест
 * должен идти без базы и без сети.
 */
function makeQuery(table: keyof typeof tables) {
  const eq: Array<[string, unknown]> = [];
  const entry = { table, eq };
  applied.push(entry);

  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      eq.push([column, value]);
      return builder;
    },
    in(column: string, values: unknown[]) {
      eq.push([`${column}:in`, values]);
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: null });
    },
    then(resolve: (r: { data: Row[] }) => unknown) {
      const rows = (tables[table] as Row[]).filter((row) =>
        eq.every(([column, value]) => {
          if (column.endsWith(":in")) {
            const key = column.slice(0, -3) as keyof Row;
            return (value as unknown[]).includes(row[key]);
          }
          // `platform` в двойнике хранится только у orders; у bot_users он
          // задаётся отдельным полем ниже, чтобы фильтр было на чём проверить.
          return (row as Record<string, unknown>)[column] === value;
        }),
      );
      return Promise.resolve(resolve({ data: rows }));
    },
  };
  return builder;
}

// Относительный путь, как в остальных тестах: под алиасом «@/…» перехват не
// срабатывает, и код доходит до настоящего клиента Supabase.
vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => makeQuery(table as keyof typeof tables),
  },
}));

const { resolveAudienceIds } = await import("../src/lib/broadcast.server");

beforeEach(() => {
  applied.length = 0;
  tables.bot_users = [];
  tables.orders = [];
});

describe("resolveAudienceIds", () => {
  it("аудитория «все» не отдаёт синтетические id покупателей из других каналов", async () => {
    tables.bot_users = [
      { telegram_id: 111, platform: "telegram" } as Row,
      { telegram_id: 222, platform: "telegram" } as Row,
      // Покупатель из Instagram: отрицательный хеш вместо чата.
      { telegram_id: -8123456789012, platform: "instagram" } as Row,
      // Покупатель из WhatsApp: телефон в ключе, чата в Telegram нет.
      { telegram_id: -9223372036854, platform: "whatsapp", user_key: "wa_77012345678" } as Row,
      /**
       * Положительный id у записи чужого канала.
       *
       * Сегодня на живой базе таких нет, и проверка знака отсеяла бы две
       * строки выше сама. Но отсеивает их по существу не знак, а платформа:
       * знак — лишь свойство текущей формулы синтетического id, и поменяйся
       * она, ошибка вернулась бы молча. Эта строка держит настоящий контракт.
       */
      { telegram_id: 999, platform: "whatsapp", user_key: "wa_77019999999" } as Row,
    ];

    const ids = await resolveAudienceIds("all");
    expect(ids).toEqual([111, 222]);
  });

  it("фильтр по платформе доезжает до запроса, а не только до результата", async () => {
    tables.bot_users = [{ telegram_id: 111, platform: "telegram" } as Row];
    await resolveAudienceIds("all");
    expect(applied.at(-1)?.eq).toContainEqual(["platform", "telegram"]);
  });

  it("строка без telegram_id получателем не считается", async () => {
    tables.bot_users = [
      { telegram_id: null, platform: "telegram" } as Row,
      { telegram_id: 333, platform: "telegram" } as Row,
    ];
    expect(await resolveAudienceIds("all")).toEqual([333]);
  });

  it("покупатели считаются только по доставленным телеграм-заказам", async () => {
    tables.orders = [
      { telegram_id: 111, status: "delivered", platform: "telegram" },
      { telegram_id: -8123456789012, status: "delivered", platform: "instagram" },
      { telegram_id: 222, status: "awaiting_payment", platform: "telegram" },
    ];
    expect(await resolveAudienceIds("buyers")).toEqual([111]);
  });

  it("«не покупали» исключает покупателей и чужие каналы разом", async () => {
    tables.orders = [{ telegram_id: 111, status: "delivered", platform: "telegram" }];
    tables.bot_users = [
      { telegram_id: 111, platform: "telegram" } as Row,
      { telegram_id: 222, platform: "telegram" } as Row,
      { telegram_id: -8123456789012, platform: "instagram" } as Row,
    ];
    expect(await resolveAudienceIds("non_buyers")).toEqual([222]);
  });

  it("аудитория по стране тоже не тянет чужие каналы", async () => {
    tables.bot_users = [
      { telegram_id: 111, platform: "telegram", state: { country_code: "KZ" } } as Row,
      { telegram_id: 222, platform: "telegram", state: { country_code: "RU" } } as Row,
      { telegram_id: -8123456789012, platform: "instagram", state: { country_code: "KZ" } } as Row,
    ];
    expect(await resolveAudienceIds("country", { country_code: "kz" })).toEqual([111]);
  });
});
