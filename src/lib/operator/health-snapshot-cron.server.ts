import { callInternal, type InternalTarget } from "./internal-client.server";
import type { BotHealthReport } from "./bots.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/** Снимки старше этого возраста крон подчищает сам — отдельного крона ретеншна не заводим. */
const RETENTION_DAYS = 30;

/**
 * Снимок состояния каждого бота — источник «Истории падений» на карточке
 * клиента. Тот же обход, что у loadHealthAll() для панели, но без
 * requireOperator(): крон приходит без сессии оператора, его впускает
 * CONTROL_PLANE + CRON_SECRET на самом роуте (см. api/operator-cron/health-snapshot.ts).
 */
export async function recordHealthSnapshots(): Promise<{ inserted: number; pruned: number }> {
  const s = await db();
  const { data: bots, error } = await s.from("bots").select("id, app_url, internal_secret");
  if (error) throw new Error(`Не удалось получить клиентов: ${error.message}`);

  const rows = await Promise.all(
    (bots ?? []).map(async (bot: InternalTarget & { id: string }) => {
      const res = await callInternal<{ report: BotHealthReport }>(bot, "/api/internal/health", {});
      if (res.ok && res.body?.report) {
        return {
          bot_id: bot.id,
          ok: true,
          error: res.body.report.last_error,
          pending_updates: res.body.report.pending_updates,
        };
      }
      // "skipped" (карточка не заполнена) не пишем — это не падение бота, а
      // недоделанная настройка, и раздувало бы историю пустыми снимками.
      if (!res.ok && res.kind === "skipped") return null;
      return {
        bot_id: bot.id,
        ok: false,
        error: res.ok ? "деплой ответил без отчёта" : res.error,
        pending_updates: null,
      };
    }),
  );

  const toInsert = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  if (toInsert.length > 0) {
    const { error: insertErr } = await s.from("bot_health_snapshots").insert(toInsert);
    if (insertErr) throw new Error(`Не удалось записать снимки: ${insertErr.message}`);
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: doomed, error: selErr } = await s
    .from("bot_health_snapshots")
    .select("id")
    .lt("at", cutoff)
    .limit(2000);
  if (selErr) throw new Error(`Не удалось найти старые снимки: ${selErr.message}`);
  let pruned = 0;
  if (doomed && doomed.length > 0) {
    const { error: delErr } = await s
      .from("bot_health_snapshots")
      .delete()
      .in(
        "id",
        doomed.map((r) => r.id),
      );
    if (delErr) throw new Error(`Не удалось удалить старые снимки: ${delErr.message}`);
    pruned = doomed.length;
  }

  return { inserted: toInsert.length, pruned };
}
