import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listIgCommentActions, listIgPollRuns } from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/log")({
  component: IgLogPage,
});

const STATUS_LABELS: Record<string, string> = {
  sent: "Отправлено",
  error: "Ошибка",
  excluded: "В исключениях",
  no_match: "Без совпадения",
  skipped_duplicate_user: "Уже писали",
  poll_error: "Ошибка опроса",
};

function IgLogPage() {
  const actionsQ = useQuery({ queryKey: ["ig-log"], queryFn: () => listIgCommentActions() });
  const pollsQ = useQuery({ queryKey: ["ig-poll-runs"], queryFn: () => listIgPollRuns() });
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const rows = useMemo(() => {
    const all = actionsQ.data ?? [];
    if (statusFilter === "all") return all;
    return all.filter((r: any) => r.status === statusFilter);
  }, [actionsQ.data, statusFilter]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Лог</h1>

      <div className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">Последние опросы (cron)</h2>
        {(pollsQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Пока нет записей опроса.</p>}
        <div className="space-y-2 text-sm">
          {(pollsQ.data ?? []).slice(0, 5).map((p: any) => (
            <div key={p.id} className="border-b pb-2 last:border-0">
              <span className="text-muted-foreground">{new Date(p.started_at).toLocaleString("ru-RU")}</span>
              {" · "}
              <span>{p.status}</span>
              {" · "}
              комментариев {p.comments_scanned}, совпадений {p.matched}, отправлено {p.sent}
              {p.note && <span className="text-muted-foreground"> · {p.note}</span>}
              {p.errors && <div className="text-destructive text-xs mt-0.5">{p.errors}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm">
          Статус:{" "}
          <select
            className="border rounded px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Все</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Время</th>
              <th className="p-2">Статус</th>
              <th className="p-2">Правило</th>
              <th className="p-2">Пользователь</th>
              <th className="p-2">Комментарий</th>
              <th className="p-2">Ошибка</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b align-top">
                <td className="p-2 whitespace-nowrap text-muted-foreground">
                  {r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}
                </td>
                <td className="p-2">{STATUS_LABELS[r.status] || r.status}</td>
                <td className="p-2">{r.keyword_label || "—"}</td>
                <td className="p-2">
                  {r.username ? `@${String(r.username).replace(/^@/, "")}` : "—"}
                </td>
                <td className="p-2 max-w-xs truncate" title={r.comment_text || ""}>
                  {r.comment_text || "—"}
                </td>
                <td className="p-2 text-destructive text-xs">{r.error_message || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !actionsQ.isLoading && (
          <p className="p-4 text-muted-foreground text-sm">
            Пока пусто. После «Проверить сейчас» на дашборде здесь появятся записи.
          </p>
        )}
      </div>
    </div>
  );
}
