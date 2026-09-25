import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 25.09 баланс Anthropic ушёл в минус, и никто не узнал: бот без модели
 * отдавал диалоги менеджеру часами. Сбой не на минуту — сообщение владельцу.
 */

const settings = new Map<string, string>();
let owner: number | null = 1580128256;
const sent: { chat_id: string; text: string }[] = [];

vi.mock("../src/integrations-supabase/client.server", () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return q;
      },
      maybeSingle: async () => {
        if (table === "bots") return { data: { owner_telegram_id: owner } };
        const value = settings.get(String(filters.key));
        return { data: value === undefined ? null : { value } };
      },
      upsert: async (row: { key: string; value: string }) => {
        settings.set(row.key, row.value);
        return { error: null };
      },
    };
    return q;
  };
  return { supabaseAdmin: { from } };
});
vi.mock("../src/lib/telegram.server", () => ({
  tg: async (_method: string, payload: { chat_id: string; text: string }) => {
    sent.push(payload);
    return { ok: true };
  },
}));

const { alertModelFailure, classifyModelFailure, MODEL_ALERT_KEY } =
  await import("../src/lib/consultant-v2/model-alert");

const BILLING =
  'anthropic_400:{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase c';

beforeEach(() => {
  settings.clear();
  sent.length = 0;
  owner = 1580128256;
  process.env.BOT_ID = "bot-1";
});

describe("вид сбоя модели", () => {
  it("деньги, ключ, лимит — сигнал; перегрузка, сервер и сеть — нет", () => {
    expect(classifyModelFailure(BILLING)).toBe("billing");
    expect(classifyModelFailure('anthropic_401:{"error":{"type":"authentication_error"}}')).toBe(
      "auth",
    );
    expect(classifyModelFailure("no_api_key")).toBe("no_key");
    expect(classifyModelFailure("anthropic_429:rate_limit_error")).toBe("limit");
    expect(classifyModelFailure("anthropic_529:overloaded")).toBeNull();
    expect(classifyModelFailure("anthropic_500:api_error")).toBeNull();
    expect(classifyModelFailure("network:The operation was aborted due to timeout")).toBeNull();
    expect(classifyModelFailure(null)).toBeNull();
  });
});

describe("сообщение владельцу", () => {
  it("кончились деньги — владельцу бота, а не продавцам; второй раз за три часа — молчит", async () => {
    settings.set("admin_chat_id", "1580128256, 5337919477, 8904564830");
    await alertModelFailure(BILLING);
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe("1580128256");
    expect(sent[0].text).toContain("закончились деньги");
    await alertModelFailure(BILLING);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(settings.get(MODEL_ALERT_KEY)!).billing).toBeTruthy();
  });

  it("другой вид сбоя — своё сообщение, отметка прошлого сохраняется", async () => {
    await alertModelFailure(BILLING);
    await alertModelFailure("anthropic_401:invalid x-api-key");
    expect(sent.map((s) => s.text.slice(0, 40))).toHaveLength(2);
    expect(Object.keys(JSON.parse(settings.get(MODEL_ALERT_KEY)!))).toEqual(["billing", "auth"]);
  });

  it("через три часа — снова", async () => {
    settings.set(
      MODEL_ALERT_KEY,
      JSON.stringify({ billing: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() }),
    );
    await alertModelFailure(BILLING);
    expect(sent).toHaveLength(1);
  });

  it("владельца нет — Telegram из настроек", async () => {
    owner = null;
    settings.set("admin_chat_id", "111, 222");
    await alertModelFailure("no_api_key");
    expect(sent.map((s) => s.chat_id)).toEqual(["111", "222"]);
  });

  it("временный сбой — ни базы, ни сообщения", async () => {
    await alertModelFailure("anthropic_529:overloaded");
    expect(sent).toHaveLength(0);
    expect(settings.has(MODEL_ALERT_KEY)).toBe(false);
  });
});
