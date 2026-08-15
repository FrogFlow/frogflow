import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listBotsFn, listStatsFn, listHealthFn } from "@/lib/operator/bots.functions";
import { formatBytes, daysSince } from "@/lib/operator/format";
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

const SUB_LABEL: Record<
  string,
  { text: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  no_data: { text: "нет данных", variant: "outline" },
  ok: { text: "оплачена", variant: "default" },
  expiring: { text: "скоро истекает", variant: "secondary" },
  overdue: { text: "просрочена", variant: "destructive" },
  grace_over: { text: "отсрочка кончилась", variant: "destructive" },
};

function OperatorClientsPage() {
  // Архивные по умолчанию скрыты, но должны быть доступны: иначе убранный
  // клиент исчезает из панели совсем, вместе с кнопкой «Вернуть из архива» на
  // своей карточке — попасть на неё становится неоткуда.
  const [showArchived, setShowArchived] = useState(false);
  const bots = useQuery({
    queryKey: ["operator_bots", showArchived],
    queryFn: () => listBotsFn({ data: { includeArchived: showArchived } }),
  });
  // Отдельным запросом: сводка тяжелее списка (считает место в хранилище), и
  // таблица не должна ждать её, чтобы отрисоваться.
  const stats = useQuery({ queryKey: ["operator_stats"], queryFn: () => listStatsFn() });
  // Здоровье — тоже отдельно: обход всех деплоев занимает секунды, а таблица
  // должна появиться сразу. Обновляем раз в минуту, чтобы упавший бот не ждал
  // перезагрузки страницы.
  const health = useQuery({
    queryKey: ["operator_health"],
    queryFn: () => listHealthFn(),
    refetchInterval: 60_000,
  });
  const list = bots.data ?? [];
  const troubled = Object.values(health.data ?? {}).filter((h) => !h.ok).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Клиенты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {list.length} клиентов на общей базе
            {health.isLoading && " · проверяю ботов…"}
            {!health.isLoading && health.data && troubled > 0 && (
              <span className="text-destructive"> · не отвечают: {troubled}</span>
            )}
            {!health.isLoading && health.data && troubled === 0 && " · все боты отвечают"}
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-muted-foreground">Показывать архивных</span>
          </label>
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
                <TableHead>Бот</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Подписка</TableHead>
                <TableHead>Заказы за 30 дн</TableHead>
                <TableHead>Место</TableHead>
                <TableHead>Деплой</TableHead>
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
                      {bot.archived_at && (
                        <Badge variant="outline" className="ml-2">
                          в архиве
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <HealthCell h={health.data?.[bot.id]} loading={health.isLoading} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.text}</Badge>
                    </TableCell>
                    <TableCell>
                      {bot.owner_name || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <SubCell bot={bot} />
                    </TableCell>
                    <TableCell>
                      <OrdersCell s={stats.data?.[bot.id]} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {stats.data?.[bot.id] ? formatBytes(stats.data[bot.id].storage_bytes) : "…"}
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

/** Состояние подписки + дата одной ячейкой: просрочку должно быть видно, не открывая карточку. */
function SubCell({
  bot,
}: {
  bot: {
    subscription_state: string;
    subscription_expires_at: string | null;
    subscription_days_left: number | null;
  };
}) {
  const label = SUB_LABEL[bot.subscription_state] ?? SUB_LABEL.no_data;
  if (bot.subscription_state === "no_data") {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={label.variant} className="w-fit">
        {label.text}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {bot.subscription_expires_at &&
          new Date(bot.subscription_expires_at).toLocaleDateString("ru-RU")}
        {bot.subscription_days_left !== null &&
          bot.subscription_days_left < 0 &&
          ` · +${-bot.subscription_days_left} дн.`}
      </span>
    </div>
  );
}

/**
 * Заказы за месяц плюс дата последнего. Молчание бота — главный признак, что
 * с клиентом что-то не так, поэтому давнее «последний заказ» подсвечивается.
 */
function OrdersCell({
  s,
}: {
  s?: { orders_30d: number; orders_total: number; last_order_at: string | null };
}) {
  if (!s) return <span className="text-muted-foreground">…</span>;
  const last = s.last_order_at ? new Date(s.last_order_at) : null;
  const days = daysSince(s.last_order_at);
  const stale = days !== null && days > 14;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{s.orders_30d}</span>
      <span className={`text-xs ${stale ? "text-amber-700" : "text-muted-foreground"}`}>
        {last === null ? "заказов не было" : days === 0 ? "сегодня" : `${days} дн. назад`}
      </span>
    </div>
  );
}

/**
 * Здоровье бота одной ячейкой. Три вещи, из-за которых магазин молча стоит:
 * деплой не отвечает, вебхук не установлен, апдейты копятся в очереди. Всё
 * это раньше было видно только по кнопке внутри карточки — то есть только
 * если заранее знать, к кому заходить.
 */
function HealthCell({
  h,
  loading,
}: {
  h?:
    | {
        ok: true;
        report: {
          webhook_url: string | null;
          pending_updates: number | null;
          last_error: string | null;
        };
      }
    | { ok: false; kind: string; error: string };
  loading: boolean;
}) {
  if (loading || !h) return <span className="text-muted-foreground text-sm">…</span>;

  if (!h.ok) {
    // «Не заполнена карточка» — это не поломка бота, а недоделанная настройка.
    const isSetup = h.kind === "skipped";
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant={isSetup ? "outline" : "destructive"} className="w-fit">
          {isSetup ? "не настроен" : "не отвечает"}
        </Badge>
        <span className="text-xs text-muted-foreground max-w-[16rem] truncate" title={h.error}>
          {h.error}
        </span>
      </div>
    );
  }

  const queued = h.report.pending_updates ?? 0;
  if (!h.report.webhook_url) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="destructive" className="w-fit">
          нет вебхука
        </Badge>
        <span className="text-xs text-muted-foreground">бот не получает сообщений</span>
      </div>
    );
  }
  if (queued > 0 || h.report.last_error) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="destructive" className="w-fit">
          {queued > 0 ? `очередь ${queued}` : "ошибка"}
        </Badge>
        <span
          className="text-xs text-muted-foreground max-w-[16rem] truncate"
          title={h.report.last_error ?? ""}
        >
          {queued > 0 ? "апдейты не разбираются" : h.report.last_error}
        </span>
      </div>
    );
  }
  return <Badge className="w-fit">отвечает</Badge>;
}
