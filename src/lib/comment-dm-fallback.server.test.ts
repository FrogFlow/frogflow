import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * runCommentDmFallback() на живом случае (сент. 2026, образовательный бот):
 * покупатель написал кодовое слово, получил сообщение, оплатил — а через
 * пару дней то же сообщение пришло ему снова. Крон видел только последние
 * 200 логов правила, считал старый комментарий пропущенным, Meta отказывала
 * в повторном private-reply, и крон слал текст обычным сообщением в открытый
 * диалог. Итог при этом не записывался (колонок MIGRATION-66 на базе нет),
 * строка висела pending и через 10 минут шла на повтор.
 */

process.env.BOT_ID = "11111111-1111-1111-1111-111111111111";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();

type Comment = {
  id: string;
  message: string;
  createdTime: string;
  from: { id: string; username: string };
};

let comments: Comment[] = [];
let logs: Array<Record<string, unknown>> = [];
let logsError: string | undefined;
let privateReply: { ok: boolean; error?: string; alreadySent?: boolean } = { ok: true };

const calls = {
  privateReply: [] as string[],
  inbox: [] as string[],
  publicReply: [] as string[],
};

vi.mock("./verticals/registry", () => ({ isConsultantVertical: () => false }));
vi.mock("./verticals/vertical.server", () => ({ currentVertical: () => "shop" }));
vi.mock("./modules/modules.server", () => ({ hasModule: async () => true }));

vi.mock("./zernio.server", () => ({
  getCommentAutomationsMeta: async () => ({}),
  listCommentAutomations: async () => ({
    automations: [
      {
        id: "auto-1",
        accountId: "acc-1",
        platformPostId: "post-1",
        keywords: ["хочу"],
        matchMode: "contains",
        dmMessage: "Ваш урок по ссылке",
        buttons: [],
      },
    ],
  }),
  listInstagramComments: async () => ({ comments }),
  getCommentAutomationLogs: async (_id: string, opts: { limit?: number; skip?: number }) => {
    if (logsError) return { logs: [], error: logsError };
    const skip = opts.skip ?? 0;
    return { logs: logs.slice(skip, skip + (opts.limit ?? 200)) };
  },
  sendCommentPrivateReply: async (_post: string, commentId: string) => {
    calls.privateReply.push(commentId);
    return privateReply;
  },
  sendZernioInboxMessage: async (conversationId: string) => {
    calls.inbox.push(conversationId);
    return { ok: true };
  },
  postCommentReply: async (_post: string, commentId: string) => {
    calls.publicReply.push(commentId);
    return { ok: true };
  },
}));

type SendRow = Record<string, unknown>;
let sends: SendRow[] = [];

/** Минимальная цепочка Supabase: фильтры копятся, результат — по таблице и операции. */
function query(table: string) {
  const state: {
    op: "select" | "insert" | "update";
    payload?: SendRow;
    filters: [string, unknown][];
  } = {
    op: "select",
    filters: [],
  };
  const result = () => {
    if (table === "comment_dm_fallback_sends") {
      if (state.op === "insert") {
        const row = state.payload!;
        if (sends.some((r) => r.comment_id === row.comment_id)) return { error: { code: "23505" } };
        sends.push({ ...row });
        return { error: null };
      }
      if (state.op === "update") {
        // Как на живой базе: колонок MIGRATION-66 нет.
        if (state.payload && "unresolved_prompt_status" in state.payload) {
          return { error: { code: "42703" } };
        }
        const commentId = state.filters.find(([k]) => k === "comment_id")?.[1];
        const row = sends.find((r) => r.comment_id === commentId);
        if (row) Object.assign(row, state.payload);
        return { data: row ? [row] : [], error: null };
      }
      const inIds = state.filters.find(([k]) => k === "comment_id")?.[1];
      const ids = Array.isArray(inIds) ? inIds : [inIds];
      return { data: sends.filter((r) => ids.includes(r.comment_id)), error: null };
    }
    if (table === "bot_users") {
      return { data: { zernio_conversation_id: "conv-buyer" }, error: null };
    }
    return { data: null, error: null };
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (payload: SendRow) => ((state.op = "insert"), (state.payload = payload), builder),
    update: (payload: SendRow) => ((state.op = "update"), (state.payload = payload), builder),
    eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
    in: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
    lt: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      const r = result() as { data?: unknown; error: unknown };
      const data = Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null);
      return { data, error: r.error };
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations-supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => query(table) },
}));

