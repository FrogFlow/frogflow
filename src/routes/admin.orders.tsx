import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components-ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components-ui/dialog";
import {
  advanceOrderFulfillment,
  revertOrderFulfillment,
  confirmOrder,
  continueDeliveryOrder,
  deleteOrder,
  listOrders,
  recordManualPayment,
  redeliverOrder,
  rejectOrder,
  remindPaymentOrder,
  updateOrderFulfillment,
} from "@/lib/orders.functions";
import { blockTelegramUserFn } from "@/lib/blocked-users.functions";
import { useState } from "react";
import { Input } from "@/components-ui/input";
import { exportOrdersCsvFn, exportCustomersCsvFn } from "@/lib/export.functions";
import { getAppTimeZone } from "@/lib/settings.functions";
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
    loading: string;
    loadError: (msg: string) => string;
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
    acceptOrderBtn: string;
    advanceToProductionBtn: string;
    advanceToReadyBtn: string;
    advanceToDeliveredBtn: string;
    revertBtn: string;
    fulfillmentTypePickup: string;
    fulfillmentTypeDelivery: string;
    fulfillmentAddressLabel: string;
    fulfillmentNoteLabel: string;
    deliveryZoneLabel: string;
    paidAmountLine: (paid: number, total: number, currency: string) => string;
    reject: string;
    resendFiles: string;
    block: string;
    deleteBtn: string;
    receiptTitle: string;
    unsupportedFormat: string;
    downloadReceipt: string;
    confirmOrderMsg: (n: number) => string;
    acceptOrderMsg: (n: number) => string;
    alreadyDelivered: (n: number) => string;
    alreadyAccepted: (n: number) => string;
    orderAccepted: (n: number) => string;
    orderInProduction: (n: number) => string;
    orderReady: (n: number) => string;
    redeliverConfirm: (n: number) => string;
    continueConfirm: (n: number) => string;
    batchSent: (sent: number) => string;
    orderDelivered: (n: number) => string;
    manualRequired: (n: number) => string;
    rejectReasonPrompt: string;
    rejectConfirm: (n: number) => string;
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
    pickupAll: string;
    pickupToday: string;
    pickupTomorrow: string;
    pickupOverdue: string;
    noOrdersForPickupFilter: string;
    rejectAcceptedConfirm: (n: number) => string;
    editFulfillmentBtn: string;
    saveBtn: string;
    cancelBtn: string;
    dateLabel: string;
    noDateLabel: string;
    addFundsBtn: string;
    addFundsPrompt: (remaining: number, currency: string) => string;
    addFundsInvalid: string;
    addFundsSuccess: string;
  }
