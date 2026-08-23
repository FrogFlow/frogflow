import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getWhatsAppConnectUrlFn,
  getWhatsAppAccountsFn,
  getWhatsAppAccountHealthFn,
  disconnectWhatsAppAccountFn,
  registerWhatsAppWebhookFn,
  getWhatsAppBotSettingsFn,
  saveWhatsAppBotSettingsFn,
  getWhatsAppTemplatesFn,
  createWhatsAppTemplateFn,
  getWhatsAppConversationsFn,
  getWhatsAppConversationMessagesFn,
  sendWhatsAppConversationMessageFn,
} from "@/lib/whatsapp.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { Checkbox } from "@/components-ui/checkbox";
import { Badge } from "@/components-ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components-ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components-ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";
import {
  Plug,
  Bot,
  LayoutTemplate,
  Inbox,
  RefreshCcw,
  Info,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/admin/whatsapp")({
  beforeLoad: ({ context }) => {
    if (!context.modules.whatsapp) throw redirect({ to: "/admin" });
  },
  component: AdminWhatsAppPage,
});

/**
 * Что можно менять в настройках автоответчика.
 *
 * Записан явно, а не выведен из типа серверной функции: `createServerFn`
 * оборачивает валидатор так, что `Parameters<…>[0]["data"]` до формы не
 * добирается. Совпадать с zod-схемой в whatsapp.functions.ts обязан — она и
 * есть настоящая проверка, этот тип лишь описывает вызов.
 */
type SettingsPatch = {
  enabled?: boolean;
  script?: string;
  startPrompt?: string;
  ignoreExcludedContacts?: boolean;
  excludedPhones?: string;
  scope?: "purchases" | "all";
  triggers?: string;
  features?: { catalog: boolean; search: boolean; cart: boolean; checkout: boolean };
  accountId?: string;
};

/** Вердикт Meta по шаблону: как показать и что он значит для продавца. */
const TEMPLATE_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" }> = {
  APPROVED: { label: "Одобрен", tone: "ok" },
  PENDING: { label: "На проверке", tone: "wait" },
  IN_APPEAL: { label: "Обжалуется", tone: "wait" },
  PENDING_DELETION: { label: "Удаляется", tone: "wait" },
  REJECTED: { label: "Отклонён", tone: "bad" },
  PAUSED: { label: "Приостановлен", tone: "bad" },
  DISABLED: { label: "Отключён", tone: "bad" },
};

