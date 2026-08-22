import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components-ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components-ui/dialog";
import {
  confirmOrder,
  continueDeliveryOrder,
  deleteOrder,
  listOrders,
  redeliverOrder,
  rejectOrder,
  remindPaymentOrder,
} from "@/lib/orders.functions";
import { blockTelegramUserFn } from "@/lib/blocked-users.functions";
import { useState } from "react";
import { Input } from "@/components-ui/input";
import { exportOrdersCsvFn, exportCustomersCsvFn } from "@/lib/export.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";
import { useModules } from "@/lib/modules/use-modules";
import { orderPlatform, type OrderPlatform } from "@/lib/order-platform";

// Тип чека определяется по расширению сохранённого пути.
// Фото показываем через <img>, PDF — через <iframe>, прочее — ссылкой на скачивание.
const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"];

function proofKind(path: string): "image" | "pdf" | "other" {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTS.includes(ext)) return "image";
  return "other";
}

export const Route = createFileRoute("/admin/orders")({
  component: OrdersPage,
});

const dateLocales: Record<Locale, string> = {
  ru: "ru-RU",
  kk: "kk-KZ",
  en: "en-US",
  uz: "uz-UZ",
};

const copy: Record<
  Locale,
  {
    statusMap: Record<string, { label: string; cls: string }>;
    title: string;
    platformAll: string;
    platformNoOrders: string;
    noOrdersYet: string;
    instagramTag: string;
    whatsappTag: string;
    noEmail: string;
    itemLine: (name: string, qty: number, price: number, currency: string) => string;
    viewScreenshot: string;
    deliveringHint: string;
    continueDelivery: string;
    redeliverFromStart: string;
    remindPayment: string;
    confirmAndDeliver: string;
    reject: string;
    resendFiles: string;
    block: string;
    deleteBtn: string;
    receiptTitle: string;
    unsupportedFormat: string;
    downloadReceipt: string;
    confirmOrderMsg: (n: number) => string;
    alreadyDelivered: (n: number) => string;
    redeliverConfirm: (n: number) => string;
    continueConfirm: (n: number) => string;
    batchSent: (sent: number) => string;
    orderDelivered: (n: number) => string;
    rejectReasonPrompt: string;
    rejectNotNotified: string;
    remindConfirm: (n: number) => string;
    remindSent: (n: number) => string;
    remindFailed: string;
    deleteConfirm1: (n: number) => string;
    deleteConfirm2: (n: number) => string;
    blockConfirm: (name: string) => string;
    blockReason: string;
    exportPeriodFrom: string;
    exportPeriodTo: string;
    preparing: string;
    exportOrders: string;
    exportCustomers: string;
    exportHint: string;
    noOrdersInPeriod: string;
    noCustomersYet: string;
  }
