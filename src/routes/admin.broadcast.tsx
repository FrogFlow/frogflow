import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
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
import { getWhatsAppAccountsFn, getWhatsAppTemplatesFn } from "@/lib/whatsapp.functions";
import { listPaymentMethods } from "@/lib/payment-methods.functions";
import { listProducts } from "@/lib/products.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import { useVertical } from "@/lib/verticals/use-vertical";
import { useModules } from "@/lib/modules/use-modules";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/broadcast")({
  component: BroadcastPage,
});

type AudienceType = "all" | "country" | "buyers" | "non_buyers" | "test";
type BroadcastChannel = "telegram" | "whatsapp";

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
    textPlaceholderPhysical: string;
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
    historyLoading: string;
    historyLoadError: (msg: string) => string;
    statusMap: Record<string, string>;
    enterText: string;
    testSent: string;
    startConfirm: (n: string) => string;
    uploadFailed: (name: string) => string;
    channelLabel: string;
    channelTelegram: string;
    channelWhatsapp: string;
    waAccountLabel: string;
    waAccountPlaceholder: string;
    waNoAccounts: string;
    waTemplateLabel: string;
    waTemplatePlaceholder: string;
    waNoApprovedTemplates: string;
    waParamsLabel: string;
    waParamsHint: string;
    waTestUnavailable: string;
    waSelectAccountAndTemplate: string;
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
    textPlaceholderPhysical: "Здравствуйте! К праздникам подготовили новые торты и десерты…",
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
    historyLoading: "Загрузка…",
    historyLoadError: (msg) => `Не удалось загрузить историю рассылок: ${msg}`,
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
    channelLabel: "Канал",
    channelTelegram: "Telegram",
    channelWhatsapp: "WhatsApp",
    waAccountLabel: "Аккаунт WhatsApp",
    waAccountPlaceholder: "Выберите аккаунт",
    waNoAccounts: "Нет подключённого аккаунта WhatsApp — подключите его на вкладке «WhatsApp».",
    waTemplateLabel: "Шаблон Meta (одобренный)",
    waTemplatePlaceholder: "Выберите шаблон",
    waNoApprovedTemplates:
      "Нет одобренных шаблонов для этого аккаунта — создайте и дождитесь одобрения Meta на вкладке «WhatsApp».",
    waParamsLabel: "Значения переменных шаблона ({{1}}, {{2}}…), через запятую",
    waParamsHint:
      "Если в тексте шаблона есть {{1}}, {{2}} и т.д. — впишите значения по порядку через запятую. Если переменных нет, оставьте пустым.",
    waTestUnavailable:
      "Для WhatsApp нет тестовой отправки себе — у продавца нет своего номера в базе.",
    waSelectAccountAndTemplate: "Выберите аккаунт WhatsApp и одобренный шаблон.",
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
    textPlaceholderPhysical: "Сәлеметсіз бе! Мерекеге жаңа торт пен десерттер дайындадық…",
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
    historyLoading: "Жүктелуде…",
    historyLoadError: (msg) => `Рассылка тарихын жүктеу мүмкін болмады: ${msg}`,
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
    channelLabel: "Арна",
    channelTelegram: "Telegram",
    channelWhatsapp: "WhatsApp",
    waAccountLabel: "WhatsApp аккаунты",
    waAccountPlaceholder: "Аккаунтты таңдаңыз",
    waNoAccounts: "Қосылған WhatsApp аккаунты жоқ — «WhatsApp» бөлімінде қосыңыз.",
    waTemplateLabel: "Meta үлгісі (мақұлданған)",
    waTemplatePlaceholder: "Үлгіні таңдаңыз",
    waNoApprovedTemplates:
      "Бұл аккаунт үшін мақұлданған үлгі жоқ — «WhatsApp» бөлімінде жасап, Meta мақұлдауын күтіңіз.",
    waParamsLabel: "Үлгі айнымалыларының мәні ({{1}}, {{2}}…), үтірмен бөліп",
    waParamsHint:
      "Үлгі мәтінінде {{1}}, {{2}} т.б. болса — мәндерін ретімен үтірмен бөліп жазыңыз. Айнымалы жоқ болса, бос қалдырыңыз.",
    waTestUnavailable: "WhatsApp үшін өзіңізге тест жіберу жоқ — сатушының базада өз нөмірі жоқ.",
    waSelectAccountAndTemplate: "WhatsApp аккаунты мен мақұлданған үлгіні таңдаңыз.",
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
    textPlaceholderPhysical: "Hello! We've prepared new cakes and desserts for the holidays…",
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
    historyLoading: "Loading…",
    historyLoadError: (msg) => `Failed to load broadcast history: ${msg}`,
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
    channelLabel: "Channel",
    channelTelegram: "Telegram",
    channelWhatsapp: "WhatsApp",
    waAccountLabel: "WhatsApp account",
    waAccountPlaceholder: "Choose an account",
    waNoAccounts: 'No WhatsApp account connected — connect one on the "WhatsApp" tab.',
    waTemplateLabel: "Meta template (approved)",
    waTemplatePlaceholder: "Choose a template",
    waNoApprovedTemplates:
      'No approved templates for this account — create one and wait for Meta\'s approval on the "WhatsApp" tab.',
    waParamsLabel: "Template variable values ({{1}}, {{2}}…), comma-separated",
    waParamsHint:
      "If the template text has {{1}}, {{2}}, etc. — enter the values in order, separated by commas. Leave empty if there are no variables.",
    waTestUnavailable:
      "There's no self-test send for WhatsApp — the seller has no own number in the database.",
    waSelectAccountAndTemplate: "Choose a WhatsApp account and an approved template.",
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
    textPlaceholderPhysical: "Assalomu alaykum! Bayramga yangi tort va desertlar tayyorladik…",
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
    historyLoading: "Yuklanmoqda…",
    historyLoadError: (msg) => `Xabarlar tarixini yuklab bo‘lmadi: ${msg}`,
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
    channelLabel: "Kanal",
    channelTelegram: "Telegram",
    channelWhatsapp: "WhatsApp",
    waAccountLabel: "WhatsApp akkaunti",
    waAccountPlaceholder: "Akkauntni tanlang",
    waNoAccounts: "Ulangan WhatsApp akkaunti yo‘q — «WhatsApp» bo‘limida ulang.",
    waTemplateLabel: "Meta shabloni (tasdiqlangan)",
    waTemplatePlaceholder: "Shablonni tanlang",
    waNoApprovedTemplates:
      "Bu akkaunt uchun tasdiqlangan shablon yo‘q — «WhatsApp» bo‘limida yarating va Meta tasdiqlashini kuting.",
    waParamsLabel: "Shablon o‘zgaruvchilari qiymati ({{1}}, {{2}}…), vergul bilan",
    waParamsHint:
      "Shablon matnida {{1}}, {{2}} va h.k. bo‘lsa — qiymatlarni tartib bilan vergul bilan kiriting. O‘zgaruvchi bo‘lmasa, bo‘sh qoldiring.",
    waTestUnavailable:
      "WhatsApp uchun o‘zingizga test yuborish yo‘q — sotuvchining bazada o‘z raqami yo‘q.",
    waSelectAccountAndTemplate: "WhatsApp akkauntini va tasdiqlangan shablonni tanlang.",
  },
};

