import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";

/**
 * Добор застрявших pending-событий — против настоящей базы: сама выборка
 * (`status = pending AND created_at < cutoff AND bot_id = …`) и переходы
 * статусов держатся на поведении PostgREST/RLS, а не на форме объекта.
 *
 * `handleZernioMessage` в этом тесте замокан — иначе добор попытался бы
 * дойти до настоящего Zernio/Telegram API. Здесь проверяется не тело
 * обработчика (для него есть свои тесты), а то, какие строки добор
 * выбирает и как расставляет статусы.
 *
 * Вызов идёт под ключом арендатора (SUPABASE_TENANT_KEY), а не под
 * service_role: retryStuckZernioEvents фильтрует по bot_id явно, и тест
 * обязан проверять именно этот путь — иначе легко получить проход, который
 * трогает застрявшие события чужих, настоящих клиентов в общей базе.
 *
 * Без переменных окружения пропускается, а не падает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… \
 *   npx vitest run tests/zernio-retry.test.ts
 */

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const ready = Boolean(URL_ && SERVICE && JWT_SECRET);

type FakePayload = { tag: string; forceError?: boolean };
const calls: FakePayload[] = [];
vi.mock("../src/lib/zernio-bot.server", () => ({
  handleZernioMessage: vi.fn(async (payload: FakePayload) => {
    calls.push(payload);
    if (payload?.forceError) throw new Error("тестовый сбой обработчика");
  }),
}));

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

const TAG = `zr-test-${Date.now().toString(36)}`;
const OLD_ID = `${TAG}-old`;
const FRESH_ID = `${TAG}-fresh`;
const OTHER_TYPE_ID = `${TAG}-other-type`;
const FAIL_ID = `${TAG}-fail`;
const ALL_IDS = [OLD_ID, FRESH_ID, OTHER_TYPE_ID, FAIL_ID];

async function service() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

describe.skipIf(!ready)("retryStuckZernioEvents (нужна настоящая база)", () => {
  let botId: string;

  beforeAll(async () => {
    const s = await service();

    const { data: bot, error: botErr } = await s
      .from("bots")
      .insert({
        bot_name: `${TAG} bot`,
        owner_id: crypto.randomUUID(),
        status: "active",
        modules: { instagram: true },
      })
      .select("id")
      .single();
    if (botErr || !bot)
      throw new Error(`не удалось создать тестового арендатора: ${botErr?.message}`);
    botId = bot.id;

    const old = (mins: number) => new Date(Date.now() - mins * 60 * 1000).toISOString();
    const { error: logsErr } = await s.from("zernio_logs").insert([
      // Зависло дольше порога, message.received — должно уйти в обработку и в processed.
      {
        event_id: OLD_ID,
        event_type: "message.received",
        status: "pending",
        payload: { tag: OLD_ID },
        created_at: old(10),
        bot_id: botId,
      },
      // Зависло, но моложе порога — трогать рано.
      {
        event_id: FRESH_ID,
        event_type: "message.received",
        status: "pending",
        payload: { tag: FRESH_ID },
        created_at: old(1),
        bot_id: botId,
      },
      // Старый тип подписки (см. третье обследование) — отметить без вызова обработчика.
      {
        event_id: OTHER_TYPE_ID,
        event_type: "comment.received",
        status: "pending",
        payload: { tag: OTHER_TYPE_ID },
        created_at: old(10),
        bot_id: botId,
      },
      // Обработчик специально падает — статус должен остаться error, не processed.
      {
        event_id: FAIL_ID,
        event_type: "message.received",
        status: "pending",
        payload: { tag: FAIL_ID, forceError: true },
        created_at: old(10),
        bot_id: botId,
      },
    ]);
    if (logsErr) throw new Error(`не удалось создать тестовые события: ${logsErr.message}`);
  });

  afterAll(async () => {
    const s = await service();
    await s.from("zernio_logs").delete().in("event_id", ALL_IDS);
    if (botId) await s.from("bots").delete().eq("id", botId);
    delete process.env.BOT_ID;
    delete process.env.SUPABASE_TENANT_KEY;
  });

  it("забирает застрявшее message.received, обходит свежее, отмечает чужой тип и держит сбой", async () => {
    process.env.BOT_ID = botId;
    process.env.SUPABASE_TENANT_KEY = mintTenantKey(botId);
    const { resetModuleCache } = await import("../src/lib/modules/modules.server");
    resetModuleCache();

    const { retryStuckZernioEvents } = await import("../src/lib/zernio-retry.server");
    const result = await retryStuckZernioEvents();

    expect(result.found).toBe(3); // OLD, OTHER_TYPE, FAIL — FRESH ещё не протухло
    expect(result.recovered).toBe(2); // OLD и OTHER_TYPE
    expect(result.stillStuck).toBe(1); // FAIL

    expect(calls.some((p) => p?.tag === OLD_ID)).toBe(true);
    expect(calls.some((p) => p?.tag === FRESH_ID)).toBe(false);
    expect(calls.some((p) => p?.tag === OTHER_TYPE_ID)).toBe(false); // не наш обработчик

    const s = await service();
    const { data } = await s.from("zernio_logs").select("event_id, status").in("event_id", ALL_IDS);
    const byId = Object.fromEntries((data ?? []).map((r) => [r.event_id, r.status]));

    expect(byId[OLD_ID]).toBe("processed");
    expect(byId[FRESH_ID]).toBe("pending");
    expect(byId[OTHER_TYPE_ID]).toBe("processed");
    expect(byId[FAIL_ID]).toBe("error");
  });

  it("выключенный модуль instagram — добор не трогает ничего", async () => {
    const s = await service();
    await s
      .from("bots")
      .update({ modules: { instagram: false } })
      .eq("id", botId);
    // Возвращаем FAIL_ID обратно в pending, чтобы было что не тронуть.
    await s.from("zernio_logs").update({ status: "pending" }).eq("event_id", FAIL_ID);

    process.env.BOT_ID = botId;
    process.env.SUPABASE_TENANT_KEY = mintTenantKey(botId);
    const { resetModuleCache } = await import("../src/lib/modules/modules.server");
    resetModuleCache();

    const { retryStuckZernioEvents } = await import("../src/lib/zernio-retry.server");
    const result = await retryStuckZernioEvents();
    expect(result).toEqual({ found: 0, recovered: 0, stillStuck: 0 });

    const { data } = await s.from("zernio_logs").select("status").eq("event_id", FAIL_ID).single();
    expect(data?.status).toBe("pending");
  });
});
