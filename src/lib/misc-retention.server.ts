/**
 * Ретеншн мелких таблиц, у которых его никогда не было (Блок 3.2, кейс 2):
 * `admin_login_attempts`, `operator_login_attempts`, `bot_events`,
 * `broadcast_recipients`. По отдельности каждая растёт медленно, но «никогда
 * не удаляется» рано или поздно значит то же самое, что уже случилось с
 * `zernio_logs` и `manager_chat_messages` до их собственных правок — просто
 * позже.
 *
 * Разделены не по таблице, а по деплою, который имеет право их трогать:
 * `admin_login_attempts` и `broadcast_recipients` — арендаторские (пишет
 * клиентский деплой под своим `bot_id`), `bot_events` и
 * `operator_login_attempts` — панель оператора (пишет только она, см.
 * operator/*.server.ts). Вызывающие крон-роуты гейтят по CONTROL_PLANE
 * ровно как остальные такие пары в проекте.
 */

const BATCH = 2000;

function retentionDays(envVar: string, fallback: number): number {
  return Math.min(365, Math.max(1, Number(process.env[envVar]) || fallback));
}

/** Три таблицы этого файла с колонкой-меткой времени `at` вместо обычного `created_at`. */
type AtTimestampedTable = "admin_login_attempts" | "operator_login_attempts" | "bot_events";

async function pruneByAt(table: AtTimestampedTable, cutoffIso: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  // PostgREST не умеет LIMIT в DELETE — тот же приём, что у pruneZernioLogs:
  // сначала выбираем порцию id, потом удаляем по ним.
  const { data: doomed, error: selectError } = await supabaseAdmin
    .from(table)
    .select("id")
    .lt("at", cutoffIso)
    .limit(BATCH);
  if (selectError) throw new Error(`${table}: ${selectError.message}`);
  if (!doomed || doomed.length === 0) return 0;

  const { error: deleteError } = await supabaseAdmin
    .from(table)
    .delete()
    .in(
      "id",
      doomed.map((row) => row.id),
    );
  if (deleteError) throw new Error(`${table}: ${deleteError.message}`);
  return doomed.length;
}

/** Попытки входа в панель продавца. ADMIN_LOGIN_ATTEMPTS_RETENTION_DAYS, по умолчанию 90. */
export async function pruneAdminLoginAttempts(): Promise<{
  deleted: number;
  retentionDays: number;
}> {
  const days = retentionDays("ADMIN_LOGIN_ATTEMPTS_RETENTION_DAYS", 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await pruneByAt("admin_login_attempts", cutoff);
  return { deleted, retentionDays: days };
}

/**
 * `broadcast_recipients` — своей даты создания нет (см. types.ts): только
 * `sent_at`, пустой у ещё не отправленных строк. Держим по дате самой
 * кампании (`broadcasts.created_at`) — кампания старше окна давно завершена
 * или заброшена, её получателям тоже пора уйти.
 */
export async function pruneBroadcastRecipients(): Promise<{
  deleted: number;
  retentionDays: number;
}> {
  const days = retentionDays("BROADCAST_RECIPIENTS_RETENTION_DAYS", 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: oldBroadcasts, error: bErr } = await supabaseAdmin
    .from("broadcasts")
    .select("id")
    .lt("created_at", cutoff)
    .limit(BATCH);
  if (bErr) throw new Error(`broadcasts: ${bErr.message}`);
  if (!oldBroadcasts || oldBroadcasts.length === 0) return { deleted: 0, retentionDays: days };

  const { data: doomed, error: rErr } = await supabaseAdmin
    .from("broadcast_recipients")
    .select("id")
    .in(
      "broadcast_id",
      oldBroadcasts.map((b) => b.id),
    )
    .limit(BATCH);
  if (rErr) throw new Error(`broadcast_recipients: ${rErr.message}`);
  if (!doomed || doomed.length === 0) return { deleted: 0, retentionDays: days };

  const { error: delErr } = await supabaseAdmin
    .from("broadcast_recipients")
    .delete()
    .in(
      "id",
      doomed.map((row) => row.id),
    );
  if (delErr) throw new Error(`broadcast_recipients: ${delErr.message}`);
  return { deleted: doomed.length, retentionDays: days };
}

/**
 * `bot_events` и `operator_login_attempts` — центральный журнал панели
 * оператора, не привязан к одному арендаторскому деплою. `bot_events` держим
 * дольше входов (180 дней по умолчанию): это история для разбора инцидентов
 * («когда клиента приостановили и кто»), а не техническая мелочь.
 */
export async function pruneOperatorAuditTables(): Promise<{
  events: number;
  logins: number;
  eventsRetentionDays: number;
  loginsRetentionDays: number;
}> {
  const eventsDays = retentionDays("BOT_EVENTS_RETENTION_DAYS", 180);
  const loginsDays = retentionDays("OPERATOR_LOGIN_ATTEMPTS_RETENTION_DAYS", 90);
  const eventsCutoff = new Date(Date.now() - eventsDays * 24 * 60 * 60 * 1000).toISOString();
  const loginsCutoff = new Date(Date.now() - loginsDays * 24 * 60 * 60 * 1000).toISOString();

  const [events, logins] = await Promise.all([
    pruneByAt("bot_events", eventsCutoff),
    pruneByAt("operator_login_attempts", loginsCutoff),
  ]);

  return { events, logins, eventsRetentionDays: eventsDays, loginsRetentionDays: loginsDays };
}
