import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { useState } from "react";
import { onboardClientFn, verifyBotTokenFn } from "@/lib/operator/onboard.functions";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { VERTICAL_KEYS, verticalDef, type VerticalKey } from "@/lib/verticals/registry";
import { Badge } from "@/components-ui/badge";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { Checkbox } from "@/components-ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";

export const Route = createFileRoute("/operator/_authed/onboard")({
  head: () => ({ meta: [{ title: "Подключить клиента — панель оператора" }] }),
  component: OnboardPage,
});

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

type Result = Awaited<ReturnType<typeof onboardClientFn>>;

/** Всё, что входит в прайс без доплаты. */
const BASE_MODULES = MODULE_KEYS.filter(
  (k) => moduleDef(k).status === "available" && moduleDef(k).price === null,
);

/**
 * Готовые наборы — по тому, что реально куплено у нынешних клиентов, а не
 * придуманные. Мультивалютность стоит во всех, потому что она есть у всех
 * пятерых: цены в тенге и рублях нужны каждому.
 *
 * Набор заменяет выбор целиком, а не добавляет к нему: «пресет» должен давать
 * предсказуемый результат независимо от того, что было натыкано раньше.
 * Итоговая сумма считается тут же, так что платные модули в наборе видны.
 */
const PRESETS: { title: string; hint: string; modules: ModuleKey[] }[] = [
  {
    title: "Магазин",
    hint: "как у Print KZ и SALTANAT",
    modules: [...BASE_MODULES, "multi_currency"] as ModuleKey[],
  },
  {
    title: "Магазин + VIP",
    hint: "как у Дидактики",
    modules: [...BASE_MODULES, "multi_currency", "vip", "blocked"] as ModuleKey[],
  },
  {
    title: "Магазин + Instagram",
    hint: "как у Развивашки",
    modules: [...BASE_MODULES, "multi_currency", "instagram", "vip", "blocked"] as ModuleKey[],
  },
];

/**
 * Пресет ниши — «Магазин» плюс suggestedModules из реестра ниш
 * (verticals/registry.ts), а не ещё один захардкоженный список модулей:
 * добавить нишу становится делом одного файла, не двух.
 */
function presetForVertical(key: VerticalKey): ModuleKey[] {
  const extra = verticalDef(key).suggestedModules;
  return [...new Set([...BASE_MODULES, ...extra])] as ModuleKey[];
}

function OnboardPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    bot_name: "",
    owner_slug: "",
    bot_token: "",
    app_url: "",
    owner_name: "",
    owner_contact: "",
    owner_telegram_id: "",
    notes: "",
    first_order_no: "0",
    set_webhook: false,
  });
  // По умолчанию — только то, что входит в базовый пакет по прайсу.
  const [modules, setModules] = useState<ModuleKey[]>(BASE_MODULES);
  const [vertical, setVertical] = useState<VerticalKey>("digital");
  const [checking, setChecking] = useState(false);
  const [botIdentity, setBotIdentity] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function onCheckToken() {
    setChecking(true);
    setError(null);
    setBotIdentity(null);
    try {
      const me = await verifyBotTokenFn({ data: { token: form.bot_token.trim() } });
      setBotIdentity(`@${me.username} — ${me.first_name}`);
    } catch (e: unknown) {
      setError(errorMessage(e) || "Не удалось проверить токен");
    } finally {
      setChecking(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tgId = form.owner_telegram_id.trim();
      const res = await onboardClientFn({
        data: {
          bot_name: form.bot_name.trim(),
          owner_slug: form.owner_slug.trim(),
          bot_token: form.bot_token.trim(),
          app_url: form.app_url.trim() || null,
          vertical,
          modules,
          owner_name: form.owner_name.trim() || null,
          owner_contact: form.owner_contact.trim() || null,
          owner_telegram_id: tgId ? Number(tgId) : null,
          notes: form.notes.trim() || null,
          first_order_no: Number(form.first_order_no || "0"),
          set_webhook: form.set_webhook,
        },
      });
      setResult(res);
    } catch (e: unknown) {
      setError(errorMessage(e) || "Не удалось подключить клиента");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <OnboardDone result={result} onDone={() => router.navigate({ to: "/operator" })} />;
  }

  const groups = new Map<string, ModuleKey[]>();
  for (const key of MODULE_KEYS) {
    const g = moduleDef(key).group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(key);
  }
  const orderedGroups = [...groups.keys()].sort(
    (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );

  const total = modules.reduce((sum, k) => sum + (moduleDef(k).price ?? 0), 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link to="/operator" className="text-sm text-muted-foreground hover:underline">
          ← Все клиенты
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Подключить клиента</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Панель заведёт клиента в базе, выпустит ключ изоляции и выдаст готовый блок переменных.
          Проект Vercel создаётся руками.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <section className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">Бот</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Название</Label>
              <Input
                value={form.bot_name}
                onChange={(e) => set({ bot_name: e.target.value })}
                placeholder="Например: Мастерская Айгуль"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Идентификатор</Label>
              <Input
                value={form.owner_slug}
                onChange={(e) => set({ owner_slug: e.target.value.toLowerCase() })}
                placeholder="aigul_shop"
                required
              />
              <p className="text-xs text-muted-foreground">Латиница, для служебных нужд</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Токен от BotFather</Label>
            <div className="flex gap-2">
              <Input
                value={form.bot_token}
                onChange={(e) => {
                  set({ bot_token: e.target.value });
                  setBotIdentity(null);
                }}
                placeholder="1234567890:AA…"
                required
              />
              <Button
                type="button"
                variant="outline"
                onClick={onCheckToken}
                disabled={checking || !form.bot_token.trim()}
              >
                {checking ? "…" : "Проверить"}
              </Button>
            </div>
            {botIdentity && <p className="text-xs text-green-600">Бот найден: {botIdentity}</p>}
            <p className="text-xs text-muted-foreground">
              Токен нужен, чтобы проставить вебхук и попасть в блок переменных. В базе панели он не
              сохраняется.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Адрес деплоя</Label>
            <Input
              value={form.app_url}
              onChange={(e) => set({ app_url: e.target.value })}
              placeholder="https://aigul-shop.vercel.app"
            />
            <p className="text-xs text-muted-foreground">
              Можно оставить пустым и заполнить позже, когда проект Vercel будет создан.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Ниша</Label>
            <Select value={vertical} onValueChange={(v) => setVertical(v as VerticalKey)}>
              <SelectTrigger className="sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERTICAL_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {verticalDef(key).title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Тексты и умолчания бота (каталог, оплата, выдача заказа) — по этой нише. Попадёт в
              блок переменных как <code>VERTICAL=</code>, менять в Vercel руками не нужно.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={form.set_webhook}
              onCheckedChange={(v) => set({ set_webhook: !!v })}
              disabled={!form.app_url.trim()}
            />
            <span>
              Проставить вебхук сразу
              <span className="block text-xs text-muted-foreground">
                Только если проект Vercel уже поднят и отвечает. Иначе — кнопкой в карточке клиента
                после деплоя.
              </span>
            </span>
          </label>
        </section>

        <section className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">Владелец</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Имя</Label>
              <Input
                value={form.owner_name}
                onChange={(e) => set({ owner_name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Контакт</Label>
              <Input
                value={form.owner_contact}
                onChange={(e) => set({ owner_contact: e.target.value })}
                placeholder="+7 … / почта"
              />
            </div>
            <div className="space-y-1">
              <Label>Telegram ID</Label>
              <Input
                value={form.owner_telegram_id}
                onChange={(e) => set({ owner_telegram_id: e.target.value })}
                inputMode="numeric"
                placeholder="Куда панель шлёт сообщения"
              />
            </div>
            <div className="space-y-1">
              <Label>Первый номер заказа</Label>
              <Input
                value={form.first_order_no}
                onChange={(e) => set({ first_order_no: e.target.value })}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                0 для нового клиента. При переносе данных — текущий максимум, иначе нумерация у
                покупателей поедет назад.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Заметки</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={2}
            />
          </div>
        </section>

        <section className="bg-card border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Модули</h2>
            <span className="text-sm text-muted-foreground">
              Разово: {total.toLocaleString("ru-RU")} ₸
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const active =
                preset.modules.length === modules.length &&
                preset.modules.every((k) => modules.includes(k));
              return (
                <Button
                  key={preset.title}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setModules(preset.modules)}
                  title={preset.hint}
                >
                  {preset.title}
                </Button>
              );
            })}
            {verticalDef(vertical).suggestedModules.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setModules(presetForVertical(vertical))}
                title={`Базовые + ${verticalDef(vertical)
                  .suggestedModules.map((k) => moduleDef(k).title)
                  .join(", ")}`}
              >
                Как у ниши «{verticalDef(vertical).title}»
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setModules(BASE_MODULES)}
            >
              Только базовые
            </Button>
          </div>
          {orderedGroups.map((group) => (
            <div key={group} className="space-y-2">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{group}</h3>
              <div className="divide-y rounded-md border">
                {groups.get(group)!.map((key) => {
                  const def = moduleDef(key);
                  const planned = def.status === "planned";
                  return (
                    <label
                      key={key}
                      className={`flex items-center justify-between gap-4 p-3 ${
                        planned ? "opacity-60" : "cursor-pointer"
                      }`}
                    >
                      <span>
                        <span className="text-sm font-medium flex items-center gap-2">
                          {def.title}
                          {planned && <Badge variant="secondary">в разработке</Badge>}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {def.price != null
                            ? `${def.price.toLocaleString("ru-RU")} ₸`
                            : "входит в базу"}
                        </span>
                      </span>
                      <Checkbox
                        checked={modules.includes(key)}
                        disabled={planned}
                        onCheckedChange={(v) =>
                          setModules((prev) => (v ? [...prev, key] : prev.filter((k) => k !== key)))
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Подключаю…" : "Подключить клиента"}
        </Button>
      </form>
    </div>
  );
}

function OnboardDone({ result, onDone }: { result: Result; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Клиент подключён</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Бот @{result.botUsername}. Ключ арендатора годен до {result.tenantKeyExpiresAt}.
        </p>
      </div>

      {result.warnings.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 space-y-1">
          {result.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-900">
              {w}
            </p>
          ))}
        </div>
      )}

      {result.webhook.attempted && (
        <p className={`text-sm ${result.webhook.ok ? "text-green-600" : "text-destructive"}`}>
          Вебхук: {result.webhook.ok ? "проставлен" : "не проставлен"} — {result.webhook.detail}
        </p>
      )}

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-medium">Переменные для проекта Vercel</h2>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(result.envBlock);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Скопировано" : "Копировать"}
            </Button>
            {/* Файлом — его можно перетащить в «Import .env» на стороне Vercel. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // Без ведущей точки и с octet-stream: иначе браузер сохранит
                // файл как «env.txt», дописав расширение к «.env».
                const slug = (result.botUsername || "client")
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
              }}
            >
              Скачать .env
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Показывается один раз: ключ арендатора и пароль админки больше нигде не хранятся.
          Скопируйте до того, как уйдёте со страницы.
        </p>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
          {result.envBlock}
        </pre>
      </section>

      {/*
        Дальше начинается та часть, на которой раньше терялось время: переменные
        уходят в Vercel, деплой собирается, и оператор остаётся без подсказки,
        что проверять. Поэтому шаги перечислены здесь, а последний ведёт прямо
        к проверке готовности на карточке.
      */}
      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">Что дальше</h2>
        <ol className="text-sm space-y-2 list-decimal pl-5">
          <li>
            Создайте проект в Vercel из этого репозитория и вставьте блок выше — в Vercel удобнее
            через{" "}
            <span className="font-medium">Settings → Environment Variables → Import .env</span>.
          </li>
          <li>
            Дождитесь сборки. Значения из интерфейса Vercel обратно не копируйте: там они
            замаскированы точками, и вставится символ «•».
          </li>
          <li>Впишите адрес деплоя в карточке клиента, если не указали его сейчас.</li>
          <li>
            Нажмите <span className="font-medium">«Проверить готовность»</span> — деплой сам скажет,
            каких переменных ему не хватает.
          </li>
          <li>
            Нажмите <span className="font-medium">«Проставить вебхук»</span> и проверьте
            <code className="mx-1">/start</code> в Telegram.
          </li>
        </ol>
      </section>

      <div className="flex gap-2">
        <Link
          to="/operator/$botId"
          params={{ botId: result.botId }}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Открыть карточку
        </Link>
        <Button variant="outline" onClick={onDone}>
          К списку клиентов
        </Button>
      </div>
    </div>
  );
}
