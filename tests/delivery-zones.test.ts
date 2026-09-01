import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";

/**
 * Блок 12, находка 12.5 — не было ни одного файла тестов на зоны доставки:
 * ни порядок по sort_order, ни исключение is_active=false, ни весь
 * Telegram-путь зоны (activeDeliveryZones/fulfillmentOptionsEnabled в
 * fulfillment.server.ts) не были покрыты. CRUD-функции самой админки
 * (delivery-zones.functions.ts) обёрнуты в createServerFn с requireAdmin —
 * ни один тест в проекте не поднимает такую сессию, тем же приёмом здесь
 * тестируется не CRUD-обёртка, а бизнес-логика, которую она вызывает.
 *
 * Против настоящей базы, тем же приёмом, что и tests/fulfillment.test.ts —
 * свой тестовый арендатор, tenant_bot JWT, RLS-изоляция через
 * trg_force_bot_id. Без переменных окружения пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \
 *   npx vitest run tests/delivery-zones.test.ts
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

const TAG = `dz-test-${Date.now().toString(36)}`;

async function serviceClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

/**
 * client.server.ts кеширует supabaseAdmin в модульной переменной при первом
 * обращении и не пересоздаёт его при смене process.env — тем же приёмом,
 * что tests/misc-retention.test.ts (loadWithEnv): сбрасываем модульный кеш
 * ПЕРЕД каждым вызовом с новым botId, иначе второй и все следующие тесты
 * тихо продолжали бы работать под клиентом первого арендатора.
 */
async function asTenant<T>(botId: string, run: () => Promise<T>): Promise<T> {
  process.env.BOT_ID = botId;
  process.env.SUPABASE_TENANT_KEY = mintTenantKey(botId);
  vi.resetModules();
  try {
    return await run();
  } finally {
    delete process.env.BOT_ID;
    delete process.env.SUPABASE_TENANT_KEY;
  }
}

