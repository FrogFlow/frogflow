import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import {
  deletePaymentMethod,
  listPaymentMethods,
  savePaymentMethod,
} from "@/lib/payment-methods.functions";
import { getSignedUploadUrl } from "@/lib/products.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/payment-methods")({
  component: PaymentMethodsPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    addBtn: string;
    countryCode: string;
    countryCodePlaceholder: string;
    countryName: string;
    countryNamePlaceholder: string;
    currency: string;
    currencyPlaceholder: string;
    instructions: string;
    instructionsPlaceholder: string;
    qrLabel: string;
    sortOrder: string;
    active: string;
    save: string;
    cancel: string;
    empty: string;
    hidden: string;
    editShort: string;
    deleteShort: string;
    confirmDelete: string;
    qrUploadError: (msg: string) => string;
    saveError: (msg: string) => string;
  }
> = {
  ru: {
    title: "Реквизиты по странам",
    addBtn: "+ Добавить",
    countryCode: "Код страны",
    countryCodePlaceholder: "KZ, RU, KG...",
    countryName: "Название (как будет в боте)",
    countryNamePlaceholder: "🇰🇿 Казахстан",
    currency: "Валюта",
    currencyPlaceholder: "KZT, RUB, KGS, BYN, USD...",
    instructions: "Инструкция для оплаты (что увидит покупатель)",
    instructionsPlaceholder: "Kaspi: +7 XXX...\nHalyk: ...",
    qrLabel: "QR-код для оплаты (опционально)",
    sortOrder: "Порядок",
    active: "Активен",
    save: "Сохранить",
    cancel: "Отмена",
    empty: "Нет способов оплаты.",
    hidden: " · скрыт",
    editShort: "Изм.",
    deleteShort: "Удал.",
    confirmDelete: "Удалить способ оплаты?",
    qrUploadError: (msg) => `Ошибка загрузки QR-кода: ${msg}`,
    saveError: (msg) => `Ошибка при сохранении: ${msg}`,
  },
  kk: {
    title: "Елдер бойынша төлем деректері",
    addBtn: "+ Қосу",
    countryCode: "Ел коды",
    countryCodePlaceholder: "KZ, RU, KG...",
    countryName: "Атауы (ботта көрсетілетін)",
    countryNamePlaceholder: "🇰🇿 Қазақстан",
    currency: "Валюта",
    currencyPlaceholder: "KZT, RUB, KGS, BYN, USD...",
    instructions: "Төлем нұсқаулығы (сатып алушы көретін мәтін)",
    instructionsPlaceholder: "Kaspi: +7 XXX...\nHalyk: ...",
    qrLabel: "Төлем үшін QR-код (міндетті емес)",
    sortOrder: "Реті",
    active: "Белсенді",
    save: "Сақтау",
    cancel: "Бас тарту",
    empty: "Төлем әдістері жоқ.",
    hidden: " · жасырын",
    editShort: "Өзг.",
    deleteShort: "Жою",
    confirmDelete: "Төлем әдісін жою керек пе?",
    qrUploadError: (msg) => `QR-кодты жүктеу қатесі: ${msg}`,
    saveError: (msg) => `Сақтау кезінде қате: ${msg}`,
  },
  en: {
    title: "Payment details by country",
    addBtn: "+ Add",
    countryCode: "Country code",
    countryCodePlaceholder: "KZ, RU, KG...",
    countryName: "Name (shown in the bot)",
    countryNamePlaceholder: "🇰🇿 Kazakhstan",
    currency: "Currency",
    currencyPlaceholder: "KZT, RUB, KGS, BYN, USD...",
    instructions: "Payment instructions (what the buyer will see)",
    instructionsPlaceholder: "Kaspi: +7 XXX...\nHalyk: ...",
    qrLabel: "Payment QR code (optional)",
    sortOrder: "Order",
    active: "Active",
    save: "Save",
    cancel: "Cancel",
    empty: "No payment methods yet.",
    hidden: " · hidden",
    editShort: "Edit",
    deleteShort: "Delete",
    confirmDelete: "Delete this payment method?",
    qrUploadError: (msg) => `Failed to upload the QR code: ${msg}`,
    saveError: (msg) => `Failed to save: ${msg}`,
  },
  uz: {
    title: "Mamlakatlar bo‘yicha to‘lov ma’lumotlari",
    addBtn: "+ Qo‘shish",
    countryCode: "Mamlakat kodi",
    countryCodePlaceholder: "KZ, RU, KG...",
    countryName: "Nomi (botda ko‘rinadigan)",
    countryNamePlaceholder: "🇰🇿 Qozog‘iston",
    currency: "Valyuta",
    currencyPlaceholder: "KZT, RUB, KGS, BYN, USD...",
    instructions: "To‘lov yo‘riqnomasi (xaridor ko‘radigan matn)",
    instructionsPlaceholder: "Kaspi: +7 XXX...\nHalyk: ...",
    qrLabel: "To‘lov uchun QR-kod (ixtiyoriy)",
    sortOrder: "Tartib",
    active: "Faol",
    save: "Saqlash",
    cancel: "Bekor qilish",
    empty: "To‘lov usullari yo‘q.",
    hidden: " · yashirin",
    editShort: "Tahr.",
    deleteShort: "O‘chir.",
    confirmDelete: "To‘lov usulini o‘chirasizmi?",
    qrUploadError: (msg) => `QR-kodni yuklashda xato: ${msg}`,
    saveError: (msg) => `Saqlashda xato: ${msg}`,
  },
};

type PM = {
  id?: string;
  country_code: string;
  country_name: string;
  currency: string;
  instructions: string;
  sort_order: number;
  is_active: boolean;
  qr_code_path?: string | null;
};

const empty: PM = {
  country_code: "",
  country_name: "",
  currency: "KZT",
  instructions: "",
  sort_order: 0,
  is_active: true,
  qr_code_path: null,
};

async function uploadFile(file: File) {
  const { path, name, signedUrl } = await getSignedUploadUrl({
    data: { bucket: "product-images", filename: file.name },
  });
  const contentType = file.type || "application/octet-stream";
  const resUpload = await fetch(signedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  });
  if (!resUpload.ok) throw new Error(await resUpload.text());
  return { path, name };
}

function PaymentMethodsPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: () => listPaymentMethods() });
  const list = (methods.data ?? []) as PM[];
  const [editing, setEditing] = useState<PM | null>(null);

  async function onQrChange(file: File | null) {
    if (!file) return;
    try {
      const r = await uploadFile(file);
      setEditing((prev) => (prev ? { ...prev, qr_code_path: r.path } : prev));
    } catch (e: unknown) {
      toast.error(tr.qrUploadError(errorMessage(e)));
    }
  }

  async function onSave() {
    if (!editing) return;
    try {
      await savePaymentMethod({ data: editing });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e)));
    }
  }
  async function onDelete(id: string) {
    if (!confirm(tr.confirmDelete)) return;
    await deletePaymentMethod({ data: { id } });
    qc.invalidateQueries({ queryKey: ["payment-methods"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        {!editing && <Button onClick={() => setEditing({ ...empty })}>{tr.addBtn}</Button>}
      </div>

      {editing && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>{tr.countryCode}</Label>
              <Input
                value={editing.country_code}
                onChange={(e) =>
                  setEditing({ ...editing, country_code: e.target.value.toUpperCase() })
                }
                placeholder={tr.countryCodePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.countryName}</Label>
              <Input
                value={editing.country_name}
                onChange={(e) => setEditing({ ...editing, country_name: e.target.value })}
                placeholder={tr.countryNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.currency}</Label>
              <Input
                value={editing.currency}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })}
                placeholder={tr.currencyPlaceholder}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{tr.instructions}</Label>
            <Textarea
              rows={6}
              value={editing.instructions}
              onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
              placeholder={tr.instructionsPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label>{tr.qrLabel}</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => onQrChange(e.target.files?.[0] ?? null)}
            />
            {editing.qr_code_path && (
              <div className="mt-2 relative inline-block">
                <img
                  src={`/api/public/img/${editing.qr_code_path}`}
                  alt="QR"
                  className="w-32 h-32 object-cover rounded border"
                />
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, qr_code_path: null })}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-5 h-5 text-xs"
                >
                  ×
                </button>
              </div>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{tr.sortOrder}</Label>
              <Input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm pt-7">
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
              />
              {tr.active}
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave}>{tr.save}</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tr.cancel}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-lg divide-y">
        {list.length === 0 && <div className="p-4 text-sm text-muted-foreground">{tr.empty}</div>}
        {list.map((m) => (
          <div key={m.id} className="p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {m.country_name}{" "}
                <span className="text-xs text-muted-foreground">[{m.country_code}]</span>
                <span className="text-xs text-muted-foreground"> · {m.currency}</span>
                {!m.is_active && <span className="text-xs text-muted-foreground">{tr.hidden}</span>}
              </div>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap mt-1 font-sans">
                {m.instructions}
              </pre>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                {tr.editShort}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onDelete(m.id!)}>
                {tr.deleteShort}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
