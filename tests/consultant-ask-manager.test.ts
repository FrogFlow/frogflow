import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ upserts: [] as Record<string, unknown>[] }));

vi.mock("../src/integrations-supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      upsert: (row: Record<string, unknown>) => {
        store.upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const { CONSULTANT_TOOLS, executeConsultantTool } = await import("../src/lib/consultant/tools");

function queuedTasks(): { reason: string; text: string; userKey: string }[] {
  const row = [...store.upserts].reverse().find((r) => r.key === "consultant_tasks_json");
  return row ? JSON.parse(String(row.value)) : [];
}

describe("вопрос, на который нет ответа", () => {
  beforeEach(() => {
    store.upserts.length = 0;
  });

  it("инструмент объявлен отдельно от передачи менеджеру", () => {
    const names = CONSULTANT_TOOLS.map((t) => t.name);
    expect(names).toContain("ask_manager");
    expect(names).toContain("handoff_to_manager");
  });

  it("записывает вопрос менеджеру и передаёт ему диалог", async () => {
    const res = await executeConsultantTool(
      "ask_manager",
      { question: "В чём отличие TRESOR R3 от LEVANT R4?" },
      { userKey: "ig:lyudmila" },
    );

    /**
     * Раньше бот продолжал разговор: «уточню и вернусь, чем ещё помочь?».
     * Продавец после первой ночи работы: «бот должен просто сообщить, что
     * передаст вопрос менеджеру. После этого не нужно продолжать диалог и
     * задавать вопросы вроде „есть ли у вас ещё вопросы?“ — дальше диалог
     * подхватит человек».
     */
    expect(res.handoff).toBe(true);
    expect(res.result).toEqual({ queued: true, paused: true, reason: "question" });

    const tasks = queuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      reason: "question",
      userKey: "ig:lyudmila",
      text: "В чём отличие TRESOR R3 от LEVANT R4?",
    });
  });

  it("пустой вопрос не засоряет очередь менеджера", async () => {
    const res = await executeConsultantTool("ask_manager", { question: "   " }, { userKey: "ig:x" });
    expect(res.result).toEqual({ queued: false, paused: true, reason: "question" });
    // Пустой вопрос в очередь не попадает, но диалог всё равно уходит
    // человеку: модель уже решила, что сама не ответит.
    expect(queuedTasks()).toHaveLength(0);
  });

  it("передача менеджеру по-прежнему ставит паузу", async () => {
    const res = await executeConsultantTool(
      "handoff_to_manager",
      { reason: "purchase" },
      { userKey: "ig:x" },
    );
    expect(res.handoff).toBe(true);
  });
});
