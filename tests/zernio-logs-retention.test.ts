import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Ретенция zernio_logs — проверка против настоящей базы, и иначе никак:
 * весь смысл прохода в том, какие строки PostgREST отдаёт под фильтр
 * `status = processed AND created_at < cutoff`, а замокав клиент, мы
 * проверили бы мокки.
 *
 * Тест создаёт свои строки и их же убирает за собой. Чужого не трогает:
 * все записи помечены собственным event_id с префиксом ниже, и проверки
 * смотрят только на них.
 *
 * На момент написания порог в 30 дней не удалял ничего — самой старой
 * записи в базе было 16 дней. Именно поэтому ветку удаления надо
 * проверять явно: в обычном прогоне она ещё долго не выполнится ни разу.
 *
 * Без переменных окружения тест пропускается, а не падает.
 */

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(URL_ && SERVICE);

const TAG = `retention-test-${Date.now()}`;
const OLD_ID = `${TAG}-old`;
const FRESH_ID = `${TAG}-fresh`;
const ERROR_ID = `${TAG}-error`;

const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
}

/**
 * Порог читается модулем один раз при загрузке, поэтому между прогонами с
 * разным порогом кеш модулей надо сбрасывать — иначе второй вызов молча
 * отработает с первым значением.
 */
async function prune(retentionDays: number) {
  process.env.ZERNIO_LOG_RETENTION_DAYS = String(retentionDays);
  vi.resetModules();
  const { pruneZernioLogs } = await import("../src/lib/zernio-logs.server");
  return pruneZernioLogs();
}

describe.skipIf(!ready)("pruneZernioLogs", () => {
  beforeAll(async () => {
    const s = await client();
    const { error } = await s.from("zernio_logs").insert([
      // Отработано и старое — единственное, что проход вправе удалить.
      { event_id: OLD_ID, event_type: "test", status: "processed", payload: {}, created_at: days(90) },
      // Отработано, но свежее — обязано пережить проход.
      { event_id: FRESH_ID, event_type: "test", status: "processed", payload: {}, created_at: days(1) },
      // Старое, но со следом ошибки — его удалять нельзя ни при каком возрасте.
      { event_id: ERROR_ID, event_type: "test", status: "error", payload: {}, created_at: days(90) },
    ]);
    if (error) throw new Error(`не удалось подготовить строки: ${error.message}`);
  });

  afterAll(async () => {
    const s = await client();
    await s.from("zernio_logs").delete().in("event_id", [OLD_ID, FRESH_ID, ERROR_ID]);
    delete process.env.ZERNIO_LOG_RETENTION_DAYS;
  });

  it("удаляет отработанное старше порога и не трогает свежее и ошибки", async () => {
    const result = await prune(30);
    expect(result.retentionDays).toBe(30);
    expect(result.deleted).toBeGreaterThan(0);

    const s = await client();
    const { data } = await s
      .from("zernio_logs")
      .select("event_id")
      .in("event_id", [OLD_ID, FRESH_ID, ERROR_ID]);

    const survivors = (data ?? []).map((r) => r.event_id);
    expect(survivors).not.toContain(OLD_ID);
    expect(survivors).toContain(FRESH_ID);
    expect(survivors).toContain(ERROR_ID);
  });

  it("сообщает done, когда удалять нечего", async () => {
    // Порог заведомо больше возраста всего, что есть в базе.
    const result = await prune(365);
    expect(result.deleted).toBe(0);
    expect(result.done).toBe(true);
  });
});
