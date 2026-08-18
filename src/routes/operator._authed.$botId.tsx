import { createFileRoute, Link } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
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
  listStatsFn,
  buildEnvBlockFn,
  panelSelfCheckFn,
  setArchivedFn,
  checkReadinessFn,
  listOwnerCandidatesFn,
} from "@/lib/operator/bots.functions";
import {
  getSubscriptionFn,
  listPaymentsFn,
  addPaymentFn,
  deletePaymentFn,
  setPolicyFn,
} from "@/lib/operator/subscriptions.functions";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { formatBytes, daysSince } from "@/lib/operator/format";
import { Badge } from "@/components-ui/badge";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { Switch } from "@/components-ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components-ui/tabs";

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
    bot_name: "",
    owner_slug: "",
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
      bot_name: b.bot_name ?? "",
      owner_slug: b.owner_slug ?? "",
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
    } catch (e: unknown) {
      alert(errorMessage(e));
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
    } catch (e: unknown) {
      alert(errorMessage(e));
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
          bot_name: meta.bot_name.trim(),
          owner_id: meta.owner_slug.trim(),
          owner_name: meta.owner_name.trim() || null,
          owner_contact: meta.owner_contact.trim() || null,
          owner_telegram_id: telegramId ? Number(telegramId) : null,
          app_url: meta.app_url.trim() || null,
          notes: meta.notes.trim() || null,
          paused_message: meta.paused_message.trim() || null,
        },
      });
      await refetchBot();
    } catch (e: unknown) {
      alert(errorMessage(e));
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
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-2xl font-semibold">{bot.bot_name}</h1>
          <Badge variant={st.variant}>{st.text}</Badge>
          {bot.archived_at && <Badge variant="outline">в архиве</Badge>}
          <ArchiveButton botId={botId} archived={Boolean(bot.archived_at)} onDone={refetchBot} />
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="modules">Модули</TabsTrigger>
          <TabsTrigger value="client">Клиент</TabsTrigger>
          <TabsTrigger value="subscription">Подписка</TabsTrigger>
          <TabsTrigger value="deploy">Деплой</TabsTrigger>
          <TabsTrigger value="journal">Журнал</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
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

          <StatsSection botId={botId} />
        </TabsContent>

        <TabsContent value="modules" className="space-y-6">
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
        </TabsContent>

        <TabsContent value="client" className="space-y-6">
          <section className="bg-card border rounded-lg p-4 space-y-4">
            <h2 className="font-medium">Данные клиента</h2>
            <form onSubmit={onSaveMeta} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Название клиента</Label>
                  <Input
                    value={meta.bot_name}
                    onChange={(e) => setMeta((m) => ({ ...m, bot_name: e.target.value }))}
                    placeholder="Как показывать в списке"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Идентификатор</Label>
                  <Input
                    value={meta.owner_slug}
                    onChange={(e) => setMeta((m) => ({ ...m, owner_slug: e.target.value }))}
                    placeholder="saltanat"
                  />
                  <p className="text-xs text-muted-foreground">
                    Латиница, цифры, дефис и подчёркивание.
                  </p>
                </div>
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
                  <OwnerPicker
                    botId={botId}
                    onPick={(id) => setMeta((m) => ({ ...m, owner_telegram_id: String(id) }))}
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
        </TabsContent>

        <TabsContent value="subscription" className="space-y-6">
          <SubscriptionSection botId={botId} />
        </TabsContent>

        <TabsContent value="deploy" className="space-y-6">
          <WebhookSection botId={botId} appUrl={bot.app_url} />
          <ReadinessSection botId={botId} />
          <EnvBlockSection botId={botId} modules={bot.modules} appUrl={bot.app_url} />
        </TabsContent>

        <TabsContent value="journal" className="space-y-6">
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
        </TabsContent>
      </Tabs>
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

/** Сводка по клиенту. Только агрегаты — см. MIGRATION-10: содержимое чужого магазина панель не читает. */
function StatsSection({ botId }: { botId: string }) {
  const stats = useQuery({ queryKey: ["operator_stats"], queryFn: () => listStatsFn() });
  const s = stats.data?.[botId];

  if (stats.isLoading) {
    return (
      <section className="bg-card border rounded-lg p-4">
        <p className="text-sm text-muted-foreground">Загрузка статистики…</p>
      </section>
    );
  }
  if (!s) return null;

  const last = s.last_order_at ? new Date(s.last_order_at) : null;
  const days = daysSince(s.last_order_at);

  const cells: Array<[string, React.ReactNode]> = [
    ["Заказов за 30 дней", s.orders_30d],
    ["Заказов всего", s.orders_total],
    [
      "Последний заказ",
      last === null ? (
        <span className="text-muted-foreground">не было</span>
      ) : (
        <span className={days !== null && days > 14 ? "text-amber-700" : undefined}>
          {last.toLocaleDateString("ru-RU")}
          {days !== null && days > 0 && ` · ${days} дн. назад`}
        </span>
      ),
    ],
    ["Товаров", s.products_total],
    ["Покупателей", s.customers_total],
    ["Место в хранилище", formatBytes(s.storage_bytes)],
  ];

  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Показатели</h2>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Переменные окружения для деплоя клиента.
 *
 * Два режима, потому что это два разных случая, и путать их дорого:
 *   • «новый деплой» — нужен весь набор, включая свежие секреты;
 *   • «уже работает» — деплой живой, и вставлять в него новый
 *     TELEGRAM_WEBHOOK_SECRET значит уронить бота до переустановки вебхука,
 *     а новый SESSION_SECRET — разлогинить владельца. Поэтому такие строки в
 *     этом режиме не выдаются вовсе.
 */
function EnvBlockSection({
  botId,
  modules,
  appUrl,
}: {
  botId: string;
  modules: Record<string, boolean> | null;
  appUrl: string | null;
}) {
  const [mode, setMode] = useState<"new" | "running">("running");
  const [botToken, setBotToken] = useState("");
  const [vipBotToken, setVipBotToken] = useState("");
  const [zernioApiKey, setZernioApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [urlOverride, setUrlOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof buildEnvBlockFn>> | null>(null);

  const selfCheck = useQuery({ queryKey: ["panel_self_check"], queryFn: () => panelSelfCheckFn() });
  const hasVip = Boolean(modules?.vip);
  const hasInstagram = Boolean(modules?.instagram);

  async function onBuild() {
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      setResult(
        await buildEnvBlockFn({
          data: {
            botId,
            mode,
            botToken: mode === "new" ? botToken || null : null,
            vipBotToken: mode === "new" && hasVip ? vipBotToken || null : null,
            zernioApiKey: mode === "new" && hasInstagram ? zernioApiKey || null : null,
            smtpHost: hasInstagram ? smtpHost || null : null,
            smtpUser: hasInstagram ? smtpUser || null : null,
            smtpPassword: hasInstagram ? smtpPassword || null : null,
            appUrlOverride: urlOverride.trim() || null,
          },
        }),
      );
    } catch (e: unknown) {
      setError((e as Error)?.message || "Не удалось собрать блок");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.envBlock);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Буфер обмена недоступен — выделите текст и скопируйте вручную.");
    }
  }

  /**
   * Файлом, а не только текстом: в Vercel есть «Import .env», куда файл просто
   * перетаскивается. Это надёжнее вставки — не зависит от того, как поле
   * разберёт многострочный текст.
   *
   * Имя без ведущей точки и тип octet-stream: с «.env» и text/plain браузер
   * сохраняет файл как «env.txt», дописывая расширение.
   */
  function onDownload() {
    if (!result) return;
    const slug = (result.botName || "client")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const blob = new Blob([result.envBlock], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "client"}.env`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Переменные окружения</h2>

      {selfCheck.data && !selfCheck.data.ok && (
        <div className="text-sm border border-destructive/40 bg-destructive/5 rounded-md p-3 space-y-1">
          <p className="font-medium text-destructive">Панели не хватает своих переменных</p>
          {selfCheck.data.vars
            .filter((v) => !v.present)
            .map((v) => (
              <p key={v.name} className="text-muted-foreground">
                <code>{v.name}</code> — {v.why}
              </p>
            ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === "running" ? "default" : "outline"}
          onClick={() => setMode("running")}
        >
          Деплой уже работает
        </Button>
        <Button
          size="sm"
          variant={mode === "new" ? "default" : "outline"}
          onClick={() => setMode("new")}
        >
          Новый деплой
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {mode === "running"
          ? "Только строки, которые можно вставить на ходу: ключ арендатора, адреса базы, адрес деплоя. Секреты и токены не выдаются — их замена уронила бы работающего бота."
          : "Полный набор со свежими секретами и паролем в админку. Для проекта, который ещё не поднят."}
      </p>

      {mode === "new" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="env-token">Токен бота (@BotFather)</Label>
            <Input
              id="env-token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:AA…"
              autoComplete="off"
            />
          </div>
          {hasVip && (
            <div className="space-y-1">
              <Label htmlFor="env-vip">Токен VIP-бота</Label>
              <Input
                id="env-vip"
                value={vipBotToken}
                onChange={(e) => setVipBotToken(e.target.value)}
                placeholder="123456:AA…"
                autoComplete="off"
              />
            </div>
          )}
          {hasInstagram && (
            <div className="space-y-1">
              <Label htmlFor="env-zernio">Ключ сервиса Instagram</Label>
              <Input
                id="env-zernio"
                value={zernioApiKey}
                onChange={(e) => setZernioApiKey(e.target.value)}
                placeholder="sk_…"
                autoComplete="off"
              />
            </div>
          )}
          {hasInstagram && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="env-smtp-host">Почта продавца для выдачи заказов</Label>
              <p className="text-xs text-muted-foreground">
                Заказы из Instagram выдаются письмом: Direct не принимает документы вложением. Нужен
                обычный ящик клиента и <b>пароль приложения</b> — не основной пароль от почты.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  id="env-smtp-host"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.yandex.ru"
                  autoComplete="off"
                />
                <Input
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="shop@example.kz"
                  autoComplete="off"
                />
                <Input
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder="пароль приложения"
                  autoComplete="off"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {!appUrl && (
        <div className="space-y-1">
          <Label htmlFor="env-url">Адрес деплоя</Label>
          <Input
            id="env-url"
            value={urlOverride}
            onChange={(e) => setUrlOverride(e.target.value)}
            placeholder="https://client.vercel.app"
          />
          <p className="text-xs text-muted-foreground">
            В карточке он ещё не заполнен. Впишите здесь — попадёт в блок.
          </p>
        </div>
      )}

      <Button size="sm" onClick={onBuild} disabled={busy}>
        {busy ? "Собираю…" : "Собрать блок"}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2">
          {result.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-600 dark:text-amber-500">
              {w}
            </p>
          ))}

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Button size="sm" variant="outline" onClick={onCopy}>
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
            <Button size="sm" variant="outline" onClick={onDownload}>
              Скачать .env
            </Button>
            <span>
              ключ арендатора годен до {result.tenantKeyExpiresAt}
              {result.botUsername && ` · @${result.botUsername}`}
              {result.vipBotUsername && ` · VIP @${result.vipBotUsername}`}
            </span>
          </div>

          <Textarea
            readOnly
            value={result.envBlock}
            rows={16}
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />

          {result.omitted.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Намеренно не выдано, чтобы не сломать работающий деплой: {result.omitted.join("; ")}.
              Нужны и они — переключитесь на «Новый деплой», но тогда после вставки переставьте
              вебхук: сменится <code>TELEGRAM_WEBHOOK_SECRET</code>.
            </p>
          )}

          {mode === "new" && (
            <p className="text-xs text-muted-foreground">
              После сохранения переменных в Vercel нужен пересбор — <code>VITE_*</code> вшиваются в
              браузерный бандл во время сборки. Значения из интерфейса Vercel не копируйте: там они
              замаскированы точками.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Убрать клиента из работы, не удаляя его данные. Заказы, выгрузки и история
 * платежей должны переживать уход: их спрашивают и через год. Поэтому архив —
 * это дата в карточке, а строка остаётся на месте.
 */
function ArchiveButton({
  botId,
  archived,
  onDone,
}: {
  botId: string;
  archived: boolean;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const question = archived
      ? "Вернуть клиента в работу? Бот останется приостановленным — включите его вручную."
      : "Убрать клиента в архив? Бот будет приостановлен и перестанет отвечать. Данные сохранятся.";
    if (!confirm(question)) return;
    setBusy(true);
    try {
      await setArchivedFn({ data: { botId, archived: !archived } });
      await onDone();
    } catch (e: unknown) {
      alert((e as Error)?.message || "Не удалось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={busy}>
      {busy ? "…" : archived ? "Вернуть из архива" : "В архив"}
    </Button>
  );
}

/**
 * «Готов ли клиент» — то, ради чего подключение перестаёт быть гаданием.
 *
 * Раньше после вставки переменных в Vercel оставалось открыть магазин, увидеть
 * 500 и идти читать лог сборки. Print KZ лежал из-за отсутствующего
 * SUPABASE_URL, Дидактика — из-за символа «•», попавшего в JWT при копировании
 * из замаскированного поля Vercel. Оба диагноза стоили времени, хотя деплой
 * знал ответ про себя сам.
 */
function ReadinessSection({ botId }: { botId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Awaited<ReturnType<typeof checkReadinessFn>> | null>(null);

  async function onCheck() {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      setRes(await checkReadinessFn({ data: { botId } }));
    } catch (e: unknown) {
      setError((e as Error)?.message || "Не удалось проверить");
    } finally {
      setBusy(false);
    }
  }

  const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;
  const TONE = {
    ok: "text-green-600 dark:text-green-500",
    warn: "text-amber-600 dark:text-amber-500",
    fail: "text-destructive",
  } as const;

  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Готовность</h2>
      <p className="text-sm text-muted-foreground">
        Деплой рассказывает, что у него настроено, панель сверяет это с карточкой и спрашивает
        Telegram про вебхук. Значения переменных не передаются — только имена и состояние.
      </p>

      <Button size="sm" onClick={onCheck} disabled={busy}>
        {busy ? "Проверяю…" : "Проверить готовность"}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {res && (
        <div className="space-y-2">
          <p className={`text-sm font-medium ${res.ok ? TONE.ok : TONE.fail}`}>
            {res.ok && res.problems === 0
              ? "Всё готово — клиента можно отдавать."
              : res.ok
                ? `Работает, но есть замечания: ${res.problems}`
                : "Не готов — нужно поправить отмеченное."}
          </p>
          <ul className="text-sm divide-y rounded-md border">
            {res.checks.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex gap-3 px-3 py-1.5">
                <span className={`${TONE[c.level]} font-mono shrink-0`}>{MARK[c.level]}</span>
                <span className="font-medium shrink-0 min-w-0 break-words">{c.name}</span>
                <span className="text-muted-foreground min-w-0 break-words">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Подбор владельца вместо ввода числа наугад.
 *
 * Telegram ID неоткуда взять — поэтому поле оставалось пустым у четверых
 * клиентов из пяти, а без него панель не может ни написать владельцу, ни
 * предупредить его об оплате. Ответ при этом лежит в базе: клиент сам
 * настраивает admin_chat_id, куда бот шлёт уведомления о заказах. У
 * единственного заполненного клиента эти значения совпадают, поэтому такой
 * кандидат идёт первым и помечен.
 */
function OwnerPicker({ botId, onPick }: { botId: string; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ["owner_candidates", botId],
    queryFn: () => listOwnerCandidatesFn({ data: { botId } }),
    enabled: open,
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary hover:underline"
      >
        Подобрать из тех, кто писал боту
      </button>
    );
  }

  return (
    <div className="border rounded-md mt-1">
      <div className="flex items-center justify-between px-2 py-1 border-b">
        <span className="text-xs text-muted-foreground">
          {list.isLoading ? "Ищу…" : `Кандидатов: ${list.data?.length ?? 0}`}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:underline"
        >
          Скрыть
        </button>
      </div>
      {list.isError && (
        <p className="text-xs text-destructive px-2 py-1">
          {(list.error as Error)?.message || "Не удалось получить список"}
        </p>
      )}
      <ul className="max-h-52 overflow-y-auto divide-y">
        {(list.data ?? []).map((c) => (
          <li key={c.telegram_id}>
            <button
              type="button"
              onClick={() => {
                onPick(c.telegram_id);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2"
            >
              <span className="text-sm">{c.name}</span>
              {c.username && <span className="text-xs text-muted-foreground">@{c.username}</span>}
              <span className="text-xs text-muted-foreground ml-auto font-mono">
                {c.telegram_id}
              </span>
              {c.source === "admin" && <Badge variant="secondary">админ бота</Badge>}
            </button>
          </li>
        ))}
      </ul>
      {!list.isLoading && (list.data?.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground px-2 py-2">
          Никого не нашлось: боту ещё никто не писал и admin_chat_id не настроен.
        </p>
      )}
    </div>
  );
}
