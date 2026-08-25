/**
 * Ретенция `manager_chat_messages`.
 *
 * До Блока 3.1 таблица писала не только переписку с покупателем, но и
 * реплику самого бота на каждый ответ каталога (см. telegram.server.ts,
 * убрано этой же правкой) — 14 725 строк за 5 дней у одного клиента, из
 * которых лишь 6 были настоящим ответом оператора. Автоответы бот больше не
 * пишет, но накопленное раньше и новая, куда более скромная переписка всё
 * равно должны когда-нибудь удаляться — иначе таблица снова растёт вечно,
 * просто медленнее.
 *
 * Тот же батч-паттерн, что и у pruneZernioLogs: PostgREST не умеет LIMIT в
 * DELETE, поэтому сначала выбираем id порцией, потом удаляем по ним.
 */

/** Сколько дней держим переписку. Переопределяется MANAGER_CHAT_RETENTION_DAYS (1–365). */
const RETENTION_DAYS = Math.min(
  365,
  Math.max(1, Number(process.env.MANAGER_CHAT_RETENTION_DAYS) || 90),
);

const BATCH = 2000;

export async function pruneManagerChatMessages(): Promise<{
  deleted: number;
  done: boolean;
  retentionDays: number;
}> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: doomed, error: selectError } = await supabaseAdmin
    .from("manager_chat_messages")
    .select("id")
    .lt("created_at", cutoff)
    .limit(BATCH);

  if (selectError) throw new Error(selectError.message);
  if (!doomed || doomed.length === 0) {
    return { deleted: 0, done: true, retentionDays: RETENTION_DAYS };
  }

  const { error: deleteError } = await supabaseAdmin
    .from("manager_chat_messages")
    .delete()
    .in(
      "id",
      doomed.map((row) => row.id),
    );

  if (deleteError) throw new Error(deleteError.message);

  return {
    deleted: doomed.length,
    done: doomed.length < BATCH,
    retentionDays: RETENTION_DAYS,
  };
}
