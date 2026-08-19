import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  getVipSubscriptions,
  getVipMemberProfiles,
  addVipSubscriptionManual,
  extendVipSubscription,
  deleteVipSubscription,
  confirmVipSubscription,
  rejectVipSubscription,
  excludeVipFromCommunity,
} from "@/lib/vip-subscriptions.functions";
import { blockTelegramUserFn } from "@/lib/blocked-users.functions";
import { searchTelegramUsersFn, type TelegramUserHit } from "@/lib/users-search.functions";
import { lookupVipGroupMemberFn } from "@/lib/vip-group-members.functions";
import { getVipTariffs } from "@/lib/vip-tariffs.functions";
import { paymentProofKind } from "@/lib/file-mime";
import { formatDateTimeRu } from "@/lib/datetime";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components-ui/dialog";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/vip/subscribers")({
  component: AdminVipSubscribers,
});

function matchesSearch(
  s: Awaited<ReturnType<typeof getVipSubscriptions>>[number],
  q: string,
): boolean {
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  if (!needle) return true;
  const id = String(s.telegram_id ?? "");
  const username = String(s.username ?? "").toLowerCase();
  const first = String(s.first_name ?? "").toLowerCase();
  const last = String(s.last_name ?? "").toLowerCase();
  const full = `${first} ${last}`.trim();
  return (
    id.includes(needle) ||
    username.includes(needle) ||
    first.includes(needle) ||
    last.includes(needle) ||
    full.includes(needle)
  );
}

// Примечание: даты форматируются через formatDateTimeRu() (src/lib/datetime.ts) —
// эта функция общая с ботом (vip-bot.server.ts, vip-subscriptions.functions.ts,
// vip-cron.server.ts) и намеренно не тронута, чтобы не расходиться с форматом
// дат в сообщениях бота.

const copy: Record<
  Locale,
  {
    title: string;
    addManualBtn: string;
    cancelBtn: string;
    addManualTitle: string;
    addManualHint: string;
    findLabel: string;
    findPlaceholder: string;
    idLabel: string;
    idPlaceholder: string;
    checkInTelegramBtn: string;
    tariffLabel: string;
    tariffPlaceholder: string;
    daysLabel: string;
    saveBtn: string;
    searchPlaceholder: string;
    searchAllHint: string;
    filterAll: string;
    filterActive: string;
    filterPending: string;
    filterExpired: string;
    filterCancelled: string;
    colUser: string;
    colTariff: string;
    colStatus: string;
    colExpires: string;
    colActions: string;
    importedTag: string;
    personalTariffTag: (price: number, currency: string) => string;
    tariffDeleted: string;
    statusActive: string;
    statusPastDue: string;
    statusPending: string;
    statusExpired: string;
    statusCancelled: string;
    receiptBtn: string;
    confirmBtn: string;
    rejectBtn: string;
    extendBtn: string;
    excludeBtn: string;
    blockBtn: string;
    deleteBtn: string;
    nothingFound: string;
    receiptModalTitle: string;
    unsupportedFormat: string;
    downloadReceipt: string;
    unknown: string;
    invalidTelegramId: string;
    foundInGroup: (name: string, status: string) => string;
    genericError: (msg: string) => string;
    fillIdAndTariff: string;
    memberAdded: string;
    memberAddedInvite: string;
    confirmPaymentPrompt: string;
    rejectPaymentPrompt: string;
    extendPrompt: string;
    extendInvalid: string;
    extendReduceConfirm: (days: number) => string;
    excludeConfirm: string;
    blockConfirm: (id: number) => string;
    blockReason: string;
    deleteConfirm: string;
  }
