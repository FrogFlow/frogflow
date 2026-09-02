import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * authenticateInternalRequest() — единственный гейт входа во внутренний API
 * клиентского деплоя (CONTROL-PLANE-PLAN.md §5–6): панель бьёт сюда с
 * x-internal-secret, деплой сверяет его с bots.internal_secret своей же
 * строки и больше никому не доверяет. До этого файла у модуля не было ни
 * одного теста, хотя это единственная защита от произвольного вызова
 * notifyOwner()/setOwnWebhook() кем угодно, кто знает URL деплоя.
 *
 * Секрет кэшируется в модульной переменной на SECRET_CACHE_TTL_MS — поэтому
 * каждый тест сбрасывает реестр модулей (vi.resetModules) и импортирует
 * internal-api.server.ts заново, иначе кэш одного теста был бы виден
 * следующему (тот же приём, что в tests/currency.test.ts).
 */

let botRow: { internal_secret: string | null } | null;
let dbError: { message: string } | null;
let selectCalls: number;

vi.mock("@/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "bots") throw new Error(`неожиданная таблица в моке: ${table}`);
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            single: async () => {
              selectCalls++;
              return { data: botRow, error: dbError };
            },
          }),
        }),
      };
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  botRow = { internal_secret: "correct-secret" };
  dbError = null;
  selectCalls = 0;
  process.env.BOT_ID = "bot-1";
});

afterEach(() => {
  delete process.env.BOT_ID;
  vi.useRealTimers();
});

describe("authenticateInternalRequest", () => {
  it("без заголовка x-internal-secret отклоняет 401 и не трогает базу", async () => {
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const res = await authenticateInternalRequest(new Request("https://x.test/"));
    expect(res).toEqual({ ok: false, status: 401, message: "Missing x-internal-secret" });
    expect(selectCalls).toBe(0);
  });

  it("без BOT_ID падает раньше похода в базу", async () => {
    delete process.env.BOT_ID;
    const { authenticateInternalRequest } = await import("./internal-api.server");
    await expect(
      authenticateInternalRequest(
        new Request("https://x.test/", { headers: { "x-internal-secret": "whatever" } }),
      ),
    ).rejects.toThrow("BOT_ID");
    expect(selectCalls).toBe(0);
  });

  it("ошибка чтения секрета из базы — 500, и ошибку не запоминает как секрет", async () => {
    dbError = { message: "connection reset" };
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const req = new Request("https://x.test/", {
      headers: { "x-internal-secret": "correct-secret" },
    });

    const res1 = await authenticateInternalRequest(req);
    expect(res1).toEqual({ ok: false, status: 500, message: "Internal secret unavailable" });

    // Сбой прошёл — следующий вызов обязан сходить в базу заново, а не
    // повторить прежний отказ (иначе временный сбой БД запирал бы вход на
    // весь TTL).
    dbError = null;
    const res2 = await authenticateInternalRequest(req);
    expect(res2).toEqual({ ok: true });
    expect(selectCalls).toBe(2);
  });

  it("пустой internal_secret в базе — 503, а не «пускаем всех»", async () => {
    botRow = { internal_secret: "" };
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const res = await authenticateInternalRequest(
      new Request("https://x.test/", { headers: { "x-internal-secret": "anything" } }),
    );
    expect(res).toEqual({
      ok: false,
      status: 503,
      message: "Internal secret is not configured for this bot",
    });
  });

  it("неверный секрет — 403", async () => {
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const res = await authenticateInternalRequest(
      new Request("https://x.test/", { headers: { "x-internal-secret": "wrong-secret" } }),
    );
    expect(res).toEqual({ ok: false, status: 403, message: "Invalid secret" });
  });

  it("совпадающий секрет — ok", async () => {
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const res = await authenticateInternalRequest(
      new Request("https://x.test/", { headers: { "x-internal-secret": "correct-secret" } }),
    );
    expect(res).toEqual({ ok: true });
  });

  it("секрет из базы кэшируется на TTL — второй запрос подряд не идёт в базу", async () => {
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const req = new Request("https://x.test/", {
      headers: { "x-internal-secret": "correct-secret" },
    });
    await authenticateInternalRequest(req);
    await authenticateInternalRequest(req);
    expect(selectCalls).toBe(1);
  });

  it("по истечении TTL кэш обновляется — ротация секрета в панели подхватывается", async () => {
    vi.useFakeTimers();
    botRow = { internal_secret: "old-secret" };
    const { authenticateInternalRequest } = await import("./internal-api.server");
    const reqOld = new Request("https://x.test/", {
      headers: { "x-internal-secret": "old-secret" },
    });
    const reqNew = new Request("https://x.test/", {
      headers: { "x-internal-secret": "new-secret" },
    });

    expect((await authenticateInternalRequest(reqOld)).ok).toBe(true);

    botRow = { internal_secret: "new-secret" };
    // Внутри TTL кэш ещё отдаёт старое значение — ротация ещё не видна.
    expect((await authenticateInternalRequest(reqNew)).ok).toBe(false);

    vi.advanceTimersByTime(60_000 + 1);
    expect((await authenticateInternalRequest(reqNew)).ok).toBe(true);
    expect(selectCalls).toBe(2);
  });
});
