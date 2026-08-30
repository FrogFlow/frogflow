import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

/**
 * productHasFiles / cartAllowsProduct (Ниши, Блок 5) — против настоящей
 * базы: оба читают products/cart_items через PostgREST join, тот же выбор,
 * что и в tests/direct-purchase.test.ts.
 *
 * Без переменных окружения пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \
 *   npx vitest run tests/fulfillment-kind.test.ts
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

/** Тот же алгоритм, что в панели, tests/tenant-isolation.test.ts и scripts/mint-tenant-key.mjs. */
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

const TAG = `fk-test-${Date.now().toString(36)}`;
const USER_KEY = `${TAG}-buyer`;
const TELEGRAM_ID = -(Date.now() % 1_000_000_000) - 1;

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

describe.skipIf(!ready)(
  "productHasFiles / cartAllowsProduct для физических товаров (нужна настоящая база)",
  () => {
    let botId: string;
    let digitalProductId: string;
    let physicalProductId: string;

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

      const { data: digital, error: digitalErr } = await s
        .from("products")
        .insert({
          bot_id: botId,
          name: `${TAG} материал`,
          description: "",
          keywords: "",
          price: 1000,
          currency: "KZT",
          category_ids: [],
          country_prices: {},
          fulfillment_kind: "digital",
          // Намеренно без файлов — это и есть проверяемый случай для physical ниже.
          is_active: true,
        })
        .select("id")
        .single();
      if (digitalErr || !digital)
        throw new Error(`не удалось создать цифровой товар: ${digitalErr?.message}`);
      digitalProductId = digital.id;

      const { data: physical, error: physicalErr } = await s
        .from("products")
        .insert({
          bot_id: botId,
          name: `${TAG} торт`,
          description: "",
          keywords: "",
          price: 15000,
          currency: "KZT",
          category_ids: [],
          country_prices: {},
          fulfillment_kind: "physical",
          lead_time_days: 3,
          is_active: true,
        })
        .select("id")
        .single();
      if (physicalErr || !physical)
        throw new Error(`не удалось создать физический товар: ${physicalErr?.message}`);
      physicalProductId = physical.id;

      const { error: userErr } = await s.from("bot_users").insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        platform: "instagram",
        first_name: "Тестовый покупатель",
        state: {},
      });
      if (userErr) throw new Error(`не удалось создать покупателя: ${userErr.message}`);
    });

    afterAll(async () => {
      const s = await client();
      await s.from("cart_items").delete().eq("user_key", USER_KEY);
      await s.from("bot_users").delete().eq("user_key", USER_KEY);
      if (digitalProductId) await s.from("products").delete().eq("id", digitalProductId);
      if (physicalProductId) await s.from("products").delete().eq("id", physicalProductId);
      if (botId) await s.from("bots").delete().eq("id", botId);
      delete process.env.BOT_ID;
      delete process.env.SUPABASE_TENANT_KEY;
    });

    async function clearCart() {
      const s = await client();
      await s.from("cart_items").delete().eq("user_key", USER_KEY);
    }

    it("physical-товар без единого файла всё равно продаётся", async () => {
      const { productHasFiles } = await import("../src/lib/direct-purchase.server");
      expect(await productHasFiles(physicalProductId)).toBe(true);
    });

    it("digital-товар без файлов по-прежнему не продаётся", async () => {
      const { productHasFiles } = await import("../src/lib/direct-purchase.server");
      expect(await productHasFiles(digitalProductId)).toBe(false);
    });

    it("пустая корзина разрешает любой первый товар", async () => {
      await clearCart();
      const { cartAllowsProduct } = await import("../src/lib/direct-purchase.server");
      expect(await cartAllowsProduct({ telegram_id: TELEGRAM_ID }, physicalProductId)).toBe(true);
    });

    it("нельзя добавить физический товар, когда в корзине уже цифровой", async () => {
      await clearCart();
      const s = await client();
      await s.from("cart_items").insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        product_id: digitalProductId,
        quantity: 1,
      });
      const { cartAllowsProduct } = await import("../src/lib/direct-purchase.server");
      expect(await cartAllowsProduct({ telegram_id: TELEGRAM_ID }, physicalProductId)).toBe(false);
      // Тот же цифровой товар (или другой цифровой) — по-прежнему можно.
      expect(await cartAllowsProduct({ telegram_id: TELEGRAM_ID }, digitalProductId)).toBe(true);
    });

    it("можно добавить второй физический товар к уже лежащему физическому", async () => {
      await clearCart();
      const s = await client();
      await s.from("cart_items").insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        product_id: physicalProductId,
        quantity: 1,
      });
      const { cartAllowsProduct } = await import("../src/lib/direct-purchase.server");
      expect(await cartAllowsProduct({ telegram_id: TELEGRAM_ID }, physicalProductId)).toBe(true);
    });
  },
);
