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
  huntLeadsFn,
  processPipelineFn,
  markContactedFn,
  markFollowUpSentFn,
  sendLeadOutreachFn,
  pipelineStatusFn,
  savePipelineSettingsFn,
} from "@/lib/operator/leads.functions";
import type { LeadStage, SalesLead } from "@/lib/operator/leads.server";
import type { OutreachStatus } from "@/lib/operator/leads-outreach.server";
import {
  instagramHref,
  mailtoHref,
  pickOutreachChannel,
  whatsappHref,
} from "@/lib/operator/leads-pipeline";
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

const LEAD_STAGES = Object.keys(STAGE_LABEL) as LeadStage[];

function websiteHref(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function LeadLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline underline-offset-2 break-all"
    >
      {children}
    </a>
  );
}

function outreachHref(lead: SalesLead): string | null {
  const channel = pickOutreachChannel(lead);
  const text = lead.follow_up_draft || lead.draft_message || "";
  if (channel === "whatsapp" && lead.phone) return whatsappHref(lead.phone, text);
  if (channel === "email" && lead.email) {
    return mailtoHref(lead.email, `FrogFlow — ${lead.business_name}`, text);
  }
  if (channel === "instagram" && lead.instagram_handle) return instagramHref(lead.instagram_handle);
  if (lead.phone) return telHref(lead.phone);
  return null;
}

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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        + Добавить вручную
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

