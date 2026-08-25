import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { deletePromoCode, listPromoCodes, savePromoCode } from "@/lib/promo-codes.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/promo-codes")({
  component: PromoCodesPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    addBtn: string;
    code: string;
    codePlaceholder: string;
    discountType: string;
    percent: string;
    fixed: string;
    discountValue: string;
    maxUses: string;
    maxUsesPlaceholder: string;
    validUntil: string;
    active: string;
    save: string;
    cancel: string;
    empty: string;
    loading: string;
    loadError: (msg: string) => string;
    inactive: string;
    usesLabel: (used: number, max: string) => string;
    unlimited: string;
    noExpiry: string;
    editShort: string;
    deleteShort: string;
    confirmDelete: string;
    saveError: (msg: string) => string;
    deleteError: (msg: string) => string;
  }
> = {
  ru: {
    title: "Промокоды",
    addBtn: "+ Добавить",
    code: "Код",
    codePlaceholder: "SALE20",
    discountType: "Тип скидки",
    percent: "Процент",
    fixed: "Фиксированная сумма",
    discountValue: "Размер скидки",
    maxUses: "Лимит использований",
    maxUsesPlaceholder: "пусто = без лимита",
    validUntil: "Действует до",
    active: "Активен",
    save: "Сохранить",
    cancel: "Отмена",
    empty: "Промокодов пока нет.",
    loading: "Загрузка…",
    loadError: (msg) => `Не удалось загрузить промокоды: ${msg}`,
    inactive: " · выключен",
    usesLabel: (used, max) => `Использован: ${used} из ${max}`,
    unlimited: "∞",
    noExpiry: "без срока",
    editShort: "Изм.",
    deleteShort: "Удал.",
    confirmDelete: "Удалить промокод?",
    saveError: (msg) => `Ошибка сохранения: ${msg}`,
    deleteError: (msg) => `Не удалось удалить: ${msg}`,
  },
  kk: {
    title: "Промокодтар",
    addBtn: "+ Қосу",
    code: "Код",
    codePlaceholder: "SALE20",
    discountType: "Жеңілдік түрі",
    percent: "Пайыз",
    fixed: "Тіркелген сома",
    discountValue: "Жеңілдік мөлшері",
    maxUses: "Пайдалану шегі",
    maxUsesPlaceholder: "бос = шексіз",
    validUntil: "Дейін жарамды",
    active: "Белсенді",
    save: "Сақтау",
    cancel: "Бас тарту",
    empty: "Промокодтар әзірге жоқ.",
    loading: "Жүктелуде…",
    loadError: (msg) => `Промокодтарды жүктеу мүмкін болмады: ${msg}`,
    inactive: " · өшірулі",
    usesLabel: (used, max) => `Пайдаланылды: ${used} / ${max}`,
    unlimited: "∞",
    noExpiry: "мерзімсіз",
    editShort: "Өзг.",
    deleteShort: "Жою",
    confirmDelete: "Промокодты жою керек пе?",
    saveError: (msg) => `Сақтау қатесі: ${msg}`,
    deleteError: (msg) => `Жою мүмкін болмады: ${msg}`,
  },
  en: {
    title: "Promo codes",
    addBtn: "+ Add",
    code: "Code",
    codePlaceholder: "SALE20",
    discountType: "Discount type",
    percent: "Percent",
    fixed: "Fixed amount",
    discountValue: "Discount value",
    maxUses: "Usage limit",
    maxUsesPlaceholder: "empty = unlimited",
    validUntil: "Valid until",
    active: "Active",
    save: "Save",
    cancel: "Cancel",
    empty: "No promo codes yet.",
    loading: "Loading…",
    loadError: (msg) => `Failed to load promo codes: ${msg}`,
    inactive: " · disabled",
    usesLabel: (used, max) => `Used: ${used} of ${max}`,
    unlimited: "∞",
    noExpiry: "no expiry",
    editShort: "Edit",
    deleteShort: "Delete",
    confirmDelete: "Delete this promo code?",
    saveError: (msg) => `Save error: ${msg}`,
    deleteError: (msg) => `Failed to delete: ${msg}`,
  },
  uz: {
    title: "Promokodlar",
    addBtn: "+ Qo‘shish",
    code: "Kod",
    codePlaceholder: "SALE20",
    discountType: "Chegirma turi",
    percent: "Foiz",
    fixed: "Belgilangan summa",
    discountValue: "Chegirma miqdori",
    maxUses: "Foydalanish chegarasi",
    maxUsesPlaceholder: "bo‘sh = cheksiz",
    validUntil: "Muddati",
    active: "Faol",
    save: "Saqlash",
    cancel: "Bekor qilish",
    empty: "Hozircha promokodlar yo‘q.",
    loading: "Yuklanmoqda…",
    loadError: (msg) => `Promokodlarni yuklab bo‘lmadi: ${msg}`,
    inactive: " · o‘chirilgan",
    usesLabel: (used, max) => `Ishlatilgan: ${used} / ${max}`,
    unlimited: "∞",
    noExpiry: "muddatsiz",
    editShort: "Tahr.",
    deleteShort: "O‘chir.",
    confirmDelete: "Promokodni o‘chirasizmi?",
    saveError: (msg) => `Saqlash xatosi: ${msg}`,
    deleteError: (msg) => `O‘chirib bo‘lmadi: ${msg}`,
  },
};

type PromoCode = {
  id?: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  max_uses: number | null;
  used_count?: number;
  valid_until: string | null;
  is_active: boolean;
};

const empty: PromoCode = {
  code: "",
  discount_type: "percent",
  discount_value: 10,
  max_uses: null,
  valid_until: null,
  is_active: true,
};

function PromoCodesPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const codes = useQuery({ queryKey: ["promo-codes"], queryFn: () => listPromoCodes() });
  const list = (codes.data ?? []) as PromoCode[];
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await savePromoCode({
        data: {
          id: editing.id,
          code: editing.code,
          discount_type: editing.discount_type,
          discount_value: Number(editing.discount_value),
          max_uses: editing.max_uses,
          valid_until: editing.valid_until,
          is_active: editing.is_active,
        },
      });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["promo-codes"] });
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e)));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!(await confirmToast(tr.confirmDelete))) return;
    try {
      await deletePromoCode({ data: { id } });
      qc.invalidateQueries({ queryKey: ["promo-codes"] });
    } catch (e: unknown) {
      toast.error(tr.deleteError(errorMessage(e)));
    }
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
              <Label>{tr.code}</Label>
              <Input
                value={editing.code}
                onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                placeholder={tr.codePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.discountType}</Label>
              <select
                className="border rounded-md h-9 px-3 text-sm bg-background w-full"
                value={editing.discount_type}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    discount_type: e.target.value as "percent" | "fixed",
                  })
                }
              >
                <option value="percent">{tr.percent}</option>
                <option value="fixed">{tr.fixed}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>{tr.discountValue}</Label>
              <Input
                type="number"
                min={0}
                value={editing.discount_value}
                onChange={(e) => setEditing({ ...editing, discount_value: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{tr.maxUses}</Label>
              <Input
                type="number"
                min={1}
                value={editing.max_uses ?? ""}
                placeholder={tr.maxUsesPlaceholder}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    max_uses: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.validUntil}</Label>
              <Input
                type="date"
                value={editing.valid_until ? editing.valid_until.slice(0, 10) : ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    valid_until: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.is_active}
              onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
            />
            {tr.active}
          </label>
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={saving}>
              {tr.save}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tr.cancel}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-lg divide-y">
        {list.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {codes.isLoading
              ? tr.loading
              : codes.isError
                ? tr.loadError(errorMessage(codes.error))
                : tr.empty}
          </div>
        )}
        {list.map((c) => (
          <div key={c.id} className="p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium font-mono">
                {c.code}
                {!c.is_active && (
                  <span className="text-xs text-muted-foreground">{tr.inactive}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.discount_type === "percent" ? `${c.discount_value}%` : c.discount_value}
                {" · "}
                {tr.usesLabel(
                  c.used_count ?? 0,
                  c.max_uses === null ? tr.unlimited : String(c.max_uses),
                )}
                {" · "}
                {c.valid_until ? new Date(c.valid_until).toLocaleDateString() : tr.noExpiry}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                {tr.editShort}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onDelete(c.id!)}>
                {tr.deleteShort}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
