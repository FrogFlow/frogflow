import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * activateVipSubscription — единственное место, где подтверждённый платёж
 * превращается в реальный доступ к VIP-группе (CONTROL-PLANE-PLAN не при
 * чём — это клиентская, денежная логика). У модуля не было ни одного теста,
 * хотя именно здесь живёт прод-инцидент из собственных комментариев файла:
 * подписка помечалась активной, а инвайт клиенту не доставлялся.
 *
 * createServerOnlyFn — тождественная функция на сервере (см.
 * @tanstack/start-fn-stubs: `(fn) => fn`), так что activateVipSubscription
 * вызываема прямо, без RPC/сессии — так же, как её реально вызывают вебхук
 * и крон. vip-flow.ts (расчёт срока, stacking) не мокается: он уже покрыт
 * тестами в tests/vip-flow.test.ts, и здесь важно, что activateVipSubscription
 * действительно склеивает эту арифметику с базой и Telegram верно.
 */

type Tariff = {
  id: string;
  duration_days: number | null;
  duration_minutes: number | null;
  is_public: boolean;
  is_entry: boolean;
};

type SubRow = {
  id: string;
  telegram_id: number;
  status: string;
  started_at: string;
  expires_at: string;
  group_invite_link: string | null;
  admin_note: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  vip_tariffs: Tariff | null;
};

const baseTariff: Tariff = {
  id: "tariff-1",
  duration_days: 30,
  duration_minutes: null,
  is_public: true,
  is_entry: false,
};

function makeSub(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id: "sub-1",
    telegram_id: 111,
    status: "pending_payment",
    started_at: new Date(0).toISOString(),
    expires_at: new Date(0).toISOString(),
    group_invite_link: null,
    admin_note: null,
    username: "buyer",
    first_name: "Имя",
    last_name: null,
    vip_tariffs: baseTariff,
    ...overrides,
  };
}

let subsStore: SubRow[];
let settingsStore: { key: string; value: string }[];

type Filter = ["eq" | "neq" | "gt" | "in", string, unknown];

function rowMatches(row: SubRow, filters: Filter[]): boolean {
  return filters.every(([op, col, val]) => {
    const cur = (row as unknown as Record<string, unknown>)[col];
    if (op === "eq") return cur === val;
    if (op === "neq") return cur !== val;
    if (op === "gt") return new Date(cur as string).getTime() > new Date(val as string).getTime();
    return (val as unknown[]).includes(cur);
  });
}

function selectBuilder() {
  const filters: Filter[] = [];
  let sortDesc = false;
  let limitN: number | undefined;
  const resolveRows = () => {
    let rows = subsStore.filter((r) => rowMatches(r, filters));
    if (sortDesc) {
      rows = rows
        .slice()
        .sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime());
    }
    if (limitN !== undefined) rows = rows.slice(0, limitN);
    return rows;
  };
  const builder = {
    eq: (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return builder;
    },
    neq: (col: string, val: unknown) => {
      filters.push(["neq", col, val]);
      return builder;
    },
    gt: (col: string, val: unknown) => {
      filters.push(["gt", col, val]);
      return builder;
    },
    in: (col: string, val: unknown[]) => {
      filters.push(["in", col, val]);
      return builder;
    },
    order: (_col: string, opts?: { ascending?: boolean }) => {
      sortDesc = opts?.ascending === false;
      return builder;
    },
    limit: (n: number) => {
      limitN = n;
      return builder;
    },
    single: async () => {
      const rows = resolveRows();
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "expected exactly one row" } };
    },
    maybeSingle: async () => ({ data: resolveRows()[0] ?? null, error: null }),
    then: (resolve: (v: { data: SubRow[]; error: null }) => void) =>
      resolve({ data: resolveRows(), error: null }),
  };
  return builder;
}

