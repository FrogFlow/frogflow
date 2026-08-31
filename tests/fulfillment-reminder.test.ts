import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { isFulfillmentReminderEligible } from "../src/lib/fulfillment-reminder";

/**
 * sendFulfillmentReminders() — CAS-идемпотентность против настоящей базы,
 * тем же приёмом, что tests/fulfillment.test.ts. Без переменных окружения
 * пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \
 *   npx vitest run tests/fulfillment-reminder.test.ts
 */
const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const ready = Boolean(URL_ && SERVICE && JWT_SECRET);

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf as never)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function mintTenantKey(botId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      role: "tenant_bot",
      bot_id: botId,
      iss: "supabase",
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = b64url(crypto.createHmac("sha256", JWT_SECRET!).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

const TAG = `fr-test-${Date.now().toString(36)}`;
const TELEGRAM_ID = -(Date.now() % 1_000_000_000) - 3;

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

const NOW = new Date("2026-01-10T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000);

describe("isFulfillmentReminderEligible", () => {
  it("дата получения дальше суток — рано напоминать", () => {
    expect(isFulfillmentReminderEligible(hoursFromNow(30), NOW, null)).toBe(false);
  });

  it("дата получения в пределах ближайших суток — пора напомнить", () => {
    expect(isFulfillmentReminderEligible(hoursFromNow(10), NOW, null)).toBe(true);
  });

  it("дата получения ровно через 24 часа — на границе, ещё считается", () => {
    expect(isFulfillmentReminderEligible(hoursFromNow(24), NOW, null)).toBe(true);
  });

  it("дата получения уже в прошлом — заказ проглядели, напоминание бесполезно", () => {
    expect(isFulfillmentReminderEligible(hoursFromNow(-2), NOW, null)).toBe(false);
  });

  it("дата получения прямо сейчас — уже не будущее, не напоминаем", () => {
    expect(isFulfillmentReminderEligible(NOW, NOW, null)).toBe(false);
  });

  it("уже отправляли — не повторяем, даже если снова в окне", () => {
    expect(isFulfillmentReminderEligible(hoursFromNow(5), NOW, hoursFromNow(-1))).toBe(false);
  });
});

describe.skipIf(!ready)("sendFulfillmentReminders (нужна настоящая база)", () => {
  let botId: string;
  const orderIds: number[] = [];

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
    process.env.BOT_ID = botId;
    process.env.SUPABASE_TENANT_KEY = mintTenantKey(botId);
  });

  afterAll(async () => {
    const s = await client();
    if (orderIds.length) await s.from("orders").delete().in("id", orderIds);
    if (botId) await s.from("bots").delete().eq("id", botId);
    delete process.env.BOT_ID;
    delete process.env.SUPABASE_TENANT_KEY;
  });

  async function makeOrder(fulfillmentAt: Date | null, status = "accepted") {
    const s = await client();
    const { data, error } = await s
      .from("orders")
      .insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        platform: "telegram",
        total: 15000,
        currency: "KZT",
        status,
        fulfillment_kind: "physical",
        fulfillment_type: "pickup",
        fulfillment_at: fulfillmentAt?.toISOString() ?? null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`не удалось создать заказ: ${error?.message}`);
    orderIds.push(data.id as number);
    return data.id as number;
  }

  it("заказ в ближайшие 24 часа — напоминание отправлено и проставлено ровно один раз", async () => {
    const orderId = await makeOrder(new Date(Date.now() + 10 * 60 * 60 * 1000));
    const { sendFulfillmentReminders } = await import("../src/lib/fulfillment-reminder.server");

    const first = await sendFulfillmentReminders();
    expect(first.sent).toBeGreaterThanOrEqual(1);

    const s = await client();
    const { data: afterFirst } = await s
      .from("orders")
      .select("fulfillment_reminder_sent_at")
      .eq("id", orderId)
      .single();
    expect(afterFirst?.fulfillment_reminder_sent_at).not.toBeNull();

    // Повторный запуск того же крона (или параллельная попытка Vercel) не
    // должен слать второе напоминание по тому же заказу — CAS уже занят.
    const second = await sendFulfillmentReminders();
    const { data: afterSecond } = await s
      .from("orders")
      .select("fulfillment_reminder_sent_at")
      .eq("id", orderId)
      .single();
    expect(afterSecond?.fulfillment_reminder_sent_at).toBe(
      afterFirst?.fulfillment_reminder_sent_at,
    );
    expect(second.checked).toBe(0); // заказ больше не попадает в выборку — sent_at уже не null
  });

  it("дата получения дальше суток — заказ не трогается", async () => {
    const orderId = await makeOrder(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    const { sendFulfillmentReminders } = await import("../src/lib/fulfillment-reminder.server");
    await sendFulfillmentReminders();

    const s = await client();
    const { data } = await s
      .from("orders")
      .select("fulfillment_reminder_sent_at")
      .eq("id", orderId)
      .single();
    expect(data?.fulfillment_reminder_sent_at).toBeNull();
  });

  it("заказ ещё не принят продавцом (awaiting_confirmation) — напоминание не шлём", async () => {
    const orderId = await makeOrder(
      new Date(Date.now() + 10 * 60 * 60 * 1000),
      "awaiting_confirmation",
    );
    const { sendFulfillmentReminders } = await import("../src/lib/fulfillment-reminder.server");
    await sendFulfillmentReminders();

    const s = await client();
    const { data } = await s
      .from("orders")
      .select("fulfillment_reminder_sent_at")
      .eq("id", orderId)
      .single();
    expect(data?.fulfillment_reminder_sent_at).toBeNull();
  });
});