> = {
  ru: {
    title: "Подписчики VIP",
    addManualBtn: "+ Добавить вручную (Импорт)",
    cancelBtn: "Отмена",
    addManualTitle: "Добавление участника вручную",
    addManualHint:
      "После добавления запись появится во вкладке «Активные». Бот отправит ссылку, если пользователь ещё не в группе (нужно чтобы человек хотя бы раз писал VIP-боту).",
    findLabel: "Найти в базе (ID, @username, имя)",
    findPlaceholder: "Иван или @username",
    idLabel: "Telegram ID участника",
    idPlaceholder: "Например: 123456789",
    checkInTelegramBtn: "Проверить в Telegram",
    tariffLabel: "Тариф",
    tariffPlaceholder: "Выберите тариф",
    daysLabel: "Дней до истечения (остаток)",
    saveBtn: "Сохранить",
    searchPlaceholder: "Поиск: ID, @username, имя…",
    searchAllHint: "Поиск по всей базе подписок (все статусы)",
    filterAll: "Все",
    filterActive: "Активные",
    filterPending: "Ожидают проверки",
    filterExpired: "Истёкшие",
    filterCancelled: "Отклонённые",
    colUser: "Пользователь",
    colTariff: "Тариф",
    colStatus: "Статус",
    colExpires: "Истекает",
    colActions: "Действия",
    importedTag: "импорт",
    personalTariffTag: (price, currency) => `личный тариф: ${price} ${currency}`,
    tariffDeleted: "Удалён",
    statusActive: "Активен",
    statusPastDue: "Истёк (ожидает кик)",
    statusPending: "Ожидает",
    statusExpired: "Истёк",
    statusCancelled: "Отклонён",
    receiptBtn: "Чек",
    confirmBtn: "Подтвердить",
    rejectBtn: "Отклонить",
    extendBtn: "Срок ±",
    excludeBtn: "Исключить",
    blockBtn: "Заблокировать",
    deleteBtn: "Удалить",
    nothingFound: "Ничего не найдено.",
    receiptModalTitle: "Чек оплаты VIP",
    unsupportedFormat: "Формат не поддерживается для предпросмотра.",
    downloadReceipt: "Скачать чек",
    unknown: "—",
    invalidTelegramId: "Введите корректный Telegram ID (только цифры)",
    foundInGroup: (name, status) => `Найден в группе: ${name} · статус: ${status}`,
    genericError: (msg) => `Ошибка: ${msg}`,
    fillIdAndTariff: "Заполните ID и выберите тариф",
    memberAdded: "Подписчик добавлен. Смотрите вкладку «Активные».",
    memberAddedInvite: "Пользователю отправлена ссылка для вступления.",
    confirmPaymentPrompt: "Подтвердить оплату и выдать доступ?",
    rejectPaymentPrompt: "Отклонить оплату? Пользователь получит уведомление в VIP-боте.",
    extendPrompt:
      "Изменить срок (дни):\n+ число — продлить (например 2)\n− число — уменьшить (например -3)",
    extendInvalid: "Укажите целое число дней, не ноль (например 5 или -2)",
    extendReduceConfirm: (days) =>
      `Уменьшить срок на ${days} дн.?\nЕсли дата окажется в прошлом — подписка станет «Истёк» и доступ к группе закроется.`,
    excludeConfirm:
      "Исключить из VIP-сообщества?\n\nЧеловека кикнут из группы, активные подписки станут «Истёкшие», он получит сообщение в боте.",
    blockConfirm: (id) =>
      `Заблокировать пользователя ${id} навсегда?\n\nБот перестанет отвечать, доступ к VIP-группе закроется, подписки и незавершённые заказы отменятся.`,
    blockReason: "заблокирован из VIP-подписчиков",
    deleteConfirm:
      "Удалить подписку?\n\nЕсли у человека больше не останется записей — бот забудет его (личный тариф и «уже был в VIP»), и снова покажет «Первый вход».\n\nДля кика из группы лучше «Исключить». Для полного запрета — «Заблокировать».",
  },
  kk: {
    title: "VIP жазылушылары",
    addManualBtn: "+ Қолмен қосу (Импорт)",
    cancelBtn: "Бас тарту",
    addManualTitle: "Қатысушыны қолмен қосу",
    addManualHint:
      "Қосылғаннан кейін жазба «Белсенді» бөлімінде пайда болады. Пайдаланушы топта әлі болмаса, бот сілтеме жібереді (адам VIP-ботқа кемінде бір рет жазуы керек).",
    findLabel: "Базадан табу (ID, @username, аты)",
    findPlaceholder: "Иван немесе @username",
    idLabel: "Қатысушының Telegram ID",
    idPlaceholder: "Мысалы: 123456789",
    checkInTelegramBtn: "Telegram-нан тексеру",
    tariffLabel: "Тариф",
    tariffPlaceholder: "Тарифті таңдаңыз",
    daysLabel: "Мерзімі бітуге дейінгі күн (қалдық)",
    saveBtn: "Сақтау",
    searchPlaceholder: "Іздеу: ID, @username, аты…",
    searchAllHint: "Барлық жазылым базасы бойынша іздеу (барлық статустар)",
    filterAll: "Барлығы",
    filterActive: "Белсенді",
    filterPending: "Тексеруді күтуде",
    filterExpired: "Мерзімі өткен",
    filterCancelled: "Қабылданбаған",
    colUser: "Пайдаланушы",
    colTariff: "Тариф",
    colStatus: "Мәртебесі",
    colExpires: "Аяқталады",
    colActions: "Әрекеттер",
    importedTag: "импорт",
    personalTariffTag: (price, currency) => `жеке тариф: ${price} ${currency}`,
    tariffDeleted: "Жойылған",
    statusActive: "Белсенді",
    statusPastDue: "Мерзімі өтті (кикті күтуде)",
    statusPending: "Күтуде",
    statusExpired: "Мерзімі өтті",
    statusCancelled: "Қабылданбады",
    receiptBtn: "Чек",
    confirmBtn: "Растау",
    rejectBtn: "Қабылдамау",
    extendBtn: "Мерзімі ±",
    excludeBtn: "Шығару",
    blockBtn: "Бұғаттау",
    deleteBtn: "Жою",
    nothingFound: "Ештеңе табылмады.",
    receiptModalTitle: "VIP төлем чегі",
    unsupportedFormat: "Алдын ала қарау үшін формат қолдау таппайды.",
    downloadReceipt: "Чекті жүктеп алу",
    unknown: "—",
    invalidTelegramId: "Дұрыс Telegram ID енгізіңіз (тек сандар)",
    foundInGroup: (name, status) => `Топта табылды: ${name} · мәртебесі: ${status}`,
    genericError: (msg) => `Қате: ${msg}`,
    fillIdAndTariff: "ID толтырып, тарифті таңдаңыз",
    memberAdded: "Жазылушы қосылды. «Белсенді» бөлімін қараңыз.",
    memberAddedInvite: "Пайдаланушыға кіру сілтемесі жіберілді.",
    confirmPaymentPrompt: "Төлемді растап, қолжетімділік беру керек пе?",
    rejectPaymentPrompt: "Төлемді қабылдамау керек пе? Пайдаланушы VIP-ботта хабарлама алады.",
    extendPrompt:
      "Мерзімді өзгерту (күн):\n+ сан — ұзарту (мысалы 2)\n− сан — қысқарту (мысалы -3)",
    extendInvalid: "Бүтін сан енгізіңіз, нөл болмасын (мысалы 5 немесе -2)",
    extendReduceConfirm: (days) =>
      `Мерзімді ${days} күнге қысқарту керек пе?\nКүн өткенде болса — жазылым «Мерзімі өтті» болады және топқа қолжетімділік жабылады.`,
    excludeConfirm:
      "VIP-қоғамдастықтан шығару керек пе?\n\nАдам топтан кикке ұшырайды, белсенді жазылымдар «Мерзімі өткен» болады, ол ботта хабарлама алады.",
    blockConfirm: (id) =>
      `${id} пайдаланушысын мәңгіге бұғаттау керек пе?\n\nБот жауап беруді тоқтатады, VIP-топқа қолжетімділік жабылады, жазылымдар мен аяқталмаған тапсырыстар бас тартылады.`,
    blockReason: "VIP жазылушыларынан бұғатталды",
    deleteConfirm:
      "Жазылымды жою керек пе?\n\nАдамда басқа жазба қалмаса — бот оны ұмытады (жеке тариф және «VIP-те болған»), қайта «Алғашқы кіру» көрсетіледі.\n\nТоптан кику үшін «Шығару» жақсырақ. Толық тыйым үшін — «Бұғаттау».",
  },
  en: {
    title: "VIP subscribers",
    addManualBtn: "+ Add manually (import)",
    cancelBtn: "Cancel",
    addManualTitle: "Add a member manually",
    addManualHint:
      'After adding, the record appears under "Active". The bot will send an invite link if the user isn\'t in the group yet (they need to have messaged the VIP bot at least once).',
    findLabel: "Find in the database (ID, @username, name)",
    findPlaceholder: "John or @username",
    idLabel: "Member's Telegram ID",
    idPlaceholder: "e.g. 123456789",
    checkInTelegramBtn: "Check in Telegram",
    tariffLabel: "Plan",
    tariffPlaceholder: "Choose a plan",
    daysLabel: "Days remaining until expiry",
    saveBtn: "Save",
    searchPlaceholder: "Search: ID, @username, name…",
    searchAllHint: "Searching the whole subscription database (all statuses)",
    filterAll: "All",
    filterActive: "Active",
    filterPending: "Awaiting review",
    filterExpired: "Expired",
    filterCancelled: "Rejected",
    colUser: "User",
    colTariff: "Plan",
    colStatus: "Status",
    colExpires: "Expires",
    colActions: "Actions",
    importedTag: "imported",
    personalTariffTag: (price, currency) => `personal plan: ${price} ${currency}`,
    tariffDeleted: "Deleted",
    statusActive: "Active",
    statusPastDue: "Expired (kick pending)",
    statusPending: "Pending",
    statusExpired: "Expired",
    statusCancelled: "Rejected",
    receiptBtn: "Receipt",
    confirmBtn: "Confirm",
    rejectBtn: "Reject",
    extendBtn: "Duration ±",
    excludeBtn: "Exclude",
    blockBtn: "Block",
    deleteBtn: "Delete",
    nothingFound: "Nothing found.",
    receiptModalTitle: "VIP payment receipt",
    unsupportedFormat: "This format can't be previewed.",
    downloadReceipt: "Download receipt",
    unknown: "—",
    invalidTelegramId: "Enter a valid Telegram ID (digits only)",
    foundInGroup: (name, status) => `Found in the group: ${name} · status: ${status}`,
    genericError: (msg) => `Error: ${msg}`,
    fillIdAndTariff: "Fill in the ID and choose a plan",
    memberAdded: 'Subscriber added. See the "Active" tab.',
    memberAddedInvite: "An invite link was sent to the user.",
    confirmPaymentPrompt: "Confirm payment and grant access?",
    rejectPaymentPrompt: "Reject the payment? The user will be notified in the VIP bot.",
    extendPrompt:
      "Change the duration (days):\n+ number — extend (e.g. 2)\n− number — shorten (e.g. -3)",
    extendInvalid: "Enter a non-zero whole number of days (e.g. 5 or -2)",
    extendReduceConfirm: (days) =>
      `Shorten the duration by ${days} day(s)?\nIf the date ends up in the past, the subscription will become "Expired" and group access will be revoked.`,
    excludeConfirm:
      'Exclude from the VIP community?\n\nThe person will be kicked from the group, active subscriptions will become "Expired", and they\'ll get a message in the bot.',
    blockConfirm: (id) =>
      `Permanently block user ${id}?\n\nThe bot will stop responding, VIP group access will be revoked, and subscriptions and unfinished orders will be cancelled.`,
    blockReason: "blocked from VIP subscribers",
    deleteConfirm:
      'Delete this subscription?\n\nIf the person has no other records left, the bot will forget them (personal plan and "already had VIP"), and show "First entry" again.\n\nFor kicking from the group, "Exclude" is better. For a full ban, use "Block".',
  },
  uz: {
    title: "VIP obunachilari",
    addManualBtn: "+ Qo‘lda qo‘shish (import)",
    cancelBtn: "Bekor qilish",
    addManualTitle: "A’zoni qo‘lda qo‘shish",
    addManualHint:
      "Qo‘shilgandan keyin yozuv «Faol» bo‘limida paydo bo‘ladi. Foydalanuvchi hali guruhda bo‘lmasa, bot taklif havolasini yuboradi (odam VIP-botga kamida bir marta yozgan bo‘lishi kerak).",
    findLabel: "Bazadan topish (ID, @username, ism)",
    findPlaceholder: "Ivan yoki @username",
    idLabel: "A’zoning Telegram ID",
    idPlaceholder: "Masalan: 123456789",
    checkInTelegramBtn: "Telegram’da tekshirish",
    tariffLabel: "Tarif",
    tariffPlaceholder: "Tarifni tanlang",
    daysLabel: "Muddati tugashiga qolgan kun",
    saveBtn: "Saqlash",
    searchPlaceholder: "Qidiruv: ID, @username, ism…",
    searchAllHint: "Barcha obuna bazasi bo‘yicha qidiruv (barcha holatlar)",
    filterAll: "Barchasi",
    filterActive: "Faol",
    filterPending: "Tekshiruvni kutmoqda",
    filterExpired: "Muddati o‘tgan",
    filterCancelled: "Rad etilgan",
    colUser: "Foydalanuvchi",
    colTariff: "Tarif",
    colStatus: "Holati",
    colExpires: "Tugaydi",
    colActions: "Amallar",
    importedTag: "import",
    personalTariffTag: (price, currency) => `shaxsiy tarif: ${price} ${currency}`,
    tariffDeleted: "O‘chirilgan",
    statusActive: "Faol",
    statusPastDue: "Muddati o‘tdi (kick kutilmoqda)",
    statusPending: "Kutmoqda",
    statusExpired: "Muddati o‘tdi",
    statusCancelled: "Rad etildi",
    receiptBtn: "Chek",
    confirmBtn: "Tasdiqlash",
    rejectBtn: "Rad etish",
    extendBtn: "Muddat ±",
    excludeBtn: "Chiqarish",
    blockBtn: "Bloklash",
    deleteBtn: "O‘chirish",
    nothingFound: "Hech narsa topilmadi.",
    receiptModalTitle: "VIP to‘lov cheki",
    unsupportedFormat: "Bu format oldindan ko‘rish uchun qo‘llab-quvvatlanmaydi.",
    downloadReceipt: "Chekni yuklab olish",
    unknown: "—",
    invalidTelegramId: "To‘g‘ri Telegram ID kiriting (faqat raqamlar)",
    foundInGroup: (name, status) => `Guruhda topildi: ${name} · holati: ${status}`,
    genericError: (msg) => `Xato: ${msg}`,
    fillIdAndTariff: "ID’ni to‘ldiring va tarifni tanlang",
    memberAdded: "Obunachi qo‘shildi. «Faol» bo‘limini qarang.",
    memberAddedInvite: "Foydalanuvchiga kirish havolasi yuborildi.",
    confirmPaymentPrompt: "To‘lovni tasdiqlab, kirishni berasizmi?",
    rejectPaymentPrompt: "To‘lovni rad etasizmi? Foydalanuvchi VIP-botda xabar oladi.",
    extendPrompt:
      "Muddatni o‘zgartirish (kun):\n+ son — uzaytirish (masalan 2)\n− son — qisqartirish (masalan -3)",
    extendInvalid: "Nol bo‘lmagan butun son kiriting (masalan 5 yoki -2)",
    extendReduceConfirm: (days) =>
      `Muddatni ${days} kunga qisqartirasizmi?\nAgar sana o‘tmishda bo‘lib qolsa — obuna «Muddati o‘tgan» bo‘ladi va guruhga kirish yopiladi.`,
    excludeConfirm:
      "VIP hamjamiyatidan chiqarasizmi?\n\nOdam guruhdan chiqariladi, faol obunalar «Muddati o‘tgan» bo‘ladi, u botda xabar oladi.",
    blockConfirm: (id) =>
      `${id} foydalanuvchisini butunlay bloklaysizmi?\n\nBot javob berishni to‘xtatadi, VIP-guruhga kirish yopiladi, obunalar va tugallanmagan buyurtmalar bekor qilinadi.`,
    blockReason: "VIP obunachilaridan bloklandi",
    deleteConfirm:
      "Obunani o‘chirasizmi?\n\nOdamda boshqa yozuv qolmasa — bot uni unutadi (shaxsiy tarif va «avval VIP’da bo‘lgan»), yana «Birinchi kirish» ko‘rsatiladi.\n\nGuruhdan chiqarish uchun «Chiqarish» yaxshiroq. To‘liq taqiqlash uchun — «Bloklash».",
  },
};