function updateBuilder(patch: Partial<SubRow>) {
  const filters: Filter[] = [];
  const apply = () => {
    const rows = subsStore.filter((r) => rowMatches(r, filters));
    for (const row of rows) Object.assign(row, patch);
    return rows;
  };
  const builder = {
    eq: (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return builder;
    },
    neq: (col: string, val: unknown) => {
      filters.push(["neq", col, val]);
      return builder;
    },
    select: (_cols: string) => builder,
    maybeSingle: async () => {
      const rows = apply();
      return { data: rows[0] ? { id: rows[0].id } : null, error: null };
    },
    then: (resolve: (v: { data: null; error: null }) => void) => {
      apply();
      resolve({ data: null, error: null });
    },
  };
  return builder;
}

vi.mock("@/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "vip_subscriptions") {
        return {
          select: (_cols: string) => selectBuilder(),
          update: (patch: Partial<SubRow>) => updateBuilder(patch),
        };
      }
      if (table === "app_settings") {
        return { select: async (_cols: string) => ({ data: settingsStore, error: null }) };
      }
      throw new Error(`неожиданная таблица в моке: ${table}`);
    },
  },
}));

const tgVipMock = vi.fn();
const isVipGroupMemberMock = vi.fn();
const revokeVipInviteMock = vi.fn(async (..._args: unknown[]) => {});
let sendMessageOk = true;

vi.mock("./vip-bot.server", () => ({
  escapeHtml: (s: string) => s,
  isAlreadyNotInChat: () => false,
  isVipGroupMember: (...args: unknown[]) => isVipGroupMemberMock(...args),
  revokeVipInvite: (...args: unknown[]) => revokeVipInviteMock(...args),
  tgVip: (...args: unknown[]) => tgVipMock(...args),
}));

