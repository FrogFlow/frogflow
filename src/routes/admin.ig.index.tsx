import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { getIgDashboard, migrateIgRulePostIds, runIgPollNow, debugIgRuleComments } from "@/lib/ig.functions";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/ig/")({
  component: IgDashboardPage,
});

function IgDashboardPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ig-dashboard"], queryFn: () => getIgDashboard() });
  const d = q.data;
  const [pollBusy, setPollBusy] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [debugBusy, setDebugBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onPollNow() {
    setPollBusy(true);
    setMsg("");
    try {
      const r = await runIgPollNow();
      setMsg(
        `Опрос: комментариев ${r.scanned}, совпадений ${r.matched}, отправлено ${r.sent}` +
          (r.errors?.length ? `. Ошибки: ${r.errors.join("; ")}` : "") +
          (r.skippedReason ? `. ${r.skippedReason}` : "") +
          (r.note ? `. ${r.note}` : ""),
      );
      qc.invalidateQueries({ queryKey: ["ig-dashboard"] });
      qc.invalidateQueries({ queryKey: ["ig-log"] });
      qc.invalidateQueries({ queryKey: ["ig-poll-runs"] });
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setPollBusy(false);
    }
  }

  async function onDebug() {
    setDebugBusy(true);
    setMsg("");
    try {
      const r = await debugIgRuleComments({ data: {} });
      const lines = r.results.map((x) => {
        const attempts = x.attempts
          .map((a) => `${a.postIdTried}→${a.count}${a.path ? ` via ${a.path}` : ""}${a.error ? ` (${a.error})` : ""}`)
          .join("; ");
        const sample = x.samples?.[0];
        const sampleIds = sample
          ? ` sample: dedupe=${sample.dedupeUserId || "—"}, dm=${sample.dmRecipientId || "—"}, comment=${sample.commentUnipileId || "—"}`
          : "";
        return `«${x.keyword}»: найдено ${x.commentsFound}. canonical=${x.canonicalCommentsPostId || x.storedPostId}. v2DM=${x.v2MessagingDisabled ? "off" : "on"}. Пробовали: ${attempts || "—"}${sampleIds}`;
      });
      setMsg(lines.length ? lines.join("\n") : "Нет активных правил");
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setDebugBusy(false);
    }
  }

  async function onMigrate() {
    setMigrateBusy(true);
    setMsg("");
    try {
      const r = await migrateIgRulePostIds();
      setMsg(`Обновлено правил: ${r.updated}` + (r.errors?.length ? `. Ошибки: ${r.errors.join("; ")}` : ""));
      qc.invalidateQueries({ queryKey: ["ig-keywords"] });
      qc.invalidateQueries({ queryKey: ["ig-dashboard"] });
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setMigrateBusy(false);
    }
  }

  const last = d?.lastPoll as any;
  const warnNoComments =
    d?.dmEnabled && (d?.counts.keywords ?? 0) > 0 && last && last.comments_scanned === 0 && last.status !== "skipped";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Instagram — дашборд</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => void onMigrate()} disabled={migrateBusy}>
            {migrateBusy ? "…" : "Исправить post_id"}
          </Button>
          <Button variant="outline" onClick={() => void onDebug()} disabled={debugBusy}>
            {debugBusy ? "…" : "Диагностика"}
          </Button>
          <Button onClick={() => void onPollNow()} disabled={pollBusy}>
            {pollBusy ? "Проверяю…" : "Проверить сейчас"}
          </Button>
        </div>
      </div>

      {msg && <p className="text-sm bg-muted border rounded-lg p-3 whitespace-pre-wrap">{msg}</p>}

      {q.isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}

      {d && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Активных правил" value={d.counts.keywords} />
            <Stat label="Исключения" value={d.counts.exclusions} />
            <Stat label="Записей в логе" value={d.counts.actions} />
            <Stat
              label="Последний опрос"
              value={last ? last.comments_scanned : "—"}
              sub={last?.started_at ? new Date(last.started_at).toLocaleString("ru-RU") : undefined}
            />
          </div>

          <div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
            <Check ok={d.configured} label="Unipile API настроен" />
            <Check ok={Boolean(d.accountId)} label={`Аккаунт: ${d.accountName || d.accountId || "не подключён"}`} />
            <Check ok={d.dmEnabled} label="Авто-DM включён" />
            <Check ok={(d.counts.keywords ?? 0) > 0} label="Есть активные правила" />
            {last && (
              <p className="text-muted-foreground pt-1">
                Последний cron: {last.status} — опрошено постов {last.posts_polled}, комментариев{" "}
                {last.comments_scanned}, отправлено {last.sent}
                {last.errors ? ` · ошибка: ${last.errors}` : ""}
                {last.note ? ` · ${last.note}` : ""}
              </p>
            )}
          </div>

          {warnNoComments && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Комментарии не найдены при последнем опросе. Нажмите «Исправить post_id», затем «Проверить сейчас».
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/admin/ig/keywords">+ Правило</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/ig/account">Аккаунт</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/ig/log">Лог</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p>
      <span className={ok ? "text-green-700" : "text-destructive"}>{ok ? "✓" : "✗"}</span> {label}
    </p>
  );
}
