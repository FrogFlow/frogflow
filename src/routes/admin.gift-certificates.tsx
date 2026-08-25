import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import {
  cancelGiftCertificate,
  createGiftCertificate,
  listGiftCertificates,
} from "@/lib/gift-certificates.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/gift-certificates")({
  component: GiftCertificatesPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    hint: string;
    addBtn: string;
    code: string;
    codePlaceholder: string;
    amount: string;
    currency: string;
    note: string;
    notePlaceholder: string;
    save: string;
    cancelForm: string;
    empty: string;
    loading: string;
    loadError: (msg: string) => string;
    statusActive: string;
    statusRedeemed: string;
    statusCancelled: string;
    redeemedInfo: (id: number, orderId: number) => string;
    cancelBtn: string;
    confirmCancel: string;
    saveError: (msg: string) => string;
    cancelError: (msg: string) => string;
    codeIssued: (code: string) => string;
  }
> = {
  ru: {
    title: "Подарочные сертификаты",
    hint: "Продавец выдаёт сертификат вручную (оплата вне бота) и отдаёт код покупателю. Тот вводит код при оформлении заказа — сертификат применится как скидка на всю сумму номинала.",
    addBtn: "+ Выдать сертификат",
    code: "Код (необязательно)",
    codePlaceholder: "оставьте пустым — сгенерируется сам",
    amount: "Номинал",
    currency: "Валюта",
    note: "Заметка",
    notePlaceholder: "для кого / по какому поводу",
    save: "Выдать",
    cancelForm: "Отмена",
    empty: "Сертификатов пока нет.",
    loading: "Загрузка…",
    loadError: (msg) => `Не удалось загрузить сертификаты: ${msg}`,
    statusActive: "Активен",
    statusRedeemed: "Использован",
    statusCancelled: "Аннулирован",
    redeemedInfo: (id, orderId) => `покупатель ID ${id} · заказ #${orderId}`,
    cancelBtn: "Аннулировать",
    confirmCancel: "Аннулировать сертификат?",
    saveError: (msg) => `Ошибка выдачи: ${msg}`,
    cancelError: (msg) => `Не удалось аннулировать: ${msg}`,
    codeIssued: (code) => `Сертификат выдан: ${code}`,
  },
  kk: {
    title: "Сыйлық сертификаттары",
    hint: "Сатушы сертификатты қолмен шығарады (боттан тыс төлем) және кодты сатып алушыға береді. Ол код рәсімдеу кезінде енгізіледі — сертификат толық номинал сомасына жеңілдік ретінде қолданылады.",
    addBtn: "+ Сертификат шығару",
    code: "Код (міндетті емес)",
    codePlaceholder: "бос қалдырыңыз — өзі жасалады",
    amount: "Номинал",
    currency: "Валюта",
    note: "Ескертпе",
    notePlaceholder: "кімге / қандай себеппен",
    save: "Шығару",
    cancelForm: "Бас тарту",
    empty: "Сертификаттар әзірге жоқ.",
    loading: "Жүктелуде…",
    loadError: (msg) => `Сертификаттарды жүктеу мүмкін болмады: ${msg}`,
    statusActive: "Белсенді",
    statusRedeemed: "Пайдаланылды",
    statusCancelled: "Жойылды",
    redeemedInfo: (id, orderId) => `сатып алушы ID ${id} · тапсырыс #${orderId}`,
    cancelBtn: "Жою",
    confirmCancel: "Сертификатты жоюды растайсыз ба?",
    saveError: (msg) => `Шығару қатесі: ${msg}`,
    cancelError: (msg) => `Жою мүмкін болмады: ${msg}`,
    codeIssued: (code) => `Сертификат шығарылды: ${code}`,
  },
  en: {
    title: "Gift certificates",
    hint: "The seller issues a certificate manually (paid outside the bot) and gives the code to the buyer. They enter it at checkout — the certificate applies as a discount for its full face value.",
    addBtn: "+ Issue certificate",
    code: "Code (optional)",
    codePlaceholder: "leave empty to auto-generate",
    amount: "Face value",
    currency: "Currency",
    note: "Note",
    notePlaceholder: "who it's for / occasion",
    save: "Issue",
    cancelForm: "Cancel",
    empty: "No gift certificates yet.",
    loading: "Loading…",
    loadError: (msg) => `Failed to load gift certificates: ${msg}`,
    statusActive: "Active",
    statusRedeemed: "Redeemed",
    statusCancelled: "Cancelled",
    redeemedInfo: (id, orderId) => `buyer ID ${id} · order #${orderId}`,
    cancelBtn: "Cancel certificate",
    confirmCancel: "Cancel this certificate?",
    saveError: (msg) => `Issue error: ${msg}`,
    cancelError: (msg) => `Failed to cancel: ${msg}`,
    codeIssued: (code) => `Certificate issued: ${code}`,
  },
  uz: {
    title: "Sovg‘a sertifikatlari",
    hint: "Sotuvchi sertifikatni qo‘lda beradi (bot tashqarisida to‘lov) va kodni xaridorga beradi. U kodni buyurtma rasmiylashtirishda kiritadi — sertifikat butun nominal summasiga chegirma sifatida qo‘llanadi.",
    addBtn: "+ Sertifikat berish",
    code: "Kod (ixtiyoriy)",
    codePlaceholder: "bo‘sh qoldiring — o‘zi yaratiladi",
    amount: "Nominal",
    currency: "Valyuta",
    note: "Izoh",
    notePlaceholder: "kim uchun / qaysi sabab bilan",
    save: "Berish",
    cancelForm: "Bekor qilish",
    empty: "Hozircha sertifikatlar yo‘q.",
    loading: "Yuklanmoqda…",
    loadError: (msg) => `Sertifikatlarni yuklab bo‘lmadi: ${msg}`,
    statusActive: "Faol",
    statusRedeemed: "Ishlatilgan",
    statusCancelled: "Bekor qilingan",
    redeemedInfo: (id, orderId) => `xaridor ID ${id} · buyurtma #${orderId}`,
    cancelBtn: "Bekor qilish",
    confirmCancel: "Sertifikatni bekor qilasizmi?",
    saveError: (msg) => `Berish xatosi: ${msg}`,
    cancelError: (msg) => `Bekor qilib bo‘lmadi: ${msg}`,
    codeIssued: (code) => `Sertifikat berildi: ${code}`,
  },
};

type GiftCertificate = {
  id: string;
  code: string;
  amount: number;
  currency: string;
  note: string | null;
  status: "active" | "redeemed" | "cancelled";
  redeemed_by_telegram_id: number | null;
  redeemed_order_id: number | null;
  created_at: string;
};

type DraftCertificate = { code: string; amount: number; currency: string; note: string };

const emptyDraft: DraftCertificate = { code: "", amount: 1000, currency: "KZT", note: "" };

function GiftCertificatesPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const certs = useQuery({
    queryKey: ["gift-certificates"],
    queryFn: () => listGiftCertificates(),
  });
  const list = (certs.data ?? []) as GiftCertificate[];
  const [draft, setDraft] = useState<DraftCertificate | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await createGiftCertificate({
        data: {
          code: draft.code.trim() || undefined,
          amount: Number(draft.amount),
          currency: draft.currency.trim().toUpperCase(),
          note: draft.note.trim() || null,
        },
      });
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["gift-certificates"] });
      toast.success(tr.codeIssued(result.code));
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e)));
    } finally {
      setSaving(false);
    }
  }

  async function onCancel(id: string) {
    if (!(await confirmToast(tr.confirmCancel))) return;
    try {
      await cancelGiftCertificate({ data: { id } });
      qc.invalidateQueries({ queryKey: ["gift-certificates"] });
    } catch (e: unknown) {
      toast.error(tr.cancelError(errorMessage(e)));
    }
  }

  const statusLabel: Record<GiftCertificate["status"], string> = {
    active: tr.statusActive,
    redeemed: tr.statusRedeemed,
    cancelled: tr.statusCancelled,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        {!draft && <Button onClick={() => setDraft({ ...emptyDraft })}>{tr.addBtn}</Button>}
      </div>
      <p className="text-sm text-muted-foreground">{tr.hint}</p>

      {draft && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>{tr.code}</Label>
              <Input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder={tr.codePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.amount}</Label>
              <Input
                type="number"
                min={1}
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.currency}</Label>
              <Input
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{tr.note}</Label>
            <Input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder={tr.notePlaceholder}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={saving}>
              {tr.save}
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {tr.cancelForm}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-lg divide-y">
        {list.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {certs.isLoading
              ? tr.loading
              : certs.isError
                ? tr.loadError(errorMessage(certs.error))
                : tr.empty}
          </div>
        )}
        {list.map((c) => (
          <div key={c.id} className="p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium font-mono">
                {c.code}
                <span className="text-xs text-muted-foreground"> · {statusLabel[c.status]}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {c.amount} {c.currency}
                {c.note ? ` · ${c.note}` : ""}
                {c.status === "redeemed" && c.redeemed_by_telegram_id && c.redeemed_order_id
                  ? ` · ${tr.redeemedInfo(c.redeemed_by_telegram_id, c.redeemed_order_id)}`
                  : ""}
              </div>
            </div>
            {c.status === "active" && (
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="destructive" onClick={() => onCancel(c.id)}>
                  {tr.cancelBtn}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
