import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  sends: [] as { chatId: unknown; text: string }[],
  fail: new Set<string>(),
  adminSetting: "1580128256, 5337919477, 8904564830" as string | null,
  owner: 1580128256 as number | null,
}));

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { owner_telegram_id: store.owner }, error: null }),
          maybeSingle: () => Promise.resolve({ data: { value: store.adminSetting }, error: null }),
        }),
        maybeSingle: () =>
          Promise.resolve({
            data: table === "app_settings" ? { value: store.adminSetting } : null,
            error: null,
          }),
      }),
    }),
  },
}));

vi.mock("../src/lib/telegram.server", () => ({
  tg: (_method: string, params: { chat_id: unknown; text: string }) => {
    store.sends.push({ chatId: params.chat_id, text: params.text });
    return Promise.resolve(
      store.fail.has(String(params.chat_id))
        ? { ok: false, description: "Bad Request: chat not found" }
        : { ok: true },
    );
  },
}));

process.env.BOT_ID = "bb3ffba7-edf0-4cce-8742-ff10c9495c44";
const { notifyOwner, notifyRecipients, describeTelegramError } = await import(
  "../src/lib/internal/internal-api.server"
);

/**
 * Продавец заполнил в панели пять Telegram ID менеджеров, нажал проверку и
 * получил уведомление на один — тот, что совпал с владельцем в карточке
 * бота. Консультант рассылал только владельцу, список настроек читала лишь
 * магазинная ветка.
 */
describe("кому уходят уведомления консультанта", () => {
  beforeEach(() => {
    store.sends.length = 0;
    store.fail.clear();
    store.adminSetting = "1580128256, 5337919477, 8904564830";
    store.owner = 1580128256;
  });

  it("владелец и все ID из настроек, без повторов", async () => {
    expect(await notifyRecipients()).toEqual(["1580128256", "5337919477", "8904564830"]);
  });

  it("отправляет каждому", async () => {
    const res = await notifyOwner("проверка");
    expect(res.ok).toBe(true);
    expect(store.sends.map((s) => String(s.chatId))).toEqual([
      "1580128256",
      "5337919477",
      "8904564830",
    ]);
  });

  it("отказ одного не отменяет остальных и виден поимённо", async () => {
    store.fail.add("5337919477");
    const res = await notifyOwner("проверка");
    expect(res.ok).toBe(true);
    expect(store.sends).toHaveLength(3);
    const failed = (res.deliveries ?? []).filter((d) => !d.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0].chatId).toBe("5337919477");
    expect(failed[0].error).toContain("/start");
  });

  it("если не дошло никому — это не успех", async () => {
    store.fail.add("1580128256");
    store.fail.add("5337919477");
    store.fail.add("8904564830");
    const res = await notifyOwner("проверка");
    expect(res.ok).toBe(false);
  });

  it("получателей нет — говорим об этом прямо", async () => {
    store.owner = null;
    store.adminSetting = "";
    const res = await notifyOwner("проверка");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("Не задан");
  });

  it("отказы Telegram переводятся на человеческий", () => {
    expect(describeTelegramError("Bad Request: chat not found")).toContain("/start");
    expect(describeTelegramError("Forbidden: bot was blocked by the user")).toContain("заблокирован");
  });
});
