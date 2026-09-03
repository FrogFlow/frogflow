import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * invoices.server.ts не имела ни одного теста — новая фича (счета на оплату
 * подписки владельцу бота через его же бота, MIGRATION-58). requireOperator
 * мокается тем же приёмом, что и hasModule в других тестах этой сессии:
 * сама сессия/куки оператора здесь не при чём, важна бизнес-логика поверх
 * неё. addPayment (subscriptions.server.ts) мокается шпионом — confirmInvoice
 * не должна изобретать свою бухгалтерию, а обязана позвать уже
 * существующий, отдельно протестированный путь начисления платежа.
 */

type OperatorSettingRow = { key: string; value: string | null };
type BotRow = {
  id: string;
  bot_name: string;
  app_url: string | null;
  internal_secret: string | null;
};
type InvoiceRow = {
  id: string;
  bot_id: string;
  amount: number;
  currency: string;
  note: string | null;
  requisites_snapshot: string;
  status: string;
  proof_path: string | null;
  proof_uploaded_at: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
};

let settingsStore: OperatorSettingRow[] = [];
let botsStore: BotRow[] = [];
let invoicesStore: InvoiceRow[] = [];
let nextInvoiceId = 1;

const callInternalMock = vi.fn(async () => ({ ok: true as const, body: {} }));
const logEventMock = vi.fn(async () => {});
const addPaymentMock = vi.fn(async () => {});

vi.mock("../src/lib/operator/guard.server", () => ({
  requireOperator: async () => ({}),
}));

vi.mock("../src/lib/operator/internal-client.server", () => ({
  callInternal: (...args: unknown[]) => callInternalMock(...(args as [])),
}));

vi.mock("../src/lib/operator/events.server", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...(args as [])),
}));

vi.mock("../src/lib/operator/subscriptions.server", () => ({
  addPayment: (...args: unknown[]) => addPaymentMock(...(args as [])),
}));

function withBotJoin(row: InvoiceRow) {
  const bot = botsStore.find((b) => b.id === row.bot_id);
  return { ...row, bots: bot ? { bot_name: bot.bot_name } : null };
}

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "operator_settings") {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, key: string) => ({
              maybeSingle: async () => ({
                data: settingsStore.find((r) => r.key === key) ?? null,
              }),
            }),
          }),
          upsert: async (row: OperatorSettingRow) => {
            const idx = settingsStore.findIndex((r) => r.key === row.key);
            if (idx >= 0) settingsStore[idx] = row;
            else settingsStore.push(row);
            return { error: null };
          },
        };
      }
      if (table === "bots") {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, id: string) => ({
              single: async () => {
                const row = botsStore.find((b) => b.id === id);
                return row
                  ? { data: row, error: null }
                  : { data: null, error: new Error("not found") };
              },
            }),
          }),
        };
      }
      if (table === "subscription_invoices") {
        return {
          insert: (row: Partial<InvoiceRow>) => ({
            select: (_cols: string) => ({
              single: async () => {
                const full: InvoiceRow = {
                  id: String(nextInvoiceId++),
                  bot_id: row.bot_id!,
                  amount: row.amount!,
                  currency: row.currency ?? "KZT",
                  note: row.note ?? null,
                  requisites_snapshot: row.requisites_snapshot!,
                  status: "sent",
                  proof_path: null,
                  proof_uploaded_at: null,
                  created_at: new Date().toISOString(),
                  created_by: row.created_by ?? null,
                  confirmed_at: null,
                  reject_reason: null,
                };
                invoicesStore.push(full);
                return { data: withBotJoin(full), error: null };
              },
            }),
          }),
          select: (_cols: string) => {
            let filtered = invoicesStore;
            const builder = {
              eq: (col: string, value: string) => {
                filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === value);
                return builder;
              },
              order: (_c: string, _o: unknown) => builder,
              single: async () => {
                const row = filtered[0];
                return row
                  ? { data: withBotJoin(row), error: null }
                  : { data: null, error: new Error("not found") };
              },
              then: (resolve: (v: { data: unknown; error: null }) => void) =>
                resolve({ data: filtered.map(withBotJoin), error: null }),
            };
            return builder;
          },
          update: (patch: Partial<InvoiceRow>) => ({
            eq: async (_c: string, id: string) => {
              const row = invoicesStore.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              return { error: row ? null : new Error("not found") };
            },
          }),
        };
      }
      throw new Error(`неожиданная таблица в моке: ${table}`);
    },
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: async (path: string, _expiresIn: number) => ({
          data: { signedUrl: `https://signed.test/${path}` },
          error: null,
        }),
      }),
    },
  },
}));

beforeEach(() => {
  settingsStore = [];
  botsStore = [
    { id: "bot-1", bot_name: "Тестовый бот", app_url: "https://x.test", internal_secret: "s" },
  ];
  invoicesStore = [];
  nextInvoiceId = 1;
  callInternalMock.mockClear();
  logEventMock.mockClear();
  addPaymentMock.mockClear();
});

describe("payout requisites", () => {
  it("пустые реквизиты по умолчанию, сохраняются и читаются обратно", async () => {
    const { getPayoutRequisites, setPayoutRequisites } =
      await import("../src/lib/operator/invoices.server");
    expect(await getPayoutRequisites()).toBe("");
    await setPayoutRequisites("  Каспи Голд 1234  ");
    expect(await getPayoutRequisites()).toBe("Каспи Голд 1234");
  });
});

