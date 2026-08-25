import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";

/**
 * Ретеншн admin_login_attempts, operator_login_attempts, bot_events,
 * broadcast_recipients (Блок 3.2, кейс 2) — против настоящей базы, тем же
 * приёмом, что tests/zernio-logs-retention.test.ts: смысл прохода в том,
 * какие строки PostgREST реально отдаёт под фильтр, а не в том, что вернул
 * мок.
 *
 * Без переменных окружения пропускается, а не падает.
 */

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(URL_ && SERVICE);

const TAG = `retention-misc-${Date.now()}`;
const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

/** Модуль читает *_RETENTION_DAYS один раз при загрузке — сбрасываем кеш между прогонами. */
async function loadWithEnv<T>(
  envPatch: Record<string, string>,
  load: () => Promise<T>,
): Promise<T> {
  for (const [k, v] of Object.entries(envPatch)) process.env[k] = v;
  vi.resetModules();
  try {
    return await load();
  } finally {
    for (const k of Object.keys(envPatch)) delete process.env[k];
  }
}

describe.skipIf(!ready)("misc-retention", () => {
  let botId: string;

  beforeAll(async () => {
    const s = await client();
    const { data: bot, error } = await s
      .from("bots")
      .insert({ bot_name: `${TAG} bot`, owner_id: crypto.randomUUID(), status: "active" })
      .select("id")
      .single();
    if (error || !bot)
      throw new Error(`не удалось создать тестового арендатора: ${error?.message}`);
    botId = bot.id;
  });

  afterAll(async () => {
    const s = await client();
    if (botId) await s.from("bots").delete().eq("id", botId);
  });

  it("pruneAdminLoginAttempts удаляет старое, не трогает свежее", async () => {
    const s = await client();
    const oldIp = `${TAG}-admin-old`;
    const freshIp = `${TAG}-admin-fresh`;
    const { error: insErr } = await s.from("admin_login_attempts").insert([
      { bot_id: botId, ok: true, ip: oldIp, at: days(120) },
      { bot_id: botId, ok: true, ip: freshIp, at: days(1) },
    ]);
    if (insErr) throw new Error(`не удалось создать попытки входа: ${insErr.message}`);

    const result = await loadWithEnv({ ADMIN_LOGIN_ATTEMPTS_RETENTION_DAYS: "90" }, async () => {
      const { pruneAdminLoginAttempts } = await import("../src/lib/misc-retention.server");
      return pruneAdminLoginAttempts();
    });
    expect(result.retentionDays).toBe(90);
    expect(result.deleted).toBeGreaterThan(0);

    const { data } = await s.from("admin_login_attempts").select("ip").eq("bot_id", botId);
    const survivors = (data ?? []).map((r) => r.ip);
    expect(survivors).not.toContain(oldIp);
    expect(survivors).toContain(freshIp);
    await s.from("admin_login_attempts").delete().eq("ip", freshIp);
  });

  it("pruneOperatorAuditTables удаляет старые bot_events и operator_login_attempts", async () => {
    const s = await client();
    const oldActor = `${TAG}-event-old`;
    const freshActor = `${TAG}-event-fresh`;
    const oldUser = `${TAG}-op-old`;
    const freshUser = `${TAG}-op-fresh`;

    // kind должен совпадать с CHECK на bot_events (см. BotEventKind в
    // operator/events.server.ts) — "meta" самое нейтральное из допустимых.
    const { error: evErr } = await s.from("bot_events").insert([
      { bot_id: botId, actor: oldActor, kind: "meta", payload: {}, at: days(400) },
      { bot_id: botId, actor: freshActor, kind: "meta", payload: {}, at: days(1) },
    ]);
    if (evErr) throw new Error(`не удалось создать bot_events: ${evErr.message}`);

    const { error: loErr } = await s.from("operator_login_attempts").insert([
      { username: oldUser, ok: true, at: days(200) },
      { username: freshUser, ok: true, at: days(1) },
    ]);
    if (loErr) throw new Error(`не удалось создать попытки входа оператора: ${loErr.message}`);

    const result = await loadWithEnv(
      { BOT_EVENTS_RETENTION_DAYS: "365", OPERATOR_LOGIN_ATTEMPTS_RETENTION_DAYS: "90" },
      async () => {
        const { pruneOperatorAuditTables } = await import("../src/lib/misc-retention.server");
        return pruneOperatorAuditTables();
      },
    );
    expect(result.eventsRetentionDays).toBe(365);
    expect(result.loginsRetentionDays).toBe(90);
    expect(result.events).toBeGreaterThan(0);
    expect(result.logins).toBeGreaterThan(0);

    const { data: events } = await s.from("bot_events").select("actor").eq("bot_id", botId);
    const eventActors = (events ?? []).map((r) => r.actor);
    expect(eventActors).not.toContain(oldActor);
    expect(eventActors).toContain(freshActor);

    const { data: logins } = await s
      .from("operator_login_attempts")
      .select("username")
      .in("username", [oldUser, freshUser]);
    const loginUsers = (logins ?? []).map((r) => r.username);
    expect(loginUsers).not.toContain(oldUser);
    expect(loginUsers).toContain(freshUser);

    await s.from("bot_events").delete().eq("actor", freshActor);
    await s.from("operator_login_attempts").delete().eq("username", freshUser);
  });

  it("pruneBroadcastRecipients удаляет получателей кампаний старше окна", async () => {
    const s = await client();
    const { data: oldBroadcast, error: obErr } = await s
      .from("broadcasts")
      .insert({ bot_id: botId, message_text: `${TAG} old`, created_at: days(120) })
      .select("id")
      .single();
    if (obErr || !oldBroadcast)
      throw new Error(`не удалось создать старую рассылку: ${obErr?.message}`);
    const { data: freshBroadcast, error: fbErr } = await s
      .from("broadcasts")
      .insert({ bot_id: botId, message_text: `${TAG} fresh`, created_at: days(1) })
      .select("id")
      .single();
    if (fbErr || !freshBroadcast)
      throw new Error(`не удалось создать свежую рассылку: ${fbErr?.message}`);

    const { error: recErr } = await s.from("broadcast_recipients").insert([
      { bot_id: botId, broadcast_id: oldBroadcast.id, telegram_id: 1, status: "sent" },
      { bot_id: botId, broadcast_id: freshBroadcast.id, telegram_id: 2, status: "sent" },
    ]);
    if (recErr) throw new Error(`не удалось создать получателей: ${recErr.message}`);

    const result = await loadWithEnv({ BROADCAST_RECIPIENTS_RETENTION_DAYS: "90" }, async () => {
      const { pruneBroadcastRecipients } = await import("../src/lib/misc-retention.server");
      return pruneBroadcastRecipients();
    });
    expect(result.retentionDays).toBe(90);
    expect(result.deleted).toBeGreaterThan(0);

    const { data } = await s
      .from("broadcast_recipients")
      .select("broadcast_id")
      .in("broadcast_id", [oldBroadcast.id, freshBroadcast.id]);
    const survivors = (data ?? []).map((r) => r.broadcast_id);
    expect(survivors).not.toContain(oldBroadcast.id);
    expect(survivors).toContain(freshBroadcast.id);

    await s
      .from("broadcast_recipients")
      .delete()
      .in("broadcast_id", [oldBroadcast.id, freshBroadcast.id]);
    await s.from("broadcasts").delete().in("id", [oldBroadcast.id, freshBroadcast.id]);
  });
});
