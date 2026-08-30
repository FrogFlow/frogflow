import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

/**
 * Статусная машина физического заказа (Ниши, Блок 6) — против настоящей
 * базы: CAS-переходы держатся на семантике `UPDATE … WHERE status = X`,
 * которую мокками не проверить (тот же выбор, что и в
 * tests/direct-purchase.test.ts).
 *
 * Без переменных окружения пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \
 *   npx vitest run tests/fulfillment.test.ts
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

const TAG = `fm-test-${Date.now().toString(36)}`;
const TELEGRAM_ID = -(Date.now() % 1_000_000_000) - 2;

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

describe.skipIf(!ready)(
  "acceptOrder / advanceFulfillment / recordPayment (нужна настоящая база)",
  () => {
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

    async function makeOrder(status: string) {
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
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`не удалось создать заказ: ${error?.message}`);
      orderIds.push(data.id as number);
      return data.id as number;
    }

    it("acceptOrder переводит awaiting_confirmation в accepted", async () => {
      const orderId = await makeOrder("awaiting_confirmation");
      const { acceptOrder } = await import("../src/lib/fulfillment.server");
      const res = await acceptOrder(orderId);
      expect(res.alreadyAccepted).toBe(false);

      const s = await client();
      const { data } = await s.from("orders").select("status").eq("id", orderId).single();
      expect(data?.status).toBe("accepted");
    });

    it("acceptOrder повторно на уже принятом — alreadyAccepted, статус не меняется", async () => {
      const orderId = await makeOrder("accepted");
      const { acceptOrder } = await import("../src/lib/fulfillment.server");
      const res = await acceptOrder(orderId);
      expect(res.alreadyAccepted).toBe(true);
    });

    it("acceptOrder на delivered — тоже alreadyAccepted, не пытается принять заново", async () => {
      const orderId = await makeOrder("delivered");
      const { acceptOrder } = await import("../src/lib/fulfillment.server");
      const res = await acceptOrder(orderId);
      expect(res.alreadyAccepted).toBe(true);
    });

    it("acceptOrder на rejected бросает — отклонённый заказ обратно в работу не берут", async () => {
      const orderId = await makeOrder("rejected");
      const { acceptOrder } = await import("../src/lib/fulfillment.server");
      await expect(acceptOrder(orderId)).rejects.toThrow();
    });

    it("advanceFulfillment проходит accepted → in_production → ready → delivered", async () => {
      const orderId = await makeOrder("accepted");
      const { advanceFulfillment } = await import("../src/lib/fulfillment.server");

      const step1 = await advanceFulfillment(orderId);
      expect(step1.status).toBe("in_production");
      const step2 = await advanceFulfillment(orderId);
      expect(step2.status).toBe("ready");
      const step3 = await advanceFulfillment(orderId);
      expect(step3.status).toBe("delivered");

      const s = await client();
      const { data } = await s.from("orders").select("status").eq("id", orderId).single();
      expect(data?.status).toBe("delivered");
    });

    it("advanceFulfillment из delivered дальше не идёт", async () => {
      const orderId = await makeOrder("delivered");
      const { advanceFulfillment } = await import("../src/lib/fulfillment.server");
      await expect(advanceFulfillment(orderId)).rejects.toThrow();
    });

    it("двойное нажатие: из двух одновременных advanceFulfillment ровно один продвигает статус", async () => {
      const orderId = await makeOrder("accepted");
      const { advanceFulfillment } = await import("../src/lib/fulfillment.server");

      const results = await Promise.allSettled([
        advanceFulfillment(orderId),
        advanceFulfillment(orderId),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      // CAS (.eq("status", from)) гарантирует, что оба одновременных запроса
      // не могут оба прочитать "accepted" и оба успешно продвинуть заказ —
      // ровно один пишет, второй промахивается мимо WHERE и получает 0 строк.
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const s = await client();
      const { data } = await s.from("orders").select("status").eq("id", orderId).single();
      expect(data?.status).toBe("in_production");
    });

    it("recordPayment суммирует внесённое (задаток + остаток)", async () => {
      const orderId = await makeOrder("accepted");
      const { recordPayment } = await import("../src/lib/fulfillment.server");
      expect(await recordPayment(orderId, 5000)).toBe(true);
      expect(await recordPayment(orderId, 10000)).toBe(true);

      const s = await client();
      const { data } = await s.from("orders").select("paid_amount").eq("id", orderId).single();
      expect(Number(data?.paid_amount)).toBe(15000);
    });

    it("processPendingDeliveries не трогает accepted/in_production/ready", async () => {
      const orderId = await makeOrder("in_production");
      const s = await client();
      // updated_at заведомо старше 2-минутного окна, которое проверяет крон —
      // если бы фильтр читал не только status, заказ подхватился бы именно
      // сейчас.
      await s
        .from("orders")
        .update({ updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
        .eq("id", orderId);

      const { processPendingDeliveries } = await import("../src/lib/orders.server");
      await processPendingDeliveries(10);

      const { data } = await s.from("orders").select("status").eq("id", orderId).single();
      expect(data?.status).toBe("in_production");
    });
  },
);
