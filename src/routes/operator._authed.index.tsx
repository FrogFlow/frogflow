import { createFileRoute, Link } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listBotsFn,
  listStatsFn,
  listStorageByKindFn,
  listHealthFn,
  checkReadinessAllFn,
  exportClientsCsvFn,
  setModuleFn,
  updateBotMetaFn,
  listFeedFn,
} from "@/lib/operator/bots.functions";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components-ui/chart";
import { listPendingModuleRequestsFn } from "@/lib/operator/module-requests.functions";
import { getRevenueSummaryFn, getRevenueByMonthFn } from "@/lib/operator/subscriptions.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components-ui/dropdown-menu";
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

type SortKey = "bot_name" | "modules" | "subscription" | "orders" | "storage";

/** Клиент/Бот/Статус — обязательные, не скрываются. Остальные можно спрятать. */
const COLUMN_DEFS: { key: string; label: string }[] = [
  { key: "owner", label: "Владелец" },
  { key: "modules", label: "Модули" },
  { key: "subscription", label: "Подписка" },
  { key: "orders", label: "Заказы за 30 дн" },
  { key: "storage", label: "Место" },
  { key: "deploy", label: "Деплой" },
];

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  return (
    <TableHead className="cursor-pointer select-none" onClick={() => onClick(sortKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs ${isActive ? "" : "opacity-0"}`}>
          {isActive && dir === "asc" ? "▲" : "▼"}
        </span>
      </span>
    </TableHead>
  );
}

function OperatorClientsPage() {
  const qc = useQueryClient();
  // Архивные по умолчанию скрыты, но должны быть доступны: иначе убранный
  // клиент исчезает из панели совсем, вместе с кнопкой «Вернуть из архива» на
  // своей карточке — попасть на неё становится неоткуда.
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  // Групповые действия: выделение не зависит от фильтров — если сузить
  // список фильтром и выделить ещё, старое выделение не теряется.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [bulkModule, setBulkModule] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Фильтры сверх текстового поиска — тоже клиентские: подписка и здоровье
  // уже приходят в списке/health, модуль — по факту наличия в bot.modules.
  const [filterSub, setFilterSub] = useState("all");
  const [filterHealth, setFilterHealth] = useState("all");
  const [filterModule, setFilterModule] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("bot_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Закреплённые клиенты — личное предпочтение оператора, не данные для
  // аудита или синхронизации между устройствами, поэтому localStorage, как и
  // у дайджеста «с прошлого захода» выше по этому же файлу.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("operator_pinned_bots");
      if (raw) setPinnedIds(new Set(JSON.parse(raw)));
    } catch {
      // localStorage недоступен — просто ничего не закреплено, не критично.
    }
  }, []);
  function togglePin(id: string) {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("operator_pinned_bots", JSON.stringify([...next]));
      } catch {
        // см. комментарий выше
      }
      return next;
    });
  }
  // Хранится множество скрытых, а не показанных: так новая колонка, добавленная
  // позже в код, по умолчанию видна всем, а не пропадает у тех, кто уже настроил
  // список под себя.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("operator_hidden_columns");
      if (raw) setHiddenCols(new Set(JSON.parse(raw)));
    } catch {
      // localStorage недоступен — все колонки просто останутся видны.
    }
  }, []);
  function toggleColumn(key: string) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem("operator_hidden_columns", JSON.stringify([...next]));
      } catch {
        // см. комментарий выше
      }
      return next;
    });
  }
  const colVisible = (key: string) => !hiddenCols.has(key);
  // Реал-тайм в этой панели — не вебсокеты (7 клиентов, один оператор, не
  // стоит того), а частый опрос: та же идея, что уже была у health ниже,
  // просто применена ко всем запросам страницы. Разная частота — по цене
  // запроса: лёгкие (bots, module_requests, revenue) каждые 15 сек, тяжёлые
  // (obходят деплои или считают Storage) — реже.
  const bots = useQuery({
    queryKey: ["operator_bots", showArchived],
    queryFn: () => listBotsFn({ data: { includeArchived: showArchived } }),
    refetchInterval: 15_000,
  });
  // Отдельным запросом: сводка тяжелее списка (считает место в хранилище), и
  // таблица не должна ждать её, чтобы отрисоваться.
  const stats = useQuery({
    queryKey: ["operator_stats"],
    queryFn: () => listStatsFn(),
    refetchInterval: 30_000,
  });
  // Здоровье — тоже отдельно: обход всех деплоев занимает секунды, а таблица
  // должна появиться сразу.
  const health = useQuery({
    queryKey: ["operator_health"],
    queryFn: () => listHealthFn(),
    refetchInterval: 30_000,
  });
  const moduleRequests = useQuery({
    queryKey: ["operator_module_requests"],
    queryFn: () => listPendingModuleRequestsFn(),
    refetchInterval: 15_000,
  });
  // Тоже отдельным запросом — та же причина, что у stats выше: считает
  // размеры объектов в Storage, тяжелее списка.
  const storageByKind = useQuery({
    queryKey: ["operator_storage_by_kind"],
    queryFn: () => listStorageByKindFn(),
    refetchInterval: 60_000,
  });
  const revenue = useQuery({
    queryKey: ["operator_revenue"],
    queryFn: () => getRevenueSummaryFn(),
    refetchInterval: 15_000,
  });
  const revenueByMonth = useQuery({
    queryKey: ["operator_revenue_by_month"],
    queryFn: () => getRevenueByMonthFn(),
    refetchInterval: 15_000,
  });
  // Последние 50 записей журнала по всем клиентам — источник для дайджеста
  // «что изменилось с прошлого захода» ниже. Того же эндпоинта, что у
  // страницы «Журнал», лимит по умолчанию.
  const feed = useQuery({
    queryKey: ["operator_feed_recent"],
    queryFn: () => listFeedFn({ data: {} }),
    refetchInterval: 30_000,
  });
  const list = bots.data ?? [];
  const troubled = Object.values(health.data ?? {}).filter((h) => !h.ok).length;

  // Клиентская фильтрация: клиентов немного, бэкенд-поиск не нужен.
  // «Требует внимания» и счётчик неотвечающих считаются по полному списку —
  // поиск и фильтры сужают только таблицу, чтобы не спрятать проблему у
  // клиента, которого не искали и не выбрали в фильтре.
  const q = search.trim().toLowerCase();
  const filtersActive =
    filterSub !== "all" || filterHealth !== "all" || filterModule !== "all" || filterTag !== "all";
  const filteredList = list.filter((b) => {
    if (q && !`${b.bot_name} ${b.owner_name ?? ""}`.toLowerCase().includes(q)) return false;
    if (filterSub !== "all" && b.subscription_state !== filterSub) return false;
    if (filterHealth !== "all") {
      const h = health.data?.[b.id];
      const isOk = h?.ok === true;
      if (filterHealth === "ok" && !isOk) return false;
      if (filterHealth === "down" && !(h && !h.ok)) return false;
    }
    if (filterModule !== "all" && !b.modules.includes(filterModule as ModuleKey)) return false;
    if (filterTag !== "all" && !b.tags.includes(filterTag)) return false;
    return true;
  });

  // Сортировка по клику на заголовок. Клиентская, как и всё остальное на
  // этой странице — сравнивать 7 клиентов не то, ради чего заводить бэкенд.
  function sortValue(b: (typeof list)[number]): number | string {
    switch (sortKey) {
      case "bot_name":
        return b.bot_name.toLowerCase();
      case "modules":
        return b.modules.length;
      case "subscription":
        return b.subscription_days_left ?? Infinity;
      case "orders":
        return stats.data?.[b.id]?.orders_30d ?? -1;
      case "storage":
        return stats.data?.[b.id]?.storage_bytes ?? -1;
    }
  }
  const sortedList = [...filteredList].sort((a, b) => {
    // Закреплённые — всегда наверху, вне зависимости от выбранной колонки
    // сортировки; порядок сортировки применяется только внутри каждой
    // группы (закреплённые/остальные).
    const pinDiff = Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id));
    if (pinDiff !== 0) return pinDiff;
    const va = sortValue(a);
    const vb = sortValue(b);
    const cmp =
      typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb)
        : Number(va) - Number(vb);
    return sortDir === "asc" ? cmp : -cmp;
  });
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "bot_name" ? "asc" : "desc");
    }
  }
  // Список тегов для фильтра — только те, что реально кто-то проставил, а не
  // выдуманный заранее справочник: тегов пока нет нигде, кроме карточки клиента.
  const allTags = [...new Set(list.flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b));

  /**
   * Что требует внимания — одной строкой сверху. Состояние и так рассыпано по
   * колонкам, но чтобы ответить «всё ли нормально сегодня», приходилось
   * просматривать таблицу целиком.
   */
  const who = (bots: typeof list) => bots.map((b) => ({ id: b.id, bot_name: b.bot_name }));
  const attention: { text: string; who: { id: string; bot_name: string }[] }[] = [];
  const overdue = list.filter((b) => ["overdue", "grace_over"].includes(b.subscription_state));
  const expiringSoon = list.filter((b) => b.subscription_state === "expiring");
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
  // Молчание бота — тот же сигнал, что уже красит ячейку «Заказы за 30 дн»
  // амброй при 14+ днях; здесь порог жёстче (30) и клиент назван по имени,
  // а не просто подсвечен цветом в таблице.
  const noOrders = list.filter((b) => {
    if (b.archived_at || !stats.data?.[b.id]) return false;
    const days = daysSince(stats.data[b.id].last_order_at);
    return days === null || days > 30;
  });
  if (noOrders.length) attention.push({ text: "нет заказов 30+ дней", who: who(noOrders) });

  async function onExport() {
    setExporting(true);
    try {
      const res = await exportClientsCsvFn();
      const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(errorMessage(e) || "Не удалось выгрузить");
    } finally {
      setExporting(false);
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const b of filteredList) {
        if (checked) next.add(b.id);
        else next.delete(b.id);
      }
      return next;
    });
  }

  async function onBulkAddTag() {
    const tag = bulkTag.trim();
    if (!tag) return;
    setBulkBusy(true);
    try {
      const targets = list.filter((b) => selectedIds.has(b.id));
      await Promise.all(
        targets.map((b) =>
          updateBotMetaFn({ data: { botId: b.id, tags: [...new Set([...b.tags, tag])] } }),
        ),
      );
      await qc.invalidateQueries({ queryKey: ["operator_bots"] });
      toast.success(`Тег «${tag}» добавлен: ${targets.length} клиентам`);
      setBulkTag("");
    } catch (e: unknown) {
      toast.error(errorMessage(e) || "Не удалось добавить тег");
    } finally {
      setBulkBusy(false);
    }
  }

  async function onBulkEnableModule() {
    if (!bulkModule) return;
    setBulkBusy(true);
    try {
      const targets = [...selectedIds];
      const results = await Promise.allSettled(
        targets.map((id) =>
          setModuleFn({ data: { botId: id, key: bulkModule as ModuleKey, enabled: true } }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      await qc.invalidateQueries({ queryKey: ["operator_bots"] });
      const title = moduleDef(bulkModule as ModuleKey).title;
      if (failed > 0) {
        toast.error(`«${title}»: включён у ${targets.length - failed} из ${targets.length}`);
      } else {
        toast.success(`«${title}» включён у ${targets.length} клиентов`);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const allVisibleSelected =
    filteredList.length > 0 && filteredList.every((b) => selectedIds.has(b.id));
  const availableModules = MODULE_KEYS.filter((k) => moduleDef(k).status === "available");

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
          <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
            {exporting ? "Выгружаю…" : "Скачать CSV"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Столбцы
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Показывать столбцы</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_DEFS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={colVisible(c.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleColumn(c.key)}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            to="/operator/onboard"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 shrink-0"
          >
            Подключить клиента
          </Link>
        </div>
      </div>

      <SinceLastVisit feed={feed.data} moduleRequests={moduleRequests.data} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterSub} onValueChange={setFilterSub}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Все подписки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Подписка: все</SelectItem>
            {Object.entries(SUB_LABEL).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label.text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterHealth} onValueChange={setFilterHealth}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Все боты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Здоровье: все</SelectItem>
            <SelectItem value="ok">Отвечает</SelectItem>
            <SelectItem value="down">Не отвечает</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterModule} onValueChange={setFilterModule}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Все модули" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Модуль: все</SelectItem>
            {MODULE_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {moduleDef(k).title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Select value={filterTag} onValueChange={setFilterTag}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Все теги" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Тег: все</SelectItem>
              {allTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filtersActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilterSub("all");
              setFilterHealth("all");
              setFilterModule("all");
              setFilterTag("all");
            }}
          >
            Сбросить фильтры
          </Button>
        )}
      </div>

      <MoneySummary
        revenue={revenue.data}
        loading={revenue.isLoading}
        overdue={overdue}
        expiringSoon={expiringSoon}
        byMonth={revenueByMonth.data}
      />

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
        <p className="text-sm text-muted-foreground">
          {q ? `Ничего не найдено по «${search}».` : "Под фильтр не попал ни один клиент."}
        </p>
      )}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border rounded-lg p-3 bg-muted/40">
          <span className="text-sm font-medium">Выбрано: {selectedIds.size}</span>
          <Input
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            placeholder="Добавить тег…"
            className="w-40 h-8"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy || !bulkTag.trim()}
            onClick={onBulkAddTag}
          >
            Добавить тег
          </Button>
          <Select value={bulkModule} onValueChange={setBulkModule}>
            <SelectTrigger className="w-56 h-8">
              <SelectValue placeholder="Включить модуль…" />
            </SelectTrigger>
            <SelectContent>
              {availableModules.map((k) => (
                <SelectItem key={k} value={k}>
                  {moduleDef(k).title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy || !bulkModule}
            onClick={onBulkEnableModule}
          >
            Включить у выбранных
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Снять выделение
          </Button>
        </div>
      )}

      {filteredList.length > 0 && (
        <div className="bg-card border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                    className="accent-primary"
                    aria-label="Выбрать всех"
                  />
                </TableHead>
                <SortableHead
                  label="Клиент"
                  sortKey="bot_name"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
                <TableHead>Бот</TableHead>
                <TableHead>Статус</TableHead>
                {colVisible("owner") && <TableHead>Владелец</TableHead>}
                {colVisible("modules") && (
                  <SortableHead
                    label="Модули"
                    sortKey="modules"
                    active={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                )}
                {colVisible("subscription") && (
                  <SortableHead
                    label="Подписка"
                    sortKey="subscription"
                    active={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                )}
                {colVisible("orders") && (
                  <SortableHead
                    label="Заказы за 30 дн"
                    sortKey="orders"
                    active={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                )}
                {colVisible("storage") && (
                  <SortableHead
                    label="Место"
                    sortKey="storage"
                    active={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                )}
                {colVisible("deploy") && <TableHead>Деплой</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedList.map((bot) => {
                const st = STATUS_LABEL[bot.status] ?? {
                  text: bot.status,
                  variant: "outline" as const,
                };
                return (
                  <TableRow key={bot.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(bot.id)}
                        onChange={(e) => toggleRow(bot.id, e.target.checked)}
                        className="accent-primary"
                        aria-label={`Выбрать ${bot.bot_name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => togglePin(bot.id)}
                        className="inline-flex items-center align-text-bottom mr-1"
                        aria-label={pinnedIds.has(bot.id) ? "Открепить" : "Закрепить"}
                        title={pinnedIds.has(bot.id) ? "Открепить" : "Закрепить наверху"}
                      >
                        <Star
                          className={`h-3.5 w-3.5 ${
                            pinnedIds.has(bot.id)
                              ? "fill-amber-400 text-amber-500"
                              : "text-muted-foreground/40 hover:text-muted-foreground"
                          }`}
                        />
                      </button>
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
                      {bot.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {bot.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <HealthCell h={health.data?.[bot.id]} loading={health.isLoading} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.text}</Badge>
                    </TableCell>
                    {colVisible("owner") && (
                      <TableCell>
                        {bot.owner_name || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {colVisible("modules") && (
                      <TableCell>
                        <ModulesCell modules={bot.modules} />
                      </TableCell>
                    )}
                    {colVisible("subscription") && (
                      <TableCell>
                        <SubCell bot={bot} />
                      </TableCell>
                    )}
                    {colVisible("orders") && (
                      <TableCell>
                        <OrdersCell s={stats.data?.[bot.id]} />
                      </TableCell>
                    )}
                    {colVisible("storage") && (
                      <TableCell className="text-sm text-muted-foreground">
                        {stats.data?.[bot.id] ? formatBytes(stats.data[bot.id].storage_bytes) : "…"}
                      </TableCell>
                    )}
                    {colVisible("deploy") && (
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
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
                          {(() => {
                            const h = health.data?.[bot.id];
                            const username = h?.ok ? h.report.bot_username : null;
                            return username ? (
                              <a
                                href={`https://t.me/${username}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                @{username} ↗
                              </a>
                            ) : null;
                          })()}
                        </div>
                      </TableCell>
                    )}
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

/**
 * Сколько денег в моменте — раньше это было видно только зайдя в каждого
 * клиента по одному, во вкладку «Подписка». Просроченные/истекающие берутся
 * из того же списка, что уже красит колонку «Подписка» в таблице — здесь
 * просто вынесены наверх, отдельным списком с числом дней, чтобы понять, к
 * кому писать в первую очередь.
 */
function MoneySummary({
  revenue,
  loading,
  overdue,
  expiringSoon,
  byMonth,
}: {
  revenue?: {
    currency: string;
    total_all_time: number;
    total_this_month: number;
    total_last_month: number;
  }[];
  loading: boolean;
  overdue: { id: string; bot_name: string; subscription_days_left: number | null }[];
  expiringSoon: { id: string; bot_name: string; subscription_days_left: number | null }[];
  byMonth?: { month: string; currency: string; total: number }[];
}) {
  const totals = revenue ?? [];
  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Деньги</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Считаю сборы…</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          {totals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Платежей ещё не заводили — добавьте их во вкладке «Подписка» у клиента.
            </p>
          ) : (
            totals.map((t) => {
              // Дельта только когда есть с чем сравнивать — «+100%» от нуля
              // вводит в заблуждение больше, чем помогает.
              const delta =
                t.total_last_month > 0
                  ? Math.round(
                      ((t.total_this_month - t.total_last_month) / t.total_last_month) * 100,
                    )
                  : null;
              return (
                <div key={t.currency}>
                  <p className="text-2xl font-semibold inline-flex items-baseline gap-2">
                    {t.total_this_month.toLocaleString("ru-RU")} {t.currency}
                    {delta !== null && (
                      <span
                        className={`text-sm font-medium ${
                          delta > 0
                            ? "text-green-600 dark:text-green-500"
                            : delta < 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta}% к прошлому месяцу
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    собрано в этом месяце · всего {t.total_all_time.toLocaleString("ru-RU")}{" "}
                    {t.currency}
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}
      <RevenueByMonthChart byMonth={byMonth} />
      {(overdue.length > 0 || expiringSoon.length > 0) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t text-sm">
          {overdue.map((b) => (
            <Link
              key={b.id}
              to="/operator/$botId"
              params={{ botId: b.id }}
              className="text-destructive hover:underline"
            >
              {b.bot_name}
              {b.subscription_days_left !== null &&
                ` · просрочен на ${-b.subscription_days_left} дн.`}
            </Link>
          ))}
          {expiringSoon.map((b) => (
            <Link
              key={b.id}
              to="/operator/$botId"
              params={{ botId: b.id }}
              className="text-amber-700 dark:text-amber-500 hover:underline"
            >
              {b.bot_name}
              {b.subscription_days_left !== null &&
                ` · истекает через ${b.subscription_days_left} дн.`}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

const MONTH_CHART_CONFIG: ChartConfig = {
  total: { label: "Сборы", color: "var(--chart-1)" },
};

/**
 * Мини-график сборов за полгода — раньше динамику можно было увидеть только
 * сравнивая «в этом месяце» на глаз от визита к визиту. Валюта только одна:
 * если у клиентов разные, берём ту, что дала больше сумм за период, а
 * остальные упоминаем строкой — смешивать валюты на одном графике нечестно.
 */
function RevenueByMonthChart({
  byMonth,
}: {
  byMonth?: { month: string; currency: string; total: number }[];
}) {
  const rows = byMonth ?? [];
  if (rows.length === 0) return null;

  const byCurrency = new Map<string, number>();
  for (const r of rows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.total);
  const dominant = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const otherCurrencies = [...byCurrency.keys()].filter((c) => c !== dominant);

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const found = rows.find((r) => r.month === key && r.currency === dominant);
    return {
      month: key,
      label: d.toLocaleDateString("ru-RU", { month: "short" }),
      total: found?.total ?? 0,
    };
  });

  return (
    <div className="pt-1 space-y-1">
      <ChartContainer config={MONTH_CHART_CONFIG} className="h-32 w-full">
        <BarChart data={months}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="total" name={dominant} fill="var(--color-total)" radius={4} />
        </BarChart>
      </ChartContainer>
      {otherCurrencies.length > 0 && (
        <p className="text-xs text-muted-foreground">
          На графике {dominant} — также есть сборы в {otherCurrencies.join(", ")}.
        </p>
      )}
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
const LAST_SEEN_KEY = "operator_last_seen_at";

// Совпадает с подписями в разделе «Журнал» — тот же журнал, просто по всем
// клиентам сразу и за окно с прошлого захода вместо ленты за всё время.
const KIND_LABEL: Record<string, string> = {
  module_on: "модуль включён",
  module_off: "модуль выключен",
  pause: "пауза",
  resume: "снят с паузы",
  suspend: "приостановлен",
  onboard: "подключение",
  webhook: "вебхук",
  env_block: "выдан блок переменных",
  meta: "правка карточки",
  payment: "платёж",
  policy: "политика неоплаты",
  message: "сообщение владельцу",
};

/**
 * «Что изменилось с прошлого захода» — отметка времени живёт в localStorage
 * браузера оператора, не на сервере: панель на одного оператора, синхронизация
 * между устройствами не нужна, а серверная сессия и так недолгая. Момент
 * сдвигается только по кнопке «Понятно», не при каждой перезагрузке страницы,
 * иначе баннер не успевали бы прочитать.
 */
function SinceLastVisit({
  feed,
  moduleRequests,
}: {
  feed?: { at: string; kind: string }[];
  moduleRequests?: { module_title: string; requested_at: string }[];
}) {
  // undefined — ещё не читали localStorage (первый рендер/гидратация),
  // null — прочитали, но это первый заход вообще, сравнивать не с чем.
  const [lastSeenAt, setLastSeenAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LAST_SEEN_KEY);
      if (v === null) localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
      setLastSeenAt(v);
    } catch {
      setLastSeenAt(null);
    }
  }, []);

  if (!lastSeenAt || !feed || !moduleRequests) return null;

  const newEvents = feed.filter((e) => e.at > lastSeenAt);
  const newRequests = moduleRequests.filter((r) => r.requested_at > lastSeenAt);
  if (newEvents.length === 0 && newRequests.length === 0) return null;

  const counts = new Map<string, number>();
  for (const e of newEvents) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  // Ограничение по умолчанию в listFeed() — если ленту забило под завязку,
  // за длинный перерыв часть событий могла не влезть в выборку.
  const maybeMore = newEvents.length >= 50;

  function dismiss() {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(LAST_SEEN_KEY, now);
    } catch {
      // localStorage недоступен (приватный режим и т.п.) — баннер просто
      // покажется снова при следующей загрузке, не критично.
    }
    setLastSeenAt(now);
  }

  return (
    <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-900 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-sm text-blue-900 dark:text-blue-200">
          С прошлого захода ({new Date(lastSeenAt).toLocaleString("ru-RU")})
        </p>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Понятно
        </Button>
      </div>
      <div className="text-sm text-blue-900 dark:text-blue-200/90 space-y-1">
        {newRequests.length > 0 && (
          <p>
            Новых заявок на модуль: {newRequests.length} —{" "}
            {newRequests.map((r) => r.module_title).join(", ")}
          </p>
        )}
        {[...counts.entries()].map(([kind, n]) => (
          <p key={kind}>
            {KIND_LABEL[kind] ?? kind}: {n}
          </p>
        ))}
        {maybeMore && (
          <p className="text-xs text-blue-900/70 dark:text-blue-200/70">
            Событий может быть больше — полная лента в разделе «Журнал».
          </p>
        )}
      </div>
    </div>
  );
}

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
