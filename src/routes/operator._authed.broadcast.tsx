import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listBotsFn } from "@/lib/operator/bots.functions";
import { listPendingModuleRequestsFn } from "@/lib/operator/module-requests.functions";
import { broadcastToOwnersFn, listBroadcastsFn } from "@/lib/operator/broadcast.functions";
import type { DeliveryResult, DeliveryStatus } from "@/lib/operator/broadcast.server";
import { Badge } from "@/components-ui/badge";
import { Button } from "@/components-ui/button";
import { Checkbox } from "@/components-ui/checkbox";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";

export const Route = createFileRoute("/operator/_authed/broadcast")({
  head: () => ({ meta: [{ title: "Рассылка владельцам — панель оператора" }] }),
  component: OperatorBroadcastPage,
});

const DELIVERY_LABEL: Record<
  DeliveryStatus,
  { text: string; variant: "default" | "secondary" | "destructive" }
> = {
  sent: { text: "Доставлено", variant: "default" },
  failed: { text: "Не доставлено", variant: "destructive" },
  unreachable: { text: "Деплой не ответил", variant: "destructive" },
  skipped: { text: "Пропущен", variant: "secondary" },
};

function DeliveryRow({ r }: { r: DeliveryResult }) {
  const label = DELIVERY_LABEL[r.status] ?? { text: r.status, variant: "secondary" as const };
  return (
    <div className="py-2 flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={label.variant}>{label.text}</Badge>
      <span className="font-medium">{r.bot_name}</span>
      {r.error && <span className="text-muted-foreground">{r.error}</span>}
    </div>
  );
}

function OperatorBroadcastPage() {
  const qc = useQueryClient();
  const bots = useQuery({
    queryKey: ["operator_bots"],
    queryFn: () => listBotsFn(),
    refetchInterval: 15_000,
  });
  const moduleRequests = useQuery({
    queryKey: ["operator_module_requests"],
    queryFn: () => listPendingModuleRequestsFn(),
    refetchInterval: 15_000,
  });
  const history = useQuery({
    queryKey: ["operator_broadcasts"],
    queryFn: () => listBroadcastsFn(),
    refetchInterval: 30_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResults, setLastResults] = useState<DeliveryResult[] | null>(null);

  const list = bots.data ?? [];
  const allSelected = list.length > 0 && selected.size === list.length;
  const overdueIds = list
    .filter((b) => ["overdue", "grace_over"].includes(b.subscription_state))
    .map((b) => b.id);
  const requestedIds = [...new Set((moduleRequests.data ?? []).map((r) => r.bot_id))];

  function selectSegment(ids: string[]) {
    setSelected(new Set(ids));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSend() {
    const botIds = [...selected];
    if (botIds.length === 0) return toast.warning("Выберите хотя бы одного получателя");
    if (!text.trim()) return toast.warning("Введите текст сообщения");
    if (
      !(await confirmToast(
        `Отправить сообщение ${botIds.length} владельц(ам)? Каждый получит его от своего бота.`,
      ))
    ) {
      return;
    }
    setSending(true);
    setLastResults(null);
    try {
      const res = await broadcastToOwnersFn({ data: { botIds, text } });
      setLastResults(res.results);
      // Текст намеренно остаётся в поле: часть получателей могла не получить
      // сообщение, и его надо иметь возможность отправить повторно.
      await qc.invalidateQueries({ queryKey: ["operator_broadcasts"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const undelivered = lastResults?.filter((r) => r.status !== "sent") ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Рассылка владельцам</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Каждый владелец получает сообщение от своего собственного бота. Панель обращается к деплою
          клиента — если деплой не отвечает, сообщение не доставлено, и это будет видно в отчёте.
        </p>
      </div>

      <section className="bg-card border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-medium">Получатели</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {overdueIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => selectSegment(overdueIds)}>
                Просроченные ({overdueIds.length})
              </Button>
            )}
            {requestedIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => selectSegment(requestedIds)}>
                С заявкой на модуль ({requestedIds.length})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(allSelected ? new Set() : new Set(list.map((b) => b.id)))}
            >
              {allSelected ? "Снять всё" : "Выбрать всех"}
            </Button>
          </div>
        </div>
        {bots.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        <div className="space-y-2">
          {list.map((bot) => (
            <label key={bot.id} className="flex items-center gap-3 text-sm cursor-pointer">
              <Checkbox checked={selected.has(bot.id)} onCheckedChange={() => toggle(bot.id)} />
              <span className="font-medium">{bot.bot_name}</span>
              {!bot.app_url && (
                <span className="text-xs text-muted-foreground">— адрес деплоя не задан</span>
              )}
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Текст сообщения</Label>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
        </div>

        <Button onClick={onSend} disabled={sending}>
          {sending ? "Отправка…" : `Отправить (${selected.size})`}
        </Button>
      </section>

      {lastResults && (
        <section className="bg-card border rounded-lg p-4 space-y-2">
          <h2 className="font-medium">
            Результат отправки
            {undelivered.length > 0 && (
              <span className="text-destructive font-normal text-sm ml-2">
                не доставлено: {undelivered.length} из {lastResults.length}
              </span>
            )}
          </h2>
          <div className="divide-y">
            {lastResults.map((r) => (
              <DeliveryRow key={r.bot_id} r={r} />
            ))}
          </div>
        </section>
      )}

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">История рассылок</h2>
        {history.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {(history.data?.length ?? 0) === 0 && !history.isLoading && (
          <p className="text-sm text-muted-foreground">Пока пусто.</p>
        )}
        <div className="divide-y">
          {(history.data ?? []).map((b) => {
            const failed = (b.results ?? []).filter((r) => r.status !== "sent").length;
            return (
              <div key={b.id} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {new Date(b.created_at).toLocaleString("ru-RU")}
                  </span>
                  <span className="font-medium">{b.actor}</span>
                  <Badge variant={failed > 0 ? "destructive" : "secondary"}>
                    {failed > 0
                      ? `${b.results.length - failed} из ${b.results.length} доставлено`
                      : `доставлено всем (${b.results.length})`}
                  </Badge>
                </div>
                <p className="text-sm whitespace-pre-wrap">{b.message_text}</p>
                {failed > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {(b.results ?? [])
                      .filter((r) => r.status !== "sent")
                      .map((r) => `${r.bot_name}: ${r.error ?? r.status}`)
                      .join("; ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