> = {
  ru: {
    statusMap: {
      awaiting_payment: { label: "Ждёт оплаты", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Ждёт подтверждения", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Выдаётся", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Выдан", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Отклонён", cls: "bg-red-100 text-red-900" },
      accepted: { label: "Принят", cls: "bg-blue-100 text-blue-900" },
      in_production: { label: "В работе", cls: "bg-indigo-100 text-indigo-900" },
      ready: { label: "Готов", cls: "bg-teal-100 text-teal-900" },
    },
    title: "Заказы",
    platformAll: "Все",
    platformNoOrders: "В этой площадке заказов пока нет.",
    noOrdersYet: "Пока нет заказов.",
    loading: "Загрузка…",
    loadError: (msg) => `Не удалось загрузить заказы: ${msg}`,
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
    acceptOrderBtn: "✅ Принять заказ",
    advanceToProductionBtn: "👩‍🍳 В работу",
    advanceToReadyBtn: "📦 Готов",
    advanceToDeliveredBtn: "🙏 Выдан",
    revertBtn: "◀️ Назад",
    fulfillmentTypePickup: "🚶 Самовывоз",
    fulfillmentTypeDelivery: "🚚 Доставка",
    fulfillmentAddressLabel: "Адрес",
    fulfillmentNoteLabel: "Комментарий",
    deliveryZoneLabel: "Зона доставки",
    paidAmountLine: (paid, total, currency) =>
      paid >= total
        ? `Оплачено полностью: ${paid} ${currency}`
        : `Внесено ${paid} из ${total} ${currency} · остаток ${total - paid} ${currency}`,
    reject: "❌ Отклонить",
    resendFiles: "Отправить файлы ещё раз",
    block: "Заблокировать",
    deleteBtn: "🗑️ Удалить",
    receiptTitle: "Чек оплаты",
    unsupportedFormat: "Формат не поддерживается для предпросмотра.",
    downloadReceipt: "📥 Скачать чек",
    confirmOrderMsg: (n) => `Подтвердить оплату заказа #${n} и выдать файлы?`,
    acceptOrderMsg: (n) => `Принять заказ #${n} в работу?`,
    alreadyDelivered: (n) => `Заказ #${n} уже выдаётся или выдан.`,
    alreadyAccepted: (n) => `Заказ #${n} уже принят в работу.`,
    orderAccepted: (n) => `Заказ #${n} принят в работу.`,
    orderInProduction: (n) => `Заказ #${n} переведён в производство.`,
    orderReady: (n) => `Заказ #${n} отмечен как готов.`,
    redeliverConfirm: (n) => `Отправить файлы заказа #${n} покупателю ещё раз?`,
    continueConfirm: (n) => `Продолжить выдачу файлов заказа #${n}? (следующая порция)`,
    batchSent: (sent) =>
      `Отправлена порция файлов (${sent}). Ещё осталось — нажмите «Продолжить» снова или дождитесь cron.`,
    orderDelivered: (n) => `Заказ #${n} выдан полностью.`,
    manualRequired: (n) =>
      `Заказ #${n} обработан, но часть материалов не ушла автоматически — проверьте заметку заказа и вышлите вручную.`,
    rejectReasonPrompt: "Причина отказа (необязательно):",
    rejectConfirm: (n) => `Отклонить заказ #${n}? Покупатель получит уведомление.`,
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
    pickupAll: "Все",
    pickupToday: "📅 Сегодня",
    pickupTomorrow: "📅 Завтра",
    pickupOverdue: "⚠️ Просрочено",
    noOrdersForPickupFilter: "По этому фильтру заказов нет.",
    rejectAcceptedConfirm: (n) =>
      `Отменить принятый заказ #${n}? Покупатель получит уведомление, деньги (если внесены) останутся в записи заказа — возврат не автоматизирован.`,
    editFulfillmentBtn: "✏️ Изменить",
    saveBtn: "Сохранить",
    cancelBtn: "Отмена",
    dateLabel: "Дата получения",
    noDateLabel: "Без даты",
    addFundsBtn: "💰 Внести оплату",
    addFundsPrompt: (remaining, currency) => `Сколько внести (остаток ${remaining} ${currency})?`,
    addFundsInvalid: "Введите положительное число",
    addFundsSuccess: "Платёж записан",
  },
  kk: {
    statusMap: {
      awaiting_payment: { label: "Төлемді күтуде", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Растауды күтуде", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Беріліп жатыр", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Берілді", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Қабылданбады", cls: "bg-red-100 text-red-900" },
      accepted: { label: "Қабылданды", cls: "bg-blue-100 text-blue-900" },
      in_production: { label: "Дайындалуда", cls: "bg-indigo-100 text-indigo-900" },
      ready: { label: "Дайын", cls: "bg-teal-100 text-teal-900" },
    },
    title: "Тапсырыстар",
    platformAll: "Барлығы",
    platformNoOrders: "Бұл алаңда әзірге тапсырыс жоқ.",
    noOrdersYet: "Әзірге тапсырыстар жоқ.",
    loading: "Жүктелуде…",
    loadError: (msg) => `Тапсырыстарды жүктеу мүмкін болмады: ${msg}`,
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
    acceptOrderBtn: "✅ Тапсырысты қабылдау",
    advanceToProductionBtn: "👩‍🍳 Дайындауға",
    advanceToReadyBtn: "📦 Дайын",
    advanceToDeliveredBtn: "🙏 Берілді",
    revertBtn: "◀️ Артқа",
    fulfillmentTypePickup: "🚶 Өзі алып кету",
    fulfillmentTypeDelivery: "🚚 Жеткізу",
    fulfillmentAddressLabel: "Мекенжай",
    fulfillmentNoteLabel: "Түсініктеме",
    deliveryZoneLabel: "Жеткізу аймағы",
    paidAmountLine: (paid, total, currency) =>
      paid >= total
        ? `Толық төленді: ${paid} ${currency}`
        : `Төленді ${paid} / ${total} ${currency} · қалдық ${total - paid} ${currency}`,
    reject: "❌ Қабылдамау",
    resendFiles: "Файлдарды қайта жіберу",
    block: "Бұғаттау",
    deleteBtn: "🗑️ Жою",
    receiptTitle: "Төлем чегі",
    unsupportedFormat: "Алдын ала қарау үшін формат қолдау таппайды.",
    downloadReceipt: "📥 Чекті жүктеп алу",
    confirmOrderMsg: (n) => `#${n} тапсырысының төлемін растап, файлдарды беру керек пе?`,
    acceptOrderMsg: (n) => `#${n} тапсырысын жұмысқа қабылдайсыз ба?`,
    alreadyDelivered: (n) => `#${n} тапсырысы қазірдің өзінде беріліп жатыр немесе берілді.`,
    alreadyAccepted: (n) => `#${n} тапсырысы қазірдің өзінде жұмысқа қабылданған.`,
    orderAccepted: (n) => `#${n} тапсырысы жұмысқа қабылданды.`,
    orderInProduction: (n) => `#${n} тапсырысы дайындауға берілді.`,
    orderReady: (n) => `#${n} тапсырысы дайын деп белгіленді.`,
    redeliverConfirm: (n) => `#${n} тапсырысының файлдарын сатып алушыға тағы жіберу керек пе?`,
    continueConfirm: (n) =>
      `#${n} тапсырысының файлдарын беруді жалғастыру керек пе? (келесі порция)`,
    batchSent: (sent) =>
      `Файлдардың порциясы жіберілді (${sent}). Тағы қалды — «Жалғастыру» қайта басыңыз немесе cron-ды күтіңіз.`,
    orderDelivered: (n) => `#${n} тапсырысы толығымен берілді.`,
    manualRequired: (n) =>
      `#${n} тапсырысы өңделді, бірақ кейбір материалдар автоматты жіберілмеді — тапсырыс жазбасын тексеріп, қолмен жіберіңіз.`,
    rejectReasonPrompt: "Қабылдамау себебі (міндетті емес):",
    rejectConfirm: (n) => `#${n} тапсырысын қабылдамайсыз ба? Сатып алушыға хабарланады.`,
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
    pickupAll: "Барлығы",
    pickupToday: "📅 Бүгін",
    pickupTomorrow: "📅 Ертең",
    pickupOverdue: "⚠️ Мерзімі өтті",
    noOrdersForPickupFilter: "Бұл сүзгі бойынша тапсырыс жоқ.",
    rejectAcceptedConfirm: (n) =>
      `#${n} қабылданған тапсырысын болдырмайсыз ба? Сатып алушыға хабарланады, енгізілген ақша (болса) тапсырыс жазбасында қалады — қайтару автоматтандырылмаған.`,
    editFulfillmentBtn: "✏️ Өзгерту",
    saveBtn: "Сақтау",
    cancelBtn: "Бас тарту",
    dateLabel: "Алу күні",
    noDateLabel: "Күнсіз",
    addFundsBtn: "💰 Төлем енгізу",
    addFundsPrompt: (remaining, currency) =>
      `Қанша енгізу керек (қалдық ${remaining} ${currency})?`,
    addFundsInvalid: "Оң сан енгізіңіз",
    addFundsSuccess: "Төлем жазылды",
  },
  en: {
    statusMap: {
      awaiting_payment: { label: "Awaiting payment", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Awaiting confirmation", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Delivering", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Delivered", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Rejected", cls: "bg-red-100 text-red-900" },
      accepted: { label: "Accepted", cls: "bg-blue-100 text-blue-900" },
      in_production: { label: "In production", cls: "bg-indigo-100 text-indigo-900" },
      ready: { label: "Ready", cls: "bg-teal-100 text-teal-900" },
    },
    title: "Orders",
    platformAll: "All",
    platformNoOrders: "No orders on this platform yet.",
    noOrdersYet: "No orders yet.",
    loading: "Loading…",
    loadError: (msg) => `Failed to load orders: ${msg}`,
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
    acceptOrderBtn: "✅ Accept order",
    advanceToProductionBtn: "👩‍🍳 Start production",
    advanceToReadyBtn: "📦 Mark ready",
    advanceToDeliveredBtn: "🙏 Mark delivered",
    revertBtn: "◀️ Back",
    fulfillmentTypePickup: "🚶 Pickup",
    fulfillmentTypeDelivery: "🚚 Delivery",
    fulfillmentAddressLabel: "Address",
    fulfillmentNoteLabel: "Note",
    deliveryZoneLabel: "Delivery zone",
    paidAmountLine: (paid, total, currency) =>
      paid >= total
        ? `Paid in full: ${paid} ${currency}`
        : `Paid ${paid} of ${total} ${currency} · balance ${total - paid} ${currency}`,
    reject: "❌ Reject",
    resendFiles: "Resend files",
    block: "Block",
    deleteBtn: "🗑️ Delete",
    receiptTitle: "Payment receipt",
    unsupportedFormat: "This format can't be previewed.",
    downloadReceipt: "📥 Download receipt",
    confirmOrderMsg: (n) => `Confirm payment for order #${n} and deliver the files?`,
    acceptOrderMsg: (n) => `Accept order #${n} into production?`,
    alreadyDelivered: (n) => `Order #${n} is already being delivered or has been delivered.`,
    alreadyAccepted: (n) => `Order #${n} is already accepted.`,
    orderAccepted: (n) => `Order #${n} accepted.`,
    orderInProduction: (n) => `Order #${n} moved to production.`,
    orderReady: (n) => `Order #${n} marked ready.`,
    redeliverConfirm: (n) => `Resend order #${n}'s files to the customer?`,
    continueConfirm: (n) => `Continue delivering order #${n}'s files? (next batch)`,
    batchSent: (sent) =>
      `A batch of files was sent (${sent}). More remain — click "Continue" again or wait for cron.`,
    orderDelivered: (n) => `Order #${n} has been fully delivered.`,
    manualRequired: (n) =>
      `Order #${n} was processed, but some materials did not go out automatically — check the order note and send them manually.`,
    rejectReasonPrompt: "Rejection reason (optional):",
    rejectConfirm: (n) => `Reject order #${n}? The customer will be notified.`,
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
    pickupAll: "All",
    pickupToday: "📅 Today",
    pickupTomorrow: "📅 Tomorrow",
    pickupOverdue: "⚠️ Overdue",
    noOrdersForPickupFilter: "No orders match this filter.",
    rejectAcceptedConfirm: (n) =>
      `Cancel accepted order #${n}? The customer will be notified; any money already recorded stays on the order — refunds are not automated.`,
    editFulfillmentBtn: "✏️ Edit",
    saveBtn: "Save",
    cancelBtn: "Cancel",
    dateLabel: "Pickup/delivery date",
    noDateLabel: "No date",
    addFundsBtn: "💰 Record payment",
    addFundsPrompt: (remaining, currency) =>
      `How much to record (balance ${remaining} ${currency})?`,
    addFundsInvalid: "Enter a positive number",
    addFundsSuccess: "Payment recorded",
  },
  uz: {
    statusMap: {
      awaiting_payment: { label: "To‘lovni kutmoqda", cls: "bg-muted text-muted-foreground" },
      awaiting_confirmation: { label: "Tasdiqni kutmoqda", cls: "bg-amber-100 text-amber-900" },
      delivering: { label: "Berilmoqda", cls: "bg-blue-100 text-blue-900" },
      delivered: { label: "Berildi", cls: "bg-green-100 text-green-900" },
      rejected: { label: "Rad etildi", cls: "bg-red-100 text-red-900" },
      accepted: { label: "Qabul qilindi", cls: "bg-blue-100 text-blue-900" },
      in_production: { label: "Tayyorlanmoqda", cls: "bg-indigo-100 text-indigo-900" },
      ready: { label: "Tayyor", cls: "bg-teal-100 text-teal-900" },
    },
    title: "Buyurtmalar",
    platformAll: "Barchasi",
    platformNoOrders: "Bu platformada hali buyurtmalar yo‘q.",
    noOrdersYet: "Hozircha buyurtmalar yo‘q.",
    loading: "Yuklanmoqda…",
    loadError: (msg) => `Buyurtmalarni yuklab bo‘lmadi: ${msg}`,
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
    acceptOrderBtn: "✅ Buyurtmani qabul qilish",
    advanceToProductionBtn: "👩‍🍳 Tayyorlashni boshlash",
    advanceToReadyBtn: "📦 Tayyor deb belgilash",
    advanceToDeliveredBtn: "🙏 Berildi deb belgilash",
    revertBtn: "◀️ Orqaga",
    fulfillmentTypePickup: "🚶 O‘zi olib ketish",
    fulfillmentTypeDelivery: "🚚 Yetkazib berish",
    fulfillmentAddressLabel: "Manzil",
    fulfillmentNoteLabel: "Izoh",
    deliveryZoneLabel: "Yetkazib berish zonasi",
    paidAmountLine: (paid, total, currency) =>
      paid >= total
        ? `To‘liq to‘landi: ${paid} ${currency}`
        : `To‘landi ${paid} / ${total} ${currency} · qoldiq ${total - paid} ${currency}`,
    reject: "❌ Rad etish",
    resendFiles: "Fayllarni qayta yuborish",
    block: "Bloklash",
    deleteBtn: "🗑️ O‘chirish",
    receiptTitle: "To‘lov cheki",
    unsupportedFormat: "Bu format oldindan ko‘rish uchun qo‘llab-quvvatlanmaydi.",
    downloadReceipt: "📥 Chekni yuklab olish",
    confirmOrderMsg: (n) => `#${n} buyurtmaning to‘lovini tasdiqlab, fayllarni berasizmi?`,
    acceptOrderMsg: (n) => `#${n} buyurtmani ishga qabul qilasizmi?`,
    alreadyDelivered: (n) => `#${n} buyurtma allaqachon berilmoqda yoki berilgan.`,
    alreadyAccepted: (n) => `#${n} buyurtma allaqachon ishga qabul qilingan.`,
    orderAccepted: (n) => `#${n} buyurtma ishga qabul qilindi.`,
    orderInProduction: (n) => `#${n} buyurtma tayyorlashga o‘tkazildi.`,
    orderReady: (n) => `#${n} buyurtma tayyor deb belgilandi.`,
    redeliverConfirm: (n) => `#${n} buyurtmaning fayllarini xaridorga yana yuborasizmi?`,
    continueConfirm: (n) =>
      `#${n} buyurtmaning fayllarini berishni davom ettirasizmi? (keyingi qism)`,
    batchSent: (sent) =>
      `Fayllar qismi yuborildi (${sent}). Yana qoldi — «Davom ettirish»ni qayta bosing yoki cron’ni kuting.`,
    orderDelivered: (n) => `#${n} buyurtma to‘liq berildi.`,
    manualRequired: (n) =>
      `#${n} buyurtma qayta ishlandi, lekin ba'zi materiallar avtomatik yuborilmadi — buyurtma izohini tekshirib, qo‘lda yuboring.`,
    rejectReasonPrompt: "Rad etish sababi (ixtiyoriy):",
    rejectConfirm: (n) => `#${n} buyurtmani rad etasizmi? Xaridorga xabar beriladi.`,
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
    pickupAll: "Barchasi",
    pickupToday: "📅 Bugun",
    pickupTomorrow: "📅 Ertaga",
    pickupOverdue: "⚠️ Muddati o‘tgan",
    noOrdersForPickupFilter: "Bu filtr bo‘yicha buyurtmalar yo‘q.",
    rejectAcceptedConfirm: (n) =>
      `#${n} qabul qilingan buyurtmani bekor qilasizmi? Xaridorga xabar beriladi, kiritilgan pul (bo‘lsa) buyurtma yozuvida qoladi — qaytarish avtomatlashtirilmagan.`,
    editFulfillmentBtn: "✏️ O‘zgartirish",
    saveBtn: "Saqlash",
    cancelBtn: "Bekor qilish",
    dateLabel: "Olish sanasi",
    noDateLabel: "Sanasiz",
    addFundsBtn: "💰 To‘lovni yozish",
    addFundsPrompt: (remaining, currency) =>
      `Qancha kiritish kerak (qoldiq ${remaining} ${currency})?`,
    addFundsInvalid: "Musbat son kiriting",
    addFundsSuccess: "To‘lov yozildi",
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
  // Часовой пояс магазина — для "Сегодня/Завтра/Просрочено" и для дат в
  // карточке заказа (Блок 6, находка 6.6). Пока не загружен — тот же
  // умолчательный часовой пояс, что и на сервере (Asia/Almaty), а не UTC.
  const tzQuery = useQuery({ queryKey: ["app-timezone"], queryFn: () => getAppTimeZone() });
  const appTz = tzQuery.data?.timeZone ?? "Asia/Almaty";

  /**
   * Разделение по площадке. Telegram и WhatsApp выдают файлы в переписку,
   * Instagram — письмом на почту; продавцу удобнее разбирать каналы отдельно.
   *
   * Пустая площадка у старых заказов означает Telegram: колонка появилась
   * позже, чем начались продажи.
   */
  const [platform, setPlatform] = useState<"all" | OrderPlatform>("all");
  const platformOf = (order: (typeof allOrders)[number]) => orderPlatform(order.platform);
  const platformFiltered =
    platform === "all" ? allOrders : allOrders.filter((o) => platformOf(o) === platform);

  /**
   * «Что печём сегодня» — quick-фильтр/сортировка по дате получения
   * физического заказа (fulfillment_at), Ниши Блок 9 доводка. Показывается
   * только если у продавца вообще есть физические заказы — на семи живых
   * digital-клиентах эти кнопки лишние.
   */
  const hasPhysicalOrders = allOrders.some((o) => o.fulfillment_kind === "physical");
  const [pickupFilter, setPickupFilter] = useState<"all" | "today" | "tomorrow" | "overdue">("all");
  const OPEN_PHYSICAL_STATUSES = new Set([
    "awaiting_payment",
    "awaiting_confirmation",
    "accepted",
    "in_production",
    "ready",
  ]);
  // en-CA форматирует как YYYY-MM-DD — тот же приём, что todayInAppTZ() в
  // fulfillment.server.ts. Раньше здесь была d.toISOString().slice(0, 10) —
  // дата UTC-сервера, а не магазина: с 00:00 до ~06:00 по Алматы "Сегодня"
  // показывало вчерашние выпечки (Блок 6, находка 6.6).
  const isoDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: appTz });
  const todayIso = isoDate(new Date());
  const tomorrowIso = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const fulfillmentDateOf = (o: (typeof allOrders)[number]) =>
    o.fulfillment_at ? String(o.fulfillment_at).slice(0, 10) : null;

  const list =
    pickupFilter === "all"
      ? platformFiltered
      : platformFiltered
          .filter((o) => {
            if (o.fulfillment_kind !== "physical") return false;
            const day = fulfillmentDateOf(o);
            if (pickupFilter === "today") return day === todayIso;
            if (pickupFilter === "tomorrow") return day === tomorrowIso;
            // overdue: дата получения в прошлом, а заказ ещё не закрыт
            return !!day && day < todayIso && OPEN_PHYSICAL_STATUSES.has(o.status);
          })
          .sort((a, b) => (fulfillmentDateOf(a) ?? "").localeCompare(fulfillmentDateOf(b) ?? ""));

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

  async function onConfirm(id: number, displayNo: number, isPhysical: boolean) {
    if (
      !(await confirmToast(isPhysical ? tr.acceptOrderMsg(displayNo) : tr.confirmOrderMsg(displayNo)))
    )
      return;
    setBusy(id);
    try {
      const result = await confirmOrder({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      // confirmOrder диспетчеризует по fulfillment_kind (Ниши, Блок 6):
      // физический заказ отвечает { alreadyAccepted }, у цифрового — форма
      // deliverOrder ниже. Подробный статус физического заказа — Блок 9.
      if ("alreadyAccepted" in result) {
        toast.success(
          result.alreadyAccepted ? tr.alreadyAccepted(displayNo) : tr.orderAccepted(displayNo),
        );
      } else if ("alreadyDelivered" in result && result.alreadyDelivered) {
        toast.success(tr.alreadyDelivered(displayNo));
      } else if ("pending" in result && result.pending) {
        toast.success(tr.batchSent(result.sent));
      } else if ("manualRequired" in result && result.manualRequired) {
        toast.warning(tr.manualRequired(displayNo));
      } else {
        toast.success(tr.orderDelivered(displayNo));
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function onAdvance(id: number, displayNo: number) {
    setBusy(id);
    try {
      const result = await advanceOrderFulfillment({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (result.status === "delivered") toast.success(tr.orderDelivered(displayNo));
      else if (result.status === "in_production") toast.success(tr.orderInProduction(displayNo));
      else if (result.status === "ready") toast.success(tr.orderReady(displayNo));
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  /** Откатить статус физического заказа на шаг назад (Блок 3, находка 3.6). */
  async function onRevert(id: number) {
    setBusy(id);
    try {
      await revertOrderFulfillment({ data: { id } });
      qc.invalidateQueries({ queryKey: ["orders"] });
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
      } else if (res.manualRequired) {
        toast.warning(tr.manualRequired(displayNo));
      } else {
        toast.success(tr.orderDelivered(displayNo));
      }
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function onReject(id: number, displayNo: number, confirmMsg?: string) {
    // prompt() returns null on Cancel/Esc — `null || undefined` used to
    // collapse that into the same "no reason given" value as an empty
    // confirm, so cancelling the dialog still rejected the order.
    const raw = prompt(tr.rejectReasonPrompt);
    if (raw === null) return;
    const note = raw.trim() || undefined;
    if (!(await confirmToast(confirmMsg ?? tr.rejectConfirm(displayNo)))) return;
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
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  /**
   * Отменить уже принятый физический заказ (Блок 3, находка 3.1) — раньше
   * rejectOrderSafely гейтила переход только из awaiting_*, и покупательница,
   * передумавшая после того, как продавец принял торт в работу, не могла
   * отменить заказ иначе как удалением строки (что стирало запись об
   * оплате). Тот же onReject, только с формулировкой подтверждения, которая
   * явно предупреждает про деньги — они не откатываются автоматически.
   */
  async function onRejectAccepted(id: number, displayNo: number) {
    await onReject(id, displayNo, tr.rejectAcceptedConfirm(displayNo));
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
  /**
   * Внести оплату вручную — задаток покупатель доплатил наличными при
   * получении, и paid_amount иначе так и остался бы равен задатку навсегда
   * (Блок 1, находка 1.5 / Блок 7, находка 7.2). prompt() — тот же приём,
   * что уже используется для причины отказа (rejectReasonPrompt) выше.
   */
  async function onAddFunds(id: number, total: number, paid: number, currency: string) {
    const remaining = Math.max(0, total - paid);
    const raw = prompt(tr.addFundsPrompt(remaining, currency), String(remaining));
    if (raw === null) return;
    const amount = Number(raw.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tr.addFundsInvalid);
      return;
    }
    setBusy(id);
    try {
      await recordManualPayment({ data: { id, amount } });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(tr.addFundsSuccess);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
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

  /**
   * Правка даты/адреса/комментария физического заказа (Блок 7, находка
   * 7.1) — раньше это можно было сделать только правкой строки в Supabase
   * напрямую. Дата хранится в тех же терминах, что и чекаут
   * (parseFulfillmentDateInput кладёт "YYYY-MM-DD" прямо в TIMESTAMPTZ) —
   * input[type=date] отдаёт ровно такую строку.
   */
  const [editing, setEditing] = useState<{
    id: number;
    fulfillmentAt: string;
    address: string;
    note: string;
    fulfillmentType: "pickup" | "delivery";
  } | null>(null);

  function onStartEdit(o: {
    id: number;
    fulfillment_at: string | null;
    fulfillment_address: string | null;
    fulfillment_note: string | null;
    fulfillment_type: string | null;
  }) {
    setEditing({
      id: o.id,
      fulfillmentAt: o.fulfillment_at ? String(o.fulfillment_at).slice(0, 10) : "",
      address: o.fulfillment_address ?? "",
      note: o.fulfillment_note ?? "",
      fulfillmentType: o.fulfillment_type === "delivery" ? "delivery" : "pickup",
    });
  }

  async function onSaveEdit() {
    if (!editing) return;
    setBusy(editing.id);
    try {
      await updateOrderFulfillment({
        data: {
          id: editing.id,
          fulfillmentAt: editing.fulfillmentAt || null,
          address: editing.address.trim() || null,
          note: editing.note.trim() || null,
          fulfillmentType: editing.fulfillmentType,
        },
      });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setEditing(null);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
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

      {hasPhysicalOrders && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", tr.pickupAll],
              ["today", tr.pickupToday],
              ["tomorrow", tr.pickupTomorrow],
              ["overdue", tr.pickupOverdue],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPickupFilter(key)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                pickupFilter === key
                  ? "border-primary bg-primary/10 font-medium"
                  : "hover:bg-muted/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {orders.isLoading
            ? tr.loading
            : orders.isError
              ? tr.loadError(errorMessage(orders.error))
              : allOrders.length === 0
                ? tr.noOrdersYet
                : pickupFilter !== "all"
                  ? tr.noOrdersForPickupFilter
                  : tr.platformNoOrders}
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
                {o.fulfillment_kind === "physical" && editing?.id !== o.id && (
                  <>
                    <div>
                      {o.fulfillment_type === "delivery"
                        ? tr.fulfillmentTypeDelivery
                        : tr.fulfillmentTypePickup}
                      {o.fulfillment_at &&
                        // Часовой пояс магазина, не браузера продавца (Блок
                        // 6, находка 6.6) — иначе дата съезжает на день у
                        // продавца, путешествующего в другом поясе.
                        ` · ${new Date(o.fulfillment_at).toLocaleDateString(dateLocales[locale], { timeZone: appTz })}`}
                    </div>
                    {/* delivery_fee может быть > 0 без delivery_zone_name
                        (заказ с ручным адресом, без выбора зоны) — раньше
                        вся строка пряталась за именем зоны (Блок 7,
                        находка 7.5), и доставка молча входила в total без
                        объяснения. */}
                    {(o.delivery_zone_name || Number(o.delivery_fee) > 0) && (
                      <div>
                        🚚 {tr.deliveryZoneLabel}: {o.delivery_zone_name || "—"}
                        {Number(o.delivery_fee) > 0 && ` (+${o.delivery_fee} ${o.currency})`}
                      </div>
                    )}
                    {o.fulfillment_address && (
                      <div>
                        📍 {tr.fulfillmentAddressLabel}: {o.fulfillment_address}
                      </div>
                    )}
                    {o.fulfillment_note && (
                      <div>
                        💬 {tr.fulfillmentNoteLabel}: {o.fulfillment_note}
                      </div>
                    )}
                    <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                      <span>
                        {tr.paidAmountLine(Number(o.paid_amount) || 0, Number(o.total), o.currency)}
                      </span>
                      {Number(o.paid_amount) < Number(o.total) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() =>
                            onAddFunds(
                              o.id,
                              Number(o.total),
                              Number(o.paid_amount) || 0,
                              o.currency,
                            )
                          }
                          disabled={busy === o.id}
                        >
                          {tr.addFundsBtn}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => onStartEdit(o)}
                        disabled={busy === o.id}
                      >
                        {tr.editFulfillmentBtn}
                      </Button>
                    </div>
                  </>
                )}
                {o.fulfillment_kind === "physical" && editing?.id === o.id && (
                  <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground block">
                        {tr.fulfillmentTypePickup} / {tr.fulfillmentTypeDelivery}
                      </label>
                      <select
                        className="border rounded-md h-8 px-2 text-sm bg-background"
                        value={editing.fulfillmentType}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            fulfillmentType: e.target.value as "pickup" | "delivery",
                          })
                        }
                      >
                        <option value="pickup">{tr.fulfillmentTypePickup}</option>
                        <option value="delivery">{tr.fulfillmentTypeDelivery}</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground block">{tr.dateLabel}</label>
                      <Input
                        type="date"
                        value={editing.fulfillmentAt}
                        onChange={(e) => setEditing({ ...editing, fulfillmentAt: e.target.value })}
                        className="h-8 w-[160px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground block">
                        {tr.fulfillmentAddressLabel}
                      </label>
                      <Input
                        value={editing.address}
                        onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground block">
                        {tr.fulfillmentNoteLabel}
                      </label>
                      <Input
                        value={editing.note}
                        onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={onSaveEdit} disabled={busy === o.id}>
                        {tr.saveBtn}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(null)}
                        disabled={busy === o.id}
                      >
                        {tr.cancelBtn}
                      </Button>
                    </div>
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
              {o.status === "delivering" && o.fulfillment_kind !== "physical" && (
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
                    onClick={() =>
                      onConfirm(o.id, o.order_no ?? o.id, o.fulfillment_kind === "physical")
                    }
                    disabled={busy === o.id}
                  >
                    {o.fulfillment_kind === "physical" ? tr.acceptOrderBtn : tr.confirmAndDeliver}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => onReject(o.id, o.order_no ?? o.id)}
                    disabled={busy === o.id}
                  >
                    {tr.reject}
                  </Button>
                </div>
              )}
              {o.fulfillment_kind === "physical" &&
                (o.status === "accepted" ||
                  o.status === "in_production" ||
                  o.status === "ready") && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {/* "Назад" (Блок 3, находка 3.6) — только между
                        живыми статусами, не с delivered: тот переход
                        необратим (баллы/реферал/отзыв). */}
                    {o.status !== "accepted" && (
                      <Button
                        variant="outline"
                        onClick={() => onRevert(o.id)}
                        disabled={busy === o.id}
                      >
                        {tr.revertBtn}
                      </Button>
                    )}
                    <Button
                      onClick={() => onAdvance(o.id, o.order_no ?? o.id)}
                      disabled={busy === o.id}
                    >
                      {o.status === "accepted"
                        ? tr.advanceToProductionBtn
                        : o.status === "in_production"
                          ? tr.advanceToReadyBtn
                          : tr.advanceToDeliveredBtn}
                    </Button>
                    {/* Отмена уже принятого заказа (Блок 3, находка 3.1) —
                        раньше единственным выходом было "🗑️ Удалить" внизу
                        карточки, которое стирало и запись об оплате. */}
                    <Button
                      variant="destructive"
                      onClick={() => onRejectAccepted(o.id, o.order_no ?? o.id)}
                      disabled={busy === o.id}
                    >
                      {tr.reject}
                    </Button>
                  </div>
                )}
              {o.status === "delivered" && o.fulfillment_kind !== "physical" && (
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
