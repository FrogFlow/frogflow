import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getVipTariffs,
  getVipEntryTariff,
  getVipBotUsername,
  saveVipTariff,
  deleteVipTariff,
} from "@/lib/vip-tariffs.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Checkbox } from "@/components-ui/checkbox";
import type { Tables } from "@/integrations-supabase/types";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/vip/tariffs")({
  component: AdminVipTariffs,
});

const copy: Record<
  Locale,
  {
    loading: string;
    entryLoadError: (msg: string) => string;
    entrySchemaHint: string;
    title: string;
    newRenewBtn: string;
    entryTitle: string;
    entryDesc: string;
    entrySchemaNeeded: string;
    name: string;
    entryPrice: string;
    currency: string;
    entryDurationDays: string;
    entryDurationMinutes: string;
    entryActive: string;
    saveEntryBtn: string;
    savedLabel: string;
    renewNoteTitle: string;
    renewNote: string;
    hiddenNoteTitle: string;
    hiddenNote: string;
    editRenewTitle: string;
    newRenewTitle: string;
    nameExample: string;
    price: string;
    currencyExample: string;
    durationDays: string;
    durationMinutes: string;
    sortOrder: string;
    active: string;
    isPublic: string;
    linkLabel: string;
    copyLinkBtn: string;
    save: string;
    cancel: string;
    renewListTitle: string;
    disabled: string;
    hiddenLabel: string;
    publicLabel: string;
    edit: string;
    delete: string;
    linkForTariff: string;
    dayShort: string;
    minShort: string;
    noRenewTariffs: string;
    validateFields: string;
    validateEntryFields: string;
    schemaAlert: string;
    confirmDelete: string;
    missingBotUsername: string;
    linkCopied: (link: string) => string;
    copyPrompt: string;
  }
