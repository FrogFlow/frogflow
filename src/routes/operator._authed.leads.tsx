import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listLeadsFn,
  funnelCountsFn,
  createLeadFn,
  updateLeadStageFn,
  updateLeadNotesFn,
  deleteLeadFn,
  scoreLeadFn,
  generateDraftFn,
} from "@/lib/operator/leads.functions";
import type { LeadStage, SalesLead } from "@/lib/operator/leads.server";
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

export const Route = createFileRoute("/operator/_authed/leads")({
  head: () => ({ meta: [{ title: "Лиды — панель оператора" }] }),
  component: OperatorLeadsPage,
});

const STAGE_LABEL: Record<
  LeadStage,
  { text: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { text: "Новый", variant: "secondary" },
  qualified: { text: "Квалифицирован", variant: "default" },
  rejected: { text: "Отклонён", variant: "destructive" },
  contacted: { text: "Написали", variant: "default" },
  replied: { text: "Ответил", variant: "default" },
  hot: { text: "Горячий", variant: "default" },
  converted: { text: "Клиент", variant: "outline" },
  lost: { text: "Проигран", variant: "destructive" },
};

// Object.keys(STAGE_LABEL) вместо импорта LEAD_STAGES из leads.server.ts —
// импорт значения (не типа) из *.server.* модуля в клиентский код запрещён
// tanstack-start:import-protection (см. build), а STAGE_LABEL типизирован
// как Record<LeadStage, ...>, так что ключи по-прежнему все 8 стадий.
const LEAD_STAGES = Object.keys(STAGE_LABEL) as LeadStage[];

function AddLeadForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [signals, setSignals] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setBusinessName("");
    setNiche("");
    setCity("");
    setWebsite("");
    setInstagram("");
    setPhone("");
    setEmail("");
    setSignals("");
  }

  async function onSave() {
    if (!businessName.trim()) return toast.warning("Укажите название бизнеса");
    setSaving(true);
    try {
      await createLeadFn({
        data: {
          business_name: businessName,
          niche: niche.trim() || null,
          city: city.trim() || null,
          website_url: website.trim() || null,
          instagram_handle: instagram.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          signals: signals.trim() || null,
        },
      });
      toast.success("Лид добавлен");
      reset();
      setOpen(false);
      onAdded();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + Добавить лида
      </Button>
    );
  }

  return (
    <section className="bg-card border rounded-lg p-4 space-y-3">
      <h2 className="font-medium">Новый лид</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Бизнес *</Label>
          <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Ниша</Label>
          <Input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="Например: салоны красоты"
          />
        </div>
        <div className="space-y-1">
          <Label>Город</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Сайт</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Instagram</Label>
          <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Телефон</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Наблюдения (что говорит о потребности в боте)</Label>
        <Textarea
          value={signals}
          onChange={(e) => setSignals(e.target.value)}
          rows={3}
          placeholder="Например: запись только через WhatsApp вручную, нет онлайн-записи на сайте, 300+ отзывов"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          Отмена
        </Button>
      </div>
    </section>
  );
}