> = {
  ru: {
    statusMap: {
      awaiting_payment: { label: "Ждёт оплаты", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Ждёт подтверждения", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Выдаётся", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Выдан", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Отклонён", cls: "bg-red-100 text-red-900" },
    },
    title: "Заказы",
    platformAll: "Все",
    platformNoOrders: "В этой площадке заказов пока нет.",
    noOrdersYet: "Пока нет заказов.",
    instagramTag: "Instagram",
    whatsappTag: "WhatsApp",
    noEmail: "почта не указана — материалы отправить некуда",
    itemLine: (name, qty, price, currency) => `${name} × ${qty} — ${price} ${currency}`,
    viewScreenshot: "📷 Скриншот оплаты",
    deliveringHint:
      "⏳ Заказ выдаётся порциями (файлы). Если зависло — нажмите «Продолжить выдачу».",
    continueDelivery: "▶️ Продолжить выдачу",
    redeliverFromStart: "Выдать заново с начала",
    remindPayment: "📩 Напомнить об оплате",
    confirmAndDeliver: "✅ Подтвердить и выдать",
    reject: "❌ Отклонить",
    resendFiles: "Отправить файлы ещё раз",
    block: "Заблокировать",
    deleteBtn: "🗑️ Удалить",
    receiptTitle: "Чек оплаты",
    unsupportedFormat: "Формат не поддерживается для предпросмотра.",
    downloadReceipt: "📥 Скачать чек",
    confirmOrderMsg: (n) => `Подтвердить оплату заказа #${n} и выдать файлы?`,
    alreadyDelivered: (n) => `Заказ #${n} уже выдаётся или выдан.`,
    redeliverConfirm: (n) => `Отправить файлы заказа #${n} покупателю ещё раз?`,
    continueConfirm: (n) => `Продолжить выдачу файлов заказа #${n}? (следующая порция)`,
    batchSent: (sent) =>
      `Отправлена порция файлов (${sent}). Ещё осталось — нажмите «Продолжить» снова или дождитесь cron.`,
    orderDelivered: (n) => `Заказ #${n} выдан полностью.`,
    rejectReasonPrompt: "Причина отказа (необязательно):",
    rejectNotNotified:
      "Заказ отклонён, но сообщить покупателю не удалось — напишите ему сами.\n\nInstagram не даёт писать позже 24 часов с последнего сообщения человека.",
    remindConfirm: (n) =>
      `Отправить покупателю напоминание и актуальный способ оплаты по заказу #${n}?`,
    remindSent: (n) => `Напоминание по заказу #${n} отправлено в Telegram.`,
    remindFailed: "Не удалось отправить напоминание",
    deleteConfirm1: (n) => `Удалить заказ #${n}? Это действие необратимо.`,
    deleteConfirm2: (n) => `Точно удалить заказ #${n}? Это нельзя отменить.`,
    blockConfirm: (name) =>
      `Заблокировать ${name}?\n\nБот перестанет отвечать, доступ к VIP-группе закроется.`,
    blockReason: "заблокирован из заказов",
    exportPeriodFrom: "Период с",
    exportPeriodTo: "по",
    preparing: "Готовлю…",
    exportOrders: "Выгрузить заказы",
    exportCustomers: "Выгрузить клиентов",
    exportHint:
      "Файл CSV — открывается двойным щелчком в Excel и Google Таблицах. Период применяется только к заказам; пустые поля — выгрузить всё.",
    noOrdersInPeriod: "За выбранный период заказов нет.",
    noCustomersYet: "Клиентов пока нет.",
  },
  kk: {
    statusMap: {
      awaiting_payment: { label: "Төлемді күтуде", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Растауды күтуде", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Беріліп жатыр", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Берілді", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Қабылданбады", cls: "bg-red-100 text-red-900" },
    },
    title: "Тапсырыстар",
    platformAll: "Барлығы",
    platformNoOrders: "Бұл алаңда әзірге тапсырыс жоқ.",
    noOrdersYet: "Әзірге тапсырыстар жоқ.",
    instagramTag: "Instagram",
    whatsappTag: "WhatsApp",
    noEmail: "пошта көрсетілмеген — материалдарды жіберетін жер жоқ",
    itemLine: (name, qty, price, currency) => `${name} × ${qty} — ${price} ${currency}`,
    viewScreenshot: "📷 Төлем скриншоты",
    deliveringHint:
      "⏳ Тапсырыс порциялармен (файлдармен) беріліп жатыр. Тоқтап қалса — «Беруді жалғастыру» басыңыз.",
    continueDelivery: "▶️ Беруді жалғастыру",
    redeliverFromStart: "Басынан қайта беру",
    remindPayment: "📩 Төлем туралы еске салу",
    confirmAndDeliver: "✅ Растау және беру",
    reject: "❌ Қабылдамау",
    resendFiles: "Файлдарды қайта жіберу",
    block: "Бұғаттау",
    deleteBtn: "🗑️ Жою",
    receiptTitle: "Төлем чегі",
    unsupportedFormat: "Алдын ала қарау үшін формат қолдау таппайды.",
    downloadReceipt: "📥 Чекті жүктеп алу",
    confirmOrderMsg: (n) => `#${n} тапсырысының төлемін растап, файлдарды беру керек пе?`,
    alreadyDelivered: (n) => `#${n} тапсырысы қазірдің өзінде беріліп жатыр немесе берілді.`,
    redeliverConfirm: (n) => `#${n} тапсырысының файлдарын сатып алушыға тағы жіберу керек пе?`,
    continueConfirm: (n) =>
      `#${n} тапсырысының файлдарын беруді жалғастыру керек пе? (келесі порция)`,
    batchSent: (sent) =>
      `Файлдардың порциясы жіберілді (${sent}). Тағы қалды — «Жалғастыру» қайта басыңыз немесе cron-ды күтіңіз.`,
    orderDelivered: (n) => `#${n} тапсырысы толығымен берілді.`,
    rejectReasonPrompt: "Қабылдамау себебі (міндетті емес):",
    rejectNotNotified:
      "Тапсырыс қабылданбады, бірақ сатып алушыға хабарлау мүмкін болмады — өзіңіз жазыңыз.\n\nInstagram адамның соңғы хабарынан 24 сағаттан кейін жазуға рұқсат бермейді.",
    remindConfirm: (n) =>
      `#${n} тапсырысы бойынша сатып алушыға еске салу мен өзекті төлем әдісін жіберу керек пе?`,
    remindSent: (n) => `#${n} тапсырысы бойынша еске салу Telegram-ға жіберілді.`,
    remindFailed: "Еске салуды жіберу мүмкін болмады",
    deleteConfirm1: (n) => `#${n} тапсырысын жою керек пе? Бұл әрекетті қайтару мүмкін емес.`,
    deleteConfirm2: (n) => `#${n} тапсырысын нақты жою керек пе? Мұны болдырмауға болмайды.`,
    blockConfirm: (name) =>
      `${name} бұғатталсын ба?\n\nБот жауап беруді тоқтатады, VIP-топқа қолжетімділік жабылады.`,
    blockReason: "тапсырыстардан бұғатталды",
    exportPeriodFrom: "Кезең",
    exportPeriodTo: "бастап",
    preparing: "Дайындалуда…",
    exportOrders: "Тапсырыстарды экспорттау",
    exportCustomers: "Клиенттерді экспорттау",
    exportHint:
      "CSV файлы Excel мен Google Кестелерінде қос басу арқылы ашылады. Кезең тек тапсырыстарға қолданылады; бос өрістер — барлығын экспорттау.",
    noOrdersInPeriod: "Таңдалған кезеңде тапсырыстар жоқ.",
    noCustomersYet: "Әзірге клиенттер жоқ.",
  },
  en: {
    statusMap: {
      awaiting_payment: { label: "Awaiting payment", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Awaiting confirmation", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Delivering", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Delivered", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Rejected", cls: "bg-red-100 text-red-900" },
    },
    title: "Orders",
    platformAll: "All",
    platformNoOrders: "No orders on this platform yet.",
    noOrdersYet: "No orders yet.",
    instagramTag: "Instagram",
    whatsappTag: "WhatsApp",
    noEmail: "no email provided — nowhere to send the materials",
    itemLine: (name, qty, price, currency) => `${name} × ${qty} — ${price} ${currency}`,
    viewScreenshot: "📷 Payment screenshot",
    deliveringHint:
      '⏳ The order is being delivered in batches (files). If it stalls — click "Continue delivery".',
    continueDelivery: "▶️ Continue delivery",
    redeliverFromStart: "Redeliver from the start",
    remindPayment: "📩 Send a payment reminder",
    confirmAndDeliver: "✅ Confirm and deliver",
    reject: "❌ Reject",
    resendFiles: "Resend files",
    block: "Block",
    deleteBtn: "🗑️ Delete",
    receiptTitle: "Payment receipt",
    unsupportedFormat: "This format can't be previewed.",
    downloadReceipt: "📥 Download receipt",
    confirmOrderMsg: (n) => `Confirm payment for order #${n} and deliver the files?`,
    alreadyDelivered: (n) => `Order #${n} is already being delivered or has been delivered.`,
    redeliverConfirm: (n) => `Resend order #${n}'s files to the customer?`,
    continueConfirm: (n) => `Continue delivering order #${n}'s files? (next batch)`,
    batchSent: (sent) =>
      `A batch of files was sent (${sent}). More remain — click "Continue" again or wait for cron.`,
    orderDelivered: (n) => `Order #${n} has been fully delivered.`,
    rejectReasonPrompt: "Rejection reason (optional):",
    rejectNotNotified:
      "The order was rejected, but the customer couldn't be notified — message them yourself.\n\nInstagram doesn't allow messaging more than 24 hours after the person's last message.",
    remindConfirm: (n) =>
      `Send the customer a reminder with the current payment method for order #${n}?`,
    remindSent: (n) => `The reminder for order #${n} was sent via Telegram.`,
    remindFailed: "Failed to send the reminder",
    deleteConfirm1: (n) => `Delete order #${n}? This action is irreversible.`,
    deleteConfirm2: (n) => `Really delete order #${n}? This can't be undone.`,
    blockConfirm: (name) =>
      `Block ${name}?\n\nThe bot will stop responding, and VIP group access will be revoked.`,
    blockReason: "blocked from Orders",
    exportPeriodFrom: "Period from",
    exportPeriodTo: "to",
    preparing: "Preparing…",
    exportOrders: "Export orders",
    exportCustomers: "Export customers",
    exportHint:
      "The CSV file opens with a double-click in Excel or Google Sheets. The period applies to orders only; leave the fields empty to export everything.",
    noOrdersInPeriod: "No orders in the selected period.",
    noCustomersYet: "No customers yet.",
  },
  uz: {
    statusMap: {
      awaiting_payment: { label: "To‘lovni kutmoqda", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Tasdiqni kutmoqda", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Berilmoqda", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Berildi", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Rad etildi", cls: "bg-red-100 text-red-900" },
    },
    title: "Buyurtmalar",
    platformAll: "Barchasi",
    platformNoOrders: "Bu platformada hali buyurtmalar yo‘q.",
    noOrdersYet: "Hozircha buyurtmalar yo‘q.",
    instagramTag: "Instagram",
    whatsappTag: "WhatsApp",
    noEmail: "email ko‘rsatilmagan — materiallarni yuborishga joy yo‘q",
    itemLine: (name, qty, price, currency) => `${name} × ${qty} — ${price} ${currency}`,
    viewScreenshot: "📷 To‘lov skrinshoti",
    deliveringHint:
      "⏳ Buyurtma qismlarga (fayllarga) bo‘lib berilmoqda. To‘xtab qolsa — «Berishni davom ettirish»ni bosing.",
    continueDelivery: "▶️ Berishni davom ettirish",
    redeliverFromStart: "Boshidan qayta berish",
    remindPayment: "📩 To‘lov haqida eslatish",
    confirmAndDeliver: "✅ Tasdiqlash va berish",
    reject: "❌ Rad etish",
    resendFiles: "Fayllarni qayta yuborish",
    block: "Bloklash",
    deleteBtn: "🗑️ O‘chirish",
    receiptTitle: "To‘lov cheki",
    unsupportedFormat: "Bu format oldindan ko‘rish uchun qo‘llab-quvvatlanmaydi.",
    downloadReceipt: "📥 Chekni yuklab olish",
    confirmOrderMsg: (n) => `#${n} buyurtmaning to‘lovini tasdiqlab, fayllarni berasizmi?`,
    alreadyDelivered: (n) => `#${n} buyurtma allaqachon berilmoqda yoki berilgan.`,
    redeliverConfirm: (n) => `#${n} buyurtmaning fayllarini xaridorga yana yuborasizmi?`,
    continueConfirm: (n) =>
      `#${n} buyurtmaning fayllarini berishni davom ettirasizmi? (keyingi qism)`,
    batchSent: (sent) =>
      `Fayllar qismi yuborildi (${sent}). Yana qoldi — «Davom ettirish»ni qayta bosing yoki cron’ni kuting.`,
    orderDelivered: (n) => `#${n} buyurtma to‘liq berildi.`,
    rejectReasonPrompt: "Rad etish sababi (ixtiyoriy):",
    rejectNotNotified:
      "Buyurtma rad etildi, lekin xaridorga xabar berib bo‘lmadi — o‘zingiz yozing.\n\nInstagram odamning oxirgi xabaridan 24 soatdan keyin yozishga ruxsat bermaydi.",
    remindConfirm: (n) =>
      `#${n} buyurtma bo‘yicha xaridorga eslatma va joriy to‘lov usulini yuborasizmi?`,
    remindSent: (n) => `#${n} buyurtma bo‘yicha eslatma Telegram’ga yuborildi.`,
    remindFailed: "Eslatmani yuborib bo‘lmadi",
    deleteConfirm1: (n) => `#${n} buyurtmani o‘chirasizmi? Bu amalni qaytarib bo‘lmaydi.`,
    deleteConfirm2: (n) => `#${n} buyurtmani rostdan o‘chirasizmi? Buni bekor qilib bo‘lmaydi.`,
    blockConfirm: (name) =>
      `${name} bloklansinmi?\n\nBot javob berishni to‘xtatadi, VIP-guruhga kirish yopiladi.`,
    blockReason: "buyurtmalardan bloklandi",
    exportPeriodFrom: "Davr",
    exportPeriodTo: "dan",
    preparing: "Tayyorlanmoqda…",
    exportOrders: "Buyurtmalarni eksport qilish",
    exportCustomers: "Mijozlarni eksport qilish",
    exportHint:
      "CSV fayli Excel va Google Jadvallarida ikki marta bosish orqali ochiladi. Davr faqat buyurtmalarga qo‘llaniladi; bo‘sh maydonlar — hammasini eksport qilish.",
    noOrdersInPeriod: "Tanlangan davrda buyurtmalar yo‘q.",
    noCustomersYet: "Hozircha mijozlar yo‘q.",
  },
};

