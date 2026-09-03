import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listBotsFn } from "@/lib/operator/bots.functions";
import {
  getPayoutRequisitesFn,
  setPayoutRequisitesFn,
  createInvoiceFn,
  listInvoicesFn,
  getInvoiceProofUrlFn,
  confirmInvoiceFn,
  rejectInvoiceFn,
  cancelInvoiceFn,
} from "@/lib/operator/invoices.functions";
import type { InvoiceStatus, SubscriptionInvoice } from "@/lib/operator/invoices.server";
import { Badge } from "@/components-ui/badge";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";

export const Route = createFileRoute("/operator/_authed/invoices")({
  head: () => ({ meta: [{ title: "Счета — панель оператора" }] }),
  component: OperatorInvoicesPage,
});

const STATUS_LABEL: Record<
  InvoiceStatus,
  { text: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  sent: { text: "Отправлен", variant: "secondary" },
  proof_uploaded: { text: "Чек прислан", variant: "default" },
  paid: { text: "Оплачен", variant: "outline" },
  rejected: { text: "Отклонён", variant: "destructive" },
  cancelled: { text: "Отменён", variant: "outline" },
};

/** Сегодня → +30 дней в ГГГГ-ММ-ГГ — умолчание для формы подтверждения, оператор может поправить. */
function defaultPeriod(): { start: string; end: string } {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function RequisitesEditor() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["operator_payout_requisites"],
    queryFn: () => getPayoutRequisitesFn(),
  });
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = value ?? query.data?.value ?? "";

  async function onSave() {
    setSaving(true);
    try {
      await setPayoutRequisitesFn({ data: { value: shown } });
      toast.success("Реквизиты сохранены");
      await qc.invalidateQueries({ queryKey: ["operator_payout_requisites"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-card border rounded-lg p-4 space-y-2">
      <h2 className="font-medium">Мои реквизиты для выплат</h2>
      <p className="text-sm text-muted-foreground">
        Показываются владельцу в тексте каждого нового счёта — снимок реквизитов на момент
        выставления сохраняется в самом счёте, так что более позднее изменение здесь не тронет уже
        отправленные счета.
      </p>
      <Textarea
        value={shown}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder={"Например:\nКаспи Голд 1234 5678 9012 3456\nИванов Иван Иванович"}
      />
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? "Сохранение…" : "Сохранить"}
      </Button>
    </section>
  );
}

function CreateInvoiceForm() {
  const qc = useQueryClient();
  const bots = useQuery({ queryKey: ["operator_bots"], queryFn: () => listBotsFn() });
  const [botId, setBotId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KZT");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const list = bots.data ?? [];

  async function onSend() {
    const amountNum = Number(amount.replace(",", "."));
    if (!botId) return toast.warning("Выберите клиента");
    if (!Number.isFinite(amountNum) || amountNum <= 0) return toast.warning("Некорректная сумма");
    const bot = list.find((b) => b.id === botId);
    if (bot && !bot.has_owner_telegram_id) {
      const proceed = await confirmToast(
        `У клиента «${bot.bot_name}» не заполнен Telegram ID владельца — счёт будет создан, но сообщение доставить некому. Продолжить?`,
      );
      if (!proceed) return;
    }
    setSending(true);
    try {
      const res = await createInvoiceFn({
        data: {
          botId,
          amount: amountNum,
          currency: currency.trim() || "KZT",
          note: note.trim() || null,
        },
      });
      if (res.delivered) {
        toast.success("Счёт создан и отправлен владельцу");
      } else {
        toast.warning(`Счёт создан, но не доставлен: ${res.deliveryError ?? "неизвестная ошибка"}`);
      }
      setAmount("");
      setNote("");
      await qc.invalidateQueries({ queryKey: ["operator_invoices"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Выставить счёт</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Клиент</Label>
          <Select value={botId} onValueChange={setBotId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите клиента" />
            </SelectTrigger>
            <SelectContent>
              {list.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.bot_name}
                  {!b.has_owner_telegram_id ? " (нет Telegram ID владельца)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Сумма</Label>
          <div className="flex gap-2">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className="w-20"
            />
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <Label>За что (необязательно)</Label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Например: подписка за октябрь"
        />
      </div>
      <Button onClick={onSend} disabled={sending}>
        {sending ? "Отправка…" : "Выставить счёт"}
      </Button>
    </section>
  );
}

function ConfirmForm({ invoice, onDone }: { invoice: SubscriptionInvoice; onDone: () => void }) {
  const [period, setPeriod] = useState(defaultPeriod());
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setBusy(true);
    try {
      await confirmInvoiceFn({
        data: { invoiceId: invoice.id, periodStart: period.start, periodEnd: period.end },
      });
      toast.success("Счёт подтверждён, платёж записан в подписку");
      onDone();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 bg-muted/40 rounded-md p-2 mt-2">
      <div className="space-y-1">
        <Label className="text-xs">Период с</Label>
        <Input
          type="date"
          value={period.start}
          onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">по</Label>
        <Input
          type="date"
          value={period.end}
          onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
          className="h-8"
        />
      </div>
      <Button size="sm" onClick={onConfirm} disabled={busy}>
        {busy ? "…" : "Подтвердить оплату"}
      </Button>
    </div>
  );
}

function InvoiceRow({
  invoice,
  onChanged,
}: {
  invoice: SubscriptionInvoice;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onViewProof() {
    setBusy(true);
    try {
      const res = await getInvoiceProofUrlFn({ data: { invoiceId: invoice.id } });
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      else toast.error("Чек ещё не прислан");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    const reason = prompt(
      "Причина отказа (покажется только в журнале, владельцу не отправляется):",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      await rejectInvoiceFn({ data: { invoiceId: invoice.id, reason } });
      toast.success("Счёт отклонён");
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!(await confirmToast(`Отменить счёт на ${invoice.amount} ${invoice.currency}?`))) return;
    setBusy(true);
    try {
      await cancelInvoiceFn({ data: { invoiceId: invoice.id } });
      toast.success("Счёт отменён");
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const label = STATUS_LABEL[invoice.status];

  return (
    <div className="py-3 space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {new Date(invoice.created_at).toLocaleString("ru-RU")}
        </span>
        <span className="font-medium">{invoice.bot_name}</span>
        <span>
          {invoice.amount} {invoice.currency}
        </span>
        <Badge variant={label.variant}>{label.text}</Badge>
      </div>
      {invoice.note && <p className="text-sm text-muted-foreground">{invoice.note}</p>}
      {invoice.reject_reason && (
        <p className="text-xs text-destructive">Причина отказа: {invoice.reject_reason}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {invoice.proof_path && (
          <Button size="sm" variant="outline" onClick={onViewProof} disabled={busy}>
            Посмотреть чек
          </Button>
        )}
        {(invoice.status === "sent" || invoice.status === "proof_uploaded") && (
          <>
            <Button size="sm" onClick={() => setConfirming((v) => !v)} disabled={busy}>
              Подтвердить
            </Button>
            <Button size="sm" variant="destructive" onClick={onReject} disabled={busy}>
              Отклонить
            </Button>
          </>
        )}
        {invoice.status === "sent" && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Отменить
          </Button>
        )}
      </div>
      {confirming && (
        <ConfirmForm
          invoice={invoice}
          onDone={() => {
            setConfirming(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

const FILTERS: { key: string; label: string; statuses: InvoiceStatus[] | null }[] = [
  { key: "review", label: "На проверке", statuses: ["proof_uploaded"] },
  { key: "sent", label: "Ожидают чек", statuses: ["sent"] },
  { key: "paid", label: "Оплачены", statuses: ["paid"] },
  { key: "closed", label: "Отклонены/отменены", statuses: ["rejected", "cancelled"] },
  { key: "all", label: "Все", statuses: null },
];

function OperatorInvoicesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("review");
  const invoices = useQuery({
    queryKey: ["operator_invoices"],
    queryFn: () => listInvoicesFn({ data: {} }),
    refetchInterval: 20_000,
  });

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;
  const list = (invoices.data ?? []).filter(
    (i) => !active.statuses || active.statuses.includes(i.status),
  );

  function onChanged() {
    qc.invalidateQueries({ queryKey: ["operator_invoices"] });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Счета</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Счёт уходит владельцу текстом от его же бота с вашими реквизитами. Он присылает чек
          обратно в тот же чат — бот сам сохранит его сюда, останется посмотреть и подтвердить.
        </p>
      </div>

      <RequisitesEditor />
      <CreateInvoiceForm />

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {invoices.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {list.length === 0 && !invoices.isLoading && (
          <p className="text-sm text-muted-foreground">Пусто.</p>
        )}
        <div className="divide-y">
          {list.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} onChanged={onChanged} />
          ))}
        </div>
      </section>
    </div>
  );
}
