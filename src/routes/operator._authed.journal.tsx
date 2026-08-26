import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listFeedFn, listBotsFn } from "@/lib/operator/bots.functions";
import { Badge } from "@/components-ui/badge";
import { Button } from "@/components-ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";

export const Route = createFileRoute("/operator/_authed/journal")({
  head: () => ({ meta: [{ title: "Журнал — панель оператора" }] }),
  component: JournalPage,
});

/**
 * Что вообще происходило — по всем клиентам сразу.
 *
 * В карточке журнал отвечает на «что делали с этим клиентом». Но вопрос
 * «что я делал на прошлой неделе» и «не появилось ли чужой активности» он не
 * закрывает: для этого пришлось бы обойти все карточки.
 */
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

/** Виды, у которых стоит выделяться в ленте: выдача ключей и остановка бота. */
const NOTABLE = new Set(["env_block", "suspend", "onboard"]);

/** Совпадает с limit по умолчанию в listFeed() — так «загружено меньше страницы» и значит «дальше пусто». */
const PAGE_SIZE = 50;

type FeedRow = Awaited<ReturnType<typeof listFeedFn>>[number];

const RANGE_LABEL: Record<string, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "30d": "30 дней",
  all: "Всё время",
};

/** null — «всё время», без нижней границы. */
function rangeSince(range: string): string | undefined {
  const now = new Date();
  if (range === "today") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
  }
  if (range === "7d") return new Date(now.getTime() - 7 * 86_400_000).toISOString();
  if (range === "30d") return new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return undefined;
}

function JournalPage() {
  const bots = useQuery({ queryKey: ["operator_bots"], queryFn: () => listBotsFn() });

  const [botId, setBotId] = useState("all");
  const [kind, setKind] = useState("all");
  const [range, setRange] = useState("all");
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  async function load(reset: boolean, before?: string) {
    if (reset) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const page = await listFeedFn({
        data: {
          botId: botId === "all" ? undefined : botId,
          kind: kind === "all" ? undefined : kind,
          since: rangeSince(range),
          before,
        },
      });
      setRows((prev) => (reset ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // Смена фильтра начинает ленту заново — иначе «подгрузить ещё» продолжало
  // бы прежнюю выборку вперемешку с новой.
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, kind, range]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Журнал</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Последние действия по всем клиентам. Секретов здесь нет — только то, что было сделано.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={botId} onValueChange={setBotId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Все клиенты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все клиенты</SelectItem>
            {(bots.data ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.bot_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Все действия" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все действия</SelectItem>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Всё время" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RANGE_LABEL).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Пока пусто.</p>
      )}

      {rows.length > 0 && (
        <div className="bg-card border rounded-lg divide-y">
          {rows.map((e) => (
            <div key={e.id} className="p-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground tabular-nums shrink-0">
                {new Date(e.at).toLocaleString("ru-RU")}
              </span>
              <span className="font-medium shrink-0">{e.bot_name}</span>
              <Badge variant={NOTABLE.has(e.kind) ? "default" : "secondary"}>
                {KIND_LABEL[e.kind] ?? e.kind}
              </Badge>
              <span className="text-muted-foreground shrink-0">{e.actor}</span>
              <span className="text-muted-foreground min-w-0 break-words">
                {summarize(e.payload)}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasMore && rows.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={loadingMore}
          onClick={() => load(false, rows[rows.length - 1]?.at)}
        >
          {loadingMore ? "Загружаю…" : "Показать ещё"}
        </Button>
      )}
    </div>
  );
}

/** Payload у каждого вида свой — показываем пары «ключ: значение», а не сырой JSON. */
function summarize(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .filter(([k]) => k !== "sweep_marker")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ")
    .slice(0, 200);
}