function LeadCard({ lead, onChanged }: { lead: SalesLead; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const label = STAGE_LABEL[lead.stage];

  async function onScore() {
    setBusy(true);
    try {
      await scoreLeadFn({ data: { id: lead.id } });
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDraft() {
    setBusy(true);
    try {
      await generateDraftFn({ data: { id: lead.id } });
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onStage(stage: string) {
    setBusy(true);
    try {
      await updateLeadStageFn({ data: { id: lead.id, stage: stage as LeadStage } });
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveNotes() {
    setBusy(true);
    try {
      await updateLeadNotesFn({ data: { id: lead.id, notes } });
      toast.success("Заметка сохранена");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!(await confirmToast(`Удалить лида «${lead.business_name}»?`))) return;
    setBusy(true);
    try {
      await deleteLeadFn({ data: { id: lead.id } });
      toast.success("Удалён");
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCopyDraft() {
    if (!lead.draft_message) return;
    try {
      await navigator.clipboard.writeText(lead.draft_message);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать — выделите текст вручную");
    }
  }

  return (
    <div className="py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{lead.business_name}</span>
        {lead.niche && <span className="text-muted-foreground">· {lead.niche}</span>}
        {lead.city && <span className="text-muted-foreground">· {lead.city}</span>}
        <Badge variant={label.variant}>{label.text}</Badge>
        {lead.score !== null && <Badge variant="outline">Оценка: {lead.score}/100</Badge>}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {lead.website_url && <span>🌐 {lead.website_url}</span>}
        {lead.instagram_handle && <span>📷 {lead.instagram_handle}</span>}
        {lead.phone && <span>📞 {lead.phone}</span>}
        {lead.email && <span>✉️ {lead.email}</span>}
      </div>
      {lead.signals && <p className="text-sm text-muted-foreground">💡 {lead.signals}</p>}
      {lead.score_reason && (
        <p className="text-sm">
          <span className="text-muted-foreground">Почему: </span>
          {lead.score_reason}
        </p>
      )}
      {lead.draft_message && (
        <div className="bg-muted/40 rounded-md p-2 space-y-1">
          <p className="text-xs text-muted-foreground">
            Черновик письма (проверьте перед отправкой):
          </p>
          <p className="text-sm whitespace-pre-wrap">{lead.draft_message}</p>
          <Button size="sm" variant="outline" onClick={onCopyDraft}>
            Скопировать
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onScore} disabled={busy}>
          {lead.score === null ? "Оценить (ИИ)" : "Переоценить (ИИ)"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDraft} disabled={busy}>
          {lead.draft_message ? "Пересоздать письмо (ИИ)" : "Сгенерировать письмо (ИИ)"}
        </Button>
        <Select value={lead.stage} onValueChange={onStage}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_STAGES.map((st) => (
              <SelectItem key={st} value={st}>
                {STAGE_LABEL[st].text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
          Удалить
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1 flex-1">
          <Label className="text-xs">Заметка</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8" />
        </div>
        <Button size="sm" variant="outline" onClick={onSaveNotes} disabled={busy}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

const FILTERS: { key: string; label: string; stage: LeadStage | null }[] = [
  { key: "all", label: "Все", stage: null },
  { key: "new", label: "Новые", stage: "new" },
  { key: "qualified", label: "Квалифицированы", stage: "qualified" },
  { key: "contacted", label: "Написали", stage: "contacted" },
  { key: "replied", label: "Ответили", stage: "replied" },
  { key: "hot", label: "Горячие", stage: "hot" },
  { key: "converted", label: "Клиенты", stage: "converted" },
];

function OperatorLeadsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  const funnel = useQuery({ queryKey: ["operator_leads_funnel"], queryFn: () => funnelCountsFn() });
  const leads = useQuery({
    queryKey: ["operator_leads", active.stage, search],
    queryFn: () =>
      listLeadsFn({ data: { stage: active.stage ?? undefined, q: search.trim() || undefined } }),
  });

  function onChanged() {
    qc.invalidateQueries({ queryKey: ["operator_leads"] });
    qc.invalidateQueries({ queryKey: ["operator_leads_funnel"] });
  }

  const counts = funnel.data;
  const list = leads.data ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Лиды</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Поиск клиентов для FrogFlow. ИИ здесь только советует — оценивает потенциал и готовит
          черновик первого письма, а находите лидов, отправляете сообщения и двигаете стадию вы
          сами. Стадии: новый → квалифицирован/отклонён → написали → ответил → горячий →
          клиент/проигран.
        </p>
      </div>

      {counts && (
        <div className="flex flex-wrap gap-2 text-sm">
          {FILTERS.filter((f) => f.stage).map((f) => (
            <span key={f.key} className="bg-card border rounded-md px-2 py-1">
              {f.label}: <span className="font-medium">{counts[f.stage!]}</span>
            </span>
          ))}
        </div>
      )}

      <AddLeadForm onAdded={onChanged} />

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
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
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: название, ниша, город, email…"
            className="h-8 w-56 ml-auto"
          />
        </div>
        {leads.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {list.length === 0 && !leads.isLoading && (
          <p className="text-sm text-muted-foreground">Пусто.</p>
        )}
        <div className="divide-y">
          {list.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onChanged={onChanged} />
          ))}
        </div>
      </section>
    </div>
  );
}
