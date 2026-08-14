import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getBotFn,
  setModuleFn,
  setBotStatusFn,
  updateBotMetaFn,
  listBotEventsFn,
  checkBotHealthFn,
  requestWebhookSetupFn,
} from "@/lib/operator/bots.functions";
import {
  getSubscriptionFn,
  listPaymentsFn,
  addPaymentFn,
  deletePaymentFn,
  setPolicyFn,
} from "@/lib/operator/subscriptions.functions";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { Badge } from "@/components-ui/badge";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { Switch } from "@/components-ui/switch";

export const Route = createFileRoute("/operator/_authed/$botId")({
  head: () => ({ meta: [{ title: "Клиент — панель оператора" }] }),
  component: OperatorClientCard,
});

const STATUS_LABEL: Record<
  string,
  { text: string; variant: "default" | "secondary" | "destructive" }
> = {
  active: { text: "Активен", variant: "default" },
  paused: { text: "Пауза", variant: "secondary" },
  suspended: { text: "Приостановлен", variant: "destructive" },
};

// Порядок групп — как разделы в прайсе.
const GROUP_ORDER = [
  "База",
  "Оплата",
  "Каталог",
  "Instagram",
  "Удержание",
  "Сервис",
  "Аналитика",
  "Физические товары",
];

