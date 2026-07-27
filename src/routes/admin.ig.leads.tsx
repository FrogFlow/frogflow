import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listIgLeads } from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/leads")({
  component: IgLeadsPage,
});

const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  pending: "Ожидает retry",
  dm_sent: "DM отправлен",
  dm_failed: "Ошибка отправки",
  dm_gave_up: "Недоступен",
  post_disabled: "Пост выключен",
};

function IgLeadsPage() {
  const q = useQuery({ queryKey: ["ig-leads"], queryFn: () => listIgLeads() });
  const [status, setStatus] = useState("all");

  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (status === "all") return all;
    return all.filter((r: any) => r.dm_status === status);
  }, [q.data, status]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Лиды Instagram</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Здесь видно пользователей по каждому посту, их последний комментарий, статус директ-сообщения и pending retry.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm">
          Статус:{" "}
          <select
            className="border rounded px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
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
              <th className="p-2">Обновлено</th>
              <th className="p-2">Статус</th>
              <th className="p-2">Пост</th>
              <th className="p-2">Правило</th>
              <th className="p-2">Пользователь</th>
              <th className="p-2">Комментарий</th>
              <th className="p-2">Попытки</th>
              <th className="p-2">Следующий retry</th>
              <th className="p-2">Ошибка</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b align-top">
                <td className="p-2 whitespace-nowrap text-muted-foreground">
                  {r.updated_at ? new Date(r.updated_at).toLocaleString("ru-RU") : "—"}
                </td>
                <td className="p-2">{STATUS_LABELS[r.dm_status] || r.dm_status}</td>
                <td className="p-2 max-w-xs">
                  <div className="font-mono text-xs break-all">{r.post_id}</div>
                  {r.post_note && <div className="text-xs text-muted-foreground mt-1">{r.post_note}</div>}
                </td>
                <td className="p-2">{r.keyword_label || "—"}</td>
                <td className="p-2">{r.username ? `@${String(r.username).replace(/^@/, "")}` : r.provider_user_id}</td>
                <td className="p-2 max-w-sm whitespace-pre-wrap">{r.last_comment_text || "—"}</td>
                <td className="p-2">{r.dm_attempts}</td>
                <td className="p-2 whitespace-nowrap text-muted-foreground">
                  {r.next_retry_at ? new Date(r.next_retry_at).toLocaleString("ru-RU") : "—"}
                </td>
                <td className="p-2 text-destructive text-xs">{r.last_error || r.closed_reason || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !q.isLoading && (
          <p className="p-4 text-muted-foreground text-sm">Пока нет лидов.</p>
        )}
      </div>
    </div>
  );
}
