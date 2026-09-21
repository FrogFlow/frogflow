export type ConsultantTask = {
  id: string;
  at: string;
  userKey: string;
  reason: string;
  text: string;
  contact?: string;
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
    contact: input.contact ? input.contact.slice(0, 300) : undefined,
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

export async function clearConsultantTasks(onlyDone = false): Promise<void> {
  const s = await db();
  const botId = process.env.BOT_ID?.trim();
  if (onlyDone) {
    const list = (await loadConsultantTasks()).filter((t) => !t.done);
    await s.from("app_settings").upsert({
      ...(botId ? { bot_id: botId } : {}),
      key: KEY,
      value: JSON.stringify(list),
      updated_at: new Date().toISOString(),
    });
    return;
  }
  if (botId) {
    await s.from("app_settings").delete().eq("key", KEY).eq("bot_id", botId);
  }
  await s.from("app_settings").delete().eq("key", KEY);
  await s.from("app_settings").upsert({
    ...(botId ? { bot_id: botId } : {}),
    key: KEY,
    value: "[]",
    updated_at: new Date().toISOString(),
  });
}


/**
 * Вопрос, на который бот не смог ответить: в список задач панели И менеджеру
 * в Telegram.
 *
 * Одной записи в панель мало. Продавец спросил прямо: «он отправит сообщение
 * в таком случае? Или как?» — и до сих пор ответ был «или как»: вопрос тихо
 * ложился в список, который надо открыть и увидеть. Бот при этом пообещал
 * покупателю вернуться с ответом, и обещание держалось только на том, заглянет
 * ли кто-нибудь в панель.
 *
 * Уведомление не отменяет запись: список в панели остаётся историей и местом,
 * где вопрос помечают сделанным. Сбой отправки не должен терять вопрос,
 * поэтому сначала пишем, потом отправляем.
 */
export async function fileConsultantQuestion(input: {
  userKey: string;
  question: string;
  /** Что бот ответил покупателю — менеджеру видно, что именно тот обещал. */
  promise?: string;
  /** question — вопрос без ответа, photo — просьба о фото. */
  reason?: "question" | "photo";
}): Promise<{ task: ConsultantTask; notified: boolean }> {
  const reason = input.reason ?? "question";
  const task = await addConsultantTask({
    userKey: input.userKey,
    reason,
    text: input.question,
  });
  let notified = false;
  try {
    const { notifyConsultantHandoff } = await import("./notify");
    const res = await notifyConsultantHandoff({
      userKey: input.userKey,
      reason,
      text: input.promise
        ? `${input.question}\n\nБот ответил: ${input.promise}`
        : input.question,
    });
    notified = Boolean(res?.ok);
  } catch (err) {
    console.warn("[consultant] вопрос записан, но уведомление не ушло", err);
  }
  return { task, notified };
}
