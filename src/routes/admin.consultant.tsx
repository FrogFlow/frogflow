import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components-ui/button";
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
} from "@/lib/consultant/consultant.functions";
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

  const d = data.data;
  const sheetsValue = sheetsUrl || d?.sheetsUrl || "";
  const shopValue = shopUrl || d?.shopUrl || "";

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

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{c.intro}</p>
        {d ? (
          <p className="text-xs text-muted-foreground mt-2">
            {c.usage(d.spend.count, d.spend.usdLabel, d.model)}
            {!d.apiKeyConfigured ? ` · ${c.noKey}` : ""}
          </p>
        ) : null}
      </div>

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">Instagram Direct</h2>
        <p className="text-sm text-muted-foreground">
          Пишите в сообщения аккаунта, не в комментарий под постом. Первое сообщение — обычный
          текст, бот спросит страну.
        </p>
        <p className="text-sm">
          {d?.lastDirectAt
            ? `Последний входящий вебхук: ${formatWhen(d.lastDirectAt, locale)} · ${d.lastDirectStatus}`
            : "Вебхуков message.received ещё не было — либо сообщение не дошло до сервера, либо пишете не в Direct."}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={pollInbox.isPending}
          onClick={() => pollInbox.mutate()}
        >
          Проверить входящие и ответить
        </Button>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">{c.catalogTitle}</h2>
        <p className="text-sm text-muted-foreground">{c.catalogBody}</p>
        <p className="text-sm">
          {d?.catalogCount
            ? c.catalogCount(d.catalogCount, formatWhen(d.meta?.importedAt, locale))
            : c.catalogEmpty}
        </p>
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
          />
        </div>
        <div className="space-y-1">
          <Label>{c.sheetsLabel}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              value={sheetsValue}
              onChange={(e) => setSheetsUrl(e.target.value)}
              placeholder={c.sheetsPlaceholder}
              className="flex-1 min-w-[16rem]"
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
        <div className="space-y-1">
          <Label>Google Drive (файл или папка)</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              value={driveUrl || d?.driveUrl || ""}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/…"
              className="flex-1 min-w-[16rem]"
            />
            <Button
              type="button"
              onClick={() => importDrive.mutate()}
              disabled={importDrive.isPending}
            >
              Загрузить с Drive
            </Button>
          </div>
        </div>
        {(d?.preview ?? []).length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-auto">
            {d!.preview.map((p) => (
              <li key={p.id}>
                {p.name} · {p.size} · {p.colors.join("/")} · {p.price_kzt} ₸ ·{" "}
                {p.stock ? "есть" : "нет"}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1">
          <Label>{c.shopLabel}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              value={shopValue}
              onChange={(e) => setShopUrl(e.target.value)}
              className="flex-1 min-w-[16rem]"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => saveShop.mutate()}
              disabled={saveShop.isPending}
            >
              {c.saveShop}
            </Button>
          </div>
        </div>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">{c.rateTitle}</h2>
        <p className="text-sm text-muted-foreground">{c.rateBody}</p>
        <p className="text-sm">
          {d?.rate
            ? `${c.rateValue(d.rate.rate, formatWhen(d.rate.updatedAt, locale))} · ${c.rateSource[rateSourceKind(d.rate.source)]}`
            : c.rateEmpty}
          {d?.rateMissing ? " · курса нет — для РФ бот не назовёт ₽" : ""}
          {d?.rateStale ? " · курс старше 2 часов" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => refreshRate.mutate()}
            disabled={refreshRate.isPending}
          >
            {c.refreshRate}
          </Button>
          <Input
            value={manualRate}
            onChange={(e) => setManualRate(e.target.value)}
            placeholder="5.15"
            className="w-28"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => saveRate.mutate()}
            disabled={saveRate.isPending}
          >
            {c.manualRate}
          </Button>
        </div>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="font-medium">{c.pausedTitle}</h2>
        {(d?.paused ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.pausedEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {(d?.paused ?? []).map((row) => (
              <li
                key={row.userKey}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {row.label}
                  <span className="text-muted-foreground">
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

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">Клиенты</h2>
        <ul className="text-sm space-y-1">
          {(d?.customers ?? []).slice(0, 15).map((row) => (
            <li key={row.userKey}>
              {row.label} · {row.country ?? "—"} · {row.conversationState ?? "—"}
              {row.paused ? " · пауза" : ""}
            </li>
          ))}
          {(d?.customers ?? []).length === 0 && (
            <li className="text-muted-foreground">Пока нет диалогов консультанта.</li>
          )}
        </ul>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">Задачи менеджеру</h2>
        <ul className="space-y-2 text-sm">
          {(d?.tasks ?? []).map((task) => (
            <li key={task.id} className="flex items-start justify-between gap-2">
              <span>
                {task.userKey}: {task.reason} — {task.text}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => toggleTask.mutate({ id: task.id, done: !task.done })}
              >
                {task.done ? "Вернуть" : "Сделано"}
              </Button>
            </li>
          ))}
          {(d?.tasks ?? []).length === 0 && <li className="text-muted-foreground">Задач нет.</li>}
        </ul>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">Аналитика вопросов</h2>
        <p className="text-sm text-muted-foreground">
          Всего {d?.analytics.total ?? 0}. Часто нет в наличии:{" "}
          {(d?.analytics.frequentOos ?? []).map((x) => `${x.text} (${x.count})`).join("; ") || "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          API Claude отдельно от абонентки 15 000 ₸. Модель {d?.model}. {d?.spend.usdLabel}
        </p>
      </section>

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
        <h2 className="font-medium">Приёмка</h2>
        <p className="text-xs text-muted-foreground">{d?.oneCNote}</p>
        <p className="text-xs text-muted-foreground">{d?.paymentNote}</p>
        {[
          ["ig_live", "Реальный Instagram проверен"],
          ["catalog_live", "Реальный ассортимент BOVI прогнан"],
          ["manager_inbox", "Пауза из Inbox проверена"],
          ["manager_app", "Пауза из приложения Instagram проверена"],
          ["demo", "Демонстрация клиенту пройдена"],
        ].map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(d?.checklist[id])}
              onChange={(e) =>
                saveChecks.mutate({ ...(d?.checklist ?? {}), [id]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">{c.rulesTitle}</h2>
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          {c.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