const { runCommentDmFallback } = await import("./comment-dm-fallback.server");

/** Ходовой рилс: 1 200 записей «sent» за пять суток, новые сверху — больше, чем крон читает. */
function busyRuleLogs(): Array<Record<string, unknown>> {
  return Array.from({ length: 1200 }, (_, i) => ({
    status: "sent",
    commentId: `recent-${i}`,
    createdAt: at(i * 0.1),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  comments = [];
  logs = [];
  logsError = undefined;
  privateReply = { ok: true };
  sends = [];
  calls.privateReply = [];
  calls.inbox = [];
  calls.publicReply = [];
});

describe("runCommentDmFallback", () => {
  it("комментарий старше прочитанных логов не трогаем: ни private-reply, ни письма в диалог", async () => {
    logs = busyRuleLogs();
    comments = [
      { id: "old-1", message: "хочу", createdTime: at(110), from: { id: "u1", username: "buyer" } },
    ];
    await runCommentDmFallback();
    expect(calls.privateReply).toEqual([]);
    expect(calls.inbox).toEqual([]);
    expect(sends).toEqual([]);
  });

  it("Meta: «уже отвечали» — в открытый диалог не пишем, строка закрыта, а не pending", async () => {
    logs = [{ status: "sent", commentId: "other", createdAt: at(80) }];
    comments = [
      { id: "c-1", message: "хочу", createdTime: at(5), from: { id: "u1", username: "buyer" } },
    ];
    privateReply = { ok: false, error: "уже уходил", alreadySent: true };
    await runCommentDmFallback();
    expect(calls.privateReply).toEqual(["c-1"]);
    expect(calls.inbox).toEqual([]);
    expect(calls.publicReply).toEqual([]);
    expect(sends[0]?.status).toBe("sent");
  });

  it("настоящий пропуск с другой ошибкой — альт-канал работает как раньше, итог записан", async () => {
    logs = [{ status: "sent", commentId: "other", createdAt: at(80) }];
    comments = [
      { id: "c-1", message: "хочу", createdTime: at(5), from: { id: "u1", username: "buyer" } },
    ];
    privateReply = { ok: false, error: "2534066" };
    await runCommentDmFallback();
    expect(calls.inbox).toEqual(["conv-buyer"]);
    expect(sends[0]?.status).toBe("sent");
    expect(sends[0]?.alt_channel_status).toBe("sent");
  });

  it("логи не прочитались — правило пропускаем, а не считаем всех пропущенными", async () => {
    logsError = "Zernio 503";
    comments = [
      { id: "c-1", message: "хочу", createdTime: at(5), from: { id: "u1", username: "buyer" } },
    ];
    await runCommentDmFallback();
    expect(calls.privateReply).toEqual([]);
  });

  it("второй комментарий того же человека: Zernio уже ответил на первый — не догоняем", async () => {
    logs = [{ status: "sent", commentId: "c-1", createdAt: at(6) }];
    comments = [
      { id: "c-1", message: "хочу", createdTime: at(6), from: { id: "u1", username: "buyer" } },
      { id: "c-2", message: "хочу!!", createdTime: at(5), from: { id: "u1", username: "buyer" } },
    ];
    await runCommentDmFallback();
    expect(calls.privateReply).toEqual([]);
  });

  it("skipped у Zernio — он видел комментарий и сознательно не писал", async () => {
    logs = [{ status: "skipped", commentId: "c-1", createdAt: at(5) }];
    comments = [
      { id: "c-1", message: "хочу", createdTime: at(5), from: { id: "u1", username: "buyer" } },
    ];
    await runCommentDmFallback();
    expect(calls.privateReply).toEqual([]);
  });
});