function OrdersPage() {
  const { locale } = useAdminLocale();
  const modules = useModules();
  const tr = copy[locale];
  const qc = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => listOrders() });
  const allOrders = orders.data ?? [];
  const [busy, setBusy] = useState<number | null>(null);

  /**
   * Разделение по площадке. Telegram и WhatsApp выдают файлы в переписку,
   * Instagram — письмом на почту; продавцу удобнее разбирать каналы отдельно.
   *
   * Пустая площадка у старых заказов означает Telegram: колонка появилась
   * позже, чем начались продажи.
   */
  const [platform, setPlatform] = useState<"all" | OrderPlatform>("all");
  const platformOf = (order: (typeof allOrders)[number]) => orderPlatform(order.platform);
  const list = platform === "all" ? allOrders : allOrders.filter((o) => platformOf(o) === platform);

  const counts = {
    all: allOrders.length,
    telegram: allOrders.filter((o) => platformOf(o) === "telegram").length,
    instagram: allOrders.filter((o) => platformOf(o) === "instagram").length,
    whatsapp: allOrders.filter((o) => platformOf(o) === "whatsapp").length,
  };

  const platformTabs: ReadonlyArray<readonly ["all" | OrderPlatform, string]> = [
    ["all", tr.platformAll],
    ["telegram", "Telegram"],
    ...(modules.dm_shop || counts.instagram > 0 ? ([["instagram", "Instagram"]] as const) : []),
    ...(modules.wa_shop || counts.whatsapp > 0 ? ([["whatsapp", "WhatsApp"]] as const) : []),
  ];

  async function onConfirm(id: number, displayNo: number) {
    if (!(await confirmToast(tr.confirmOrderMsg(displayNo)))) return;
    setBusy(id);
    try {
      const result = await confirmOrder({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (result.alreadyDelivered) {
        toast.success(tr.alreadyDelivered(displayNo));
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function onRedeliver(id: number, displayNo: number) {
    if (!(await confirmToast(tr.redeliverConfirm(displayNo)))) return;
    setBusy(id);
    try {
      await redeliverOrder({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function onContinue(id: number, displayNo: number) {
    if (!(await confirmToast(tr.continueConfirm(displayNo)))) return;
    setBusy(id);
    try {
      const res = await continueDeliveryOrder({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if ("pending" in res && res.pending) {
        toast.success(tr.batchSent(res.sent));
      } else {
        toast.success(tr.orderDelivered(displayNo));
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function onReject(id: number) {
    const note = prompt(tr.rejectReasonPrompt) || undefined;
    setBusy(id);
    try {
      const result = await rejectOrder({ data: { id, note } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      // Покупателю из Instagram написать удаётся не всегда: платформа запрещает
      // писать позже суток с его последнего сообщения. Отказ при этом
      // состоялся, и продавец должен знать, что окликнуть человека придётся сам.
      if (!result.customerNotified) {
        toast.warning(tr.rejectNotNotified);
      }
    } finally {
      setBusy(null);
    }
  }
  async function onRemindPayment(id: number, displayNo: number) {
    if (!(await confirmToast(tr.remindConfirm(displayNo)))) return;
    setBusy(id);
    try {
      await remindPaymentOrder({ data: { id } });
      toast.success(tr.remindSent(displayNo));
    } catch (e: unknown) {
      toast.error(errorMessage(e) || tr.remindFailed);
    } finally {
      setBusy(null);
    }
  }
  async function onDelete(id: number, displayNo: number) {
    if (!(await confirmToast(tr.deleteConfirm1(displayNo)))) return;
    if (!(await confirmToast(tr.deleteConfirm2(displayNo)))) return;
    setBusy(id);
    try {
      await deleteOrder({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function onBlock(o: {
    id: number;
    telegram_id: number;
    username?: string | null;
    display_name?: string | null;
  }) {
    if (!(await confirmToast(tr.blockConfirm(o.display_name || String(o.telegram_id))))) return;
    setBusy(o.id);
    try {
      await blockTelegramUserFn({
        data: {
          telegram_id: o.telegram_id,
          username: o.username ?? undefined,
          first_name: o.display_name ?? undefined,
          reason: tr.blockReason,
        },
      });
      qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const [proofModal, setProofModal] = useState<{ path: string } | null>(null);

  function onViewScreenshot(path: string) {
    setProofModal({ path });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{tr.title}</h1>
      <ExportBar />

      <div className="flex flex-wrap gap-2">
        {platformTabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPlatform(key)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              platform === key ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted/50"
            }`}
          >
            {label}
            <span className="ml-1.5 text-xs text-muted-foreground">{counts[key]}</span>
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {allOrders.length === 0 ? tr.noOrdersYet : tr.platformNoOrders}
        </p>
      )}
      <div className="space-y-3">
        {list.map((o) => {
          const st = tr.statusMap[o.status] || { label: o.status, cls: "bg-muted" };
          return (
            <div key={o.id} className="bg-card border rounded-lg p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">#{o.order_no ?? o.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                  {/* Telegram — основной канал, поэтому метки нужны только внешним площадкам. */}
                  {platformOf(o) === "instagram" && (
                    <span className="text-xs px-2 py-0.5 rounded bg-pink-100 text-pink-900">
                      {tr.instagramTag}
                    </span>
                  )}
                  {platformOf(o) === "whatsapp" && (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-900">
                      {tr.whatsappTag}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleString(dateLocales[locale])}
                  </span>
                </div>
                <div className="font-semibold">
                  {o.total} {o.currency}
                </div>
              </div>
              <div className="text-sm">
                <div>
                  👤 <b>{o.display_name}</b>
                  {o.username && (
                    <>
                      {" "}
                      (
                      <a
                        className="text-primary"
                        // Профиль открывается там, откуда пришёл заказ: у
                        // покупателя из Instagram юзернейм в t.me ведёт в никуда.
                        href={
                          platformOf(o) === "instagram"
                            ? `https://instagram.com/${o.username}`
                            : platformOf(o) === "whatsapp"
                              ? `https://wa.me/${o.username.replace(/\D/g, "")}`
                              : `https://t.me/${o.username}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {platformOf(o) === "whatsapp" ? o.username : `@${o.username}`}
                      </a>
                      )
                    </>
                  )}
                </div>
                <div>📞 {o.contact || "—"}</div>
                <div>🌍 {o.country_name || "—"}</div>
                {/* Куда уйдут материалы после подтверждения. Для заказов из
                    Instagram это единственный способ выдачи, поэтому пустая
                    почта здесь — предупреждение, а не мелочь. */}
                {platformOf(o) === "instagram" && (
                  <div className={o.customer_email ? "" : "text-amber-700"}>
                    ✉️ {o.customer_email || tr.noEmail}
                  </div>
                )}
              </div>
              <ul className="text-sm list-disc pl-5">
                {(o.order_items ?? []).map((it) => (
                  <li key={it.id}>
                    {tr.itemLine(it.name_snapshot, it.quantity, it.price_snapshot, o.currency)}
                  </li>
                ))}
              </ul>
              {o.payment_proof_path && (
                <button
                  className="inline-block text-sm text-primary underline text-left"
                  onClick={() => onViewScreenshot(o.payment_proof_path!)}
                >
                  {tr.viewScreenshot}
                </button>
              )}
              {o.status === "delivering" && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm text-blue-700">{tr.deliveringHint}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => onContinue(o.id, o.order_no ?? o.id)}
                      disabled={busy === o.id}
                    >
                      {tr.continueDelivery}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onRedeliver(o.id, o.order_no ?? o.id)}
                      disabled={busy === o.id}
                    >
                      {tr.redeliverFromStart}
                    </Button>
                  </div>
                </div>
              )}
              {(o.status === "awaiting_confirmation" || o.status === "awaiting_payment") && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {o.status === "awaiting_payment" && (
                    <Button
                      variant="outline"
                      onClick={() => onRemindPayment(o.id, o.order_no ?? o.id)}
                      disabled={busy === o.id}
                    >
                      {tr.remindPayment}
                    </Button>
                  )}
                  <Button
                    onClick={() => onConfirm(o.id, o.order_no ?? o.id)}
                    disabled={busy === o.id}
                  >
                    {tr.confirmAndDeliver}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => onReject(o.id)}
                    disabled={busy === o.id}
                  >
                    {tr.reject}
                  </Button>
                </div>
              )}
              {o.status === "delivered" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRedeliver(o.id, o.order_no ?? o.id)}
                  disabled={busy === o.id}
                >
                  {tr.resendFiles}
                </Button>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => onBlock(o)}
                  disabled={busy === o.id}
                >
                  {tr.block}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(o.id, o.order_no ?? o.id)}
                  disabled={busy === o.id}
                >
                  {tr.deleteBtn}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Модалка просмотра чека оплаты */}
      <Dialog open={!!proofModal} onOpenChange={(open) => !open && setProofModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr.receiptTitle}</DialogTitle>
          </DialogHeader>
          {proofModal &&
            (() => {
              const kind = proofKind(proofModal.path);
              const src = `/api/admin/file/${proofModal.path}?bucket=payment-proofs`;
              if (kind === "image") {
                return (
                  <img src={src} alt={tr.receiptTitle} className="max-h-[80vh] mx-auto rounded" />
                );
              }
              if (kind === "pdf") {
                return (
                  <iframe
                    src={src}
                    className="w-full h-[80vh] rounded border"
                    title={tr.receiptTitle}
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

/**
 * Выгрузка в CSV. Скачивание собирается в браузере из строки, которую вернул
 * сервер: так не нужен ни отдельный роут, ни временный файл в хранилище.
 */
function ExportBar() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const [busy, setBusy] = useState<"orders" | "customers" | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function download(csv: string, name: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const today = () => new Date().toISOString().slice(0, 10);

  async function onOrders() {
    setBusy("orders");
    try {
      const res = await exportOrdersCsvFn({ data: { from: from || null, to: to || null } });
      if (res.count === 0) {
        toast(tr.noOrdersInPeriod);
        return;
      }
      download(res.csv, `orders-${today()}.csv`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onCustomers() {
    setBusy("customers");
    try {
      const res = await exportCustomersCsvFn();
      if (res.count === 0) {
        toast(tr.noCustomersYet);
        return;
      }
      download(res.csv, `customers-${today()}.csv`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-card border rounded-lg p-3 flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground block">{tr.exportPeriodFrom}</label>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9 w-[150px]"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground block">{tr.exportPeriodTo}</label>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 w-[150px]"
        />
      </div>
      <Button variant="outline" size="sm" onClick={onOrders} disabled={busy !== null}>
        {busy === "orders" ? tr.preparing : tr.exportOrders}
      </Button>
      <Button variant="outline" size="sm" onClick={onCustomers} disabled={busy !== null}>
        {busy === "customers" ? tr.preparing : tr.exportCustomers}
      </Button>
      <p className="text-xs text-muted-foreground basis-full">{tr.exportHint}</p>
    </div>
  );
}
