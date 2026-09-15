import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components-ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components-ui/tabs";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { useAdminLocale } from "@/lib/admin-locale";
import {
  getConsultantAdminFn,
  importConsultantCatalogFn,
  importConsultantDriveFn,
  importConsultantSheetsFn,
  refreshConsultantRateFn,
  resumeConsultantFn,
  saveConsultantAbFn,
  saveConsultantChecklistFn,
  saveConsultantShopUrlFn,
  pollConsultantInboxFn,
  setConsultantRateFn,
  setConsultantTaskDoneFn,
  testConsultantTelegramFn,
} from "@/lib/consultant/consultant.functions";
import { StoriesTab } from "./admin.stories-tab";
import { Badge } from "@/components-ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components-ui/table";
import { CheckCircle2, Circle, ExternalLink, Package, Search, Send } from "lucide-react";
import { rateSourceKind } from "@/lib/consultant/vtb-parse";
import { errorMessage } from "@/lib/error-message";
import type { Locale } from "@/lib/i18n";
import { rejectNonConsultantPage } from "@/lib/verticals/consultant-admin-guard";

export const Route = createFileRoute("/admin/consultant")({
  beforeLoad: ({ context }) => rejectNonConsultantPage(context),
  component: ConsultantPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    intro: string;
    catalogTitle: string;
    catalogBody: string;
    catalogEmpty: string;
    catalogCount: (n: number, at: string) => string;
    uploadLabel: string;
    sheetsLabel: string;
    sheetsPlaceholder: string;
    sheetsBtn: string;
    shopLabel: string;
    saveShop: string;
    rateTitle: string;
    rateBody: string;
    rateEmpty: string;
    rateValue: (rate: number, at: string) => string;
    rateSource: Record<"vtb" | "nbk" | "manual" | "other", string>;
    rateNbkToast: string;
    refreshRate: string;
    manualRate: string;
    usage: (count: number, usd: string, model: string) => string;
    noKey: string;
    rulesTitle: string;
    rules: string[];
    pausedTitle: string;
    pausedEmpty: string;
    pausedResume: string;
    pausedReason: Record<string, string>;
  }
> = {
  ru: {
    title: "Консультант",
    intro:
      "Claude понимает запрос и вызывает tools. Цены и остатки — только из загруженного прайса. Курс VTB хранит backend.",
    catalogTitle: "Каталог",
    catalogBody:
      "Ежедневный Excel сохраните как CSV (запятая или «;») или укажите Google Sheet. Колонки: название, цена, размер, цвет, наличие.",
    catalogEmpty: "Прайс ещё не загружен — бот не назовёт цену.",
    catalogCount: (n, at) => `${n} позиций · обновлён ${at}`,
    uploadLabel: "CSV-файл",
    sheetsLabel: "Ссылка на Google Sheet",
    sheetsPlaceholder: "https://docs.google.com/spreadsheets/d/…",
    sheetsBtn: "Загрузить из таблицы",
    shopLabel: "Ссылка на полный ассортимент",
    saveShop: "Сохранить ссылку",
    rateTitle: "Курс VTB Казахстан",
    rateBody:
      "RUB = ₸ / (курс покупки × 0,95). Сначала касса VTB; если страница недоступна — официальный курс НБРК. Кассу VTB всегда можно ввести вручную.",
    rateEmpty: "Курса ещё нет. Обновите или введите вручную.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
    rateSource: {
      vtb: "источник: VTB",
      nbk: "источник: НБРК (касса VTB сейчас не публикует курс)",
      manual: "источник: вручную",
      other: "источник: внешний URL",
    },
    rateNbkToast: "Страница VTB недоступна — записан курс НБРК. Кассу банка введите вручную, если нужна именно она.",
    refreshRate: "Обновить курс",
    manualRate: "Записать курс вручную",
    usage: (count, usd, model) => `Claude: ${count} вызовов · ${usd} · модель ${model}`,
    noKey: "ANTHROPIC_API_KEY не задан — товарные ответы пойдут упрощённым поиском по прайсу.",
    rulesTitle: "Правила",
    rules: [
      "Сухой тон, без «отлично» и выдуманных цен.",
      "Сначала страна: Казахстан или Россия.",
      "Нет в прайсе — честный отказ, не альтернатива из головы.",
      "РФ: СДЭК, доставку бот не считает.",
      "Покупка / менеджер — пауза. Ответ из Instagram Direct тоже ставит паузу. Здесь можно вернуть бота.",
    ],
    pausedTitle: "Пауза бота",
    pausedEmpty: "Нет диалогов на паузе.",
    pausedResume: "Вернуть бота",
    pausedReason: {
      manager_intervention: "ответил менеджер",
      purchase: "покупка",
      error: "ошибка",
      other: "пауза",
    },
  },
  kk: {
    title: "Кеңесші",
    intro: "Claude сұрауды түсінеді және tools шақырады. Баға мен қор — тек жүктелген прайстан.",
    catalogTitle: "Каталог",
    catalogBody: "Excel-ді CSV етіп сақтаңыз немесе Google Sheet сілтемесін беріңіз.",
    catalogEmpty: "Прайс жүктелмеген.",
    catalogCount: (n, at) => `${n} позиция · ${at}`,
    uploadLabel: "CSV файл",
    sheetsLabel: "Google Sheet сілтемесі",
    sheetsPlaceholder: "https://docs.google.com/spreadsheets/d/…",
    sheetsBtn: "Кестеден жүктеу",
    shopLabel: "Толық ассортимент сілтемесі",
    saveShop: "Сілтемені сақтау",
    rateTitle: "VTB Қазақстан бағамы",
    rateBody: "RUB = ₸ / (сатып алу бағамы × 0,95). VTB жоқ болса — НБРК.",
    rateEmpty: "Бағам жоқ.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
    rateSource: {
      vtb: "көз: VTB",
      nbk: "көз: НБРК (VTB кассасы жарияламайды)",
      manual: "көз: қолмен",
      other: "көз: сыртқы URL",
    },
    rateNbkToast: "VTB беті жоқ — НБРК бағамы жазылды.",
    refreshRate: "Бағамды жаңарту",
    manualRate: "Қолмен жазу",
    usage: (count, usd, model) => `Claude: ${count} · ${usd} · ${model}`,
    noKey: "ANTHROPIC_API_KEY жоқ.",
    rulesTitle: "Ережелер",
    rules: [
      "Құрғақ тон, ойдан шығарылған баға жоқ.",
      "Алдымен ел.",
      "Прайста жоқ — ашық айту.",
      "РФ: CDEK, бот жеткізуді есептемейді.",
      "Сатып алу / менеджер — пауза. Осы жерден ботты қайта қосуға болады.",
    ],
    pausedTitle: "Бот паузасы",
    pausedEmpty: "Паузадағы диалог жоқ.",
    pausedResume: "Ботты қайтару",
    pausedReason: {
      manager_intervention: "менеджер жауап берді",
      purchase: "сатып алу",
      error: "қате",
      other: "пауза",
    },
  },
  en: {
    title: "Consultant",
    intro:
      "Claude understands the request and calls tools. Prices and stock come only from the uploaded list.",
    catalogTitle: "Catalog",
    catalogBody:
      "Save the daily Excel as CSV, or paste a Google Sheet link. Columns: name, price, size, color, stock.",
    catalogEmpty: "No price list yet — the bot will not invent a price.",
    catalogCount: (n, at) => `${n} items · updated ${at}`,
    uploadLabel: "CSV file",
    sheetsLabel: "Google Sheet URL",
    sheetsPlaceholder: "https://docs.google.com/spreadsheets/d/…",
    sheetsBtn: "Import from sheet",
    shopLabel: "Full assortment URL",
    saveShop: "Save URL",
    rateTitle: "VTB Kazakhstan rate",
    rateBody:
      "RUB = ₸ / (buy rate × 0.95). VTB first; if their page is down we store the official NBK rate. You can still type the VTB till rate.",
    rateEmpty: "No rate yet. Refresh or enter it manually.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
    rateSource: {
      vtb: "source: VTB",
      nbk: "source: NBK (VTB till rate is not published)",
      manual: "source: manual",
      other: "source: custom URL",
    },
    rateNbkToast: "VTB page is down — stored the official NBK rate. Enter the till rate manually if you need VTB.",
    refreshRate: "Refresh rate",
    manualRate: "Save manual rate",
    usage: (count, usd, model) => `Claude: ${count} calls · ${usd} · ${model}`,
    noKey: "ANTHROPIC_API_KEY is missing — product answers fall back to list matching.",
    rulesTitle: "Rules",
    rules: [
      "Dry tone, no invented prices.",
      "Country first: Kazakhstan or Russia.",
      "Not on the list — say so, do not invent alternatives.",
      "RF: CDEK; the bot does not quote shipping.",
      "Buy / manager pauses automation. A reply from Instagram Direct also pauses it. Resume the bot here.",
    ],
    pausedTitle: "Bot pause",
    pausedEmpty: "No paused conversations.",
    pausedResume: "Resume bot",
    pausedReason: {
      manager_intervention: "manager replied",
      purchase: "purchase",
      error: "error",
      other: "paused",
    },
  },
  uz: {
    title: "Maslahatchi",
    intro:
      "Claude so‘rovni tushunadi va tools chaqiradi. Narx va qoldiq — faqat yuklangan ro‘yxatdan.",
    catalogTitle: "Katalog",
    catalogBody: "Excelni CSV qilib saqlang yoki Google Sheet havolasini bering.",
    catalogEmpty: "Narxlar ro‘yxati yo‘q.",
    catalogCount: (n, at) => `${n} ta · ${at}`,
    uploadLabel: "CSV fayl",
    sheetsLabel: "Google Sheet havolasi",
    sheetsPlaceholder: "https://docs.google.com/spreadsheets/d/…",
    sheetsBtn: "Jadvaldan yuklash",
    shopLabel: "To‘liq assortiment havolasi",
    saveShop: "Havolani saqlash",
    rateTitle: "VTB Qozog‘iston kursi",
    rateBody: "RUB = ₸ / (sotib olish kursi × 0,95). VTB yo‘q bo‘lsa — NBK.",
    rateEmpty: "Kurs yo‘q.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
    rateSource: {
      vtb: "manba: VTB",
      nbk: "manba: NBK (VTB kassasi e’lon qilmaydi)",
      manual: "manba: qo‘lda",
      other: "manba: tashqi URL",
    },
    rateNbkToast: "VTB sahifasi yo‘q — NBK kursi yozildi.",
    refreshRate: "Kursni yangilash",
    manualRate: "Qo‘lda yozish",
    usage: (count, usd, model) => `Claude: ${count} · ${usd} · ${model}`,
    noKey: "ANTHROPIC_API_KEY yo‘q.",
    rulesTitle: "Qoidalar",
    rules: [
      "Quruq ohang, o‘ylab topilgan narx yo‘q.",
      "Avval mamlakat.",
      "Ro‘yxatda yo‘q — ochiq aytish.",
      "RF: CDEK, bot yetkazib berishni hisoblamaydi.",
      "Sotib olish / menejer — pauza. Botni shu yerda qayta yoqish mumkin.",
    ],
    pausedTitle: "Bot pauzasi",
    pausedEmpty: "Pauzadagi suhbat yo‘q.",
    pausedResume: "Botni qaytarish",
    pausedReason: {
      manager_intervention: "menejer javob berdi",
      purchase: "sotib olish",
      error: "xato",
      other: "pauza",
    },
  },
};

function formatWhen(iso: string | undefined, locale: Locale): string {
  if (!iso) return "—";
  const loc =
    locale === "en" ? "en-US" : locale === "kk" ? "kk-KZ" : locale === "uz" ? "uz-UZ" : "ru-RU";
  return new Date(iso).toLocaleString(loc);
}

function ConsultantPage() {
  const { locale } = useAdminLocale();
  const c = copy[locale];
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["consultant-admin"], queryFn: () => getConsultantAdminFn() });
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [shopUrl, setShopUrl] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [dialogSearch, setDialogSearch] = useState("");
  const [dialogFilter, setDialogFilter] = useState<"all" | "paused" | "active">("all");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogStockFilter, setCatalogStockFilter] = useState<"all" | "in_stock" | "out_of_stock">("all");
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState<string>("all");

  const d = data.data;
  const sheetsValue = sheetsUrl || d?.sheetsUrl || "";
  const shopValue = shopUrl || d?.shopUrl || "";
  const tasks = d?.tasks ?? [];
  const pendingTasksCount = tasks.filter((t) => !t.done).length;

  const rawCatalog = d?.catalog ?? [];
  const categories = Array.from(new Set(rawCatalog.map((p) => p.category).filter(Boolean)));

  const filteredCatalog = rawCatalog.filter((p) => {
    if (catalogStockFilter === "in_stock" && !p.stock) return false;
    if (catalogStockFilter === "out_of_stock" && p.stock) return false;
    if (catalogCategoryFilter !== "all" && p.category !== catalogCategoryFilter) return false;
    if (catalogSearch.trim()) {
      const q = catalogSearch.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchCat = (p.category ?? "").toLowerCase().includes(q);
      const matchSize = (p.size ?? "").toLowerCase().includes(q);
      const matchColor = (p.colors ?? []).some((c) => c.toLowerCase().includes(q));
      if (!matchName && !matchCat && !matchSize && !matchColor) return false;
    }
    return true;
  });

  const filteredCustomers = (d?.customers ?? []).filter((row) => {
    if (dialogFilter === "paused" && !row.paused) return false;
    if (dialogFilter === "active" && row.paused) return false;
    if (dialogSearch.trim()) {
      const q = dialogSearch.toLowerCase();
      const matchLabel = row.label.toLowerCase().includes(q);
      const matchUser = row.userKey.toLowerCase().includes(q);
      const matchTurn = (row.recent ?? []).some((turn) => turn.text.toLowerCase().includes(q));
      const matchReply = (row.lastReply ?? "").toLowerCase().includes(q);
      if (!matchLabel && !matchUser && !matchTurn && !matchReply) return false;
    }
    return true;
  });

  const importCsv = useMutation({
    mutationFn: (csv: string) => importConsultantCatalogFn({ data: { csv, source: "csv" } }),
    onSuccess: (res) => {
      toast.success(`${res.meta.count} позиций`);
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const importXlsx = useMutation({
    mutationFn: (xlsxBase64: string) =>
      importConsultantCatalogFn({ data: { xlsxBase64, source: "xlsx" } }),
    onSuccess: (res) => {
      toast.success(`${res.meta.count} позиций`);
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const importDrive = useMutation({
    mutationFn: () => importConsultantDriveFn({ data: { url: driveUrl || d?.driveUrl || "" } }),
    onSuccess: (res) => {
      toast.success(`${res.meta.count} позиций`);
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const importSheets = useMutation({
    mutationFn: () => importConsultantSheetsFn({ data: { url: sheetsValue } }),
    onSuccess: (res) => {
      toast.success(`${res.meta.count} позиций`);
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const saveShop = useMutation({
    mutationFn: () => saveConsultantShopUrlFn({ data: { url: shopValue } }),
    onSuccess: () => {
      toast.success("Сохранено");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const refreshRate = useMutation({
    mutationFn: () => refreshConsultantRateFn(),
    onSuccess: (res) => {
      if (res.fetched && res.kind === "nbk") toast.message(c.rateNbkToast);
      else if (res.fetched) toast.success("Курс обновлён");
      else if (res.stored) toast.message("Запрос не прошёл — оставлен последний курс");
      else toast.error("Курс не получен");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const saveRate = useMutation({
    mutationFn: () => setConsultantRateFn({ data: { rate: Number(manualRate.replace(",", ".")) } }),
    onSuccess: () => {
      toast.success("Курс записан");
      setManualRate("");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const resumeBot = useMutation({
    mutationFn: (userKey: string) => resumeConsultantFn({ data: { userKey } }),
    onSuccess: () => {
      toast.success(c.pausedResume);
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const saveAb = useMutation({
    mutationFn: (bucket: "a" | "b" | "split") => saveConsultantAbFn({ data: { bucket } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consultant-admin"] }),
  });
  const toggleTask = useMutation({
    mutationFn: (p: { id: string; done: boolean }) => setConsultantTaskDoneFn({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consultant-admin"] }),
  });
  const saveChecks = useMutation({
    mutationFn: (checklist: Record<string, boolean>) =>
      saveConsultantChecklistFn({ data: { checklist } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consultant-admin"] }),
  });
  const pollInbox = useMutation({
    mutationFn: () => pollConsultantInboxFn(),
    onSuccess: (res) => {
      toast.success(`Direct: проверено ${res.checked}, ответов ${res.replied}`);
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const testTg = useMutation({
    mutationFn: () => testConsultantTelegramFn(),
    onSuccess: () => toast.success("Тестовое уведомление отправлено в Telegram!"),
    onError: (e: unknown) => toast.error("Ошибка отправки в Telegram: " + errorMessage(e)),
  });

    return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{c.intro}</p>
        {d ? (
          <p className="text-xs text-muted-foreground mt-2">
            {c.usage(d.spend.count, d.spend.usdLabel, d.model)}
            {!d.apiKeyConfigured ? ` • ${c.noKey}` : ""}
          </p>
        ) : null}
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="tasks" className="relative">
            Задачи менеджера
            {pendingTasksCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-destructive text-destructive-foreground">
                {pendingTasksCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="dialogs">Диалоги</TabsTrigger>
          <TabsTrigger value="stories">Сторис</TabsTrigger>
          <TabsTrigger value="knowledge">База знаний</TabsTrigger>
          <TabsTrigger value="ai_setup">Настройка ИИ</TabsTrigger>
          <TabsTrigger value="diagnostics">Диагностика</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          <section className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">Instagram Direct</h2>
            <p className="text-sm text-muted-foreground">
              {c.intro}
            </p>
            <p className="text-sm">
              {d?.lastDirectAt
                ? `Последнее входящее: ${formatWhen(d.lastDirectAt, locale)} — ${d.lastDirectStatus}`
                : "Отсутствует"}
            </p>
          </section>

          <section className="bg-card border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-medium">Уведомления в Telegram</h2>
                <p className="text-xs text-muted-foreground">
                  При вызове менеджера или запросе на оформление бот присылает карточку диалога владельцу бота в Telegram.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testTg.isPending}
                onClick={() => testTg.mutate()}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                {testTg.isPending ? "Отправка..." : "Проверить Telegram"}
              </Button>
            </div>
          </section>

          <section className="bg-card border rounded-lg p-4 space-y-2">
            <h2 className="font-medium">Статус системы</h2>
            <p className="text-xs text-muted-foreground">
              Модель {d?.model}. {d?.spend.usdLabel}
            </p>
          </section>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-6 mt-4">
          <section className="bg-card border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="font-medium text-base">Задачи для менеджера</h2>
                <p className="text-xs text-muted-foreground">
                  Запросы на покупку и диалоги, переданные консультантом человеку.
                </p>
              </div>
              <Badge variant="outline">
                Активных: {pendingTasksCount} из {tasks.length}
              </Badge>
            </div>

            {tasks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Задач пока нет — бот ещё не передавал оформление заказов менеджеру.
              </div>
            ) : (
              <div className="divide-y border rounded-lg overflow-hidden">
                {tasks.map((t) => {
                  const isPurchase = t.reason === "purchase";
                  return (
                    <div
                      key={t.id}
                      className={`p-3.5 flex items-start justify-between gap-4 transition-colors ${
                        t.done ? "bg-muted/20 opacity-60" : "bg-card hover:bg-muted/10"
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleTask.mutate({ id: t.id, done: !t.done })}
                          disabled={toggleTask.isPending}
                          className="mt-0.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                          title={t.done ? "Вернуть в работу" : "Отметить как выполненную"}
                        >
                          {t.done ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Circle className="w-5 h-5" />
                          )}
                        </button>
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{t.userKey}</span>
                            <span
                              className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                                isPurchase
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              }`}
                            >
                              {isPurchase ? "🛒 Оформление заказа" : "❓ Требуется менеджер"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatWhen(t.at, locale)}
                            </span>
                          </div>
                          {t.contact && (
                            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 rounded px-2 py-1 border border-emerald-200 dark:border-emerald-800 inline-flex items-center gap-1.5 mt-0.5">
                              <span>📞 Контакты:</span>
                              <span className="text-foreground font-mono">{t.contact}</span>
                            </div>
                          )}
                          <p className="text-sm text-foreground/90 bg-muted/40 rounded p-2 border">
                            «{t.text}»
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {t.userKey.startsWith("ig_") && (
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href="https://www.instagram.com/direct/inbox/"
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Открыть Instagram Direct"
                            >
                              <ExternalLink className="w-3.5 h-3.5 mr-1" />
                              Direct
                            </a>
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant={t.done ? "ghost" : "outline"}
                          size="sm"
                          disabled={toggleTask.isPending}
                          onClick={() => toggleTask.mutate({ id: t.id, done: !t.done })}
                        >
                          {t.done ? "Вернуть" : "Готово"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="dialogs" className="space-y-6 mt-4">
          <section className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">{c.pausedTitle}</h2>
            {(d?.paused ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{c.pausedEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {(d?.paused ?? []).map((row) => (
                  <li key={row.userKey} className="flex items-center justify-between gap-4 text-sm p-2 rounded border bg-muted/10">
                    <span className="truncate">
                      <span className="font-medium">{row.label}</span>
                      <span className="text-muted-foreground ml-2">
                        {" · "}
                        {c.pausedReason[row.pauseReason ?? "other"] ?? c.pausedReason.other}
                        {" · "}
                        {formatWhen(row.updatedAt, locale)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={resumeBot.isPending}
                      onClick={() => resumeBot.mutate(row.userKey)}
                    >
                      {c.pausedResume}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card border rounded-lg p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Диалоги с клиентами</h2>
                <p className="text-xs text-muted-foreground">История общения консультанта в Instagram Direct</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={dialogSearch}
                  onChange={(e) => setDialogSearch(e.target.value)}
                  placeholder="Поиск по клиенту / тексту..."
                  className="h-8 text-xs w-48 sm:w-60"
                />
                <div className="flex rounded-md border bg-muted p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDialogFilter("all")}
                    className={`px-2 py-1 rounded ${dialogFilter === "all" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogFilter("paused")}
                    className={`px-2 py-1 rounded ${dialogFilter === "paused" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                  >
                    Пауза
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogFilter("active")}
                    className={`px-2 py-1 rounded ${dialogFilter === "active" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
                  >
                    Активны
                  </button>
                </div>
              </div>
            </div>

            {filteredCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Диалогов не найдено.</p>
            ) : (
              <div className="space-y-3">
                {filteredCustomers.map((row) => (
                  <div key={row.userKey} className="border rounded-lg p-3 space-y-2 text-sm bg-card">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{row.label}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-muted">
                          {row.country ? (row.country === "KZ" ? "🇰🇿 Казахстан" : "🇷🇺 Россия") : "Страна не указана"}
                        </span>
                        {row.paused ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            ⏸ На паузе
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            ▶ Бот активен
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{formatWhen(row.updatedAt, locale)}</span>
                    </div>

                    {(row.recent ?? []).length === 0 ? (
                      <p className="text-muted-foreground text-xs">{row.lastReply || "Нет недавних сообщений"}</p>
                    ) : (
                      <div className="space-y-1 bg-muted/30 rounded p-2 text-xs">
                        {(row.recent ?? []).map((turn, i) => (
                          <div key={`${row.userKey}-${i}`} className="flex gap-2">
                            <span className="font-semibold min-w-[50px] text-foreground/70">
                              {turn.role === "customer" ? "Клиент:" : "Бот:"}
                            </span>
                            <span className="text-foreground/90">{turn.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="stories" className="space-y-6 mt-4">
          <StoriesTab />
        </TabsContent>

        <TabsContent value="knowledge" className="space-y-6 mt-4">
          <section className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">{c.catalogTitle}</h2>
            <p className="text-sm text-muted-foreground">{c.catalogBody}</p>
            <p className="text-sm">
              {d?.catalogCount
                ? c.catalogCount(d.catalogCount, formatWhen(d.meta?.importedAt, locale))
                : c.catalogEmpty}
            </p>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>{c.uploadLabel}</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (/\.xlsx$/i.test(file.name)) {
                      const buf = new Uint8Array(await file.arrayBuffer());
                      let binary = "";
                      buf.forEach((b) => {
                        binary += String.fromCharCode(b);
                      });
                      importXlsx.mutate(btoa(binary));
                    } else {
                      importCsv.mutate(await file.text());
                    }
                    e.target.value = "";
                  }}
                  disabled={importCsv.isPending || importXlsx.isPending}
                />
              </div>

              <div className="space-y-1">
                <Label>{c.sheetsLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    value={sheetsValue}
                    onChange={(e) => setSheetsUrl(e.target.value)}
                    placeholder={c.sheetsPlaceholder}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={() => importSheets.mutate()}
                    disabled={importSheets.isPending}
                  >
                    {c.sheetsBtn}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-card border rounded-lg p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-medium text-base flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" />
                  Товары в базе знаний
                </h2>
                <p className="text-xs text-muted-foreground">
                  Каталог, используемый ИИ-консультантом для проверки наличия и расчета цен (₸ / ₽)
                </p>
              </div>
              <Badge variant="outline" className="self-start sm:self-auto">
                Показано: {filteredCatalog.length} из {rawCatalog.length} {d?.catalogCount && d.catalogCount > rawCatalog.length ? `(всего в базе: ${d.catalogCount})` : ""}
              </Badge>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Поиск по названию, цвету, размеру..."
                  className="pl-8 h-9 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {categories.length > 0 && (
                  <select
                    value={catalogCategoryFilter}
                    onChange={(e) => setCatalogCategoryFilter(e.target.value)}
                    className="h-9 px-2.5 rounded-md border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="all">Все категории ({categories.length})</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                )}

                <div className="flex rounded-md border bg-muted p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setCatalogStockFilter("all")}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      catalogStockFilter === "all"
                        ? "bg-background font-medium shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Все
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatalogStockFilter("in_stock")}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      catalogStockFilter === "in_stock"
                        ? "bg-background font-medium shadow-sm text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    В наличии
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatalogStockFilter("out_of_stock")}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      catalogStockFilter === "out_of_stock"
                        ? "bg-background font-medium shadow-sm text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Нет
                  </button>
                </div>
              </div>
            </div>

            {filteredCatalog.length === 0 ? (
              <div className="text-center py-10 border rounded-lg bg-muted/10 text-sm text-muted-foreground">
                {rawCatalog.length === 0
                  ? "Каталог пуст. Загрузите файл прайса (CSV / XLSX) или укажите Google Sheets выше."
                  : "По заданным фильтрам товаров не найдено."}
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-[480px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                      <TableRow>
                        <TableHead className="w-[35%]">Товар</TableHead>
                        <TableHead className="w-[15%]">Категория</TableHead>
                        <TableHead className="w-[12%]">Размер</TableHead>
                        <TableHead className="w-[15%]">Цвета</TableHead>
                        <TableHead className="w-[12%] text-right">Цена ₸</TableHead>
                        <TableHead className="w-[11%] text-right">Цена ₽</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCatalog.map((p) => {
                        const rub =
                          d?.rate?.rate && d.rate.rate > 0
                            ? Math.round(p.price_kzt / (d.rate.rate * 0.95))
                            : null;
                        return (
                          <TableRow key={p.id} className="text-xs">
                            <TableCell className="font-medium">
                              <div className="space-y-0.5">
                                <div className="text-foreground">{p.name}</div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {p.stock ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                      В наличии{p.stock_qty != null ? ` (${p.stock_qty} шт)` : ""}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                      Нет в наличии
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    ID: {p.id}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.category || "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.size || "—"}
                            </TableCell>
                            <TableCell>
                              {p.colors?.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {p.colors.map((col, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-block px-1.5 py-0.5 rounded bg-muted text-[10px]"
                                    >
                                      {col}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium font-mono text-foreground">
                              {p.price_kzt ? `${p.price_kzt.toLocaleString("ru-RU")} ₸` : "—"}
                            </TableCell>
                            <TableCell className="text-right font-medium font-mono text-muted-foreground">
                              {rub ? `${rub.toLocaleString("ru-RU")} ₽` : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </section>

          <section className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">{c.rateTitle}</h2>
            <p className="text-sm text-muted-foreground">{c.rateBody}</p>
            <p className="text-sm">
              {d?.rate
                ? `${c.rateValue(d.rate.rate, formatWhen(d.rate.updatedAt, locale))} — VTB`
                : c.rateEmpty}
            </p>
            
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                placeholder="0.00"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                className="w-24 h-9"
              />
              <Button type="button" size="sm" onClick={() => saveRate.mutate()}>
                Сохранить
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="ai_setup" className="space-y-6 mt-4">
          <section className="bg-card border rounded-lg p-4 space-y-2">
            <h2 className="font-medium">A/B формулировок</h2>
            <div className="flex gap-2">
              {(["split", "a", "b"] as const).map((bucket) => (
                <Button
                  key={bucket}
                  type="button"
                  size="sm"
                  variant={d?.ab === bucket ? "default" : "outline"}
                  onClick={() => saveAb.mutate(bucket)}
                >
                  {bucket}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              A — дословное ТЗ. B — короткий сухой вариант.
            </p>
          </section>
          
          <section className="bg-card border rounded-lg p-4 space-y-2">
            <h2 className="font-medium">{c.rulesTitle}</h2>
            <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
              {c.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          </section>
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-6 mt-4">
          <section className="bg-card border rounded-lg p-4 space-y-2">
            <h2 className="font-medium">Статистика часов</h2>
            <p className="text-sm text-muted-foreground">
              Всего запросов: {d?.analytics.total ?? 0}. 
            </p>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}