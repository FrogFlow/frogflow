import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Теневой режим: на v1 то же сообщение молча считает v2 — только в журнал,
 * без паузы, задачи и счёта клиенту; выключатель и дневной предел.
 */

const settings = new Map<string, string>();
let vertical = "consultant";
const decideCalls: { text: string; ctx: Record<string, unknown> }[] = [];
const traces: { messageId: string; entry: Record<string, unknown> }[] = [];

vi.mock("../src/integrations-supabase/client.server", () => {
  const from = () => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      in: (col: string, vals: string[]) => {
        filters[col] = vals;
        return q;
      },
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: ((filters.key as string[]) ?? [])
            .filter((k) => settings.has(k))
            .map((k) => ({ key: k, value: settings.get(k) })),
        }),
      upsert: async (row: { key: string; value: string }) => {
        settings.set(row.key, row.value);
        return { error: null };
      },
    };
    return q;
  };
  return { supabaseAdmin: { from } };
});
vi.mock("../src/lib/verticals/vertical.server", () => ({ currentVertical: () => vertical }));
vi.mock("../src/lib/consultant-v2/engine", () => ({
  decideConsultantReplyV2: async (text: string, _state: unknown, ctx: Record<string, unknown>) => {
    decideCalls.push({ text, ctx });
    (ctx.onUsage as (u: unknown, m: string) => void)?.(
      { inputTokens: 1000, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 },
      "claude-haiku-4-5-20251001",
    );
    return {
      text: "55х100 — 15 000 ₸. Какой размер нужен?",
      kind: "product",
      patch: {},
      toolsUsed: ["search_products «PIP»"],
    };
  },
}));
vi.mock("../src/lib/consultant/runs", async (orig) => ({
  ...(await orig<typeof import("../src/lib/consultant/runs")>()),
  appendRunTrace: async (messageId: string, entry: Record<string, unknown>) => {
    traces.push({ messageId, entry });
  },
}));

const { takeShadowSlot, runShadowV2, SHADOW_COUNTER_KEY, SHADOW_DAILY_LIMIT, SHADOW_SETTING_KEY } =
  await import("../src/lib/consultant-v2/shadow");

beforeEach(() => {
  settings.clear();
  vertical = "consultant";
  decideCalls.length = 0;
  traces.length = 0;
});

describe("выключатель и предел тени", () => {
  it("без настройки — выключена", async () => {
    expect(await takeShadowSlot()).toBe(false);
  });

  it("включена — считает сообщения за сутки по Алматы; предел — стоп", async () => {
    settings.set(SHADOW_SETTING_KEY, "on");
    const now = new Date("2026-09-25T10:00:00Z");
    expect(await takeShadowSlot(now)).toBe(true);
    expect(JSON.parse(settings.get(SHADOW_COUNTER_KEY)!)).toEqual({ day: "2026-09-25", n: 1 });
    settings.set(SHADOW_COUNTER_KEY, JSON.stringify({ day: "2026-09-25", n: SHADOW_DAILY_LIMIT }));
    expect(await takeShadowSlot(now)).toBe(false);
    // Новые сутки по Алматы (UTC+5) — счёт заново.
    expect(await takeShadowSlot(new Date("2026-09-25T19:30:00Z"))).toBe(true);
  });

  it("на деплое v2 тени нет — там v2 и так отвечает", async () => {
    settings.set(SHADOW_SETTING_KEY, "on");
    vertical = "consultant_bovi_v2";
    expect(await takeShadowSlot()).toBe(false);
  });
});

describe("ответ v2 в тени", () => {
  it("dryRun, ответ — в журнал рядом с v1, после строки v1", async () => {
    settings.set(SHADOW_SETTING_KEY, "on");
    let v1Written = false;
    const recorded = new Promise<void>((resolve) =>
      setTimeout(() => {
        v1Written = true;
        resolve();
      }, 10),
    );
    await runShadowV2({
      messageId: "m1",
      userKey: "ig_1",
      text: "Цены можно",
      state: {},
      storyId: "s1",
      recorded,
    });
    expect(decideCalls[0].ctx).toMatchObject({ dryRun: true, userKey: "ig_1", storyId: "s1" });
    expect(v1Written).toBe(true);
    expect(traces).toHaveLength(1);
    expect(traces[0].messageId).toBe("m1");
    expect(traces[0].entry.shadow_v2).toMatchObject({
      text: "55х100 — 15 000 ₸. Какой размер нужен?",
      kind: "product",
      handoff: null,
      model: "claude-haiku-4-5-20251001",
    });
    expect((traces[0].entry.shadow_v2 as { usd: number }).usd).toBeGreaterThan(0);
  });

  it("выключена — модель не вызывается", async () => {
    await runShadowV2({ messageId: "m2", userKey: "ig_1", text: "Цена?", state: {} });
    expect(decideCalls).toHaveLength(0);
    expect(traces).toHaveLength(0);
  });
});