function BroadcastPage() {
  const { locale } = useAdminLocale();
  const { isPhysicalShop } = useVertical();
  const tr = copy[locale];
  const qc = useQueryClient();
  const modules = useModules();
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

  // wa_broadcasts: рассылка по WhatsApp идёт одобренным Meta-шаблоном, а не
  // произвольным текстом — окно ответа у базы подписчиков почти всегда
  // закрыто. См. createBroadcast() в broadcast.server.ts.
  const [channel, setChannel] = useState<BroadcastChannel>("telegram");
  const [waAccountId, setWaAccountId] = useState<string>("");
  const [waTemplateName, setWaTemplateName] = useState<string>("");
  const [waTemplateLanguage, setWaTemplateLanguage] = useState<string>("");
  const [waParamsText, setWaParamsText] = useState<string>("");

  const waAccounts = useQuery({
    queryKey: ["wa-broadcast-accounts"],
    queryFn: () => getWhatsAppAccountsFn(),
    enabled: channel === "whatsapp" && Boolean(modules.wa_broadcasts),
  });
  const waAccountList = waAccounts.data?.accounts ?? [];

  useEffect(() => {
    if (channel === "whatsapp" && !waAccountId && waAccountList.length > 0) {
      setWaAccountId(waAccountList[0]._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, waAccountList.length]);

  const waTemplates = useQuery({
    queryKey: ["wa-broadcast-templates", waAccountId],
    queryFn: () => getWhatsAppTemplatesFn({ data: { accountId: waAccountId } }),
    enabled: channel === "whatsapp" && Boolean(waAccountId),
  });
  const waApprovedTemplates = (waTemplates.data?.templates ?? []).filter(
    (t) => t.status === "APPROVED",
  );

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
      photo_paths: channel === "whatsapp" ? [] : photoPaths,
      product_ids: channel === "whatsapp" ? [] : selectedProducts,
      show_catalog: channel === "whatsapp" ? false : showCatalog,
      audience_type: audienceType,
      audience_filter:
        audienceType === "country" ? { country_code: countryCode.trim().toUpperCase() } : undefined,
      channel,
      account_id: channel === "whatsapp" ? waAccountId || undefined : undefined,
      template_name: channel === "whatsapp" ? waTemplateName || undefined : undefined,
      template_language: channel === "whatsapp" ? waTemplateLanguage || undefined : undefined,
      template_params:
        channel === "whatsapp"
          ? waParamsText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    }),
    [
      messageText,
      photoPaths,
      selectedProducts,
      showCatalog,
      audienceType,
      countryCode,
      channel,
      waAccountId,
      waTemplateName,
      waTemplateLanguage,
      waParamsText,
    ],
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
    // Фиксируем каждую удачную загрузку сразу, а не одним setPhotoPaths после
    // всего цикла: раньше сбой на файле 3 из 5 откатывал весь набор целиком —
    // 1 и 2 уже лежали в хранилище, а из состояния экрана пропадали (Блок C.9).
    const next = [...photoPaths];
    try {
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
        setPhotoPaths([...next]);
      }
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
    if (channel === "whatsapp" && (!waAccountId || !waTemplateName)) {
      return toast.warning(tr.waSelectAccountAndTemplate);
    }
    if (
      audienceType !== "test" &&
      !(await confirmToast(tr.startConfirm(String(audienceCount ?? "?"))))
    )
      return;
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
    } catch (e: unknown) {
      // Раньше без catch: сбой обработки порции проходил незамеченным — кнопка
      // просто переставала быть занятой, будто всё в порядке (Блок C.8).
      toast.error(errorMessage(e));
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
        {modules.wa_broadcasts && (
          <div className="space-y-2">
            <Label>{tr.channelLabel}</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="channel"
                  checked={channel === "telegram"}
                  onChange={() => setChannel("telegram")}
                />
                {tr.channelTelegram}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="channel"
                  checked={channel === "whatsapp"}
                  onChange={() => setChannel("whatsapp")}
                />
                {tr.channelWhatsapp}
              </label>
            </div>
          </div>
        )}

        {channel === "whatsapp" && (
          <div className="space-y-4 border rounded-md p-3">
            <div className="space-y-2">
              <Label>{tr.waAccountLabel}</Label>
              {waAccountList.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr.waNoAccounts}</p>
              ) : (
                <Select value={waAccountId} onValueChange={setWaAccountId}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder={tr.waAccountPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {waAccountList.map((a) => (
                      <SelectItem key={a._id} value={a._id}>
                        {a.name || a.username || a._id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {waAccountId && (
              <div className="space-y-2">
                <Label>{tr.waTemplateLabel}</Label>
                {waApprovedTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tr.waNoApprovedTemplates}</p>
                ) : (
                  <Select
                    value={waTemplateName ? `${waTemplateName}__${waTemplateLanguage}` : ""}
                    onValueChange={(v) => {
                      const [name, lang] = v.split("__");
                      setWaTemplateName(name);
                      setWaTemplateLanguage(lang);
                    }}
                  >
                    <SelectTrigger className="max-w-xs">
                      <SelectValue placeholder={tr.waTemplatePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {waApprovedTemplates.map((t) => (
                        <SelectItem
                          key={`${t.name}__${t.language}`}
                          value={`${t.name}__${t.language}`}
                        >
                          {t.name} ({t.language})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {waTemplateName && (
              <div className="space-y-1">
                <Label>{tr.waParamsLabel}</Label>
                <Input
                  value={waParamsText}
                  onChange={(e) => setWaParamsText(e.target.value)}
                  placeholder="Мария, 25%"
                />
                <p className="text-xs text-muted-foreground">{tr.waParamsHint}</p>
              </div>
            )}
          </div>
        )}

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
            placeholder={isPhysicalShop ? tr.textPlaceholderPhysical : tr.textPlaceholder}
          />
          <EmojiInsertBar onInsert={insertEmoji} />
        </div>

        {channel !== "whatsapp" && (
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
        )}

        {channel !== "whatsapp" && (
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
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {channel === "whatsapp" ? (
            <p className="text-xs text-muted-foreground">{tr.waTestUnavailable}</p>
          ) : (
            <Button variant="outline" onClick={onTestSend} disabled={busy || uploading}>
              {tr.sendTestBtn}
            </Button>
          )}
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
                  if (!(await confirmToast(tr.cancelConfirm))) return;
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
        {broadcasts.isLoading && (
          <p className="text-sm text-muted-foreground">{tr.historyLoading}</p>
        )}
        {broadcasts.isError && (
          <p className="text-sm text-destructive">
            {tr.historyLoadError(errorMessage(broadcasts.error))}
          </p>
        )}
        {!broadcasts.isLoading && !broadcasts.isError && (broadcasts.data ?? []).length === 0 && (
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
