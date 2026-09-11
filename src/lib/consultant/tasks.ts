export type ConsultantTask = {
  id: string;
  at: string;
  userKey: string;
  reason: string;
  text: string;
  done: boolean;
};

const KEY = "consultant_tasks_json";
const LIMIT = 80;

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function loadConsultantTasks(): Promise<ConsultantTask[]> {
  const s = await db();
  const { data } = await s.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (!data?.value) return [];
  try {
    const parsed = JSON.parse(data.value) as unknown;
    return Array.isArray(parsed) ? (parsed as ConsultantTask[]) : [];
  } catch {
    return [];
  }
}

export async function addConsultantTask(
  input: Omit<ConsultantTask, "id" | "at" | "done">,
): Promise<ConsultantTask> {
  const task: ConsultantTask = {
    id: `tsk_${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    done: false,
    ...input,
    text: input.text.slice(0, 400),
  };
  const list = [...(await loadConsultantTasks()), task].slice(-LIMIT);
  const s = await db();
  await s.from("app_settings").upsert({
    key: KEY,
    value: JSON.stringify(list),
    updated_at: task.at,
  });
  return task;
}

export async function setConsultantTaskDone(id: string, done: boolean): Promise<void> {
  const list = (await loadConsultantTasks()).map((t) => (t.id === id ? { ...t, done } : t));
  const s = await db();
  await s.from("app_settings").upsert({
    key: KEY,
    value: JSON.stringify(list),
    updated_at: new Date().toISOString(),
  });
}
