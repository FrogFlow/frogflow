import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components-ui/button";
import { Checkbox } from "@/components-ui/checkbox";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";
import { Textarea } from "@/components-ui/textarea";
import { EmojiInsertBar, insertAtCursor } from "@/components-ui/emoji-insert-bar";
import {
  cancelBroadcastFn,
  getBroadcastFn,
  getBroadcastUploadUrl,
  listBroadcastsFn,
  previewBroadcastAudience,
  processBroadcastBatchFn,
  sendTestBroadcastFn,
  startBroadcastFn,
} from "@/lib/broadcast.functions";
import { listPaymentMethods } from "@/lib/payment-methods.functions";
import { listProducts } from "@/lib/products.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/broadcast")({
  component: BroadcastPage,
});

type AudienceType = "all" | "country" | "buyers" | "non_buyers" | "test";

const dateLocales: Record<Locale, string> = {
  ru: "ru-RU",
  kk: "kk-KZ",
  en: "en-US",
  uz: "uz-UZ",
};

const copy: Record<
  Locale,
  {
    audienceLabels: Record<AudienceType, string>;
    title: string;
    audienceLabel: string;
    countryPlaceholder: string;
    countryHint: string;
    recipients: (n: string) => string;
    textLabel: string;
    textPlaceholder: string;
    photosLabel: string;
    uploading: string;
    deleteTitle: string;
    clearAll: string;
    buttonsLabel: string;
    addCatalogButton: string;
    sendTestBtn: string;
    startBtn: string;
    currentBroadcast: string;
    statusLabel: string;
    sentLabel: (sent: number, total: number) => string;
    errorsLabel: (n: number) => string;
    blockedLabel: (n: number) => string;
    errorsShort: (n: number) => string;
    blockedShort: (n: number) => string;
    cronHint: string;
    processNowBtn: string;
    cancelBtn: string;
    cancelConfirm: string;
    historyTitle: string;
    noHistory: string;
    statusMap: Record<string, string>;
    enterText: string;
    testSent: string;
    startConfirm: (n: string) => string;
    uploadFailed: (name: string) => string;
  }
