import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listFeedFn } from "@/lib/operator/bots.functions";
import { Badge } from "@/components-ui/badge";

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

function JournalPage() {
  const feed = useQuery({ queryKey: ["operator_feed"], queryFn: () => listFeedFn() });
  const rows = feed.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Журнал</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Последние действия по всем клиентам. Секретов здесь нет — только то, что было сделано.
        </p>
      </div>

      {feed.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {feed.isError && (
        <p className="text-sm text-destructive">
          {(feed.error as Error)?.message || "Не удалось загрузить журнал"}
        </p>
      )}
      {!feed.isLoading && rows.length === 0 && (
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
