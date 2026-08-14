import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listBotsFn } from "@/lib/operator/bots.functions";
import { Badge } from "@/components-ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components-ui/table";

export const Route = createFileRoute("/operator/_authed/")({
  head: () => ({ meta: [{ title: "Клиенты — панель оператора" }] }),
  component: OperatorClientsPage,
});

const STATUS_LABEL: Record<
  string,
  { text: string; variant: "default" | "secondary" | "destructive" }
> = {
  active: { text: "Активен", variant: "default" },
  paused: { text: "Пауза", variant: "secondary" },
  suspended: { text: "Приостановлен", variant: "destructive" },
};

function OperatorClientsPage() {
  const bots = useQuery({ queryKey: ["operator_bots"], queryFn: () => listBotsFn() });
  const list = bots.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Клиенты</h1>
          <p className="text-sm text-muted-foreground mt-1">{list.length} клиентов на общей базе</p>
        </div>
        <Link
          to="/operator/onboard"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 shrink-0"
        >
          Подключить клиента
        </Link>
      </div>

      {bots.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {bots.isError && (
        <p className="text-sm text-destructive">
          {(bots.error as Error)?.message || "Не удалось загрузить список"}
        </p>
      )}

      {list.length > 0 && (
        <div className="bg-card border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Подписка до</TableHead>
                <TableHead>Деплой</TableHead>
                <TableHead>Заметки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((bot) => {
                const st = STATUS_LABEL[bot.status] ?? {
                  text: bot.status,
                  variant: "outline" as const,
                };
                return (
                  <TableRow key={bot.id}>
                    <TableCell>
                      <Link
                        to="/operator/$botId"
                        params={{ botId: bot.id }}
                        className="font-medium hover:underline"
                      >
                        {bot.bot_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.text}</Badge>
                    </TableCell>
                    <TableCell>
                      {bot.owner_name || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {bot.subscription_expires_at ? (
                        new Date(bot.subscription_expires_at).toLocaleDateString("ru-RU")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {bot.app_url ? (
                        <a
                          href={bot.app_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          деплой ↗
                        </a>
                      ) : (
                        <span className="text-muted-foreground">не задан</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {bot.notes || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