> = {
  ru: {
    loading: "Загрузка...",
    entryLoadError: (msg) => `Ошибка загрузки тарифа входа: ${msg}`,
    entrySchemaHint:
      "Выполните в Supabase SQL: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    title: "Тарифы VIP-подписки",
    newRenewBtn: "+ Тариф продления",
    entryTitle: "Первый вход",
    entryDesc:
      "Это видит новый клиент при первом /start: разовая цена за вход + первый период доступа. После оплаты открываются тарифы продления ниже. Старым клиентам (уже были в VIP / импорт / скрытая ссылка) вход не показывается.",
    entrySchemaNeeded:
      "Нужен SQL: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    name: "Название",
    entryPrice: "Цена за вход (по умолч. 10 000)",
    currency: "Валюта",
    entryDurationDays: "Срок доступа после входа (дни)",
    entryDurationMinutes: "Срок в тест-режиме (минуты)",
    entryActive: "Активен (показывать новым клиентам)",
    saveEntryBtn: "Сохранить вход",
    savedLabel: "Сохранено ✓",
    renewNoteTitle: "Тарифы продления",
    renewNote: "— для тех, кто уже был в VIP (после первого входа, импорт, истекшие).",
    hiddenNoteTitle: "Скрытый",
    hiddenNote:
      "— только по ссылке; бот запоминает и сам предлагает при продлении (дешёвая аудитория).",
    editRenewTitle: "Редактирование тарифа продления",
    newRenewTitle: "Новый тариф продления",
    nameExample: 'Название (например, "1 Месяц")',
    price: "Цена",
    currencyExample: "Валюта (KZT, RUB...)",
    durationDays: "Срок (в днях)",
    durationMinutes: "Срок для тест-режима (в минутах)",
    sortOrder: "Порядок сортировки",
    active: "Активен (можно оформлять)",
    isPublic: "Публичный при продлении. Сними = скрытый (только по ссылке)",
    linkLabel: "Ссылка на этот тариф",
    copyLinkBtn: "Скопировать ссылку",
    save: "Сохранить",
    cancel: "Отмена",
    renewListTitle: "Тарифы продления",
    disabled: "Выключен",
    hiddenLabel: "Скрытый — только по ссылке",
    publicLabel: "Публичный — при продлении",
    edit: "Изменить",
    delete: "Удалить",
    linkForTariff: "Ссылка для этого тарифа:",
    dayShort: "дн.",
    minShort: "мин.",
    noRenewTariffs: "Нет тарифов продления. Создайте хотя бы один.",
    validateFields: "Проверьте поля",
    validateEntryFields: "Проверьте поля входа",
    schemaAlert:
      "Сначала выполните SQL в Supabase (колонка is_entry):\n\nALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    confirmDelete: "Удалить тариф?",
    missingBotUsername: "Задайте VIP_BOT_USERNAME в Vercel env — иначе deep-link не собрать.",
    linkCopied: (link) => `Ссылка скопирована в буфер:\n\n${link}`,
    copyPrompt: "Скопируйте ссылку:",
  },
  kk: {
    loading: "Жүктелуде...",
    entryLoadError: (msg) => `Кіру тарифін жүктеу қатесі: ${msg}`,
    entrySchemaHint:
      "Supabase SQL орындаңыз: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    title: "VIP-жазылым тарифтері",
    newRenewBtn: "+ Ұзарту тарифі",
    entryTitle: "Алғашқы кіру",
    entryDesc:
      "Мұны жаңа клиент бірінші /start кезінде көреді: бір реттік кіру бағасы + бірінші кезең қолжетімділігі. Төлемнен кейін төмендегі ұзарту тарифтері ашылады. Ескі клиенттерге (VIP-те болған / импорт / жасырын сілтеме) кіру көрсетілмейді.",
    entrySchemaNeeded:
      "SQL қажет: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    name: "Атауы",
    entryPrice: "Кіру бағасы (әдепкі 10 000)",
    currency: "Валюта",
    entryDurationDays: "Кіргеннен кейінгі қолжетімділік мерзімі (күн)",
    entryDurationMinutes: "Тест режиміндегі мерзім (минут)",
    entryActive: "Белсенді (жаңа клиенттерге көрсету)",
    saveEntryBtn: "Кіруді сақтау",
    savedLabel: "Сақталды ✓",
    renewNoteTitle: "Ұзарту тарифтері",
    renewNote: "— бұрын VIP-те болғандарға (алғашқы кіруден кейін, импорт, мерзімі өткендер).",
    hiddenNoteTitle: "Жасырын",
    hiddenNote:
      "— тек сілтеме арқылы; бот есте сақтап, ұзарту кезінде өзі ұсынады (арзан аудитория).",
    editRenewTitle: "Ұзарту тарифін өңдеу",
    newRenewTitle: "Жаңа ұзарту тарифі",
    nameExample: 'Атауы (мысалы, "1 Ай")',
    price: "Баға",
    currencyExample: "Валюта (KZT, RUB...)",
    durationDays: "Мерзім (күнмен)",
    durationMinutes: "Тест режимінің мерзімі (минутпен)",
    sortOrder: "Сұрыптау реті",
    active: "Белсенді (рәсімдеуге болады)",
    isPublic: "Ұзартуда жария. Белгіні алу = жасырын (тек сілтеме арқылы)",
    linkLabel: "Бұл тарифке сілтеме",
    copyLinkBtn: "Сілтемені көшіру",
    save: "Сақтау",
    cancel: "Бас тарту",
    renewListTitle: "Ұзарту тарифтері",
    disabled: "Өшірулі",
    hiddenLabel: "Жасырын — тек сілтеме арқылы",
    publicLabel: "Жария — ұзартуда",
    edit: "Өзгерту",
    delete: "Жою",
    linkForTariff: "Осы тарифке сілтеме:",
    dayShort: "күн",
    minShort: "мин.",
    noRenewTariffs: "Ұзарту тарифтері жоқ. Кемінде біреуін жасаңыз.",
    validateFields: "Өрістерді тексеріңіз",
    validateEntryFields: "Кіру өрістерін тексеріңіз",
    schemaAlert:
      "Алдымен Supabase-те SQL орындаңыз (is_entry бағаны):\n\nALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    confirmDelete: "Тарифті жою керек пе?",
    missingBotUsername: "Vercel env-де VIP_BOT_USERNAME көрсетіңіз — әйтпесе deep-link құрылмайды.",
    linkCopied: (link) => `Сілтеме буферге көшірілді:\n\n${link}`,
    copyPrompt: "Сілтемені көшіріңіз:",
  },
  en: {
    loading: "Loading...",
    entryLoadError: (msg) => `Failed to load the entry plan: ${msg}`,
    entrySchemaHint:
      "Run this SQL in Supabase: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    title: "VIP subscription plans",
    newRenewBtn: "+ Renewal plan",
    entryTitle: "First entry",
    entryDesc:
      "This is what a new customer sees on their first /start: a one-time entry price plus the first access period. After payment, the renewal plans below become available. Returning customers (already had VIP / imported / hidden link) don't see the entry offer.",
    entrySchemaNeeded:
      "SQL required: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    name: "Name",
    entryPrice: "Entry price (default 10,000)",
    currency: "Currency",
    entryDurationDays: "Access period after entry (days)",
    entryDurationMinutes: "Duration in test mode (minutes)",
    entryActive: "Active (show to new customers)",
    saveEntryBtn: "Save entry plan",
    savedLabel: "Saved ✓",
    renewNoteTitle: "Renewal plans",
    renewNote: "— for those who already had VIP (after first entry, import, expired).",
    hiddenNoteTitle: "Hidden",
    hiddenNote:
      "— link-only; the bot remembers and offers it automatically on renewal (a cheaper audience).",
    editRenewTitle: "Editing renewal plan",
    newRenewTitle: "New renewal plan",
    nameExample: 'Name (e.g. "1 Month")',
    price: "Price",
    currencyExample: "Currency (KZT, RUB...)",
    durationDays: "Duration (in days)",
    durationMinutes: "Duration in test mode (in minutes)",
    sortOrder: "Sort order",
    active: "Active (can be purchased)",
    isPublic: "Public on renewal. Uncheck = hidden (link-only)",
    linkLabel: "Link to this plan",
    copyLinkBtn: "Copy link",
    save: "Save",
    cancel: "Cancel",
    renewListTitle: "Renewal plans",
    disabled: "Disabled",
    hiddenLabel: "Hidden — link-only",
    publicLabel: "Public — shown on renewal",
    edit: "Edit",
    delete: "Delete",
    linkForTariff: "Link for this plan:",
    dayShort: "d.",
    minShort: "min.",
    noRenewTariffs: "No renewal plans yet. Create at least one.",
    validateFields: "Check the fields",
    validateEntryFields: "Check the entry plan fields",
    schemaAlert:
      "First run this SQL in Supabase (is_entry column):\n\nALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    confirmDelete: "Delete this plan?",
    missingBotUsername:
      "Set VIP_BOT_USERNAME in the Vercel env — otherwise the deep link can't be built.",
    linkCopied: (link) => `Link copied to clipboard:\n\n${link}`,
    copyPrompt: "Copy the link:",
  },
  uz: {
    loading: "Yuklanmoqda...",
    entryLoadError: (msg) => `Kirish tarifini yuklashda xato: ${msg}`,
    entrySchemaHint:
      "Supabase’da SQL bajaring: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    title: "VIP obuna tariflari",
    newRenewBtn: "+ Uzaytirish tarifi",
    entryTitle: "Birinchi kirish",
    entryDesc:
      "Buni yangi mijoz birinchi /start’da ko‘radi: bir martalik kirish narxi + birinchi davr dostupi. To‘lovdan keyin quyidagi uzaytirish tariflari ochiladi. Eski mijozlarga (avval VIP’da bo‘lgan / import / yashirin havola) kirish ko‘rsatilmaydi.",
    entrySchemaNeeded:
      "SQL kerak: ALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    name: "Nomi",
    entryPrice: "Kirish narxi (standart 10 000)",
    currency: "Valyuta",
    entryDurationDays: "Kirishdan keyingi dostup muddati (kun)",
    entryDurationMinutes: "Test rejimidagi muddat (daqiqa)",
    entryActive: "Faol (yangi mijozlarga ko‘rsatish)",
    saveEntryBtn: "Kirishni saqlash",
    savedLabel: "Saqlandi ✓",
    renewNoteTitle: "Uzaytirish tariflari",
    renewNote:
      "— avval VIP’da bo‘lganlar uchun (birinchi kirishdan keyin, import, muddati o‘tgan).",
    hiddenNoteTitle: "Yashirin",
    hiddenNote:
      "— faqat havola orqali; bot eslab qoladi va uzaytirishda o‘zi taklif qiladi (arzon auditoriya).",
    editRenewTitle: "Uzaytirish tarifini tahrirlash",
    newRenewTitle: "Yangi uzaytirish tarifi",
    nameExample: 'Nomi (masalan, "1 oy")',
    price: "Narx",
    currencyExample: "Valyuta (KZT, RUB...)",
    durationDays: "Muddat (kunlarda)",
    durationMinutes: "Test rejimi muddati (daqiqalarda)",
    sortOrder: "Saralash tartibi",
    active: "Faol (rasmiylashtirish mumkin)",
    isPublic: "Uzaytirishda ochiq. Belgini olib tashlash = yashirin (faqat havola orqali)",
    linkLabel: "Bu tarifga havola",
    copyLinkBtn: "Havolani nusxalash",
    save: "Saqlash",
    cancel: "Bekor qilish",
    renewListTitle: "Uzaytirish tariflari",
    disabled: "O‘chirilgan",
    hiddenLabel: "Yashirin — faqat havola orqali",
    publicLabel: "Ochiq — uzaytirishda",
    edit: "Tahrirlash",
    delete: "O‘chirish",
    linkForTariff: "Ushbu tarif uchun havola:",
    dayShort: "kun",
    minShort: "daq.",
    noRenewTariffs: "Uzaytirish tariflari yo‘q. Kamida bittasini yarating.",
    validateFields: "Maydonlarni tekshiring",
    validateEntryFields: "Kirish maydonlarini tekshiring",
    schemaAlert:
      "Avval Supabase’da SQL bajaring (is_entry ustuni):\n\nALTER TABLE vip_tariffs ADD COLUMN IF NOT EXISTS is_entry BOOLEAN NOT NULL DEFAULT false;",
    confirmDelete: "Tarifni o‘chirasizmi?",
    missingBotUsername:
      "Vercel env’da VIP_BOT_USERNAME’ni belgilang — aks holda deep-link yig‘ilmaydi.",
    linkCopied: (link) => `Havola vaqtinchalik xotiraga nusxalandi:\n\n${link}`,
    copyPrompt: "Havolani nusxalang:",
  },
};