> = {
  ru: {
    audienceLabels: {
      all: "Все пользователи бота",
      buyers: "Только покупатели",
      non_buyers: "Только не покупавшие",
      country: "По стране",
      test: "Тест (admin Telegram ID)",
    },
    title: "Рассылка",
    audienceLabel: "Аудитория",
    countryPlaceholder: "Выберите страну",
    countryHint:
      "Фильтр по стране, которую пользователь выбрал в боте при первом входе. RU — Россия, KZ — Казахстан.",
    recipients: (n) => `Получателей: ~${n}`,
    textLabel: "Текст (HTML: <b>, <i>)",
    textPlaceholder: "Здравствуйте! К 1 сентября подготовили новые материалы…",
    photosLabel: "Фото (до 10, альбом)",
    uploading: "Загрузка…",
    deleteTitle: "Удалить",
    clearAll: "Очистить все",
    buttonsLabel: "Кнопки на товары (до 8)",
    addCatalogButton: "Добавить кнопку «Открыть каталог»",
    sendTestBtn: "Отправить себе (тест)",
    startBtn: "🚀 Запустить рассылку",
    currentBroadcast: "Текущая рассылка",
    statusLabel: "Статус:",
    sentLabel: (sent, total) => `отправлено ${sent} / ${total}`,
    errorsLabel: (n) => ` · ошибки: ${n}`,
    blockedLabel: (n) => ` · заблокировали: ${n}`,
    errorsShort: (n) => `ошибки: ${n}`,
    blockedShort: (n) => `заблокировали: ${n}`,
    cronHint: "Очередь обрабатывается автоматически через cron (каждую минуту).",
    processNowBtn: "Обработать порцию сейчас",
    cancelBtn: "Отменить",
    cancelConfirm: "Отменить рассылку? Неотправленные получатели будут пропущены.",
    historyTitle: "История",
    noHistory: "Рассылок пока не было.",
    statusMap: {
      queued: "⏳ В очереди",
      sending: "📤 Отправляется",
      completed: "✅ Завершена",
      cancelled: "🚫 Отменена",
      failed: "❌ Не удалась",
    },
    enterText: "Введите текст сообщения.",
    testSent: "Тестовое сообщение отправлено на admin Telegram ID.",
    startConfirm: (n) => `Запустить рассылку для ~${n} получателей?`,
    uploadFailed: (name) => `Не удалось загрузить ${name}`,
  },
  kk: {
    audienceLabels: {
      all: "Боттың барлық пайдаланушылары",
      buyers: "Тек сатып алушылар",
      non_buyers: "Тек сатып алмағандар",
      country: "Ел бойынша",
      test: "Тест (admin Telegram ID)",
    },
    title: "Хабарлама",
    audienceLabel: "Аудитория",
    countryPlaceholder: "Елді таңдаңыз",
    countryHint:
      "Пайдаланушы ботта бірінші кіргенде таңдаған ел бойынша сүзгі. RU — Ресей, KZ — Қазақстан.",
    recipients: (n) => `Алушылар: ~${n}`,
    textLabel: "Мәтін (HTML: <b>, <i>)",
    textPlaceholder: "Сәлеметсіз бе! 1 қыркүйекке жаңа материалдар дайындадық…",
    photosLabel: "Фото (10-ге дейін, альбом)",
    uploading: "Жүктелуде…",
    deleteTitle: "Жою",
    clearAll: "Барлығын тазарту",
    buttonsLabel: "Тауар түймелері (8-ге дейін)",
    addCatalogButton: "«Каталогты ашу» түймесін қосу",
    sendTestBtn: "Өзіме жіберу (тест)",
    startBtn: "🚀 Хабарламаны бастау",
    currentBroadcast: "Ағымдағы хабарлама",
    statusLabel: "Мәртебесі:",
    sentLabel: (sent, total) => `жіберілді ${sent} / ${total}`,
    errorsLabel: (n) => ` · қателер: ${n}`,
    blockedLabel: (n) => ` · бұғаттады: ${n}`,
    errorsShort: (n) => `қателер: ${n}`,
    blockedShort: (n) => `бұғаттады: ${n}`,
    cronHint: "Кезек cron арқылы автоматты түрде өңделеді (әр минут сайын).",
    processNowBtn: "Порцияны қазір өңдеу",
    cancelBtn: "Болдырмау",
    cancelConfirm: "Хабарламаны болдырмау керек пе? Жіберілмеген алушылар өткізіп жіберіледі.",
    historyTitle: "Тарих",
    noHistory: "Әзірге хабарламалар болған жоқ.",
    statusMap: {
      queued: "⏳ Кезекте",
      sending: "📤 Жіберілуде",
      completed: "✅ Аяқталды",
      cancelled: "🚫 Болдырылмады",
      failed: "❌ Сәтсіз аяқталды",
    },
    enterText: "Хабарлама мәтінін енгізіңіз.",
    testSent: "Тест хабары admin Telegram ID-іне жіберілді.",
    startConfirm: (n) => `~${n} алушыға хабарламаны бастау керек пе?`,
    uploadFailed: (name) => `${name} жүктелмеді`,
  },
  en: {
    audienceLabels: {
      all: "All bot users",
      buyers: "Buyers only",
      non_buyers: "Non-buyers only",
      country: "By country",
      test: "Test (admin Telegram ID)",
    },
    title: "Broadcast",
    audienceLabel: "Audience",
    countryPlaceholder: "Choose a country",
    countryHint:
      "Filters by the country the user picked in the bot on their first visit. RU — Russia, KZ — Kazakhstan.",
    recipients: (n) => `Recipients: ~${n}`,
    textLabel: "Text (HTML: <b>, <i>)",
    textPlaceholder: "Hello! We've prepared new materials for the new school year…",
    photosLabel: "Photos (up to 10, album)",
    uploading: "Uploading…",
    deleteTitle: "Delete",
    clearAll: "Clear all",
    buttonsLabel: "Product buttons (up to 8)",
    addCatalogButton: 'Add an "Open catalog" button',
    sendTestBtn: "Send to myself (test)",
    startBtn: "🚀 Start broadcast",
    currentBroadcast: "Current broadcast",
    statusLabel: "Status:",
    sentLabel: (sent, total) => `sent ${sent} / ${total}`,
    errorsLabel: (n) => ` · errors: ${n}`,
    blockedLabel: (n) => ` · blocked: ${n}`,
    errorsShort: (n) => `errors: ${n}`,
    blockedShort: (n) => `blocked: ${n}`,
    cronHint: "The queue is processed automatically via cron (every minute).",
    processNowBtn: "Process a batch now",
    cancelBtn: "Cancel",
    cancelConfirm: "Cancel the broadcast? Recipients not yet sent to will be skipped.",
    historyTitle: "History",
    noHistory: "No broadcasts yet.",
    statusMap: {
      queued: "⏳ Queued",
      sending: "📤 Sending",
      completed: "✅ Completed",
      cancelled: "🚫 Cancelled",
      failed: "❌ Failed",
    },
    enterText: "Enter the message text.",
    testSent: "Test message sent to the admin Telegram ID.",
    startConfirm: (n) => `Start the broadcast for ~${n} recipients?`,
    uploadFailed: (name) => `Failed to upload ${name}`,
  },
  uz: {
    audienceLabels: {
      all: "Botning barcha foydalanuvchilari",
      buyers: "Faqat xaridorlar",
      non_buyers: "Faqat xarid qilmaganlar",
      country: "Mamlakat bo‘yicha",
      test: "Test (admin Telegram ID)",
    },
    title: "Xabar yuborish",
    audienceLabel: "Auditoriya",
    countryPlaceholder: "Mamlakatni tanlang",
    countryHint:
      "Foydalanuvchi botga birinchi kirganida tanlagan mamlakat bo‘yicha filtr. RU — Rossiya, KZ — Qozog‘iston.",
    recipients: (n) => `Qabul qiluvchilar: ~${n}`,
    textLabel: "Matn (HTML: <b>, <i>)",
    textPlaceholder: "Assalomu alaykum! 1-sentabrga yangi materiallar tayyorladik…",
    photosLabel: "Fotolar (10 tagacha, albom)",
    uploading: "Yuklanmoqda…",
    deleteTitle: "O‘chirish",
    clearAll: "Barchasini tozalash",
    buttonsLabel: "Mahsulot tugmalari (8 tagacha)",
    addCatalogButton: "«Katalogni ochish» tugmasini qo‘shish",
    sendTestBtn: "O‘zimga yuborish (test)",
    startBtn: "🚀 Xabar yuborishni boshlash",
    currentBroadcast: "Joriy xabar yuborish",
    statusLabel: "Holati:",
    sentLabel: (sent, total) => `yuborildi ${sent} / ${total}`,
    errorsLabel: (n) => ` · xatolar: ${n}`,
    blockedLabel: (n) => ` · bloklandi: ${n}`,
    errorsShort: (n) => `xatolar: ${n}`,
    blockedShort: (n) => `bloklandi: ${n}`,
    cronHint: "Navbat cron orqali avtomatik qayta ishlanadi (har daqiqada).",
    processNowBtn: "Qismni hozir qayta ishlash",
    cancelBtn: "Bekor qilish",
    cancelConfirm:
      "Xabar yuborishni bekor qilasizmi? Yuborilmagan qabul qiluvchilar o‘tkazib yuboriladi.",
    historyTitle: "Tarix",
    noHistory: "Hozircha xabar yuborilmagan.",
    statusMap: {
      queued: "⏳ Navbatda",
      sending: "📤 Yuborilmoqda",
      completed: "✅ Yakunlandi",
      cancelled: "🚫 Bekor qilindi",
      failed: "❌ Muvaffaqiyatsiz",
    },
    enterText: "Xabar matnini kiriting.",
    testSent: "Test xabari admin Telegram ID’ga yuborildi.",
    startConfirm: (n) => `~${n} qabul qiluvchiga xabar yuborishni boshlaysizmi?`,
    uploadFailed: (name) => `${name} yuklanmadi`,
  },
};

function BroadcastPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: () => listProducts() });
  const paymentMethods = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
  });
  const broadcasts = useQuery({ queryKey: ["broadcasts"], queryFn: () => listBroadcastsFn() });

  const [messageText, setMessageText] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [showCatalog, setShowCatalog] = useState(true);
  const [audienceType, setAudienceType] = useState<AudienceType>("all");
  const [countryCode, setCountryCode] = useState("RU");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  function insertEmoji(emoji: string) {
    const el = messageRef.current;
    const { next, cursor } = insertAtCursor(
      messageText,
      emoji,
      el?.selectionStart ?? null,
      el?.selectionEnd ?? null,
    );
    setMessageText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  const activeBroadcast = useQuery({
    queryKey: ["broadcast", activeId],
    queryFn: () => getBroadcastFn({ data: { id: activeId! } }),
    enabled: !!activeId,
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      return st === "queued" || st === "sending" ? 2000 : false;
    },
  });

  const payload = useMemo(
    () => ({
      message_text: messageText,
      photo_paths: photoPaths,
      product_ids: selectedProducts,
      show_catalog: showCatalog,
      audience_type: audienceType,
      audience_filter:
        audienceType === "country" ? { country_code: countryCode.trim().toUpperCase() } : undefined,
    }),
    [messageText, photoPaths, selectedProducts, showCatalog, audienceType, countryCode],
  );

  useEffect(() => {
    let cancelled = false;
    previewBroadcastAudience({
      data: {
        audience_type: audienceType,
        country_code: audienceType === "country" ? countryCode.trim().toUpperCase() : undefined,
      },
    })
      .then((res) => {
        if (!cancelled) setAudienceCount(res.count);
      })
      .catch(() => {
        if (!cancelled) setAudienceCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [audienceType, countryCode]);

  useEffect(() => {
    const running = broadcasts.data?.find((b) => b.status === "queued" || b.status === "sending");
    if (running) setActiveId(running.id);
  }, [broadcasts.data]);

  async function onUploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const next = [...photoPaths];
      for (const file of Array.from(files)) {
        if (next.length >= 10) break;
        const { path, signedUrl } = await getBroadcastUploadUrl({ data: { filename: file.name } });
        const res = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "image/jpeg" },
        });
        if (!res.ok) throw new Error(tr.uploadFailed(file.name));
        next.push(path);
      }
      setPhotoPaths(next);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function onTestSend() {
    if (!messageText.trim()) return toast.warning(tr.enterText);
    setBusy(true);
    try {
      await sendTestBroadcastFn({ data: { ...payload, audience_type: "test" } });
      toast.success(tr.testSent);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onStart() {
    if (!messageText.trim()) return toast.warning(tr.enterText);
    if (audienceType !== "test" && !confirm(tr.startConfirm(String(audienceCount ?? "?")))) return;
    setBusy(true);
    try {
      const row = await startBroadcastFn({ data: payload });
      setActiveId(row.id as string);
      await qc.invalidateQueries({ queryKey: ["broadcasts"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onProcessNow() {
    setBusy(true);
    try {
      await processBroadcastBatchFn();
      await qc.invalidateQueries({ queryKey: ["broadcasts"] });
      if (activeId) await qc.invalidateQueries({ queryKey: ["broadcast", activeId] });
    } finally {
      setBusy(false);
    }
  }

  const productList = products.data ?? [];
  const countryOptions = (paymentMethods.data ?? []).filter((m) => m.is_active);

  function broadcastPhotoUrl(path: string) {
    return `/api/public/img/broadcast-images/${encodeURIComponent(path)}`;
  }

  function removePhoto(path: string) {
    setPhotoPaths((prev) => prev.filter((p) => p !== path));
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">{tr.title}</h1>

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <div className="space-y-2">
          <Label>{tr.audienceLabel}</Label>
          <div className="grid gap-2">
            {(Object.keys(tr.audienceLabels) as AudienceType[])
              .filter((k) => k !== "test")
              .map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="audience"
                    checked={audienceType === key}
                    onChange={() => setAudienceType(key)}
                  />
                  {tr.audienceLabels[key]}
                </label>
              ))}
          </div>
          {audienceType === "country" && (
            <div className="space-y-1">
              <Select value={countryCode} onValueChange={setCountryCode}>
                <SelectTrigger className="max-w-xs">
                  <SelectValue placeholder={tr.countryPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {countryOptions.map((m) => (
                    <SelectItem key={m.id} value={m.country_code}>
                      {m.country_name} ({m.country_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tr.countryHint}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {tr.recipients(String(audienceCount ?? "…"))}
          </p>
        </div>

        <div className="space-y-2">
          <Label>{tr.textLabel}</Label>
          <Textarea
            ref={messageRef}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            rows={6}
            placeholder={tr.textPlaceholder}
          />
          <EmojiInsertBar onInsert={insertEmoji} />
        </div>

        <div className="space-y-2">
          <Label>{tr.photosLabel}</Label>
          <Input
            type="file"
            accept="image/*"
            multiple
            disabled={uploading || photoPaths.length >= 10}
            onChange={(e) => onUploadPhotos(e.target.files)}
          />
          {uploading && <p className="text-sm text-muted-foreground">{tr.uploading}</p>}
          {photoPaths.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3">
                {photoPaths.map((p) => (
                  <div key={p} className="relative group">
                    <img
                      src={broadcastPhotoUrl(p)}
                      alt={p}
                      className="h-20 w-20 object-cover rounded-md border"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p)}
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs leading-none opacity-90 hover:opacity-100"
                      title={tr.deleteTitle}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPhotoPaths([])}>
                {tr.clearAll}
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>{tr.buttonsLabel}</Label>
          <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-2">
            {productList.map((p) => {
              const checked = selectedProducts.includes(p.id);
              return (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      setSelectedProducts((prev) => {
                        if (c) return prev.length >= 8 ? prev : [...prev, p.id];
                        return prev.filter((id) => id !== p.id);
                      });
                    }}
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showCatalog} onCheckedChange={(c) => setShowCatalog(Boolean(c))} />
            {tr.addCatalogButton}
          </label>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={onTestSend} disabled={busy || uploading}>
            {tr.sendTestBtn}
          </Button>
          <Button onClick={onStart} disabled={busy || uploading || audienceType === "test"}>
            {tr.startBtn}
          </Button>
        </div>
      </div>

      {activeBroadcast.data && (
        <div className="bg-card border rounded-lg p-4 space-y-2">
          <h2 className="font-medium">{tr.currentBroadcast}</h2>
          <p className="text-sm">
            {tr.statusLabel} <b>{activeBroadcast.data.status}</b> ·{" "}
            {tr.sentLabel(activeBroadcast.data.sent_count, activeBroadcast.data.total_count)}
            {activeBroadcast.data.failed_count > 0 &&
              tr.errorsLabel(activeBroadcast.data.failed_count)}
            {activeBroadcast.data.blocked_count > 0 &&
              tr.blockedLabel(activeBroadcast.data.blocked_count)}
          </p>
          <p className="text-xs text-muted-foreground">{tr.cronHint}</p>
          {(activeBroadcast.data.status === "queued" ||
            activeBroadcast.data.status === "sending") && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onProcessNow} disabled={busy}>
                {tr.processNowBtn}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(tr.cancelConfirm)) return;
                  setBusy(true);
                  try {
                    await cancelBroadcastFn({ data: { id: activeId! } });
                    setActiveId(null);
                    await qc.invalidateQueries({ queryKey: ["broadcasts"] });
                  } catch (e: unknown) {
                    toast.error(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {tr.cancelBtn}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">{tr.historyTitle}</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ["broadcasts"] })}
          >
            ↻
          </Button>
        </div>
        {(broadcasts.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">{tr.noHistory}</p>
        )}
        {broadcasts.data?.map((b) => {
          return (
            <div key={b.id} className="bg-card border rounded-lg p-3 text-sm">
              <div className="font-medium truncate">
                {b.message_text.slice(0, 80)}
                {b.message_text.length > 80 ? "…" : ""}
              </div>
              <div className="text-muted-foreground mt-1">
                {new Date(b.created_at).toLocaleString(dateLocales[locale])} ·{" "}
                {tr.statusMap[b.status] ?? b.status}
              </div>
              <div className="text-muted-foreground">
                📨 {b.sent_count}/{b.total_count}
                {b.failed_count > 0 && (
                  <span className="text-destructive ml-2">{tr.errorsShort(b.failed_count)}</span>
                )}
                {b.blocked_count > 0 && (
                  <span className="ml-2">{tr.blockedShort(b.blocked_count)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
