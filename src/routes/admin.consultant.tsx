import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components-ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components-ui/tabs";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Switch } from "@/components-ui/switch";
import { Textarea } from "@/components-ui/textarea";
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
  toggleConsultantBotFn,
  clearConsultantTasksFn,
  saveConsultantStoreInfoFn,
  saveConsultantKnowledgeFn,
  importConsultantKnowledgeFn,
} from "@/lib/consultant/consultant.functions";
import type { ConsultantKnowledgeArticle } from "@/lib/consultant/knowledge";
import { confirmToast } from "@/lib/confirm-toast";
import { StoriesTab } from "./admin.stories-tab";
import { Badge } from "@/components-ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components-ui/table";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { rateSourceKind } from "@/lib/consultant/vtb-parse";
import { priceRub } from "@/lib/consultant/rate";
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
      "RUB = ₸ / (курс покупки × 0,95 в будни / 0,93 в выходные). Подтягивается из официального ВТБ Онлайн (online.vtb.kz). Если банк недоступен — резервный курс НБРК.",
    rateEmpty: "Курса ещё нет. Обновите или введите вручную.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
    rateSource: {
      vtb: "источник: ВТБ Онлайн",
      nbk: "источник: НБРК (резервный курс)",
      manual: "источник: вручную",
      other: "источник: внешний URL",
    },
    rateNbkToast: "Сервис ВТБ временно недоступен — записан курс НБРК. Можно ввести курс вручную.",
    refreshRate: "Обновить курс (ВТБ)",
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

  const [storeAddress, setStoreAddress] = useState<string | null>(null);
  const [storePhone, setStorePhone] = useState<string | null>(null);
  const [storeHours, setStoreHours] = useState<string | null>(null);

  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeTagFilter, setKnowledgeTagFilter] = useState("all");
  const [showAddArticle, setShowAddArticle] = useState(false);
  const [newArticleTitle, setNewArticleTitle] = useState("");
  const [newArticleTags, setNewArticleTags] = useState("");
  const [newArticleContent, setNewArticleContent] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importKnowledgeText, setImportKnowledgeText] = useState("");

  const d = data.data;
  const sheetsValue = sheetsUrl || d?.sheetsUrl || "";
  const shopValue = shopUrl || d?.shopUrl || "";
  const tasks = d?.tasks ?? [];
  const pendingTasksCount = tasks.filter((t) => !t.done).length;

  const currentAddress = storeAddress !== null ? storeAddress : (d?.storeInfo?.address ?? "");
  const currentPhone = storePhone !== null ? storePhone : (d?.storeInfo?.phone ?? "");
  const currentHours = storeHours !== null ? storeHours : (d?.storeInfo?.hours ?? "");

  const knowledgeArticles: ConsultantKnowledgeArticle[] = d?.knowledge ?? [];
  const allKnowledgeTags = Array.from(
    new Set(
      knowledgeArticles
        .flatMap((a) => a.tags || [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const filteredKnowledgeArticles = knowledgeArticles.filter((art) => {
    if (knowledgeTagFilter !== "all" && !art.tags?.some((t) => t.toLowerCase() === knowledgeTagFilter)) {
      return false;
    }
    if (knowledgeSearch.trim()) {
      const q = knowledgeSearch.toLowerCase();
      const matchTitle = art.title.toLowerCase().includes(q);
      const matchContent = art.content.toLowerCase().includes(q);
      const matchTags = (art.tags || []).some((t) => t.toLowerCase().includes(q));
      if (!matchTitle && !matchContent && !matchTags) return false;
    }
    return true;
  });

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

  const toggleBot = useMutation({
    mutationFn: (enabled: boolean) => toggleConsultantBotFn({ data: { enabled } }),
    onSuccess: (res) => {
      toast.success(res.enabled ? "Автоконсультант включен" : "Автоконсультант полностью выключен");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const clearTasks = useMutation({
    mutationFn: (onlyDone?: boolean) => clearConsultantTasksFn({ data: { onlyDone } }),
    onSuccess: (_, onlyDone) => {
      toast.success(onlyDone ? "Выполненные задачи очищены" : "Список задач менеджера сброшен");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const onResetAllTasks = async () => {
    const ok = await confirmToast("Сбросить ВСЕ задачи менеджера? Список будет полностью очищен.");
    if (!ok) return;
    clearTasks.mutate(false);
  };

  const onClearDoneTasks = async () => {
    clearTasks.mutate(true);
  };

  const saveStoreInfo = useMutation({
    mutationFn: () =>
      saveConsultantStoreInfoFn({
        data: {
          address: currentAddress,
          phone: currentPhone,
          hours: currentHours,
        },
      }),
    onSuccess: () => {
      toast.success("Адрес и контакты магазина сохранены");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const saveKnowledge = useMutation({
    mutationFn: (articles: ConsultantKnowledgeArticle[]) =>
      saveConsultantKnowledgeFn({ data: { articles } }),
    onSuccess: () => {
      toast.success("База знаний обновлена");
      qc.invalidateQueries({ queryKey: ["consultant-admin"] });
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const importKnowledge = useMutation({
    mutationFn: (text: string) => importConsultantKnowledgeFn({ data: { text } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Добавлено ${res.count} статей в базу знаний (всего: ${res.total})`);
        setImportKnowledgeText("");
        setShowImport(false);
        qc.invalidateQueries({ queryKey: ["consultant-admin"] });
      } else {
        toast.error(res.error || "Ошибка импорта");
      }
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const handleAddArticle = () => {
    if (!newArticleTitle.trim() || !newArticleContent.trim()) {
      toast.error("Укажите заголовок и текст статьи");
      return;
    }
    const tags = newArticleTags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const newArt: ConsultantKnowledgeArticle = {
      id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: newArticleTitle.trim(),
      tags,
      content: newArticleContent.trim(),
      updatedAt: new Date().toISOString(),
    };
    saveKnowledge.mutate([newArt, ...knowledgeArticles]);
    setNewArticleTitle("");
    setNewArticleTags("");
    setNewArticleContent("");
    setShowAddArticle(false);
  };

  const handleDeleteArticle = async (id: string, title: string) => {
    const ok = await confirmToast(`Удалить статью "${title}" из базы знаний?`);
    if (!ok) return;
    const remaining = knowledgeArticles.filter((a) => a.id !== id);
    saveKnowledge.mutate(remaining);
  };


  const isBotEnabled = d?.botEnabled !== false;

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

      {/* Главный переключатель работы бота */}
      <div
        className={`p-4 rounded-xl border transition-colors shadow-sm flex items-center justify-between gap-4 flex-wrap ${
          isBotEnabled
            ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
            : "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                isBotEnabled ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
            />
            <h2 className="text-base font-semibold">
              {isBotEnabled ? "Автоконсультант включен" : "Автоконсультант выключен"}
            </h2>
            <Badge
              variant={isBotEnabled ? "default" : "secondary"}
              className={
                isBotEnabled
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white"
              }
            >
              {isBotEnabled ? "Активен" : "На паузе"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {isBotEnabled
              ? "Бот автоматически отвечает клиентам в Instagram Direct на вопросы по наличию, ценам и товарам."
              : "Бот полностью отключен. Все входящие сообщения в Direct обрабатываются менеджерами вручную."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center space-x-2">
            <Switch
              id="bot-master-toggle"
              checked={isBotEnabled}
              disabled={toggleBot.isPending}
              onCheckedChange={(checked) => toggleBot.mutate(checked)}
            />
            <Label htmlFor="bot-master-toggle" className="text-sm font-medium cursor-pointer">
              {isBotEnabled ? "Вкл" : "Выкл"}
            </Label>
          </div>
          <Button
            variant={isBotEnabled ? "outline" : "default"}
            size="sm"
            disabled={toggleBot.isPending}
            onClick={() => toggleBot.mutate(!isBotEnabled)}
            className="font-medium"
          >
            {isBotEnabled ? "Выключить бота" : "Включить бота"}
          </Button>
        </div>
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
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">
                  Активных: {pendingTasksCount} из {tasks.length}
                </Badge>
                {tasks.some((t) => t.done) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={clearTasks.isPending}
                    onClick={onClearDoneTasks}
                    className="text-xs h-8"
                  >
                    Очистить выполненные
                  </Button>
                )}
                {tasks.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={clearTasks.isPending}
                    onClick={onResetAllTasks}
                    className="text-xs h-8 text-destructive hover:text-destructive"
                  >
                    {clearTasks.isPending ? "Сброс..." : "Сбросить задачи"}
                  </Button>
                )}
              </div>
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
          {/* Store Info & Pickup */}
          <section className="bg-card border rounded-lg p-4 space-y-4">
            <div>
              <h2 className="font-medium text-base flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary" />
                Адрес бутика и контакты для самовывоза
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Когда клиент спрашивает, где находится магазин, можно ли забрать заказ самовывозом или приехать посмотреть текстиль вживую, бот автоматически отправляет эти контакты и адрес.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Адрес бутика / шоурума</Label>
                <Input
                  value={currentAddress}
                  onChange={(e) => setStoreAddress(e.target.value)}
                  placeholder="г. Алматы, ул. Сатпаева 3, ТЦ COLIBRI, 1 этаж"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Контактный телефон / WhatsApp</Label>
                <Input
                  value={currentPhone}
                  onChange={(e) => setStorePhone(e.target.value)}
                  placeholder="+7 (777) 333 08 08"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Режим работы</Label>
                <Input
                  value={currentHours}
                  onChange={(e) => setStoreHours(e.target.value)}
                  placeholder="Ежедневно с 10:00 до 21:00"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => saveStoreInfo.mutate()}
                disabled={saveStoreInfo.isPending}
              >
                {saveStoreInfo.isPending ? "Сохранение..." : "Сохранить адрес и контакты"}
              </Button>
            </div>
          </section>

          {/* Knowledge Base Articles */}
          <section className="bg-card border rounded-lg p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-medium text-base flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary" />
                  База знаний (фабрики, ткани, сертификаты, уход)
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Ежедневный файл 1С содержит только цены и остатки. Эти статьи дополняют знания Claude о происхождении текстиля, фабриках (Португалия, Турция), сертификатах (OEKO-TEX), плотности сатина (300 TC) и правилах стирки.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImport(!showImport)}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  {showImport ? "Скрыть импорт" : "Импорт текстом"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowAddArticle(!showAddArticle)}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  {showAddArticle ? "Отмена" : "Добавить статью"}
                </Button>
              </div>
            </div>

            {showImport && (
              <div className="bg-muted/40 border rounded-lg p-3 space-y-2">
                <Label className="text-xs font-medium">
                  Массовый импорт статей с тегами
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Формат: <code>### Заголовок статьи [тег1, тег2]</code>, затем текст статьи. Статьи разделяются тройной решёткой (###).
                </p>
                <Textarea
                  value={importKnowledgeText}
                  onChange={(e) => setImportKnowledgeText(e.target.value)}
                  placeholder={`### Фабрика в Португалии [португалия, фабрика, европа]\nBOVI производит текстиль на сертифицированной фабрике в Португалии...\n\n### Сатин 300 TC [сатин, хлопок, плотность]\nДля комплектов белья используется мерсеризованный хлопок 300 нитей/дюйм...`}
                  rows={6}
                  className="text-xs font-mono"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => importKnowledge.mutate(importKnowledgeText)}
                    disabled={importKnowledge.isPending || !importKnowledgeText.trim()}
                  >
                    {importKnowledge.isPending ? "Импорт..." : "Импортировать в базу"}
                  </Button>
                </div>
              </div>
            )}

            {showAddArticle && (
              <div className="bg-muted/40 border rounded-lg p-3 space-y-3">
                <Label className="text-xs font-medium">Новая статья базы знаний</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Заголовок</Label>
                    <Input
                      value={newArticleTitle}
                      onChange={(e) => setNewArticleTitle(e.target.value)}
                      placeholder="Например: Плотность махровых полотенец"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Теги (через запятую)</Label>
                    <Input
                      value={newArticleTags}
                      onChange={(e) => setNewArticleTags(e.target.value)}
                      placeholder="полотенца, махра, плотность, хлопок"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Содержание статьи</Label>
                  <Textarea
                    value={newArticleContent}
                    onChange={(e) => setNewArticleContent(e.target.value)}
                    placeholder="Подробный ответ консультанта о материале, фабрике или свойствах..."
                    rows={3}
                    className="text-xs mt-1"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddArticle}
                    disabled={saveKnowledge.isPending}
                  >
                    Сохранить статью
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={knowledgeSearch}
                  onChange={(e) => setKnowledgeSearch(e.target.value)}
                  placeholder="Поиск по статьям и тегам..."
                  className="pl-8 h-9 text-xs"
                />
              </div>

              {allKnowledgeTags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Тег:</span>
                  <button
                    type="button"
                    onClick={() => setKnowledgeTagFilter("all")}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      knowledgeTagFilter === "all"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Все ({knowledgeArticles.length})
                  </button>
                  {allKnowledgeTags.slice(0, 8).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setKnowledgeTagFilter(t)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        knowledgeTagFilter === t
                          ? "bg-primary text-primary-foreground font-medium"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {filteredKnowledgeArticles.length === 0 ? (
              <div className="text-center py-6 border rounded-lg bg-muted/10 text-xs text-muted-foreground">
                {knowledgeArticles.length === 0
                  ? "База знаний пока пуста. Добавьте статьи выше."
                  : "По заданному фильтру статей не найдено."}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredKnowledgeArticles.map((art) => (
                  <div
                    key={art.id}
                    className="border rounded-lg p-3 bg-background hover:bg-muted/20 transition-colors space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-primary" />
                          {art.title}
                        </h3>
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          {(art.tags || []).map((t, idx) => (
                            <Badge
                              key={idx}
                              variant="secondary"
                              className="text-[10px] py-0 px-1.5 font-normal"
                            >
                              #{t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteArticle(art.id, art.title)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {art.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

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
                            ? priceRub(p.price_kzt, d.rate.rate)
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
                ? `${c.rateValue(d.rate.rate, formatWhen(d.rate.updatedAt, locale))} — ${
                    d.rate.source?.includes("vtb")
                      ? "ВТБ Онлайн (официальный курс)"
                      : d.rate.source?.includes("nationalbank")
                      ? "НБРК (резервный курс)"
                      : "вручную"
                  }`
                : c.rateEmpty}
            </p>
            
            <div className="flex gap-2 items-center flex-wrap">
              <Input
                type="number"
                placeholder="0.00"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                className="w-28 h-9"
              />
              <Button type="button" size="sm" onClick={() => saveRate.mutate()} disabled={saveRate.isPending}>
                Сохранить вручную
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refreshRate.mutate()}
                disabled={refreshRate.isPending}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshRate.isPending ? "animate-spin" : ""}`} />
                {refreshRate.isPending ? "Обновление..." : "Подтянуть курс (ВТБ)"}
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