function LeadCard({
  lead,
  onChanged,
  aiConfigured,
  zernio,
}: {
  lead: SalesLead;
  onChanged: () => void;
  aiConfigured: boolean;
  zernio: OutreachStatus | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const label = STAGE_LABEL[lead.stage];
  const href = outreachHref(lead);
  const channel = pickOutreachChannel(lead);

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

  async function onCopyDraft(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать — выделите текст вручную");
    }
  }

  async function onWrote() {
    setBusy(true);
    try {
      if (lead.follow_up_draft && lead.stage === "contacted") {
        await markFollowUpSentFn({ data: { id: lead.id } });
      } else {
        await markContactedFn({ data: { id: lead.id, channel } });
      }
      onChanged();
      toast.success("Касание записано, следующий шаг в очереди");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSendBusiness(sendChannel: "whatsapp" | "instagram") {
    setBusy(true);
    try {
      const r = await sendLeadOutreachFn({ data: { id: lead.id, channel: sendChannel } });
      if (r.ok) {
        toast.success(
          sendChannel === "whatsapp"
            ? "Отправлено из WhatsApp Business"
            : "Отправлено в Instagram Direct",
        );
      } else {
        toast.error(r.error || "Не отправилось");
      }
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const message =
    lead.follow_up_draft && lead.stage === "contacted" ? lead.follow_up_draft : lead.draft_message;
  const canTouch = lead.stage === "qualified" || lead.stage === "new" || lead.stage === "contacted";
  const zernioReady = Boolean(zernio?.configured && !zernio.blockedAsClientWorkspace);
  const canWa = zernioReady && (zernio?.whatsapp.length ?? 0) > 0 && Boolean(lead.phone);
  const canIg =
    zernioReady && (zernio?.instagram.length ?? 0) > 0 && Boolean(lead.instagram_handle);

  return (
    <div className="py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{lead.business_name}</span>
        {lead.niche && <span className="text-muted-foreground">· {lead.niche}</span>}
        {lead.city && <span className="text-muted-foreground">· {lead.city}</span>}
        <Badge variant={label.variant}>{label.text}</Badge>
        {lead.score !== null && <Badge variant="outline">Оценка: {lead.score}/100</Badge>}
        {lead.next_action && <Badge variant="outline">Дальше: {lead.next_action}</Badge>}
        {lead.conversation_id && <Badge variant="outline">Диалог открыт</Badge>}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {lead.website_url && (
          <span>
            🌐 <LeadLink href={websiteHref(lead.website_url)}>{lead.website_url}</LeadLink>
          </span>
        )}
        {lead.instagram_handle && (
          <span>
            📷{" "}
            <LeadLink href={instagramHref(lead.instagram_handle)}>{lead.instagram_handle}</LeadLink>
          </span>
        )}
        {lead.phone && (
          <span>
            📞{" "}
            <a
              href={telHref(lead.phone)}
              className="text-primary hover:underline underline-offset-2"
            >
              {lead.phone}
            </a>
          </span>
        )}
        {lead.email && (
          <span>
            ✉️{" "}
            <a
              href={`mailto:${lead.email}`}
              className="text-primary hover:underline underline-offset-2 break-all"
            >
              {lead.email}
            </a>
          </span>
        )}
      </div>
      {lead.signals && <p className="text-sm text-muted-foreground">💡 {lead.signals}</p>}
      {lead.score_reason && (
        <p className="text-sm">
          <span className="text-muted-foreground">Почему: </span>
          {lead.score_reason}
        </p>
      )}
      {lead.outreach_error && (
        <p className="text-sm text-destructive">Не отправилось: {lead.outreach_error}</p>
      )}
      {message && (
        <div className="bg-muted/40 rounded-md p-2 space-y-1">
          <p className="text-xs text-muted-foreground">
            {lead.follow_up_draft && lead.stage === "contacted"
              ? "Дожим (проверьте перед отправкой):"
              : "Черновик (проверьте перед отправкой из WhatsApp Business / Direct):"}
          </p>
          <p className="text-sm whitespace-pre-wrap">{message}</p>
          <Button size="sm" variant="outline" onClick={() => onCopyDraft(message)}>
            Скопировать
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canTouch && canWa && (
          <Button size="sm" onClick={() => void onSendBusiness("whatsapp")} disabled={busy}>
            {lead.stage === "contacted"
              ? "Дожать из WhatsApp Business"
              : "Отправить из WhatsApp Business"}
          </Button>
        )}
        {canTouch && canIg && (
          <Button
            size="sm"
            variant={canWa ? "outline" : "default"}
            onClick={() => void onSendBusiness("instagram")}
            disabled={busy}
          >
            {lead.stage === "contacted" ? "Дожать в Direct" : "Отправить в Direct"}
          </Button>
        )}
        {href && canTouch && (
          <Button size="sm" variant="outline" asChild disabled={busy}>
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => void onWrote()}>
              {zernioReady
                ? channel === "email"
                  ? "Письмо и отметить"
                  : "Личный чат и отметить"
                : lead.stage === "contacted"
                  ? "Дожать и отметить"
                  : "Написать и отметить"}
            </a>
          </Button>
        )}
        {lead.stage === "contacted" && (
          <Button size="sm" variant="outline" onClick={() => onStage("replied")} disabled={busy}>
            Ответил
          </Button>
        )}
        {lead.stage === "replied" && (
          <Button size="sm" variant="outline" onClick={() => onStage("hot")} disabled={busy}>
            Горячий
          </Button>
        )}
        {(lead.stage === "hot" || lead.stage === "replied") && (
          <Button size="sm" onClick={() => onStage("converted")} disabled={busy}>
            Закрыли сделку
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onScore} disabled={busy || !aiConfigured}>
          {lead.score === null ? "Оценить (ИИ)" : "Переоценить (ИИ)"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDraft} disabled={busy || !aiConfigured}>
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
  const [huntQuery, setHuntQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  const funnel = useQuery({ queryKey: ["operator_leads_funnel"], queryFn: () => funnelCountsFn() });
  const status = useQuery({
    queryKey: ["operator_leads_pipeline"],
    queryFn: () => pipelineStatusFn(),
  });
  const leads = useQuery({
    queryKey: ["operator_leads", active.stage, search],
    queryFn: () =>
      listLeadsFn({ data: { stage: active.stage ?? undefined, q: search.trim() || undefined } }),
  });

  function onChanged() {
    qc.invalidateQueries({ queryKey: ["operator_leads"] });
    qc.invalidateQueries({ queryKey: ["operator_leads_funnel"] });
    qc.invalidateQueries({ queryKey: ["operator_leads_pipeline"] });
  }

  const counts = funnel.data;
  const list = leads.data ?? [];
  const pipe = status.data;
  const due = pipe?.due ?? [];
  const aiConfigured = pipe?.aiConfigured !== false;
  const zernio = pipe?.zernio;
  const templateValue = templateName ?? pipe?.settings.whatsappTemplateName ?? "";

  async function onHunt() {
    setBusy(true);
    try {
      const r = await huntLeadsFn({ data: { query: huntQuery.trim() || null } });
      if (r.error) toast.error(r.error);
      else {
        toast.success(
          `Поиск «${r.query}»: ${r.inserted} новых, ${r.skippedDup} уже были (${r.backend}, ${r.hits} сниппетов)`,
        );
      }
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onProcess() {
    setBusy(true);
    try {
      const r = await processPipelineFn();
      toast.success(
        `Воронка: оценено ${r.scored}, квалифицировано ${r.qualified}, черновиков ${r.drafted}, сообщений ${r.messaged}, дожимов ${r.followUps}, проиграно ${r.lost}`,
      );
      if (r.errors.length) toast.warning(r.errors.slice(0, 3).join("; "));
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleHunt(on: boolean) {
    try {
      await savePipelineSettingsFn({ data: { autoHunt: on } });
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  async function onToggleWa(on: boolean) {
    try {
      await savePipelineSettingsFn({ data: { autoWhatsApp: on } });
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  async function onToggleIg(on: boolean) {
    try {
      await savePipelineSettingsFn({ data: { autoInstagram: on } });
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  async function onSaveTemplate() {
    try {
      await savePipelineSettingsFn({ data: { whatsappTemplateName: templateValue } });
      toast.success("Имя шаблона сохранено");
      onChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Лиды</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Поиск и оценка идут сами. Первое сообщение — из вашего WhatsApp Business и Instagram
          Business через Zernio, не с личного номера. Холодный Direct Meta часто режет: тогда
          откройте профиль вручную. Сделку («Клиент») закрываете вы.
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

      {pipe && !pipe.aiConfigured && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2">
          Автопоиск и оценка выключены: в переменных этой панели нет{" "}
          <code className="font-mono">ANTHROPIC_API_KEY</code>. Без него крон не вынет ICP из
          выдачи. По желанию добавьте ещё <code className="font-mono">TAVILY_API_KEY</code> — поиск
          стабильнее, чем запасной DuckDuckGo.
        </p>
      )}

      {zernio && !zernio.configured && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2">
          WhatsApp Business и Instagram Business не подключены к панели: нет{" "}
          <code className="font-mono">ZERNIO_API_KEY</code> своего бизнеса FrogFlow (не ключ
          клиентского магазина). Пока кнопка откроет личный чат.
        </p>
      )}

      {zernio?.blockedAsClientWorkspace && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2">
          {zernio.error ||
            "На панели висит ключ Zernio магазина клиента. Отправка с него заблокирована, чтобы не писать лидам с чужого WhatsApp."}
        </p>
      )}

      {zernio?.configured && !zernio.blockedAsClientWorkspace && (
        <p className="text-sm bg-card border rounded-md px-3 py-2">
          Zernio: WhatsApp{" "}
          {zernio.whatsapp.length
            ? zernio.whatsapp.map((a) => a.username).join(", ")
            : "не подключён"}
          , Instagram{" "}
          {zernio.instagram.length
            ? zernio.instagram.map((a) => `@${a.username}`).join(", ")
            : "не подключён"}
          {zernio.error ? `. ${zernio.error}` : ""}
        </p>
      )}

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">Воронка</h2>
        <div className="flex flex-wrap gap-2">
          <Input
            value={huntQuery}
            onChange={(e) => setHuntQuery(e.target.value)}
            placeholder="Запрос или пусто — ротация по СНГ"
            className="h-8 w-64"
          />
          <Button size="sm" onClick={() => void onHunt()} disabled={busy || !aiConfigured}>
            {busy ? "Ищем…" : "Найти лидов"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onProcess()} disabled={busy}>
            Прогнать воронку
          </Button>
          <AddLeadForm onAdded={onChanged} />
        </div>
        {pipe && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pipe.settings.autoHunt}
                onChange={(e) => void onToggleHunt(e.target.checked)}
              />
              Ночной поиск сам (крон панели). Квалификация от {pipe.settings.qualifyMinScore}{" "}
              баллов, отказ до {pipe.settings.rejectMaxScore}.
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pipe.settings.autoWhatsApp}
                onChange={(e) => void onToggleWa(e.target.checked)}
              />
              Самим слать первое из WhatsApp Business (по умолчанию выкл. — жмёте на карточке)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pipe.settings.autoInstagram}
                onChange={(e) => void onToggleIg(e.target.checked)}
              />
              Самим слать первое в Direct (Meta часто откажет без диалога)
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Шаблон WhatsApp (если Meta просит)</Label>
                <Input
                  value={templateValue}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="имя_одобренного_шаблона"
                  className="h-8 w-64"
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => void onSaveTemplate()}>
                Сохранить шаблон
              </Button>
            </div>
          </div>
        )}
      </section>

      {due.length > 0 && (
        <section className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">Сегодня ({due.length})</h2>
          <p className="text-xs text-muted-foreground">
            Кто ждёт касания прямо сейчас. Написали → очередь сама поставит дожим.
          </p>
          <div className="divide-y">
            {due.map((lead) => (
              <LeadCard
                key={`due-${lead.id}`}
                lead={lead}
                onChanged={onChanged}
                aiConfigured={aiConfigured}
                zernio={zernio}
              />
            ))}
          </div>
        </section>
      )}

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
            <LeadCard
              key={lead.id}
              lead={lead}
              onChanged={onChanged}
              aiConfigured={aiConfigured}
              zernio={zernio}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
