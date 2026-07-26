import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listIgCommentActions } from "@/lib/ig.functions";

export const Route = createFileRoute("/admin/ig/log")({
  component: IgLogPage,
});

function IgLogPage() {
  const q = useQuery({ queryKey: ["ig-log"], queryFn: () => listIgCommentActions() });
  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Лог действий</h1>
      <p className="text-sm text-muted-foreground">Последние 200 обработанных комментариев / DM.</p>

      <div className="overflow-x-auto border rounded-lg bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Время</th>
              <th className="p-2">Статус</th>
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
                <td className="p-2">{r.status}</td>
                <td className="p-2">
                  {r.username ? `@${String(r.username).replace(/^@/, "")}` : "—"}
                  <div className="font-mono text-xs text-muted-foreground">{r.provider_user_id}</div>
                </td>
                <td className="p-2 max-w-xs truncate" title={r.comment_text || ""}>
                  {r.comment_text || "—"}
                </td>
                <td className="p-2 text-destructive text-xs">{r.error_message || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !q.isLoading && (
          <p className="p-4 text-muted-foreground text-sm">Пока пусто.</p>
        )}
      </div>
    </div>
  );
}
