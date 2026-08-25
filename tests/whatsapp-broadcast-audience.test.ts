import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Кому уходит WhatsApp-рассылка (Блок B.3, кейс 2, раунд 2).
 *
 * Раньше resolveWhatsAppAudience не читала список исключённых номеров вовсе
 * — его читал только живой автоответчик (zernio-bot.server.ts). Продавец
 * добавляет туда номер, когда клиент попросил не писать; рассылка всё равно
 * его задевала, и для WhatsApp Business API это прямой риск жалоб.
 */

type Row = { telegram_id: number | null; state?: unknown; user_key?: string; platform?: string };

const tables: {
  bot_users: Row[];
  orders: Array<Row & { status: string }>;
  app_settings: Array<{ key: string; value: string; bot_id: string }>;
} = {
  bot_users: [],
  orders: [],
  app_settings: [],
};

function makeQuery(table: keyof typeof tables) {
  const eq: Array<[string, unknown]> = [];

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
    range() {
      return builder;
    },
    maybeSingle() {
      const rows = filterRows();
      return Promise.resolve({ data: rows[0] ?? null });
    },
    then(resolve: (r: { data: unknown[] }) => unknown) {
      return Promise.resolve(resolve({ data: filterRows() }));
    },
  };

  function filterRows() {
    return (tables[table] as unknown as Record<string, unknown>[]).filter((row) =>
      eq.every(([column, value]) => {
        if (column.endsWith(":in")) {
          const key = column.slice(0, -3);
          return (value as unknown[]).includes(row[key]);
        }
        return row[column] === value;
      }),
    );
  }

  return builder;
}

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => makeQuery(table as keyof typeof tables),
  },
}));

const { resolveWhatsAppAudience } = await import("../src/lib/broadcast.server");

beforeEach(() => {
  tables.bot_users = [];
  tables.orders = [];
  tables.app_settings = [];
  process.env.BOT_ID = "test-bot";
});

describe("resolveWhatsAppAudience", () => {
  it("без списка исключений отдаёт всех подряд", async () => {
    tables.bot_users = [
      { telegram_id: -1, platform: "whatsapp", user_key: "wa_77011111111" },
      { telegram_id: -2, platform: "whatsapp", user_key: "wa_77022222222" },
    ];
    const audience = await resolveWhatsAppAudience("all");
    expect(audience.map((a) => a.phone)).toEqual(["77011111111", "77022222222"]);
  });

  it("исключённый номер не попадает в рассылку", async () => {
    tables.bot_users = [
      { telegram_id: -1, platform: "whatsapp", user_key: "wa_77011111111" },
      { telegram_id: -2, platform: "whatsapp", user_key: "wa_77022222222" },
    ];
    tables.app_settings = [
      { key: "whatsapp_bot_excluded_phones", value: "+7 701 111 11 11", bot_id: "test-bot" },
    ];
    const audience = await resolveWhatsAppAudience("all");
    expect(audience.map((a) => a.phone)).toEqual(["77022222222"]);
  });

  it("исключение работает и для аудитории по стране", async () => {
    tables.bot_users = [
      {
        telegram_id: -1,
        platform: "whatsapp",
        user_key: "wa_77011111111",
        state: { country_code: "KZ" },
      },
      {
        telegram_id: -2,
        platform: "whatsapp",
        user_key: "wa_77022222222",
        state: { country_code: "KZ" },
      },
    ];
    tables.app_settings = [
      { key: "whatsapp_bot_excluded_phones", value: "77011111111", bot_id: "test-bot" },
    ];
    const audience = await resolveWhatsAppAudience("country", { country_code: "kz" });
    expect(audience.map((a) => a.phone)).toEqual(["77022222222"]);
  });
});