function AdminWhatsAppPage() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const { data: accountsData } = useQuery({
    queryKey: ["wa_accounts"],
    queryFn: () => getWhatsAppAccountsFn(),
  });
  const accounts = accountsData?.accounts ?? [];
  const acc = accounts[0];

  const { data: settings } = useQuery({
    queryKey: ["wa_settings"],
    queryFn: () => getWhatsAppBotSettingsFn(),
  });

  const { data: health } = useQuery({
    queryKey: ["wa_health", acc?._id],
    queryFn: () => getWhatsAppAccountHealthFn({ data: { accountId: acc!._id } }),
    enabled: Boolean(acc?._id),
  });

  const { data: templatesData, isFetching: templatesLoading } = useQuery({
    queryKey: ["wa_templates", acc?._id],
    queryFn: () => getWhatsAppTemplatesFn({ data: { accountId: acc!._id } }),
    enabled: Boolean(acc?._id),
  });
  const templates = templatesData?.templates ?? [];

  const saveSettings = async (patch: SettingsPatch) => {
    try {
      await saveWhatsAppBotSettingsFn({ data: patch });
      qc.invalidateQueries({ queryKey: ["wa_settings"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await getWhatsAppConnectUrlFn();
      if (res?.authUrl) window.open(res.authUrl, "_blank");
      else toast.error("Zernio не вернул ссылку подключения");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Магазин в переписке, автоответчик и рассылки на рабочем номере продавца.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={handleConnect} disabled={connecting}>
            <Plug className="w-4 h-4 mr-1" />
            {connecting ? "Открываю…" : acc ? "Подключить ещё номер" : "Подключить WhatsApp"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                const res = await registerWhatsAppWebhookFn();
                if (res.ok) toast.success("Webhook обновлён");
                else toast.error(res.error || "Не удалось обновить webhook");
              } catch (e: unknown) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <RefreshCcw className="w-4 h-4 mr-1" /> Обновить Webhook
          </Button>
        </div>
      </div>

      {!acc ? <NotConnectedNotice /> : null}

      <Tabs defaultValue={acc ? "bot" : "accounts"}>
        <TabsList>
          <TabsTrigger value="bot">
            <Bot className="w-4 h-4 mr-1" /> Автоответчик
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutTemplate className="w-4 h-4 mr-1" /> Шаблоны
          </TabsTrigger>
          <TabsTrigger value="chats">
            <Inbox className="w-4 h-4 mr-1" /> Чаты
          </TabsTrigger>
          <TabsTrigger value="accounts">
            <Plug className="w-4 h-4 mr-1" /> Номер
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bot" className="space-y-4 pt-4">
          <BotSettingsTab settings={settings} onSave={saveSettings} />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4 pt-4">
          <TemplatesTab
            accountId={acc?._id}
            templates={templates}
            loading={templatesLoading}
            onCreated={() => qc.invalidateQueries({ queryKey: ["wa_templates"] })}
          />
        </TabsContent>

        <TabsContent value="chats" className="pt-4">
          <ChatsTab accountId={acc?._id} />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4 pt-4">
          <AccountsTab
            accounts={accounts}
            health={health?.health}
            onDisconnected={() => qc.invalidateQueries({ queryKey: ["wa_accounts"] })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Что нужно от клиента до того, как что-либо заработает.
 *
 * Это не наши требования, а правила Meta, и умолчать о них нельзя: без карты
 * в Business Suite шаблоны просто перестанут уходить в середине рассылки, и
 * выглядеть это будет как поломка.
 */
function NotConnectedNotice() {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="w-4 h-4" /> Что нужно, чтобы подключить WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <ul className="list-disc pl-5 space-y-1">
          <li>Аккаунт Meta Business и WhatsApp Business Account.</li>
          <li>
            Номер, на котором уже стоит WhatsApp Business. При подключении выберите вариант с
            существующим аккаунтом — переписка продолжит зеркалиться с приложением на телефоне, а
            история за полгода подтянется.
          </li>
          <li>
            <b>Карта в Meta Business Suite.</b> Meta берёт плату за каждое доставленное шаблонное
            сообщение напрямую с неё. Без карты рассылки перестанут уходить.
          </li>
          <li>
            Первые сутки на новом номере — лимит 250 новых собеседников. Дальше он растёт сам.
          </li>
        </ul>
        <p className="text-muted-foreground">
          Сообщения в ответ покупателю (в течение 24 часов с его последнего сообщения) бесплатны —
          платные только шаблоны, которыми пишут первыми.
        </p>
      </CardContent>
    </Card>
  );
}

type Settings = Awaited<ReturnType<typeof getWhatsAppBotSettingsFn>>;

function BotSettingsTab({
  settings,
  onSave,
}: {
  settings?: Settings;
  onSave: (patch: SettingsPatch) => Promise<void>;
}) {
  const [script, setScript] = useState<string | null>(null);
  const [startPrompt, setStartPrompt] = useState<string | null>(null);
  const [excludedPhones, setExcludedPhones] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<string | null>(null);

  if (!settings) return <p className="text-sm text-muted-foreground">Загружаю настройки…</p>;

  const features = settings.features;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Бот отвечает в WhatsApp</CardTitle>
          <CardDescription>
            Выключите, чтобы бот замолчал совсем — переписку продолжите сами с телефона.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.enabled}
              onCheckedChange={(v) => onSave({ enabled: Boolean(v) })}
            />
            Автоответчик включён
          </label>

          <div className="space-y-1.5">
            <Label className="text-xs">Первое сообщение новому пользователю</Label>
            <Textarea
              rows={3}
              value={startPrompt ?? settings.startPrompt}
              onChange={(e) => setStartPrompt(e.target.value)}
              onBlur={() => {
                if (startPrompt !== null && startPrompt !== settings.startPrompt) {
                  onSave({ startPrompt });
                }
              }}
              placeholder="Здравствуйте! Чтобы активировать бота и открыть каталог, напишите /start"
            />
            <p className="text-xs text-muted-foreground">
              Отправляется один раз в ответ на первое сообщение, ссылку, фото или файл. До команды
              /start бот больше не отвечает. Изменение действует для новых пользователей и тех, кому
              подсказка ещё не отправлялась.
            </p>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settings.ignoreExcludedContacts}
                onCheckedChange={(v) => onSave({ ignoreExcludedContacts: Boolean(v) })}
              />
              Не отвечать контактам из списка исключений
            </label>
            <Textarea
              rows={5}
              value={excludedPhones ?? settings.excludedPhones}
              onChange={(e) => setExcludedPhones(e.target.value)}
              onBlur={() => {
                if (excludedPhones !== null && excludedPhones !== settings.excludedPhones) {
                  onSave({ excludedPhones });
                }
              }}
              placeholder={"+7 705 123 45 67\n+7 777 123 45 67"}
            />
            <p className="text-xs text-muted-foreground">
              Один номер на строку. Эти номера бот полностью игнорирует, включая команду /start.
              Контакты из телефона нужно добавить сюда вручную — WhatsApp не передаёт телефонную
              книгу через API.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">На что отвечать</Label>
            <Select value={settings.scope} onValueChange={(v) => onSave({ scope: v as never })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="purchases">Только покупки (рекомендуется)</SelectItem>
                <SelectItem value="all">Отвечать на любые сообщения</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              «Только покупки» — бот не лезет в обычную переписку: отвечает на слова-триггеры,
              кнопки и шаги заказа, остальное оставляет вам.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Слова, которыми покупатель зовёт бота</Label>
            <Input
              value={triggers ?? settings.triggers}
              onChange={(e) => setTriggers(e.target.value)}
              onBlur={() => {
                if (triggers !== null && triggers !== settings.triggers) onSave({ triggers });
              }}
              placeholder="каталог, купить, заказать"
            />
            <p className="text-xs text-muted-foreground">
              Через запятую. Новый покупатель сначала получает одноразовую подсказку и запускает
              бота командой /start. После активации совпадение идёт по целому сообщению: «Каталог»
              сработает, «а где ваш каталог?» — нет.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Что умеет бот</CardTitle>
          <CardDescription>Выключенное просто не показывается покупателю.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ["catalog", "Каталог товаров"],
              ["search", "Поиск по каталогу"],
              ["cart", "Корзина"],
              ["checkout", "Оформление заказа"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={features[key]}
                onCheckedChange={(v) => onSave({ features: { ...features, [key]: Boolean(v) } })}
              />
              {label}
            </label>
          ))}

          <div className="space-y-1.5 pt-2">
            <Label className="text-xs">Приветствие на свободный вопрос</Label>
            <Textarea
              rows={4}
              value={script ?? settings.script}
              onChange={(e) => setScript(e.target.value)}
              onBlur={() => {
                if (script !== null && script !== settings.script) onSave({ script });
              }}
              placeholder="Здравствуйте! Я бот магазина, помогу выбрать материал и оформить заказ."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TemplatesTab({
  accountId,
  templates,
  loading,
  onCreated,
}: {
  accountId?: string;
  templates: Array<{ name: string; language: string; status: string; reason?: string }>;
  loading: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("ru");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      const res = await createWhatsAppTemplateFn({
        data: { accountId, name: name.trim(), category: "UTILITY", language, body: body.trim() },
      });
      if (res.ok) {
        toast.success("Шаблон отправлен на проверку Meta");
        setName("");
        setBody("");
        onCreated();
      } else {
        toast.error(res.error || "Meta не приняла шаблон");
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Зачем нужны шаблоны</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>
            WhatsApp разрешает писать покупателю свободным текстом только 24 часа с его последнего
            сообщения. Позже — только шаблоном, который заранее одобрила Meta.
          </p>
          <p className="text-muted-foreground">
            Проверка занимает до суток. Результат придёт сюда сам — обновлять страницу и ждать не
            нужно. За доставку шаблонных сообщений Meta берёт плату с вашей карты.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Новый шаблон</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Имя (для Meta)</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="order_ready"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Язык</Label>
              <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Текст</Label>
            <Textarea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Здравствуйте! Ваш заказ готов, материалы отправлены."
            />
            <p className="text-xs text-muted-foreground">
              Латиница в нижнем регистре, цифры и подчёркивания в имени. Рекламный текст Meta в
              служебной категории не пропустит.
            </p>
          </div>
          <Button
            type="button"
            onClick={create}
            disabled={saving || !accountId || !name.trim() || !body.trim()}
          >
            {saving ? "Отправляю…" : "Отправить на проверку"}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Мои шаблоны</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загружаю…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Шаблонов пока нет. Без них рассылки и сообщения вне 24-часового окна не отправятся.
            </p>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => {
                const meta = TEMPLATE_STATUS[template.status] ?? {
                  label: template.status,
                  tone: "wait" as const,
                };
                return (
                  <div
                    key={`${template.name}:${template.language}`}
                    className="flex items-start justify-between gap-3 rounded-md border p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm">
                        {template.name}{" "}
                        <span className="text-muted-foreground">({template.language})</span>
                      </div>
                      {template.reason ? (
                        <div className="text-xs text-destructive mt-0.5">{template.reason}</div>
                      ) : null}
                    </div>
                    <Badge
                      variant={meta.tone === "ok" ? "default" : "outline"}
                      className={
                        meta.tone === "bad"
                          ? "border-destructive/40 text-destructive shrink-0"
                          : "shrink-0"
                      }
                    >
                      {meta.tone === "ok" ? (
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                      ) : meta.tone === "bad" ? (
                        <XCircle className="w-3 h-3 mr-1" />
                      ) : (
                        <Clock className="w-3 h-3 mr-1" />
                      )}
                      {meta.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChatsTab({ accountId }: { accountId?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const { data: conversationsData } = useQuery({
    queryKey: ["wa_conversations", accountId],
    queryFn: () => getWhatsAppConversationsFn({ data: { accountId: accountId! } }),
    enabled: Boolean(accountId),
    refetchInterval: 15_000,
  });
  const conversations = conversationsData?.conversations ?? [];

  const { data: messagesData, refetch } = useQuery({
    queryKey: ["wa_messages", accountId, selected],
    queryFn: () =>
      getWhatsAppConversationMessagesFn({
        data: { accountId: accountId!, conversationId: selected! },
      }),
    enabled: Boolean(accountId && selected),
    refetchInterval: 10_000,
  });
  const messages = messagesData?.messages ?? [];

  const send = async () => {
    if (!accountId || !selected || !draft.trim()) return;
    setSending(true);
    try {
      const res = await sendWhatsAppConversationMessageFn({
        data: { accountId, conversationId: selected, message: draft.trim() },
      });
      if (res.ok) {
        setDraft("");
        refetch();
      } else {
        toast.error(res.error || "Не удалось отправить");
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (!accountId) {
    return <p className="text-sm text-muted-foreground">Сначала подключите номер WhatsApp.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-[280px_1fr]">
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Диалоги</CardTitle>
        </CardHeader>
        <CardContent className="p-0 max-h-[60vh] overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">Пока нет переписок.</p>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelected(conversation.id)}
                className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-muted/50 ${
                  selected === conversation.id ? "bg-muted" : ""
                }`}
              >
                <div className="font-medium truncate">
                  {conversation.participantName || conversation.participantId || "Без имени"}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {conversation.lastMessage || "—"}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardContent className="flex-1 space-y-2 overflow-y-auto max-h-[52vh] pt-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Выберите диалог слева.</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  message.direction === "outgoing"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-background border"
                }`}
              >
                {message.message || <span className="opacity-60">[вложение]</span>}
              </div>
            ))
          )}
        </CardContent>
        {selected ? (
          <div className="border-t p-3 space-y-2">
            <Textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ответить покупателю…"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Отправить можно в течение 24 часов с последнего сообщения покупателя.
              </p>
              <Button type="button" size="sm" onClick={send} disabled={sending || !draft.trim()}>
                {sending ? "Отправляю…" : "Отправить"}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function AccountsTab({
  accounts,
  health,
  onDisconnected,
}: {
  accounts: Array<{ _id: string; username?: string; name?: string; isExpired?: boolean }>;
  health?: { status?: string; issues?: string[] } | null;
  onDisconnected: () => void;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Номер не подключён. Нажмите «Подключить WhatsApp» вверху.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <Card key={account._id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <div className="min-w-0">
              <div className="font-medium">{account.username || account.name || account._id}</div>
              <div className="text-xs text-muted-foreground">{account._id}</div>
              {account.isExpired ? (
                <Badge variant="outline" className="mt-1 border-destructive/40 text-destructive">
                  Требуется переподключение
                </Badge>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await confirmToast(
                  "Отключить номер? Бот перестанет отвечать в WhatsApp.",
                );
                if (!ok) return;
                try {
                  await disconnectWhatsAppAccountFn({ data: { accountId: account._id } });
                  onDisconnected();
                } catch (e: unknown) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Отключить
            </Button>
          </CardContent>
        </Card>
      ))}

      {health?.issues?.length ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Состояние подключения</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="list-disc pl-5 space-y-1">
              {health.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
