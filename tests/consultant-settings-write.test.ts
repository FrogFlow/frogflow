import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  calls: [] as { row: unknown; options: unknown }[],
  error: null as { message: string } | null,
}));

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      upsert: (row: unknown, options?: unknown) => {
        store.calls.push({ row, options });
        return Promise.resolve({ error: store.error });
      },
    }),
  },
}));

const { saveConsultantKnowledge } = await import("../src/lib/consultant/knowledge");
const { saveConsultantStoreInfo } = await import("../src/lib/consultant/store-info");

/**
 * MIGRATION-02 сменила первичный ключ app_settings с (key) на (bot_id, key).
 * Явное ON CONFLICT (key) после этого отвергается Postgres целиком, а ошибка
 * терялась — админка рапортовала «добавлено N статей», и не добавлялось ничего.
 */
describe("запись настроек консультанта в app_settings", () => {
  beforeEach(() => {
    store.calls.length = 0;
    store.error = null;
  });

  it("база знаний пишется без onConflict — ключ составной", async () => {
    await saveConsultantKnowledge([
      { id: "a", title: "Уход", tags: [], content: "Стирка 40°C", updatedAt: "2026-09-17T00:00:00.000Z" },
    ]);
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].options).toBeUndefined();
  });

  it("адрес и часы пишутся без onConflict", async () => {
    await saveConsultantStoreInfo({ hours: "ежедневно с 10:00 до 21:00" });
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].options).toBeUndefined();
  });

  it("отказ базы больше не выглядит как успех — база знаний", async () => {
    store.error = {
      message: "there is no unique or exclusion constraint matching the ON CONFLICT specification",
    };
    await expect(
      saveConsultantKnowledge([
        { id: "a", title: "Уход", tags: [], content: "текст", updatedAt: "2026-09-17T00:00:00.000Z" },
      ]),
    ).rejects.toThrow(/Не удалось сохранить базу знаний/);
  });

  it("отказ базы больше не выглядит как успех — адрес магазина", async () => {
    store.error = { message: "permission denied" };
    await expect(saveConsultantStoreInfo({ phone: "+7 777 333 08 08" })).rejects.toThrow(
      /Не удалось сохранить/,
    );
  });
});
