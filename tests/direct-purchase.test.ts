import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Денежный путь Direct-покупки — против настоящей базы, и иначе никак.
 *
 * `createOrderFromCart` и `claimAwaitingProof` держатся на поведении,
 * которое мокками не проверить: точную семантику CAS-обновления
 * (`UPDATE … WHERE updated_at = X`, где важно, что Postgres сериализует два
 * одновременных UPDATE над одной строкой, а не что мок вернул нужное
 * значение) и встроенный join `cart_items → products` через PostgREST.
 * Замокав клиента, мы проверили бы мокки — см. тот же выбор в
 * tests/zernio-logs-retention.test.ts.
 *
 * Тест создаёт свои строки (товар, реквизиты, покупатель, корзина) под
 * уникальным тегом и убирает их за собой. Чужого не трогает.
 *
 * Без переменных окружения пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx vitest run tests/direct-purchase.test.ts
 */

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(URL_ && SERVICE);

const TAG = `dp-test-${Date.now().toString(36)}`;
// Код страны заведомо не пересекается с настоящими реквизитами клиентов —
// иначе resolvePrice() под service_role (он видит реквизиты всех
// арендаторов, RLS тут не фильтрует) мог бы найти чужую строку раньше нашей.
const FAKE_COUNTRY = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;
const USER_KEY = `${TAG}-buyer`;
// Отрицательный — как у настоящих покупателей из Instagram (instagramCustomerId).
const TELEGRAM_ID = -(Date.now() % 1_000_000_000) - 1;

const BASE_PRICE = 1000;
const COUNTRY_PRICE = 700;
// Валюта страны и товара совпадают нарочно: resolvePrice не должен звать
// внешний курс валют, а сумму — предсказывать без сетевого похода.
const CURRENCY = "KZT";

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