function AdminVipSubscribers() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending_payment");
  const [tableSearch, setTableSearch] = useState("");

  const effectiveStatus = tableSearch.trim() ? "all" : statusFilter;

  const subs = useQuery({
    queryKey: ["vip_subs", effectiveStatus],
    queryFn: () => getVipSubscriptions({ data: { status: effectiveStatus } }),
  });
  const profiles = useQuery({ queryKey: ["vip_profiles"], queryFn: () => getVipMemberProfiles() });
  const tariffs = useQuery({ queryKey: ["vip_tariffs"], queryFn: () => getVipTariffs() });

  const profileByTelegram = new Map((profiles.data ?? []).map((p) => [String(p.telegram_id), p]));

  const filteredSubs = useMemo(() => {
    const list = subs.data ?? [];
    const byStatus =
      tableSearch.trim() || statusFilter === "all"
        ? list
        : list.filter((s) => s.status === statusFilter);
    return byStatus.filter((s) => matchesSearch(s, tableSearch));
  }, [subs.data, statusFilter, tableSearch]);

  const [addingManual, setAddingManual] = useState(false);
  const [manualData, setManualData] = useState({
    telegram_id: "",
    tariff_id: "",
    days: 30,
    status: "active",
  });
  const [manualSearch, setManualSearch] = useState("");
  const [manualHits, setManualHits] = useState<TelegramUserHit[]>([]);
  const [manualLookupLoading, setManualLookupLoading] = useState(false);
  const [manualLookupHint, setManualLookupHint] = useState<string | null>(null);
  const [proofModal, setProofModal] = useState<{ path: string } | null>(null);

  useEffect(() => {
    const q = manualSearch.trim();
    if (q.length < 1) {
      setManualHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await searchTelegramUsersFn({ data: { query: q } });
        if (!cancelled) setManualHits(res as TelegramUserHit[]);
      } catch {
        if (!cancelled) setManualHits([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [manualSearch]);

  const handleLookupManualId = async () => {
    const id = manualData.telegram_id.trim();
    if (!/^\d{5,15}$/.test(id)) {
      return toast.warning(tr.invalidTelegramId);
    }
    setManualLookupLoading(true);
    setManualLookupHint(null);
    try {
      const row = await lookupVipGroupMemberFn({ data: { telegram_id: id } });
      const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || tr.unknown;
      setManualLookupHint(
        tr.foundInGroup(`${name}${row.username ? ` @${row.username}` : ""}`, row.member_status),
      );
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    } finally {
      setManualLookupLoading(false);
    }
  };

  const handleAddManual = async () => {
    if (!manualData.telegram_id || !manualData.tariff_id) return toast.warning(tr.fillIdAndTariff);
    const days = Number.isFinite(manualData.days) && manualData.days >= 1 ? manualData.days : 30;
    try {
      const res = await addVipSubscriptionManual({
        data: { ...manualData, days },
      });
      setAddingManual(false);
      setManualSearch("");
      setManualHits([]);
      setManualLookupHint(null);
      setManualData({ telegram_id: "", tariff_id: "", days: 30, status: "active" });
      setStatusFilter("active");
      qc.invalidateQueries({ queryKey: ["vip_subs"] });
      const msg =
        tr.memberAdded +
        (res.warning ? `\n\n⚠ ${res.warning}` : "") +
        (res.inviteSent ? `\n\n${tr.memberAddedInvite}` : "");
      toast.success(msg);
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    }
  };

  const handleConfirm = async (id: string) => {
    if (!confirm(tr.confirmPaymentPrompt)) return;
    try {
      await confirmVipSubscription({ data: { id } });
      qc.invalidateQueries({ queryKey: ["vip_subs"] });
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm(tr.rejectPaymentPrompt)) return;
    try {
      await rejectVipSubscription({ data: { id } });
      qc.invalidateQueries({ queryKey: ["vip_subs"] });
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    }
  };

  const handleExtend = async (id: string) => {
    const days = prompt(tr.extendPrompt, "30");
    if (days === null || days.trim() === "") return;
    const n = parseInt(days.trim(), 10);
    if (!Number.isFinite(n) || n === 0) {
      return toast.warning(tr.extendInvalid);
    }
    if (n < 0) {
      const ok = confirm(tr.extendReduceConfirm(Math.abs(n)));
      if (!ok) return;
    }
    try {
      await extendVipSubscription({ data: { id, days: n } });
      qc.invalidateQueries({ queryKey: ["vip_subs"] });
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    }
  };

  const handleExclude = async (id: string) => {
    if (!confirm(tr.excludeConfirm)) return;
    try {
      await excludeVipFromCommunity({ data: { id } });
      qc.invalidateQueries({ queryKey: ["vip_subs"] });
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    }
  };

  const handleBlock = async (sub: {
    telegram_id: number;
    username?: string | null;
    first_name?: string | null;
  }) => {
    if (!confirm(tr.blockConfirm(sub.telegram_id))) return;
    try {
      await blockTelegramUserFn({
        data: {
          telegram_id: sub.telegram_id,
          username: sub.username ?? undefined,
          first_name: sub.first_name ?? undefined,
          reason: tr.blockReason,
        },
      });
      qc.invalidateQueries({ queryKey: ["vip_subs"] });
    } catch (e: unknown) {
      toast.error(tr.genericError(errorMessage(e)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(tr.deleteConfirm)) return;
    await deleteVipSubscription({ data: { id } });
    qc.invalidateQueries({ queryKey: ["vip_subs"] });
    qc.invalidateQueries({ queryKey: ["vip_profiles"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h2 className="text-xl font-semibold">{tr.title}</h2>
        <Button onClick={() => setAddingManual(!addingManual)}>
          {addingManual ? tr.cancelBtn : tr.addManualBtn}
        </Button>
      </div>

      {addingManual && (
        <div className="bg-card border rounded-lg p-4 space-y-4 max-w-xl">
          <h3 className="font-medium">{tr.addManualTitle}</h3>
          <p className="text-xs text-muted-foreground">{tr.addManualHint}</p>
          <div className="space-y-2">
            <Label>{tr.findLabel}</Label>
            <Input
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              placeholder={tr.findPlaceholder}
            />
            {manualHits.length > 0 && (
              <ul className="border rounded-md divide-y max-h-40 overflow-y-auto">
                {manualHits.map((u) => (
                  <li key={u.telegram_id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => {
                        setManualData((d) => ({ ...d, telegram_id: String(u.telegram_id) }));
                        setManualSearch("");
                        setManualHits([]);
                      }}
                    >
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || tr.unknown}
                      {u.username ? ` @${u.username}` : ""}
                      <span className="text-muted-foreground"> · {u.telegram_id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <Label>{tr.idLabel}</Label>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={manualData.telegram_id}
                onChange={(e) => {
                  setManualData({ ...manualData, telegram_id: e.target.value });
                  setManualLookupHint(null);
                }}
                placeholder={tr.idPlaceholder}
              />
              <Button
                type="button"
                variant="outline"
                disabled={manualLookupLoading}
                onClick={handleLookupManualId}
              >
                {manualLookupLoading ? "…" : tr.checkInTelegramBtn}
              </Button>
            </div>
            {manualLookupHint && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                {manualLookupHint}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{tr.tariffLabel}</Label>
            <Select
              value={manualData.tariff_id}
              onValueChange={(v) => setManualData({ ...manualData, tariff_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={tr.tariffPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {tariffs.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{tr.daysLabel}</Label>
            <Input
              type="number"
              min={1}
              value={manualData.days}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setManualData({ ...manualData, days: Number.isFinite(n) ? n : 30 });
              }}
            />
          </div>
          <Button onClick={handleAddManual}>{tr.saveBtn}</Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Input
          className="max-w-sm"
          value={tableSearch}
          onChange={(e) => setTableSearch(e.target.value)}
          placeholder={tr.searchPlaceholder}
        />
        {tableSearch.trim() && <p className="text-xs text-muted-foreground">{tr.searchAllHint}</p>}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={statusFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setStatusFilter("all")}
          disabled={!!tableSearch.trim()}
        >
          {tr.filterAll}
        </Button>
        <Button
          variant={statusFilter === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setStatusFilter("active")}
          disabled={!!tableSearch.trim()}
        >
          {tr.filterActive}
        </Button>
        <Button
          variant={statusFilter === "pending_payment" ? "default" : "outline"}
          size="sm"
          onClick={() => setStatusFilter("pending_payment")}
          disabled={!!tableSearch.trim()}
        >
          {tr.filterPending}
        </Button>
        <Button
          variant={statusFilter === "expired" ? "default" : "outline"}
          size="sm"
          onClick={() => setStatusFilter("expired")}
          disabled={!!tableSearch.trim()}
        >
          {tr.filterExpired}
        </Button>
        <Button
          variant={statusFilter === "cancelled" ? "default" : "outline"}
          size="sm"
          onClick={() => setStatusFilter("cancelled")}
          disabled={!!tableSearch.trim()}
        >
          {tr.filterCancelled}
        </Button>
      </div>

      <div className="border rounded-md overflow-hidden bg-card">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 font-medium">{tr.colUser}</th>
              <th className="p-2 font-medium">{tr.colTariff}</th>
              <th className="p-2 font-medium">{tr.colStatus}</th>
              <th className="p-2 font-medium">{tr.colExpires}</th>
              <th className="p-2 font-medium text-right">{tr.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {filteredSubs.map((s) => {
              const profile = profileByTelegram.get(String(s.telegram_id));
              const personalTariff = profile?.vip_tariffs;
              return (
                <tr key={s.id} className="border-t">
                  <td className="p-2">
                    <div>
                      {s.first_name} {s.last_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.username ? `@${s.username}` : `ID: ${s.telegram_id}`}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.imported && (
                        <span className="text-[10px] bg-secondary px-1 rounded">
                          {tr.importedTag}
                        </span>
                      )}
                      {personalTariff && (
                        <span className="text-[10px] bg-orange-100 text-orange-800 px-1 rounded border border-orange-200">
                          {tr.personalTariffTag(personalTariff.price, personalTariff.currency)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    {(s as { vip_tariffs?: { name?: string } | null }).vip_tariffs?.name ||
                      tr.tariffDeleted}
                  </td>
                  <td className="p-2">
                    {(() => {
                      const pastDue =
                        s.status === "active" && new Date(s.expires_at).getTime() <= Date.now();
                      if (s.status === "active" && !pastDue)
                        return (
                          <span className="text-green-600 font-medium">{tr.statusActive}</span>
                        );
                      if (pastDue)
                        return (
                          <span className="text-amber-600 font-medium">{tr.statusPastDue}</span>
                        );
                      if (s.status === "pending_payment")
                        return (
                          <span className="text-orange-600 font-medium">{tr.statusPending}</span>
                        );
                      if (s.status === "expired")
                        return <span className="text-red-600 font-medium">{tr.statusExpired}</span>;
                      if (s.status === "cancelled")
                        return <span className="text-muted-foreground">{tr.statusCancelled}</span>;
                      return <span className="text-muted-foreground">{s.status}</span>;
                    })()}
                  </td>
                  <td className="p-2">
                    {s.status === "pending_payment" ? "-" : formatDateTimeRu(s.expires_at)}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {(s.status === "pending_payment" || s.payment_proof_path) &&
                        (s.payment_proof_path ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProofModal({ path: s.payment_proof_path! })}
                          >
                            {tr.receiptBtn}
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" disabled>
                            {tr.receiptBtn}
                          </Button>
                        ))}
                      {s.status === "pending_payment" && (
                        <>
                          <Button variant="default" size="sm" onClick={() => handleConfirm(s.id)}>
                            {tr.confirmBtn}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleReject(s.id)}>
                            {tr.rejectBtn}
                          </Button>
                        </>
                      )}
                      {s.status !== "pending_payment" && (
                        <Button variant="outline" size="sm" onClick={() => handleExtend(s.id)}>
                          {tr.extendBtn}
                        </Button>
                      )}
                      {s.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => handleExclude(s.id)}
                        >
                          {tr.excludeBtn}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() => handleBlock(s)}
                      >
                        {tr.blockBtn}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() => handleDelete(s.id)}
                      >
                        {tr.deleteBtn}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredSubs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  {tr.nothingFound}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!proofModal} onOpenChange={(open) => !open && setProofModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr.receiptModalTitle}</DialogTitle>
          </DialogHeader>
          {proofModal &&
            (() => {
              const kind = paymentProofKind(proofModal.path);
              const src = `/api/admin/file/${proofModal.path}?bucket=payment-proofs`;
              if (kind === "image") {
                return (
                  <img
                    src={src}
                    alt={tr.receiptModalTitle}
                    className="max-h-[80vh] mx-auto rounded"
                  />
                );
              }
              if (kind === "pdf") {
                return (
                  <iframe
                    src={src}
                    className="w-full h-[80vh] rounded border"
                    title={tr.receiptModalTitle}
                  />
                );
              }
              return (
                <div className="text-center py-6 space-y-3">
                  <p className="text-muted-foreground">{tr.unsupportedFormat}</p>
                  <Button asChild>
                    <a href={src} target="_blank" rel="noreferrer">
                      {tr.downloadReceipt}
                    </a>
                  </Button>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