describe.skipIf(!ready)("delivery zones — activeDeliveryZones/fulfillmentOptionsEnabled", () => {
  let botId: string;
  let otherBotId: string;
  const zoneIds: string[] = [];

  beforeAll(async () => {
    const s = await serviceClient();
    const { data: bot, error: botErr } = await s
      .from("bots")
      .insert({ bot_name: `${TAG} bot`, owner_id: crypto.randomUUID(), status: "active" })
      .select("id")
      .single();
    if (botErr || !bot)
      throw new Error(`не удалось создать тестового арендатора: ${botErr?.message}`);
    botId = bot.id;

    const { data: other, error: otherErr } = await s
      .from("bots")
      .insert({ bot_name: `${TAG} bot 2`, owner_id: crypto.randomUUID(), status: "active" })
      .select("id")
      .single();
    if (otherErr || !other)
      throw new Error(`не удалось создать второго тестового арендатора: ${otherErr?.message}`);
    otherBotId = other.id;
  });

  afterAll(async () => {
    const s = await serviceClient();
    if (zoneIds.length) await s.from("delivery_zones").delete().in("id", zoneIds);
    await s.from("app_settings").delete().eq("bot_id", botId);
    if (botId) await s.from("bots").delete().eq("id", botId);
    if (otherBotId) await s.from("bots").delete().eq("id", otherBotId);
  });

  // Данные заводим через service_role с явным bot_id — тем же приёмом, что
  // makeOrder в tests/fulfillment.test.ts: тестируем не запись (её и так
  // проверяет RLS-политика на каждый живой INSERT из-под tenant_bot), а
  // чтение через activeDeliveryZones()/fulfillmentOptionsEnabled().
  async function makeZone(
    forBotId: string,
    name: string,
    price: number,
    sort_order: number,
    is_active = true,
  ) {
    const s = await serviceClient();
    const { data, error } = await s
      .from("delivery_zones")
      .insert({ bot_id: forBotId, name, price, sort_order, is_active })
      .select("id")
      .single();
    if (error || !data) throw new Error(`не удалось создать зону: ${error?.message}`);
    zoneIds.push(data.id as string);
    return data.id as string;
  }

  it("activeDeliveryZones возвращает зоны по sort_order, скрытые (is_active=false) не попадают", async () => {
    await makeZone(botId, "Юг", 3000, 2);
    await makeZone(botId, "Центр", 2000, 1);
    await makeZone(botId, "Скрытая", 5000, 0, false);

    const zones = await asTenant(botId, async () => {
      const { activeDeliveryZones } = await import("../src/lib/fulfillment.server");
      return activeDeliveryZones();
    });
    expect(zones.map((z) => z.name)).toEqual(["Центр", "Юг"]);
  });

  it("activeDeliveryZones не видит зоны другого арендатора (RLS-изоляция)", async () => {
    await makeZone(otherBotId, "Чужая зона", 1000, 0);

    const zones = await asTenant(botId, async () => {
      const { activeDeliveryZones } = await import("../src/lib/fulfillment.server");
      return activeDeliveryZones();
    });
    expect(zones.some((z) => z.name === "Чужая зона")).toBe(false);
  });

  it("activeDeliveryZones — пустой список, если у арендатора нет ни одной зоны (фолбэк на свободный адрес)", async () => {
    const s = await serviceClient();
    await s.from("delivery_zones").delete().eq("bot_id", otherBotId);

    const zones = await asTenant(otherBotId, async () => {
      const { activeDeliveryZones } = await import("../src/lib/fulfillment.server");
      return activeDeliveryZones();
    });
    expect(zones).toEqual([]);
  });

  describe("fulfillmentOptionsEnabled (Блок 12, находка 12.8)", () => {
    it("оба способа включены по умолчанию, пока ничего не настроено", async () => {
      const result = await asTenant(botId, async () => {
        const { fulfillmentOptionsEnabled } = await import("../src/lib/fulfillment.server");
        return fulfillmentOptionsEnabled();
      });
      expect(result).toEqual({ pickup: true, delivery: true });
    });

    it("самовывоз выключен явной настройкой — доставка остаётся включённой", async () => {
      const s = await serviceClient();
      await s
        .from("app_settings")
        .upsert({ bot_id: botId, key: "fulfillment_pickup_enabled", value: "false" });

      const result = await asTenant(botId, async () => {
        const { fulfillmentOptionsEnabled } = await import("../src/lib/fulfillment.server");
        return fulfillmentOptionsEnabled();
      });
      expect(result).toEqual({ pickup: false, delivery: true });
    });
  });

  // Блок 12 — сознательно не покрытые этим заходом пункты, с причиной:
  //
  // 12.1 — DB-тесты (этот файл включительно) пропускаются в CI без секретов
  // SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_JWT_SECRET. Это
  // конфигурация окружения CI (GitHub Actions secrets), не код — из этой
  // сессии недоступна для правки; см. MIGRATION-README.md, п. 10 про то,
  // что фактически применено и проверено вручную вместо CI.
  //
  // 12.7 — регрессионный тест на точечное обновление вариантов
  // (products.functions.ts saveProduct, Блок 8, находка 8.1/8.2) не
  // добавлен: saveProduct — createServerFn с requireAdmin() внутри, и ни
  // один тест в этом проекте не поднимает admin-сессию для прямого вызова
  // такой функции — тот же барьер, что и у CRUD delivery-zones.functions.ts
  // (см. комментарий вверху файла). Логика уже проверена вручную живым
  // сохранением товара с вариантами на Демо-тестере в рамках Блока 8.
  //
  // 12.8 (частично) — cartFulfillmentKind, maxLeadTimeDaysInCart,
  // advanceOrderFulfillment/confirmOrder/deleteOrder на оплаченном заказе
  // не покрыты; fulfillmentOptionsEnabled — покрыта выше.
});