/** Черновик формы редактирования тарифа продления: новый ещё без id. */
type TariffDraft = Partial<Tables<"vip_tariffs">> &
  Pick<Tables<"vip_tariffs">, "name" | "price" | "currency" | "duration_days" | "duration_minutes">;

/** Черновик формы «Первый вход»: спред ответа getVipEntryTariff + флаг схемы. */
type EntryDraft = Partial<Tables<"vip_tariffs">> & { _needsSchema?: boolean };

function tariffDeepLink(botUsername: string, tariffId: string) {
  const user = botUsername.replace(/^@/, "").trim();
  if (!user) return "";
  return `https://t.me/${user}?start=t_${tariffId}`;
}

function AdminVipTariffs() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const tariffs = useQuery({ queryKey: ["vip_tariffs"], queryFn: () => getVipTariffs() });
  const entryQ = useQuery({ queryKey: ["vip_entry"], queryFn: () => getVipEntryTariff() });
  const bot = useQuery({ queryKey: ["vip_bot_username"], queryFn: () => getVipBotUsername() });

  const [editing, setEditing] = useState<TariffDraft | null>(null);
  const [entry, setEntry] = useState<EntryDraft | null>(null);
  const [entrySaved, setEntrySaved] = useState(false);

  const botUsername = (bot.data?.username || "").replace(/^@/, "").trim();

  useEffect(() => {
    if (entryQ.data) setEntry({ ...entryQ.data });
  }, [entryQ.data]);

  const renewTariffs = (tariffs.data ?? []).filter((t) => !t.is_entry);

  const handleEdit = (t: Tables<"vip_tariffs">) =>
    setEditing({ ...t, is_public: t.is_public !== false, is_entry: false });
  const handleNew = () =>
    setEditing({
      name: "",
      price: 0,
      currency: "KZT",
      duration_days: 30,
      duration_minutes: 2,
      is_active: true,
      is_public: true,
      is_entry: false,
      sort_order: 0,
    });

  const handleSave = async () => {
    if (!editing?.name || Number(editing.price) < 0) return alert(tr.validateFields);
    await saveVipTariff({ data: { ...editing, is_entry: false } });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["vip_tariffs"] });
  };

  const handleSaveEntry = async () => {
    if (!entry?.name || Number(entry.price) < 0) return alert(tr.validateEntryFields);
    if (entry._needsSchema) {
      return alert(tr.schemaAlert);
    }
    await saveVipTariff({
      data: {
        id: entry.id || undefined,
        name: entry.name,
        price: Number(entry.price),
        currency: entry.currency || "KZT",
        duration_days: Number(entry.duration_days) || 30,
        duration_minutes: Number(entry.duration_minutes) || 5,
        is_active: !!entry.is_active,
        is_public: false,
        is_entry: true,
        sort_order: -100,
      },
    });
    setEntrySaved(true);
    setTimeout(() => setEntrySaved(false), 2000);
    qc.invalidateQueries({ queryKey: ["vip_entry"] });
    qc.invalidateQueries({ queryKey: ["vip_tariffs"] });
  };

  const handleDelete = async (id: string) => {
    if (!confirm(tr.confirmDelete)) return;
    try {
      await deleteVipTariff({ data: { id } });
      qc.invalidateQueries({ queryKey: ["vip_tariffs"] });
    } catch (e: unknown) {
      alert(errorMessage(e));
    }
  };

  const copyLink = async (tariffId: string) => {
    if (!botUsername) {
      alert(tr.missingBotUsername);
      return;
    }
    const link = tariffDeepLink(botUsername, tariffId);
    try {
      await navigator.clipboard.writeText(link);
      alert(tr.linkCopied(link));
    } catch {
      prompt(tr.copyPrompt, link);
    }
  };

  if (tariffs.isLoading || entryQ.isLoading) return <div>{tr.loading}</div>;

  if (entryQ.isError) {
    return (
      <div className="space-y-4">
        <p className="text-red-600 text-sm">
          {tr.entryLoadError((entryQ.error as Error)?.message ?? "")}
        </p>
        <p className="text-sm text-muted-foreground">{tr.entrySchemaHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{tr.title}</h2>
        {!editing && <Button onClick={handleNew}>{tr.newRenewBtn}</Button>}
      </div>

      {/* First entry block */}
      {entry && (
        <div className="border-2 border-orange-200 rounded-lg bg-orange-50/50 p-4 space-y-4">
          <div>
            <h3 className="font-semibold text-lg">{tr.entryTitle}</h3>
            <p className="text-sm text-muted-foreground mt-1">{tr.entryDesc}</p>
          </div>
          {entry._needsSchema && <p className="text-sm text-red-600">{tr.entrySchemaNeeded}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{tr.name}</Label>
              <Input
                value={entry.name || ""}
                onChange={(e) => setEntry({ ...entry, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.entryPrice}</Label>
              <Input
                type="number"
                value={entry.price ?? 10000}
                onChange={(e) => setEntry({ ...entry, price: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.currency}</Label>
              <Input
                value={entry.currency || "KZT"}
                onChange={(e) => setEntry({ ...entry, currency: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.entryDurationDays}</Label>
              <Input
                type="number"
                value={entry.duration_days ?? 30}
                onChange={(e) => setEntry({ ...entry, duration_days: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.entryDurationMinutes}</Label>
              <Input
                type="number"
                value={entry.duration_minutes ?? 5}
                onChange={(e) => setEntry({ ...entry, duration_minutes: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={!!entry.is_active}
              onCheckedChange={(c) => setEntry({ ...entry, is_active: !!c })}
              id="entry-active"
            />
            <Label htmlFor="entry-active">{tr.entryActive}</Label>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSaveEntry}>{tr.saveEntryBtn}</Button>
            {entrySaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
          </div>
        </div>
      )}

      <div className="text-sm border rounded-lg p-3 bg-muted/40 space-y-1">
        <p>
          <b>{tr.renewNoteTitle}</b> {tr.renewNote}
        </p>
        <p>
          <b>{tr.hiddenNoteTitle}</b> {tr.hiddenNote}
        </p>
      </div>

      {editing && (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">{editing.id ? tr.editRenewTitle : tr.newRenewTitle}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{tr.nameExample}</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.price}</Label>
              <Input
                type="number"
                value={editing.price}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.currencyExample}</Label>
              <Input
                value={editing.currency}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.durationDays}</Label>
              <Input
                type="number"
                value={editing.duration_days}
                onChange={(e) => setEditing({ ...editing, duration_days: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.durationMinutes}</Label>
              <Input
                type="number"
                value={editing.duration_minutes ?? 0}
                onChange={(e) =>
                  setEditing({ ...editing, duration_minutes: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{tr.sortOrder}</Label>
              <Input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Checkbox
              checked={editing.is_active}
              onCheckedChange={(c) => setEditing({ ...editing, is_active: !!c })}
            />
            <Label>{tr.active}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={editing.is_public !== false}
              onCheckedChange={(c) => setEditing({ ...editing, is_public: !!c })}
            />
            <Label>{tr.isPublic}</Label>
          </div>
          {editing.id && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3">
              <Label>{tr.linkLabel}</Label>
              <code className="block text-xs break-all select-all">
                {tariffDeepLink(botUsername, editing.id)}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyLink(editing.id!)}
              >
                {tr.copyLinkBtn}
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleSave}>{tr.save}</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tr.cancel}
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="space-y-3">
          <h3 className="font-medium">{tr.renewListTitle}</h3>
          {renewTariffs.map((t) => {
            const link = tariffDeepLink(botUsername, t.id);
            const hidden = t.is_active && t.is_public === false;
            return (
              <div key={t.id} className="border rounded-lg bg-card p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {t.price} {t.currency} · {t.duration_days} {tr.dayShort} ({t.duration_minutes}{" "}
                      {tr.minShort})
                    </div>
                    <div className="text-sm mt-1">
                      {!t.is_active ? (
                        <span className="text-muted-foreground">{tr.disabled}</span>
                      ) : hidden ? (
                        <span className="text-orange-600 font-medium">{tr.hiddenLabel}</span>
                      ) : (
                        <span className="text-green-600">{tr.publicLabel}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(t)}>
                      {tr.edit}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(t.id)}>
                      {tr.delete}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">{tr.linkForTariff}</div>
                  <code className="block text-xs break-all select-all rounded bg-muted px-2 py-1">
                    {link}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => copyLink(t.id)}
                  >
                    {tr.copyLinkBtn}
                  </Button>
                </div>
              </div>
            );
          })}
          {renewTariffs.length === 0 && (
            <p className="text-center text-muted-foreground py-6">{tr.noRenewTariffs}</p>
          )}
        </div>
      )}
    </div>
  );
}
