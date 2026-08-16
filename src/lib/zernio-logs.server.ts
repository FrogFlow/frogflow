/**
 * Ретенция `zernio_logs`.
 *
 * Таблица пишется вебхуком Instagram на каждое входящее событие и ничем не
 * подчищалась: на момент заведения этого файла — 26 719 строк и 62 МБ при
 * 86 МБ всей базы, то есть 72 %, с приростом около 1670 строк в сутки.
 * За год это ~610 тыс. строк и больше гигабайта на логах, которые нужны
 * ровно до тех пор, пока разбирается конкретная доставка.
 *
 * Удаляются только `processed` старше 30 дней. `error` и `pending`
 * остаются: первое — единственный след того, что событие не отработало,
 * второе — незавершённая обработка, и удалять её значит потерять хвост.
 *
 * Живёт не отдельным кроном, а внутри уже работающего `/api/cron/broadcast`:
 * на тарифе Vercel Hobby свой cron нельзя (см. DEPLOYMENT.md), расписание
 * задаётся внешним вызовом, и заводить второй такой вызов на каждом из пяти
 * деплоев ради одного DELETE — плохой размен.
 *
 * Изоляция обычная: деплой ходит ключом арендатора, и RLS отдаёт ему только
 * свои строки. У роли `tenant_bot` есть DELETE на этой таблице, так что чужие
 * логи такой проход не тронет, даже если модуль Instagram у арендатора уже
 * выключен — накопленное до выключения всё равно уберётся.
 */

/** Сколько дней держим отработанные события. Переопределяется ZERNIO_LOG_RETENTION_DAYS (1–365). */
const RETENTION_DAYS = Math.min(
  365,
  Math.max(1, Number(process.env.ZERNIO_LOG_RETENTION_DAYS) || 30),
);

/**
 * Потолок на один проход. Крон здесь serverless, и «удалить всё разом» на
 * накопленном хвосте упёрлось бы в таймаут, не удалив ничего: удаление идёт
 * порциями, а остаток заберут следующие часы. Возвращаемый `done` говорит,
 * осталось ли что-то на следующий раз.
 */
const BATCH = 2000;

export async function pruneZernioLogs(): Promise<{
  deleted: number;
  done: boolean;
  retentionDays: number;
}> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Сначала выбираем идентификаторы: PostgREST не умеет LIMIT в DELETE, а без
  // ограничения проход снова стал бы «всё разом».
  const { data: doomed, error: selectError } = await supabaseAdmin
    .from("zernio_logs")
    .select("id")
    .eq("status", "processed")
    .lt("created_at", cutoff)
    .limit(BATCH);

  if (selectError) throw new Error(selectError.message);
  if (!doomed || doomed.length === 0) {
    return { deleted: 0, done: true, retentionDays: RETENTION_DAYS };
  }

  const { error: deleteError } = await supabaseAdmin
    .from("zernio_logs")
    .delete()
    .in(
      "id",
      doomed.map((row) => row.id),
    );

  if (deleteError) throw new Error(deleteError.message);

  return {
    deleted: doomed.length,
    // Набрали полную порцию — значит, скорее всего, осталось ещё.
    done: doomed.length < BATCH,
    retentionDays: RETENTION_DAYS,
  };
}