describe("createInvoice", () => {
  it("отказывает, если реквизиты не заданы", async () => {
    const { createInvoice } = await import("../src/lib/operator/invoices.server");
    await expect(createInvoice("bot-1", 15000, "KZT", null, "operator")).rejects.toThrow(
      /реквизиты/i,
    );
  });

  it("заводит счёт, отправляет текст владельцу через callInternal, пишет журнал", async () => {
    const { setPayoutRequisites, createInvoice } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Каспи Голд 1234 5678 9012 3456");
    const res = await createInvoice("bot-1", 15000, "KZT", "Подписка за октябрь", "operator");
    expect(res.delivered).toBe(true);
    expect(res.invoice.status).toBe("sent");
    expect(res.invoice.requisites_snapshot).toBe("Каспи Голд 1234 5678 9012 3456");
    expect(res.invoice.bot_name).toBe("Тестовый бот");
    expect(callInternalMock).toHaveBeenCalledTimes(1);
    const [, path, body] = callInternalMock.mock.calls[0]!;
    expect(path).toBe("/api/internal/notify-owner");
    expect((body as { text: string }).text).toContain("15000 KZT");
    expect((body as { text: string }).text).toContain("Каспи Голд");
    expect(logEventMock).toHaveBeenCalledWith(
      "bot-1",
      "operator",
      "payment",
      expect.objectContaining({ action: "invoice_created" }),
    );
  });

  it("снимок реквизитов не меняется у уже отправленного счёта при смене реквизитов", async () => {
    const { setPayoutRequisites, createInvoice } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Реквизиты А");
    const first = await createInvoice("bot-1", 1000, "KZT", null, "operator");
    await setPayoutRequisites("Реквизиты Б");
    expect(first.invoice.requisites_snapshot).toBe("Реквизиты А");
  });
});

describe("confirmInvoice", () => {
  it("подтверждает счёт и вызывает addPayment с суммой/валютой счёта", async () => {
    const { setPayoutRequisites, createInvoice, confirmInvoice, listInvoices } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Реквизиты");
    const created = await createInvoice("bot-1", 20000, "KZT", "Октябрь", "operator");

    await confirmInvoice(created.invoice.id, "2026-10-01", "2026-10-31", "operator");

    expect(addPaymentMock).toHaveBeenCalledWith(
      "bot-1",
      expect.objectContaining({
        period_start: "2026-10-01",
        period_end: "2026-10-31",
        amount: 20000,
        currency: "KZT",
      }),
      "operator",
    );
    const [after] = await listInvoices("bot-1");
    expect(after!.status).toBe("paid");
    expect(after!.confirmed_at).not.toBeNull();
  });

  it("нельзя подтвердить уже оплаченный счёт повторно", async () => {
    const { setPayoutRequisites, createInvoice, confirmInvoice } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Реквизиты");
    const created = await createInvoice("bot-1", 1000, "KZT", null, "operator");
    await confirmInvoice(created.invoice.id, "2026-01-01", "2026-01-31", "operator");
    addPaymentMock.mockClear();
    await expect(
      confirmInvoice(created.invoice.id, "2026-02-01", "2026-02-28", "operator"),
    ).rejects.toThrow(/paid/);
    expect(addPaymentMock).not.toHaveBeenCalled();
  });
});

describe("rejectInvoice / cancelInvoice", () => {
  it("отклоняет счёт с причиной, не трогая addPayment", async () => {
    const { setPayoutRequisites, createInvoice, rejectInvoice, listInvoices } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Реквизиты");
    const created = await createInvoice("bot-1", 1000, "KZT", null, "operator");
    await rejectInvoice(created.invoice.id, "Чек не по теме", "operator");
    expect(addPaymentMock).not.toHaveBeenCalled();
    const [after] = await listInvoices("bot-1");
    expect(after!.status).toBe("rejected");
    expect(after!.reject_reason).toBe("Чек не по теме");
  });

  it("отменить можно только счёт без присланного чека", async () => {
    const { setPayoutRequisites, createInvoice, cancelInvoice, confirmInvoice } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Реквизиты");
    const created = await createInvoice("bot-1", 1000, "KZT", null, "operator");
    await confirmInvoice(created.invoice.id, "2026-01-01", "2026-01-31", "operator");
    await expect(cancelInvoice(created.invoice.id, "operator")).rejects.toThrow(/только/);
  });
});

describe("getInvoiceProofUrl", () => {
  it("null, пока чек не прислан; signed URL, когда путь есть", async () => {
    const { setPayoutRequisites, createInvoice, getInvoiceProofUrl } =
      await import("../src/lib/operator/invoices.server");
    await setPayoutRequisites("Реквизиты");
    const created = await createInvoice("bot-1", 1000, "KZT", null, "operator");
    expect(await getInvoiceProofUrl(created.invoice.id)).toBeNull();

    invoicesStore[0]!.proof_path = "bot-1/invoice-1/123.jpg";
    const url = await getInvoiceProofUrl(created.invoice.id);
    expect(url).toBe("https://signed.test/bot-1/invoice-1/123.jpg");
  });
});
