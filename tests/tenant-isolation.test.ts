import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

/**
 * Изоляция арендаторов — самая дорогая из возможных поломок: клиент видит
 * заказы и покупателей другого клиента. Держится она не на коде приложения, а
 * на RLS в базе (MIGRATION-02) и на claim bot_id внутри SUPABASE_TENANT_KEY.
 * Проверить это можно только против настоящей базы: подделать RLS мокками
 * значит проверить мокки.
 *
 * Тест ничего не пишет — только читает.
 *
 * Запуск:
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   SUPABASE_JWT_SECRET=… npx vitest run tests/tenant-isolation.test.ts
 *
 * Без этих переменных тест пропускается, а не падает: в обычном прогоне
 * секретов нет и быть не должно.
 */

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const ready = Boolean(URL_ && ANON && SERVICE && JWT_SECRET);

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf as never)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Тот же алгоритм, что в панели и в scripts/mint-tenant-key.mjs. */
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

/** select=* — у таблиц разные ключи: у bot_users, например, нет колонки id. */
async function rows(table: string, key: string, query = ""): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=500${query}`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>[];
}

/**
 * «Данных не досталось» — это либо пустая выборка (RLS включена, политик нет),
 * либо отказ 403 (права ещё и отозваны, как у operator_login_attempts).
 * Оба исхода одинаково означают, что арендатор таблицу не читает.
 */
async function unreachable(table: string, key: string): Promise<boolean> {
  try {
    return (await rows(table, key)).length === 0;
  } catch (e) {
    return /HTTP 40[13]/.test((e as Error).message);
  }
}

describe.skipIf(!ready)("изоляция арендаторов (нужна настоящая база)", () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    const res = await fetch(`${URL_}/rest/v1/bots?select=id&limit=2`, {
      headers: { apikey: ANON!, Authorization: `Bearer ${SERVICE}` },
    });
    const list = (await res.json()) as { id: string }[];
    if (list.length < 2) throw new Error("нужны минимум два клиента в bots");
    a = list[0]!.id;
    b = list[1]!.id;
  });

  it("ключ арендатора видит только свои заказы", async () => {
    const mine = await rows("orders", mintTenantKey(a));
    const foreign = await rows("orders", mintTenantKey(a), `&bot_id=eq.${b}`);
    // Явный запрос чужих строк должен вернуть пусто: фильтрует база, а не код.
    expect(foreign).toHaveLength(0);
    expect(Array.isArray(mine)).toBe(true);
  });

  it("ключ арендатора видит только своих покупателей", async () => {
    expect(await rows("bot_users", mintTenantKey(a), `&bot_id=eq.${b}`)).toHaveLength(0);
  });

  it("ключ арендатора видит только свои товары", async () => {
    expect(await rows("products", mintTenantKey(a), `&bot_id=eq.${b}`)).toHaveLength(0);
  });

  it("два ключа видят разные наборы строк", async () => {
    const forA = await rows("products", mintTenantKey(a));
    const forB = await rows("products", mintTenantKey(b));
    const idsA = new Set(forA.map((r) => r.id));
    expect(forB.filter((r) => idsA.has(r.id))).toHaveLength(0);
  });

  it("в bots арендатор видит одну строку — свою", async () => {
    const seen = await rows("bots", mintTenantKey(a));
    expect(seen.map((r) => r.id)).toEqual([a]);
  });

  /**
   * Таблицы панели закрыты для арендатора полностью: RLS включена, политик нет.
   * Без этого клиент читал бы журнал действий и попытки входа оператора.
   */
  it("служебные таблицы панели арендатору недоступны", async () => {
    for (const table of ["bot_events", "operator_broadcasts", "operator_login_attempts"]) {
      expect(await unreachable(table, mintTenantKey(a)), table).toBe(true);
    }
  });

  it("подделанная подпись не принимается", async () => {
    const forged = mintTenantKey(a).replace(
      /\.[^.]+$/,
      ".ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    );
    await expect(rows("products", forged)).rejects.toThrow(/HTTP 40[13]/);
  });
});
