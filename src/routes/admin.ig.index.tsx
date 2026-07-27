import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getIgDashboard } from "@/lib/ig.functions";
import { Button } from "@/components-ui/button";

export const Route = createFileRoute("/admin/ig/")({
  component: IgDashboardPage,
});

function IgDashboardPage() {
  const q = useQuery({ queryKey: ["ig-dashboard"], queryFn: () => getIgDashboard() });
  const d = q.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Instagram — дашборд</h1>

      {q.isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}

      {d && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Правила" value={d.counts.keywords} />
            <Stat label="Посты в слежении" value={d.counts.posts} />
            <Stat label="Исключения" value={d.counts.exclusions} />
            <Stat label="Действий в логе" value={d.counts.actions} />
          </div>

          <div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
            <p>
              Unipile API:{" "}
              <span className={d.configured ? "text-green-700" : "text-destructive"}>
                {d.configured ? "настроен" : "нет ключей (UNIPILE_DSN / UNIPILE_API_KEY)"}
              </span>
            </p>
            <p>
              Аккаунт: {d.accountId ? `${d.accountName || "—"} (${d.accountId})` : "не подключён"}
            </p>
            <p>Статус: {d.accountStatus || "—"}</p>
            <p>
              Авто-DM:{" "}
              <span className={d.dmEnabled ? "text-green-700" : "text-amber-700"}>
                {d.dmEnabled ? "включён" : "выключен"}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/admin/ig/account">Аккаунт</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/ig/keywords">Правила</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/ig/posts">Посты</Link>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