function OperatorClientCard() {
  const { botId } = Route.useParams();
  const qc = useQueryClient();
  const botQuery = useQuery({
    queryKey: ["operator_bot", botId],
    queryFn: () => getBotFn({ data: { botId } }),
  });
  const eventsQuery = useQuery({
    queryKey: ["operator_bot_events", botId],
    queryFn: () => listBotEventsFn({ data: { botId } }),
  });

  const [busyModule, setBusyModule] = useState<ModuleKey | null>(null);
  const [busyStatus, setBusyStatus] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [meta, setMeta] = useState({
    owner_name: "",
    owner_contact: "",
    owner_telegram_id: "",
    app_url: "",
    notes: "",
    paused_message: "",
  });

  useEffect(() => {
    if (!botQuery.data) return;
    const b = botQuery.data;
    setMeta({
      owner_name: b.owner_name ?? "",
      owner_contact: b.owner_contact ?? "",
      owner_telegram_id: b.owner_telegram_id != null ? String(b.owner_telegram_id) : "",
      app_url: b.app_url ?? "",
      notes: b.notes ?? "",
      paused_message: b.paused_message ?? "",
    });
  }, [botQuery.data]);

  async function refetchBot() {
    await qc.invalidateQueries({ queryKey: ["operator_bot", botId] });
  }

  async function onToggleModule(key: ModuleKey, enabled: boolean) {
    setBusyModule(key);
    try {
      await setModuleFn({ data: { botId, key, enabled } });
      await refetchBot();
      await qc.invalidateQueries({ queryKey: ["operator_bot_events", botId] });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyModule(null);
    }
  }

  async function onSetStatus(status: "active" | "paused" | "suspended") {
    if (
      status !== "active" &&
      !confirm(
        `Перевести бота в статус «${STATUS_LABEL[status].text}»? Клиент увидит текст из «Сообщение на паузе».`,
      )
    ) {
      return;
    }
    setBusyStatus(true);
    try {
      await setBotStatusFn({ data: { botId, status } });
      await refetchBot();
      await qc.invalidateQueries({ queryKey: ["operator_bot_events", botId] });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyStatus(false);
    }
  }

  async function onSaveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSavingMeta(true);
    try {
      const telegramId = meta.owner_telegram_id.trim();
      await updateBotMetaFn({
        data: {
          botId,
          owner_name: meta.owner_name.trim() || null,
          owner_contact: meta.owner_contact.trim() || null,
          owner_telegram_id: telegramId ? Number(telegramId) : null,
          app_url: meta.app_url.trim() || null,
          notes: meta.notes.trim() || null,
          paused_message: meta.paused_message.trim() || null,
        },
      });
      await refetchBot();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSavingMeta(false);
    }
  }

  if (botQuery.isLoading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  if (botQuery.isError || !botQuery.data) {
    return (
      <p className="text-sm text-destructive">
        {(botQuery.error as Error)?.message || "Клиент не найден"}
      </p>
    );
  }

  const bot = botQuery.data;
  const st = STATUS_LABEL[bot.status] ?? { text: bot.status, variant: "outline" as const };

  const groups = new Map<string, ModuleKey[]>();
  for (const key of MODULE_KEYS) {
    const g = moduleDef(key).group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(key);
  }
  const orderedGroups = [...groups.keys()].sort(
    (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/operator" className="text-sm text-muted-foreground hover:underline">
          ← Все клиенты
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-semibold">{bot.bot_name}</h1>
          <Badge variant={st.variant}>{st.text}</Badge>
        </div>
      </div>

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">Статус бота</h2>
        <p className="text-sm text-muted-foreground">
          Пауза/приостановка не трогает вебхук и токен — бот просто отвечает текстом ниже вместо
          обработки заказа.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={bot.status === "active" ? "default" : "outline"}
            disabled={busyStatus}
            onClick={() => onSetStatus("active")}
          >
            Активен
          </Button>
          <Button
            size="sm"
            variant={bot.status === "paused" ? "default" : "outline"}
            disabled={busyStatus}
            onClick={() => onSetStatus("paused")}
          >
            Пауза
          </Button>
          <Button
            size="sm"
            variant={bot.status === "suspended" ? "destructive" : "outline"}
            disabled={busyStatus}
            onClick={() => onSetStatus("suspended")}
          >
            Приостановить
          </Button>
        </div>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="font-medium">Модули</h2>
        {orderedGroups.map((group) => (
          <div key={group} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{group}</h3>
            <div className="divide-y rounded-md border">
              {groups.get(group)!.map((key) => {
                const def = moduleDef(key);
                const planned = def.status === "planned";
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-4 p-3 ${planned ? "opacity-60" : ""}`}
                  >
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">
                        {def.title}
                        {planned && <Badge variant="secondary">в разработке</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {def.price != null
                          ? `${def.price.toLocaleString("ru-RU")} ₸`
                          : "входит в базу"}
                        {def.note ? ` · ${def.note}` : ""}
                      </div>
                    </div>
                    <Switch
                      checked={bot.modules[key] === true}
                      disabled={planned || busyModule === key}
                      onCheckedChange={(checked) => onToggleModule(key, checked)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="font-medium">Данные клиента</h2>
        <form onSubmit={onSaveMeta} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Имя владельца</Label>
              <Input
                value={meta.owner_name}
                onChange={(e) => setMeta((m) => ({ ...m, owner_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Контакт (телефон/почта)</Label>
              <Input
                value={meta.owner_contact}
                onChange={(e) => setMeta((m) => ({ ...m, owner_contact: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Telegram ID владельца</Label>
              <Input
                value={meta.owner_telegram_id}
                onChange={(e) => setMeta((m) => ({ ...m, owner_telegram_id: e.target.value }))}
                placeholder="Например: 123456789"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <Label>Адрес деплоя</Label>
              <Input
                value={meta.app_url}
                onChange={(e) => setMeta((m) => ({ ...m, app_url: e.target.value }))}
                placeholder="https://…vercel.app"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Сообщение на паузе</Label>
            <Textarea
              value={meta.paused_message}
              onChange={(e) => setMeta((m) => ({ ...m, paused_message: e.target.value }))}
              rows={2}
              placeholder="Бот временно недоступен. Загляните чуть позже — мы уже разбираемся."
            />
          </div>
          <div className="space-y-1">
            <Label>Заметки</Label>
            <Textarea
              value={meta.notes}
              onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
              rows={3}
            />
          </div>
          <Button type="submit" disabled={savingMeta}>
            {savingMeta ? "Сохранение…" : "Сохранить"}
          </Button>
        </form>
      </section>

      <SubscriptionSection botId={botId} />

      <WebhookSection botId={botId} appUrl={bot.app_url} />

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">Журнал действий</h2>
        {eventsQuery.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {(eventsQuery.data?.length ?? 0) === 0 && !eventsQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Пока пусто.</p>
        )}
        {(eventsQuery.data?.length ?? 0) > 0 && (
          <div className="divide-y text-sm">
            {eventsQuery.data!.map((ev) => (
              <div key={ev.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">
                  {new Date(ev.at).toLocaleString("ru-RU")}
                </span>
                <span className="font-medium">{ev.actor}</span>
                <Badge variant="outline">{ev.kind}</Badge>
                {ev.payload != null && (
                  <span className="text-xs text-muted-foreground">
                    {JSON.stringify(ev.payload)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Вебхук и диагностика — обе операции требуют токена Telegram, и обе делает сам
 * деплой: панель просто зовёт его внутренний API. Токен не вводится, не
 * передаётся по сети и не хранится в панели (CONTROL-PLANE-PLAN.md §5).
 */
function WebhookSection({ botId, appUrl }: { botId: string; appUrl: string | null }) {
  const [busy, setBusy] = useState<"hook" | "health" | null>(null);
  const [hook, setHook] = useState<{ ok: boolean; detail: string } | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof checkBotHealthFn>> | null>(null);

  async function onSetWebhook() {
    if (!confirm("Направить бота на этот деплой? Текущий вебхук будет перезаписан.")) return;
    setBusy("hook");
    setHook(null);
    try {
      setHook(await requestWebhookSetupFn({ data: { botId } }));
    } catch (e: unknown) {
      setHook({ ok: false, detail: (e as Error)?.message || "Не удалось" });
    } finally {
      setBusy(null);
    }
  }

  async function onCheck() {
    setBusy("health");
    setHealth(null);
    try {
      setHealth(await checkBotHealthFn({ data: { botId } }));
    } catch (e: unknown) {
      setHealth({ ok: false, error: (e as Error)?.message || "Не удалось" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Вебхук и диагностика</h2>
      {!appUrl ? (
        <p className="text-sm text-muted-foreground">
          Сначала заполните «Адрес деплоя» выше — без него панели некуда обратиться.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Обе кнопки выполняет сам деплой своим токеном. Панель токена не знает, вводить его не
            нужно.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onCheck} disabled={busy !== null}>
              {busy === "health" ? "Проверяю…" : "Проверить бота"}
            </Button>
            <Button size="sm" variant="outline" onClick={onSetWebhook} disabled={busy !== null}>
              {busy === "hook" ? "Ставлю…" : "Проставить вебхук"}
            </Button>
          </div>

          {hook && (
            <p className={`text-sm ${hook.ok ? "text-green-600" : "text-destructive"}`}>
              {hook.ok ? "Вебхук проставлен: " : "Не удалось: "}
              {hook.detail}
            </p>
          )}

          {health && !health.ok && <p className="text-sm text-destructive">{health.error}</p>}
          {health?.ok && (
            <dl className="text-sm grid sm:grid-cols-2 gap-x-4 gap-y-1">
              <Row label="Бот">
                {health.report.bot_username ? `@${health.report.bot_username}` : "—"}
              </Row>
              <Row label="Вебхук">{health.report.webhook_url || "не установлен"}</Row>
              <Row label="Очередь">
                {health.report.pending_updates ?? "—"}
                {(health.report.pending_updates ?? 0) > 0 && " — апдейты не разбираются"}
              </Row>
              <Row label="Последняя ошибка">
                {health.report.last_error ? (
                  <span className="text-destructive">
                    {health.report.last_error}
                    {health.report.last_error_at &&
                      ` (${new Date(health.report.last_error_at).toLocaleString("ru-RU")})`}
                  </span>
                ) : (
                  "нет"
                )}
              </Row>
            </dl>
          )}
        </>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground shrink-0">{label}:</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}

const SUB_LABEL: Record<
  string,
  { text: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  no_data: { text: "не заведена", variant: "outline" },
  ok: { text: "оплачена", variant: "default" },
  expiring: { text: "скоро истекает", variant: "secondary" },
  overdue: { text: "просрочена", variant: "destructive" },
  grace_over: { text: "отсрочка кончилась", variant: "destructive" },
};

/**
 * Подписка. Источник истины — платежи: bots.subscription_expires_at
 * пересчитывает триггер из MIGRATION-09, руками эта дата не правится.
 */
function SubscriptionSection({ botId }: { botId: string }) {
  const qc = useQueryClient();
  const sub = useQuery({
    queryKey: ["operator_sub", botId],
    queryFn: () => getSubscriptionFn({ data: { botId } }),
  });
  const payments = useQuery({
    queryKey: ["operator_payments", botId],
    queryFn: () => listPaymentsFn({ data: { botId } }),
  });

  const [form, setForm] = useState({
    period_start: "",
    period_end: "",
    amount: "15000",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policy, setPolicyState] = useState({
    on_overdue: "warn" as "warn" | "suspend",
    warn_days_before: 5,
    grace_days: 3,
  });

  useEffect(() => {
    if (sub.data) setPolicyState(sub.data.policy);
  }, [sub.data]);

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["operator_sub", botId] }),
      qc.invalidateQueries({ queryKey: ["operator_payments", botId] }),
      qc.invalidateQueries({ queryKey: ["operator_bot", botId] }),
      qc.invalidateQueries({ queryKey: ["operator_bot_events", botId] }),
    ]);
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addPaymentFn({
        data: {
          botId,
          period_start: form.period_start,
          period_end: form.period_end,
          amount: Number(form.amount || "0"),
          currency: "KZT",
          note: form.note.trim() || null,
        },
      });
      setForm({ period_start: "", period_end: "", amount: "15000", note: "" });
      await refresh();
    } catch (e: unknown) {
      alert((e as Error)?.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(paymentId: string) {
    if (!confirm("Удалить платёж? Дата «оплачен до» пересчитается.")) return;
    try {
      await deletePaymentFn({ data: { botId, paymentId } });
      await refresh();
    } catch (e: unknown) {
      alert((e as Error)?.message);
    }
  }

  async function onSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    setPolicyBusy(true);
    try {
      await setPolicyFn({ data: { botId, ...policy } });
      await refresh();
    } catch (e: unknown) {
      alert((e as Error)?.message);
    } finally {
      setPolicyBusy(false);
    }
  }

  const st = sub.data ? (SUB_LABEL[sub.data.state] ?? SUB_LABEL.no_data) : null;
  const list = payments.data ?? [];

  return (
    <section className="bg-card border rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-medium">Подписка</h2>
        {st && <Badge variant={st.variant}>{st.text}</Badge>}
        {sub.data?.expiresAt && (
          <span className="text-sm text-muted-foreground">
            до {new Date(sub.data.expiresAt).toLocaleDateString("ru-RU")}
            {sub.data.daysLeft !== null &&
              (sub.data.daysLeft >= 0
                ? ` — осталось ${sub.data.daysLeft} дн.`
                : ` — просрочено на ${-sub.data.daysLeft} дн.`)}
          </span>
        )}
      </div>

      {sub.data?.expiresAt && !sub.data.backedByPayments && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
          Дата не подтверждена ни одним платежом — досталась в наследство от заведения строки. При
          первом же записанном платеже она пересчитается по нему.
        </p>
      )}

      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Платежи ({list.length})
        </h3>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока ни одного.</p>
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {list.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-2">
                <div>
                  <div>
                    {new Date(p.period_start).toLocaleDateString("ru-RU")} —{" "}
                    {new Date(p.period_end).toLocaleDateString("ru-RU")}
                    <span className="font-medium">
                      {" · "}
                      {Number(p.amount).toLocaleString("ru-RU")} {p.currency}
                    </span>
                  </div>
                  {p.note && <div className="text-xs text-muted-foreground">{p.note}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => onDelete(p.id)}>
                  Удалить
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={onAdd} className="space-y-3 border-t pt-3">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Записать платёж</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Период с</Label>
            <Input
              type="date"
              value={form.period_start}
              onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>по</Label>
            <Input
              type="date"
              value={form.period_end}
              onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Сумма, ₸</Label>
            <Input
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              inputMode="numeric"
              required
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Примечание</Label>
          <Input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Например: Kaspi перевод"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Записываю…" : "Записать"}
        </Button>
      </form>

      <form onSubmit={onSavePolicy} className="space-y-3 border-t pt-3">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Что делать при неоплате
        </h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Поведение</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={policy.on_overdue === "warn" ? "default" : "outline"}
                onClick={() => setPolicyState((p) => ({ ...p, on_overdue: "warn" }))}
              >
                Предупредить
              </Button>
              <Button
                type="button"
                size="sm"
                variant={policy.on_overdue === "suspend" ? "destructive" : "outline"}
                onClick={() => setPolicyState((p) => ({ ...p, on_overdue: "suspend" }))}
              >
                Приостановить
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Предупредить за, дней</Label>
            <Input
              value={policy.warn_days_before}
              onChange={(e) =>
                setPolicyState((p) => ({ ...p, warn_days_before: Number(e.target.value || 0) }))
              }
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <Label>Отсрочка, дней</Label>
            <Input
              value={policy.grace_days}
              onChange={(e) =>
                setPolicyState((p) => ({ ...p, grace_days: Number(e.target.value || 0) }))
              }
              inputMode="numeric"
            />
          </div>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={policyBusy}>
          {policyBusy ? "Сохранение…" : "Сохранить политику"}
        </Button>
      </form>
    </section>
  );
}
