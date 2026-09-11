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
  importConsultantSheetsFn,
  refreshConsultantRateFn,
  saveConsultantShopUrlFn,
  setConsultantRateFn,
} from "@/lib/consultant/consultant.functions";
import { errorMessage } from "@/lib/error-message";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/consultant")({
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
    refreshRate: string;
    manualRate: string;
    usage: (count: number, usd: string, model: string) => string;
    noKey: string;
    rulesTitle: string;
    rules: string[];
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
      "RUB = ₸ / (курс покупки × 0,95). Обновление раз в 15 минут; если запрос упал — последний удачный.",
    rateEmpty: "Курса ещё нет. Обновите или введите вручную.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
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
      "Покупка / менеджер — пауза. Ответ из этой админки тоже ставит паузу.",
    ],
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
    rateBody: "RUB = ₸ / (сатып алу бағамы × 0,95). 15 минут сайын.",
    rateEmpty: "Бағам жоқ.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
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
      "Сатып алу / менеджер — пауза.",
    ],
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
      "RUB = ₸ / (buy rate × 0.95). Refreshed every 15 minutes; fetch failure keeps the last good rate.",
    rateEmpty: "No rate yet. Refresh or enter it manually.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
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
      "Buy / manager pauses automation. A reply from this inbox also pauses it.",
    ],
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
    rateBody: "RUB = ₸ / (sotib olish kursi × 0,95). 15 daqiqada.",
    rateEmpty: "Kurs yo‘q.",
    rateValue: (rate, at) => `${rate} ₸/₽ · ${at}`,
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
      "Sotib olish / menejer — pauza.",
    ],
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
      if (res.fetched) toast.success("Курс обновлён");
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
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              importCsv.mutate(await file.text());
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
          {d?.rate ? c.rateValue(d.rate.rate, formatWhen(d.rate.updatedAt, locale)) : c.rateEmpty}
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
