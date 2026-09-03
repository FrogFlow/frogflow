import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

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
 * createOrderFromCart зовётся под ключом арендатора (SUPABASE_TENANT_KEY), а
 * не под service_role: триггер assign_order_no (MIGRATION-03) берёт bot_id
 * из claim'а JWT через current_bot_id(), и без него заказу неоткуда взять
 * order_no — под голым service_role INSERT просто падает на NOT NULL.
 * Ровно то же самое в проде: деплой всегда подключается ключом арендатора.
 *
 * Без переменных окружения пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \
 *   npx vitest run tests/direct-purchase.test.ts
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
  let botId: string;
  let productId: string;
  let physicalProductId: string;
  let deliveryZoneId: string;
  let variantProductId: string;
  let variantSmallId: string;
  let variantBigId: string;
  const orderIds: number[] = [];

  beforeAll(async () => {
    const { resetPricingCache } = await import("../src/lib/pricing.server");
    resetPricingCache();
    const { resetModuleCache } = await import("../src/lib/modules/modules.server");
    resetModuleCache();

    const s = await client();

    // Свой тестовый арендатор — bot_users.bot_id NOT NULL в бою (MIGRATION-02),
    // products/payment_methods/cart_items/orders держат внешний ключ на
    // bots(id), а assign_order_no() без claim'а JWT не выдаст order_no.
    // Строку арендатора заводим под service_role (bots закрыт для tenant_bot
    // на INSERT), дальше сам код под проверкой работает уже ключом
    // арендатора — как в проде.
    //
    // modules.stock: true — товары этого арендатора не задают stock_quantity
    // (остаётся NULL, "не отслеживается"), так что включённый модуль ничего
    // не меняет для остальных тестов файла; нужен только тестам ниже
    // ("createOrderFromCart — складской учёт").
    const { data: bot, error: botErr } = await s
      .from("bots")
      .insert({
        bot_name: `${TAG} bot`,
        owner_id: crypto.randomUUID(),
        status: "active",
        modules: { stock: true },
      })
      .select("id")
      .single();
    if (botErr || !bot)
      throw new Error(`не удалось создать тестового арендатора: ${botErr?.message}`);
    botId = bot.id;
    process.env.BOT_ID = botId;
    process.env.SUPABASE_TENANT_KEY = mintTenantKey(botId);

    const { data: product, error: productErr } = await s
      .from("products")
      .insert({
        bot_id: botId,
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

    // Физический товар — для проверки, что createOrderFromCart записывает
    // fulfillment_type/at/address/note (Ниши, Блок 8.3), а не только
    // fulfillment_kind (Блок 6, уже проверен вживую в задаче #110).
    const { data: physicalProduct, error: physicalErr } = await s
      .from("products")
      .insert({
        bot_id: botId,
        name: `${TAG} торт`,
        description: "тестовый физический товар",
        keywords: "",
        price: BASE_PRICE,
        currency: CURRENCY,
        category_ids: [],
        country_prices: { [FAKE_COUNTRY]: COUNTRY_PRICE },
        fulfillment_kind: "physical",
        is_active: true,
      })
      .select("id")
      .single();
    if (physicalErr || !physicalProduct)
      throw new Error(`не удалось создать физический товар: ${physicalErr?.message}`);
    physicalProductId = physicalProduct.id;

    // Зона доставки (Ниши, Блок B) — для проверки, что createOrderFromCart
    // складывает её цену в total и снимает name в delivery_zone_name.
    const { data: zone, error: zoneErr } = await s
      .from("delivery_zones")
      .insert({ bot_id: botId, name: `${TAG} зона`, price: 300, is_active: true })
      .select("id")
      .single();
    if (zoneErr || !zone) throw new Error(`не удалось создать зону доставки: ${zoneErr?.message}`);
    deliveryZoneId = zone.id;

    // Товар с вариантами (Ниши, Блок D) — для проверки, что createOrderFromCart
    // складывает две строки одной корзины (по одной на вариант) в две отдельные
    // строки order_items с верным product_variant_id/price_snapshot/name_snapshot.
    const { data: variantProduct, error: variantProductErr } = await s
      .from("products")
      .insert({
        bot_id: botId,
        name: `${TAG} торт с вариантами`,
        description: "тестовый товар с вариантами",
        keywords: "",
        price: BASE_PRICE,
        currency: CURRENCY,
        category_ids: [],
        fulfillment_kind: "physical",
        is_active: true,
      })
      .select("id")
      .single();
    if (variantProductErr || !variantProduct)
      throw new Error(`не удалось создать товар с вариантами: ${variantProductErr?.message}`);
    variantProductId = variantProduct.id;

    const { data: variantRows, error: variantsErr } = await s
      .from("product_variants")
      .insert([
        { bot_id: botId, product_id: variantProductId, name: "1 кг", price: 1000, sort_order: 0 },
        { bot_id: botId, product_id: variantProductId, name: "2 кг", price: 1800, sort_order: 1 },
      ])
      .select("id, name");
    if (variantsErr || !variantRows || variantRows.length !== 2)
      throw new Error(`не удалось создать варианты товара: ${variantsErr?.message}`);
    variantSmallId = variantRows.find((v) => v.name === "1 кг")!.id;
    variantBigId = variantRows.find((v) => v.name === "2 кг")!.id;

    const { error: methodErr } = await s.from("payment_methods").insert({
      bot_id: botId,
      country_code: FAKE_COUNTRY,
      country_name: `${TAG} страна`,
      currency: CURRENCY,
      instructions: "тестовые реквизиты",
      is_active: true,
      sort_order: 0,
    });
    if (methodErr) throw new Error(`не удалось создать реквизиты: ${methodErr.message}`);

    const { error: userErr } = await s.from("bot_users").insert({
      bot_id: botId,
      telegram_id: TELEGRAM_ID,
      user_key: USER_KEY,
      platform: "instagram",
      first_name: "Тестовый покупатель",
      state: { mode: "awaiting_proof", country_code: FAKE_COUNTRY },
    });
    if (userErr) throw new Error(`не удалось создать покупателя: ${userErr.message}`);

    const { error: cartErr } = await s.from("cart_items").insert({
      bot_id: botId,
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
    if (deliveryZoneId) await s.from("delivery_zones").delete().eq("id", deliveryZoneId);
    if (productId) await s.from("products").delete().eq("id", productId);
    if (physicalProductId) await s.from("products").delete().eq("id", physicalProductId);
    // Каскад по product_id (ON DELETE CASCADE, MIGRATION-53) уберёт и сами
    // варианты — отдельно чистить product_variants не нужно.
    if (variantProductId) await s.from("products").delete().eq("id", variantProductId);
    if (botId) await s.from("bots").delete().eq("id", botId);
    delete process.env.BOT_ID;
    delete process.env.SUPABASE_TENANT_KEY;
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
        .select("total, currency, status, platform, fulfillment_type, fulfillment_at")
        .eq("id", order!.id)
        .single();
      // Ручная цена страны (700), а не основная (1000) — тот самый разбор
      // из pricing.server.ts.
      expect(orderRow).toMatchObject({
        total: COUNTRY_PRICE,
        currency: CURRENCY,
        status: "awaiting_confirmation",
        platform: "instagram",
        // Digital-корзина: fulfillment не передан, значит null — не мусор
        // от параметра, который к этому заказу не относится (Ниши, Блок 8.3).
        fulfillment_type: null,
        fulfillment_at: null,
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

    /**
     * Ниши, Блок 8.3: способ/дата/адрес/комментарий получения собираются
     * шагами чекаута ДО этого вызова (zernio-bot.server.ts,
     * proceedToFulfillmentOrPayment) и передаются через новый параметр
     * fulfillment — здесь проверяется только сама запись в orders, не сам
     * многошаговый диалог (он проверяется вручную на реальном Instagram/
     * WhatsApp аккаунте, см. план).
     */
    it("физический заказ — записывает fulfillment_type/at/address/note", async () => {
      const s = await client();
      await s.from("cart_items").insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        product_id: physicalProductId,
        quantity: 1,
      });

      const { createOrderFromCart } = await import("../src/lib/direct-purchase.server");
      const order = await createOrderFromCart({
        user: {
          telegram_id: TELEGRAM_ID,
          user_key: USER_KEY,
          username: null,
          first_name: "Тестовый покупатель",
        },
        countryCode: FAKE_COUNTRY,
        fulfillment: {
          type: "delivery",
          at: "2026-09-10",
          address: "ул. Тестовая, 1",
          note: "надпись «С днём рождения»",
        },
      });
      expect(order).not.toBeNull();
      expect(order!.fulfillment_kind).toBe("physical");
      orderIds.push(order!.id);

      const { data: orderRow } = await s
        .from("orders")
        .select(
          "fulfillment_kind, fulfillment_type, fulfillment_at, fulfillment_address, fulfillment_note",
        )
        .eq("id", order!.id)
        .single();
      expect(orderRow).toMatchObject({
        fulfillment_kind: "physical",
        fulfillment_type: "delivery",
        fulfillment_address: "ул. Тестовая, 1",
        fulfillment_note: "надпись «С днём рождения»",
      });
      expect(orderRow!.fulfillment_at?.slice(0, 10)).toBe("2026-09-10");
    });

    it("физический заказ без fulfillment (устаревший вызов) — поля остаются null", async () => {
      const s = await client();
      await s.from("cart_items").insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        product_id: physicalProductId,
        quantity: 1,
      });

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

      const { data: orderRow } = await s
        .from("orders")
        .select("fulfillment_kind, fulfillment_type, fulfillment_at")
        .eq("id", order!.id)
        .single();
      expect(orderRow).toMatchObject({
        fulfillment_kind: "physical",
        fulfillment_type: null,
        fulfillment_at: null,
      });
    });

    /**
     * Ниши, Блок B: комиссия зоны доставки складывается в amount ДО этого
     * вызова (sendDirectPaymentDetails замораживает её в frozen_cart.total —
     * здесь передаём готовую сумму через frozenPriced, тем же приёмом, что
     * и настоящий чекаут), а сама зона (id/name) — отдельным параметром
     * deliveryZone, только для снимка delivery_zone_id/_name в orders.
     */
    it("физический заказ с зоной доставки — total включает комиссию, зона — снимок", async () => {
      const s = await client();
      await s.from("cart_items").insert({
        bot_id: botId,
        telegram_id: TELEGRAM_ID,
        user_key: USER_KEY,
        product_id: physicalProductId,
        quantity: 1,
      });

      const zoneFee = 300;
      const { createOrderFromCart } = await import("../src/lib/direct-purchase.server");
      const order = await createOrderFromCart({
        user: {
          telegram_id: TELEGRAM_ID,
          user_key: USER_KEY,
          username: null,
          first_name: "Тестовый покупатель",
        },
        countryCode: FAKE_COUNTRY,
        frozenPriced: {
          lines: [
            {
              id: crypto.randomUUID(),
              productId: physicalProductId,
              name: `${TAG} торт`,
              quantity: 1,
              price: BASE_PRICE,
              currency: CURRENCY,
              countryPrices: { [FAKE_COUNTRY]: COUNTRY_PRICE },
              unit: COUNTRY_PRICE,
              sum: COUNTRY_PRICE,
            },
          ],
          total: COUNTRY_PRICE + zoneFee,
          currency: CURRENCY,
          mixedCurrency: false,
        },
        fulfillment: {
          type: "delivery",
          at: "2026-09-10",
          address: "ул. Тестовая, 1",
          note: null,
        },
        deliveryZone: { id: deliveryZoneId, name: `${TAG} зона`, fee: zoneFee },
      });
      expect(order).not.toBeNull();
      orderIds.push(order!.id);
      expect(order!.total).toBe(COUNTRY_PRICE + zoneFee);

      const { data: orderRow } = await s
        .from("orders")
        .select("total, delivery_zone_id, delivery_zone_name, delivery_fee")
        .eq("id", order!.id)
        .single();
      expect(orderRow).toMatchObject({
        total: COUNTRY_PRICE + zoneFee,
        delivery_zone_id: deliveryZoneId,
        delivery_zone_name: `${TAG} зона`,
        delivery_fee: zoneFee,
      });
    });

    /**
     * Ниши, Блок D: товар с двумя вариантами — оба добавляются в корзину как
     * раздельные строки (addToCart различает их по product_variant_id), и
     * createOrderFromCart обязан сохранить это разделение в order_items:
     * две строки, каждая со своим product_variant_id и price_snapshot
     * варианта (не базовой цены товара), name_snapshot — имя товара со
     * склеенным именем варианта.
     */
    it("товар с двумя вариантами — createOrderFromCart создаёт две строки с верными вариантами", async () => {
      const { addToCart, createOrderFromCart, clearCart } =
        await import("../src/lib/direct-purchase.server");
      await clearCart({ telegram_id: TELEGRAM_ID });
      await addToCart(
        { telegram_id: TELEGRAM_ID, user_key: USER_KEY },
        variantProductId,
        variantSmallId,
      );
      await addToCart(
        { telegram_id: TELEGRAM_ID, user_key: USER_KEY },
        variantProductId,
        variantBigId,
      );

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
      const { data: items } = await s
        .from("order_items")
        .select("product_variant_id, name_snapshot, price_snapshot, quantity")
        .eq("order_id", order!.id)
        .order("price_snapshot");
      expect(items).toHaveLength(2);
      expect(items).toEqual([
        expect.objectContaining({
          product_variant_id: variantSmallId,
          name_snapshot: `${TAG} торт с вариантами — 1 кг`,
          price_snapshot: 1000,
          quantity: 1,
        }),
        expect.objectContaining({
          product_variant_id: variantBigId,
          name_snapshot: `${TAG} торт с вариантами — 2 кг`,
          price_snapshot: 1800,
          quantity: 1,
        }),
      ]);
    });

    /**
     * [Кондитеры-HIGH] postback от клиента можно подделать, минуя реально
     * показанную клавиатуру (там для товара с вариантами всегда есть
     * variantId). Без варианта товар с вариантами не должен вообще попасть
     * в корзину — иначе createOrderFromCart посчитал бы его по
     * products.price, служебной «цене от», а не по цене варианта.
     */
    it("товар с вариантами без выбранного варианта в корзину не попадает", async () => {
      const { addToCart, readCart, clearCart } = await import("../src/lib/direct-purchase.server");
      await clearCart({ telegram_id: TELEGRAM_ID });
      await addToCart({ telegram_id: TELEGRAM_ID, user_key: USER_KEY }, variantProductId, null);
      const cart = await readCart({ telegram_id: TELEGRAM_ID });
      expect(cart).toHaveLength(0);
      await clearCart({ telegram_id: TELEGRAM_ID });
    });
  });

  /**
   * Блок 4, находка 4.12: createOrderFromCart раньше не читал stock_quantity
   * вообще — товар с включённым модулем "stock" можно было продать в минус
   * бесконечно через Instagram/WhatsApp, хотя Telegram/Mini App (общий
   * placeOrderInner) списывают остаток атомарно. decrementStock/restoreStock
   * теперь общие для обоих каналов (fulfillment.server.ts) — здесь
   * проверяется именно склейка с Direct-путём, не сам CAS (он уже проверен
   * настоящей гонкой в placeOrderInner-эквивалентных тестах бота).
   */
  describe("createOrderFromCart — складской учёт (Блок 4, находка 4.12)", () => {
    let stockProductId: string;
    let outOfStockProductId: string;

    beforeAll(async () => {
      const s = await client();
      const { data: stockProduct, error: stockErr } = await s
        .from("products")
        .insert({
          bot_id: botId,
          name: `${TAG} торт с остатком`,
          description: "тестовый товар с ограниченным остатком",
          keywords: "",
          price: BASE_PRICE,
          currency: CURRENCY,
          category_ids: [],
          fulfillment_kind: "physical",
          stock_quantity: 2,
          is_active: true,
        })
        .select("id")
        .single();
      if (stockErr || !stockProduct)
        throw new Error(`не удалось создать товар с остатком: ${stockErr?.message}`);
      stockProductId = stockProduct.id;

      const { data: outOfStockProduct, error: outErr } = await s
        .from("products")
        .insert({
          bot_id: botId,
          name: `${TAG} раскупленный торт`,
          description: "тестовый товар без остатка",
          keywords: "",
          price: BASE_PRICE,
          currency: CURRENCY,
          category_ids: [],
          fulfillment_kind: "physical",
          stock_quantity: 0,
          is_active: true,
        })
        .select("id")
        .single();
      if (outErr || !outOfStockProduct)
        throw new Error(`не удалось создать раскупленный товар: ${outErr?.message}`);
      outOfStockProductId = outOfStockProduct.id;
    });

    afterAll(async () => {
      const s = await client();
      if (stockProductId) await s.from("products").delete().eq("id", stockProductId);
      if (outOfStockProductId) await s.from("products").delete().eq("id", outOfStockProductId);
    });

    it("успешное оформление списывает остаток атомарно", async () => {
      const { addToCart, createOrderFromCart, clearCart } =
        await import("../src/lib/direct-purchase.server");
      await clearCart({ telegram_id: TELEGRAM_ID });
      await addToCart({ telegram_id: TELEGRAM_ID, user_key: USER_KEY }, stockProductId, null);

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
      const { data: product } = await s
        .from("products")
        .select("stock_quantity")
        .eq("id", stockProductId)
        .single();
      expect(product!.stock_quantity).toBe(1);
    });

    it("недостаточный остаток — заказ не создаётся, остаток не трогается", async () => {
      const { addToCart, createOrderFromCart, clearCart } =
        await import("../src/lib/direct-purchase.server");
      await clearCart({ telegram_id: TELEGRAM_ID });
      await addToCart({ telegram_id: TELEGRAM_ID, user_key: USER_KEY }, outOfStockProductId, null);

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

      const s = await client();
      const { data: product } = await s
        .from("products")
        .select("stock_quantity")
        .eq("id", outOfStockProductId)
        .single();
      expect(product!.stock_quantity).toBe(0);
    });

    /**
     * Корзина из двух позиций: первая — остаток есть, вторая — раскуплена.
     * Первая обязана откатиться обратно, а не остаться списанной впустую
     * ради заказа, который в итоге не создался целиком.
     */
    it("раскупленная вторая позиция — откатывает остаток уже списанной первой", async () => {
      const { addToCart, createOrderFromCart, clearCart } =
        await import("../src/lib/direct-purchase.server");
      await clearCart({ telegram_id: TELEGRAM_ID });
      await addToCart({ telegram_id: TELEGRAM_ID, user_key: USER_KEY }, stockProductId, null);
      await addToCart({ telegram_id: TELEGRAM_ID, user_key: USER_KEY }, outOfStockProductId, null);

      const s = await client();
      const { data: before } = await s
        .from("products")
        .select("stock_quantity")
        .eq("id", stockProductId)
        .single();

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

      const { data: after } = await s
        .from("products")
        .select("stock_quantity")
        .eq("id", stockProductId)
        .single();
      expect(after!.stock_quantity).toBe(before!.stock_quantity);
    });
  });
});