describe.skipIf(!ready)("createOrderFromCart и claimAwaitingProof (нужна настоящая база)", () => {
  let productId: string;
  const orderIds: number[] = [];

  beforeAll(async () => {
    const { resetPricingCache } = await import("../src/lib/pricing.server");
    resetPricingCache();

    const s = await client();

    const { data: product, error: productErr } = await s
      .from("products")
      .insert({
        name: `${TAG} материал`,
        description: "тестовый товар для проверки денежного пути",
        keywords: "",
        price: BASE_PRICE,
        currency: CURRENCY,
        category_ids: [],
        country_prices: { [FAKE_COUNTRY]: COUNTRY_PRICE },
        file_path: `${TAG}/material.pdf`,
        file_name: "Тестовый материал.pdf",
        is_active: true,
      })
      .select("id")
      .single();
    if (productErr || !product) throw new Error(`не удалось создать товар: ${productErr?.message}`);
    productId = product.id;

    const { error: methodErr } = await s.from("payment_methods").insert({
      country_code: FAKE_COUNTRY,
      country_name: `${TAG} страна`,
      currency: CURRENCY,
      instructions: "тестовые реквизиты",
      is_active: true,
      sort_order: 0,
    });
    if (methodErr) throw new Error(`не удалось создать реквизиты: ${methodErr.message}`);

    const { error: userErr } = await s.from("bot_users").insert({
      telegram_id: TELEGRAM_ID,
      user_key: USER_KEY,
      platform: "instagram",
      first_name: "Тестовый покупатель",
      state: { mode: "awaiting_proof", country_code: FAKE_COUNTRY },
    });
    if (userErr) throw new Error(`не удалось создать покупателя: ${userErr.message}`);

    const { error: cartErr } = await s.from("cart_items").insert({
      telegram_id: TELEGRAM_ID,
      user_key: USER_KEY,
      product_id: productId,
      quantity: 1,
    });
    if (cartErr) throw new Error(`не удалось наполнить корзину: ${cartErr.message}`);
  });

  afterAll(async () => {
    const s = await client();
    if (orderIds.length) {
      await s.from("order_items").delete().in("order_id", orderIds);
      await s.from("orders").delete().in("id", orderIds);
    }
    await s.from("cart_items").delete().eq("user_key", USER_KEY);
    await s.from("bot_users").delete().eq("user_key", USER_KEY);
    await s.from("payment_methods").delete().eq("country_code", FAKE_COUNTRY);
    if (productId) await s.from("products").delete().eq("id", productId);
  });

  /** Каждый тест сам приводит state в нужное ему исходное положение — чтобы
   *  порядок запуска тестов друг на друга не влиял. */
  async function setState(mode: string | null) {
    const s = await client();
    await s
      .from("bot_users")
      .update({ state: mode ? { mode, country_code: FAKE_COUNTRY } : {} })
      .eq("user_key", USER_KEY);
  }

  describe("claimAwaitingProof", () => {
    it("забирает шаг и переводит его в processing_proof", async () => {
      await setState("awaiting_proof");
      const { claimAwaitingProof } = await import("../src/lib/direct-purchase.server");
      const claimed = await claimAwaitingProof(USER_KEY);
      expect(claimed?.mode).toBe("awaiting_proof"); // снимок на момент захвата

      const s = await client();
      const { data } = await s.from("bot_users").select("state").eq("user_key", USER_KEY).single();
      expect((data!.state as { mode?: string }).mode).toBe("processing_proof");
    });

    it("второй раз забрать не даёт — шаг уже не awaiting_proof", async () => {
      await setState("processing_proof");
      const { claimAwaitingProof } = await import("../src/lib/direct-purchase.server");
      expect(await claimAwaitingProof(USER_KEY)).toBeNull();
    });

    it("не забирает шаг, на котором чек не ждут", async () => {
      await setState("awaiting_email");
      const { claimAwaitingProof } = await import("../src/lib/direct-purchase.server");
      expect(await claimAwaitingProof(USER_KEY)).toBeNull();
    });

    /**
     * Главная проверка: ровно один из двух одновременных вызовов должен
     * победить. Это и есть починка живой гонки — до неё оба читали
     * awaiting_proof, оба писали свой заказ, и корзина дублировалась в двух
     * заказах сразу.
     */
    it("из двух одновременных попыток забирает шаг ровно одна", async () => {
      await setState("awaiting_proof");
      const s = await client();
      const { claimAwaitingProof } = await import("../src/lib/direct-purchase.server");
      const [a, b] = await Promise.all([
        claimAwaitingProof(USER_KEY),
        claimAwaitingProof(USER_KEY),
      ]);

      const winners = [a, b].filter((r) => r !== null);
      expect(winners).toHaveLength(1);

      const { data } = await s.from("bot_users").select("state").eq("user_key", USER_KEY).single();
      expect((data!.state as { mode?: string }).mode).toBe("processing_proof");
    });
  });

  describe("createOrderFromCart", () => {
    it("считает сумму в валюте страны и снимает файлы товара", async () => {
      const { createOrderFromCart } = await import("../src/lib/direct-purchase.server");
      const order = await createOrderFromCart({
        user: {
          telegram_id: TELEGRAM_ID,
          user_key: USER_KEY,
          username: null,
          first_name: "Тестовый покупатель",
        },
        countryCode: FAKE_COUNTRY,
      });
      expect(order).not.toBeNull();
      orderIds.push(order!.id);

      const s = await client();
      const { data: orderRow } = await s
        .from("orders")
        .select("total, currency, status, platform")
        .eq("id", order!.id)
        .single();
      // Ручная цена страны (700), а не основная (1000) — тот самый разбор
      // из pricing.server.ts.
      expect(orderRow).toMatchObject({
        total: COUNTRY_PRICE,
        currency: CURRENCY,
        status: "awaiting_confirmation",
        platform: "instagram",
      });

      const { data: items } = await s
        .from("order_items")
        .select("price_snapshot, name_snapshot, file_path_snapshot, material_files_snapshot")
        .eq("order_id", order!.id);
      expect(items).toHaveLength(1);
      expect(items![0].price_snapshot).toBe(COUNTRY_PRICE);
      expect(items![0].file_path_snapshot).toBe(`${TAG}/material.pdf`);
    });

    it("на пустой корзине заказ не создаёт", async () => {
      const { createOrderFromCart, clearCart } = await import("../src/lib/direct-purchase.server");
      await clearCart({ telegram_id: TELEGRAM_ID });
      const order = await createOrderFromCart({
        user: {
          telegram_id: TELEGRAM_ID,
          user_key: USER_KEY,
          username: null,
          first_name: "Тестовый покупатель",
        },
        countryCode: FAKE_COUNTRY,
      });
      expect(order).toBeNull();
    });
  });
});
