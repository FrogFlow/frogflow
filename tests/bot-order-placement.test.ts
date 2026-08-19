import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

/**
 * Двойной тап по кнопке страны в placeOrder (bot.server.ts) до этой правки
 * успевал прочитать одну и ту же корзину дважды и создать два одинаковых
 * заказа — тот же класс гонки, что claimAwaitingProof уже чинит для
 * Direct-покупки (см. tests/direct-purchase.test.ts). Проверяется здесь тем
 * же способом: реальный Postgres, реальный конкурентный UPDATE, а не мок,
 * который просто подтвердил бы свою же логику.
 *
 * Без переменных окружения пропускается, а не падает.
 */

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(URL_ && SERVICE);

const TAG = `op-test-${Date.now().toString(36)}`;
const TELEGRAM_ID = -(Date.now() % 1_000_000_000) - 2;

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

describe.skipIf(!ready)("claimOrderPlacement/releaseOrderPlacement (нужна настоящая база)", () => {
  let botId: string;

  beforeAll(async () => {
    const s = await client();
    const { data: bot, error: botErr } = await s
      .from("bots")
      .insert({ bot_name: `${TAG} bot`, owner_id: crypto.randomUUID(), status: "active" })
      .select("id")
      .single();
    if (botErr || !bot)
      throw new Error(`не удалось создать тестового арендатора: ${botErr?.message}`);
    botId = bot.id;

    const { error: userErr } = await s.from("bot_users").insert({
      bot_id: botId,
      telegram_id: TELEGRAM_ID,
      user_key: `${TAG}-buyer`,
      platform: "telegram",
      first_name: "Тестовый покупатель",
      state: {},
    });
    if (userErr) throw new Error(`не удалось создать покупателя: ${userErr.message}`);
  });

  afterAll(async () => {
    const s = await client();
    await s.from("bot_users").delete().eq("telegram_id", TELEGRAM_ID);
    if (botId) await s.from("bots").delete().eq("id", botId);
  });

  async function setState(state: Record<string, unknown>) {
    const s = await client();
    await s.from("bot_users").update({ state }).eq("telegram_id", TELEGRAM_ID);
  }

  async function readState(): Promise<Record<string, unknown>> {
    const s = await client();
    const { data } = await s
      .from("bot_users")
      .select("state")
      .eq("telegram_id", TELEGRAM_ID)
      .single();
    return (data!.state as Record<string, unknown>) ?? {};
  }

  it("забирает claim и ставит placing_order", async () => {
    await setState({ country_code: "KZ" });
    const { claimOrderPlacement } = await import("../src/lib/bot.server");
    expect(await claimOrderPlacement(TELEGRAM_ID)).toBe(true);
    expect((await readState()).placing_order).toBe(true);
  });

  it("второй раз забрать не даёт, пока флаг не снят", async () => {
    await setState({ country_code: "KZ", placing_order: true });
    const { claimOrderPlacement } = await import("../src/lib/bot.server");
    expect(await claimOrderPlacement(TELEGRAM_ID)).toBe(false);
  });

  it("releaseOrderPlacement снимает флаг, не трогая остальной state", async () => {
    await setState({ country_code: "KZ", placing_order: true });
    const { releaseOrderPlacement } = await import("../src/lib/bot.server");
    await releaseOrderPlacement(TELEGRAM_ID, { country_code: "KZ", placing_order: true });
    const state = await readState();
    expect(state.placing_order).toBeUndefined();
    expect(state.country_code).toBe("KZ");
  });

  /**
   * Главная проверка: ровно один из двух одновременных вызовов должен
   * победить. Это и есть починка живой гонки — до неё оба читали пустую
   * (ещё не забранную) корзину и оба создавали свой заказ.
   */
  it("из двух одновременных попыток claim забирает ровно одна", async () => {
    await setState({ country_code: "KZ" });
    const { claimOrderPlacement } = await import("../src/lib/bot.server");
    const [a, b] = await Promise.all([
      claimOrderPlacement(TELEGRAM_ID),
      claimOrderPlacement(TELEGRAM_ID),
    ]);

    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect((await readState()).placing_order).toBe(true);
  });
});