vi.mock("./vip-member.server", () => ({
  assignMemberTariff: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.resetModules();
  subsStore = [makeSub()];
  settingsStore = [
    { key: "vip_group_id", value: "-100999" },
    { key: "vip_test_mode", value: "false" },
    { key: "vip_welcome_message", value: "" },
  ];
  sendMessageOk = true;
  isVipGroupMemberMock.mockReset().mockResolvedValue(false);
  revokeVipInviteMock.mockClear();
  tgVipMock.mockReset().mockImplementation(async (method: string, payload: { name?: string }) => {
    if (method === "createChatInviteLink") {
      return { ok: true, result: { invite_link: `https://t.me/joinchat/${payload.name}` } };
    }
    if (method === "sendMessage") return { ok: sendMessageOk, description: "blocked" };
    return { ok: true, result: {} };
  });
});

describe("activateVipSubscription", () => {
  it("уже активная подписка — отклоняется без похода в Telegram", async () => {
    subsStore = [makeSub({ status: "active" })];
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    await expect(activateVipSubscription("sub-1")).rejects.toThrow("Подписка уже активна");
    expect(tgVipMock).not.toHaveBeenCalled();
  });

  it("статус не pending_payment (cancelled) — отклоняется с понятной причиной", async () => {
    subsStore = [makeSub({ status: "cancelled" })];
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    await expect(activateVipSubscription("sub-1")).rejects.toThrow(
      "Подписку можно подтвердить только из статуса «ожидает оплаты»",
    );
  });

  it("vip_group_id не настроен в панели — отклоняется до создания инвайта", async () => {
    settingsStore = settingsStore.filter((r) => r.key !== "vip_group_id");
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    await expect(activateVipSubscription("sub-1")).rejects.toThrow(
      "Не настроен ID VIP группы в настройках",
    );
    expect(tgVipMock).not.toHaveBeenCalled();
  });

  it("новый покупатель не в группе — создаёт инвайт, активирует запись, шлёт ссылку", async () => {
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    const res = await activateVipSubscription("sub-1");

    expect(res).toEqual({ ok: true, deliveryFailed: false });
    expect(subsStore[0]!.status).toBe("active");
    expect(subsStore[0]!.group_invite_link).toBe("https://t.me/joinchat/vip-sub-1");

    expect(tgVipMock).toHaveBeenCalledWith("createChatInviteLink", expect.anything());
    const sendCall = tgVipMock.mock.calls.find((c) => c[0] === "sendMessage")!;
    expect(sendCall[1].text).toContain("Ваша персональная одноразовая ссылка");
  });

  it("покупатель уже состоит в группе — без нового инвайта, другое сообщение", async () => {
    isVipGroupMemberMock.mockResolvedValue(true);
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    const res = await activateVipSubscription("sub-1");

    expect(res.ok).toBe(true);
    expect(tgVipMock).not.toHaveBeenCalledWith("createChatInviteLink", expect.anything());
    expect(subsStore[0]!.group_invite_link).toBeNull();
    const sendCall = tgVipMock.mock.calls.find((c) => c[0] === "sendMessage")!;
    expect(sendCall[1].text).toContain("Вы остаётесь в VIP-группе");
  });

  // Заметка: в этой ветке (покупатель уже в группе) код не проверяет .ok
  // результата sendMessage — deliveryFailed остаётся false даже если Telegram
  // отклонил отправку. Ниже фиксируется именно это, наблюдаемое поведение:
  // не баг с потерянным доступом (он уже есть), но асимметрия с другими
  // двумя ветками — см. итоговый отчёт по задаче.
  it("покупатель уже в группе и Telegram отклонил уведомление — deliveryFailed это не отражает (текущее поведение)", async () => {
    isVipGroupMemberMock.mockResolvedValue(true);
    sendMessageOk = false;
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    const res = await activateVipSubscription("sub-1");

    expect(res).toEqual({ ok: true, deliveryFailed: false });
    expect(subsStore[0]!.status).toBe("active");
  });

  it("продление, пока старая подписка ещё активна — новый срок считается от старого истечения, старая закрывается", async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    subsStore = [
      makeSub({ id: "sub-1", status: "pending_payment" }),
      makeSub({
        id: "sub-old",
        status: "active",
        expires_at: future,
        group_invite_link: "https://t.me/joinchat/old",
      }),
    ];
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    await activateVipSubscription("sub-1");

    const newExpiry = new Date(subsStore[0]!.expires_at).getTime();
    // 30 дней тарифа поверх остатка старой подписки, не от «сейчас».
    expect(newExpiry).toBeGreaterThan(new Date(future).getTime());
    expect(subsStore.find((s) => s.id === "sub-old")!.status).toBe("expired");
    expect(revokeVipInviteMock).toHaveBeenCalledWith("-100999", "https://t.me/joinchat/old");
  });

  it("заявку уже обработал другой администратор — откатывает только что созданный инвайт", async () => {
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    // Меняем статус строки между чтением и записью — как параллельный админ.
    tgVipMock.mockImplementationOnce(async (method: string, payload: { name?: string }) => {
      subsStore[0]!.status = "cancelled";
      return { ok: true, result: { invite_link: `https://t.me/joinchat/${payload.name}` } };
    });

    await expect(activateVipSubscription("sub-1")).rejects.toThrow(
      "Заявка уже обработана другим администратором",
    );
    expect(revokeVipInviteMock).toHaveBeenCalledWith("-100999", "https://t.me/joinchat/vip-sub-1");
  });

  it("новый инвайт создан, но Telegram отклонил его доставку — подписка активна, deliveryFailed: true", async () => {
    sendMessageOk = false;
    const { activateVipSubscription } = await import("./vip-subscriptions.functions");
    const res = await activateVipSubscription("sub-1");

    expect(res).toEqual({ ok: true, deliveryFailed: true });
    // Ровно инцидент из документации модуля: платёж подтверждён, ссылка
    // сохранена в базе, но клиент её не получил — админ должен это увидеть.
    expect(subsStore[0]!.status).toBe("active");
    expect(subsStore[0]!.group_invite_link).toBe("https://t.me/joinchat/vip-sub-1");
  });
});
