import { createFileRoute, Link } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  listBotsFn,
  listStatsFn,
  listStorageByKindFn,
  listHealthFn,
  checkReadinessAllFn,
} from "@/lib/operator/bots.functions";
import { listPendingModuleRequestsFn } from "@/lib/operator/module-requests.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { formatBytes, daysSince } from "@/lib/operator/format";
import { Badge } from "@/components-ui/badge";
import { StorageDonut, DonutLegendRow, buildDonutSegments } from "@/components-ui/storage-donut";
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
  const [search, setSearch] = useState("");
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
  const moduleRequests = useQuery({
    queryKey: ["operator_module_requests"],
    queryFn: () => listPendingModuleRequestsFn(),
  });
  // Тоже отдельным запросом — та же причина, что у stats выше: считает
  // размеры объектов в Storage, тяжелее списка.
  const storageByKind = useQuery({
    queryKey: ["operator_storage_by_kind"],
    queryFn: () => listStorageByKindFn(),
  });
  const list = bots.data ?? [];
  const troubled = Object.values(health.data ?? {}).filter((h) => !h.ok).length;

  // Клиентская фильтрация: клиентов немного, бэкенд-поиск не нужен.
  // «Требует внимания» и счётчик неотвечающих считаются по полному списку —
  // поиск сужает только таблицу, чтобы не спрятать проблему у клиента,
  // которого не искали.
  const q = search.trim().toLowerCase();
  const filteredList = q
    ? list.filter((b) => `${b.bot_name} ${b.owner_name ?? ""}`.toLowerCase().includes(q))
    : list;

  /**
   * Что требует внимания — одной строкой сверху. Состояние и так рассыпано по
   * колонкам, но чтобы ответить «всё ли нормально сегодня», приходилось
   * просматривать таблицу целиком.
   */
  const who = (bots: typeof list) => bots.map((b) => ({ id: b.id, bot_name: b.bot_name }));
  const attention: { text: string; who: { id: string; bot_name: string }[] }[] = [];
  const overdue = list.filter((b) => ["overdue", "grace_over"].includes(b.subscription_state));
  if (overdue.length) attention.push({ text: "просрочена подписка", who: who(overdue) });
  const dead = list.filter((b) => health.data?.[b.id] && !health.data[b.id].ok);
  if (dead.length) attention.push({ text: "бот не отвечает", who: who(dead) });
  const queued = list.filter((b) => {
    const h = health.data?.[b.id];
    return h?.ok && (h.report.pending_updates ?? 0) > 0;
  });
  if (queued.length) attention.push({ text: "копится очередь апдейтов", who: who(queued) });
  const noOwner = list.filter((b) => !b.has_owner_telegram_id && !b.archived_at);
  if (noOwner.length)
    attention.push({
      text: "не заполнен Telegram владельца — не написать",
      who: who(noOwner),
    });
  const noUrl = list.filter((b) => !b.app_url && !b.archived_at);
  if (noUrl.length) attention.push({ text: "не указан адрес деплоя", who: who(noUrl) });
  const requestedBotIds = new Set((moduleRequests.data ?? []).map((r) => r.bot_id));
  const wantsModule = list.filter((b) => requestedBotIds.has(b.id));
  if (wantsModule.length)
    attention.push({ text: "заказал подключение модуля", who: who(wantsModule) });

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
        <div className="flex items-center gap-2 shrink-0">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или владельцу…"
            className="w-56"
          />
          <Link
            to="/operator/onboard"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 shrink-0"
          >
            Подключить клиента
          </Link>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-900 space-y-1">
          <p className="font-medium text-sm text-amber-900 dark:text-amber-200">Требует внимания</p>
          {attention.map((a) => (
            <p key={a.text} className="text-sm text-amber-900 dark:text-amber-200/90">
              {a.text}:{" "}
              {a.who.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ", "}
                  <Link
                    to="/operator/$botId"
                    params={{ botId: b.id }}
                    className="font-medium hover:underline"
                  >
                    {b.bot_name}
                  </Link>
                </span>
              ))}
            </p>
          ))}
        </div>
      )}

      <ReadinessAll bots={list} />

      {bots.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {bots.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(bots.error) || "Не удалось загрузить список"}
        </p>
      )}

      {list.length > 0 && filteredList.length === 0 && (
        <p className="text-sm text-muted-foreground">Ничего не найдено по «{search}».</p>
      )}

      {filteredList.length > 0 && (
        <div className="bg-card border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Бот</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Модули</TableHead>
                <TableHead>Подписка</TableHead>
                <TableHead>Заказы за 30 дн</TableHead>
                <TableHead>Место</TableHead>
                <TableHead>Деплой</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredList.map((bot) => {
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
                      <ModulesCell modules={bot.modules} />
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

      <StorageOverview bots={list} byKind={storageByKind.data} loading={storageByKind.isLoading} />
    </div>
  );
}

// Диск Supabase Pro на момент внедрения (см. переписку с клиентом) — 100 GB
// в десятичных гигабайтах, как у Supabase в тарифах, не гибибайты.
const STORAGE_LIMIT_BYTES = 100 * 1000 * 1000 * 1000;

/**
 * Донат «сколько места занял каждый клиент» + свободный остаток от лимита
 * тарифа. Данные — из operator_storage_by_kind() (MIGRATION-39), просуммированные
 * по клиенту: тот же источник, что и у разбивки на карточке клиента, поэтому
 * сумма секторов здесь не может разойтись с суммой секторов там.
 */
function StorageOverview({
  bots,
  byKind,
  loading,
}: {
  bots: { id: string; bot_name: string }[];
  byKind?: Record<string, { kind: string; bytes: number }[]>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="space-y-3 pt-2">
        <h2 className="text-lg font-semibold">Хранилище</h2>
        <p className="text-sm text-muted-foreground">Считаю занятое место…</p>
      </section>
    );
  }
  if (!byKind) return null;

  const totalsByBot = bots.map((bot) => ({
    id: bot.id,
    bot_name: bot.bot_name,
    bytes: (byKind[bot.id] ?? []).reduce((sum, row) => sum + row.bytes, 0),
  }));
  const totalUsed = totalsByBot.reduce((sum, b) => sum + b.bytes, 0);
  const free = Math.max(0, STORAGE_LIMIT_BYTES - totalUsed);

  const segments = buildDonutSegments(
    totalsByBot.filter((b) => b.bytes > 0),
    (b) => b.id,
    (b) => b.bot_name,
    (b) => b.bytes,
  );
  segments.push({ key: "__free__", label: "Свободно", bytes: free, color: "var(--muted)" });

  return (
    <section className="space-y-3 pt-2">
      <div>
        <h2 className="text-lg font-semibold">Хранилище</h2>
        <p className="text-sm text-muted-foreground">
          {formatBytes(totalUsed)} занято из {formatBytes(STORAGE_LIMIT_BYTES)} (лимит тарифа
          Supabase)
        </p>
      </div>
      <div className="bg-card border rounded-lg p-4 flex flex-wrap items-center gap-6">
        <StorageDonut
          segments={segments}
          centerLabel={formatBytes(totalUsed)}
          centerSublabel="занято"
          formatValue={formatBytes}
        />
        <div className="flex-1 min-w-[14rem] space-y-1.5">
          {segments.map((s) => (
            <DonutLegendRow
              key={s.key}
              segment={s}
              valueLabel={`${formatBytes(s.bytes)} · ${totalUsed + free > 0 ? Math.round((s.bytes / (totalUsed + free)) * 100) : 0}%`}
            />
          ))}
        </div>
      </div>
    </section>
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

/**
 * Что куплено — коротко. Полный список из четырнадцати ключей в строку не
 * влезет и не нужен: важно видеть платные, за которые клиент заплатил
 * отдельно, а остальное — числом.
 */
function ModulesCell({ modules }: { modules: ModuleKey[] }) {
  const paid = modules.filter((k) => moduleDef(k).price != null);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">{modules.length}</span>
      {paid.length > 0 && (
        <span
          className="text-xs text-muted-foreground max-w-[14rem] truncate"
          title={paid.map((k) => moduleDef(k).title).join(", ")}
        >
          {paid.map((k) => moduleDef(k).title).join(", ")}
        </span>
      )}
    </div>
  );
}

/**
 * Проверка готовности по всем сразу. Та же, что на карточке, но после общего
 * обновления кода обойти пятерых по одному — пять заходов вместо одного.
 */
/**
 * Раньше при находке проблем говорила только «не готовы: 2 из 5» — какие
 * именно клиенты и что у них не так, приходилось искать открытием каждой
 * карточки по очереди. Теперь неполадки видны сразу под кнопкой: имя
 * клиента (ссылкой на карточку) и все пункты, что не в порядке, тем же
 * текстом, что и в разделе «Готовность» самой карточки.
 */
function ReadinessAll({ bots }: { bots: { id: string; bot_name: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof checkReadinessAllFn>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(bots.map((b) => [b.id, b.bot_name]));

  async function run() {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      setRes(await checkReadinessAllFn());
    } catch (e: unknown) {
      setError(errorMessage(e) || "Не удалось проверить");
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(res ?? {});
  const bad = entries.filter(([, r]) => !r.ok);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? "Проверяю всех…" : "Проверить готовность всех"}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
        {res && (
          <span className="text-sm">
            {bad.length === 0 ? (
              <span className="text-green-600 dark:text-green-500">
                Все {entries.length} в порядке
              </span>
            ) : (
              <span className="text-destructive">
                Не готовы: {bad.length} из {entries.length}
              </span>
            )}
          </span>
        )}
      </div>

      {bad.length > 0 && (
        <div className="border rounded-lg p-3 bg-destructive/5 border-destructive/30 space-y-3">
          {bad.map(([botId, r]) => (
            <div key={botId} className="text-sm">
              <Link
                to="/operator/$botId"
                params={{ botId }}
                className="font-medium hover:underline"
              >
                {names.get(botId) ?? botId}
              </Link>
              <ul className="mt-1 ml-4 list-disc space-y-0.5">
                {r.checks
                  .filter((c) => c.level !== "ok")
                  .map((c, i) => (
                    <li key={i}>
                      <span
                        className={
                          c.level === "fail"
                            ? "text-destructive font-medium"
                            : "text-amber-700 dark:text-amber-500 font-medium"
                        }
                      >
                        {c.name}
                      </span>
                      <span className="text-muted-foreground"> — {c.detail}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
