/**
 * Напоминание о дате получения физического заказа (Ниши, доводка после
 * Блока 8.3) — раз в час (см. vercel.json) крон ищет заказы, чья
 * fulfillment_at попала в ближайшие 24 часа, и шлёт ровно одно напоминание
 * и продавцу, и покупателю. Идемпотентность — CAS на
 * orders.fulfillment_reminder_sent_at, тем же приёмом, что
 * bot_users.cart_reminder_sent_at в cart-reminder.server.ts.
 *
 * Канал покупателя — любой из трёх (Telegram/Instagram/WhatsApp), через уже
 * канало-независимую notifyOrderCustomer(). Продавца достаём только в
 * Telegram через admin_chat_id — тем же приёмом, что
 * notifyAdminsAboutDeliveryIssue (orders.server.ts) и notifyAdminNewOrder
 * (bot.server.ts): seller-facing сторона всей SaaS сегодня только в
 * Telegram, отдельного канала для продавца в Direct нет.
 */
import type { Locale } from "./i18n";
import { isLocale } from "./i18n";
import { isFulfillmentReminderEligible } from "./fulfillment-reminder";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const BUYER_TEXT: Record<Locale, (displayNo: number | string, dateLabel: string) => string> = {
  ru: (n, d) => `⏰ Напоминаем: заказ #${n} — получение завтра, ${d}.`,
  kk: (n, d) => `⏰ Еске саламыз: №${n} тапсырысты алу ертең, ${d}.`,
  en: (n, d) => `⏰ Reminder: order #${n} — pickup/delivery is tomorrow, ${d}.`,
  uz: (n, d) => `⏰ Eslatma: #${n} buyurtma ertaga, ${d} kuni olinadi.`,
};

/** Возвращает true, если напоминание реально ушло хотя бы одному админу (Блок 3, находка 3.9). */
async function notifyAdminsAboutUpcomingFulfillment(text: string): Promise<boolean> {
  const { tg } = await import("./telegram.server");
  const s = await db();
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "admin_chat_id")
    .maybeSingle();

  const raw = setting?.value?.trim();
  if (!raw) return false;

  let anyOk = false;
  for (const chatId of raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
      anyOk = true;
    } catch (e) {
      console.error("[fulfillment-reminder] notifyAdminsAboutUpcomingFulfillment failed", e);
    }
  }
  return anyOk;
}

export async function sendFulfillmentReminders(): Promise<{ checked: number; sent: number }> {
  const { PHYSICAL_STATUSES, isoDateToDisplay } = await import("./fulfillment.server");
  const s = await db();

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Незакрытые статусы физического заказа — не только PHYSICAL_STATUSES
  // (accepted/in_production/ready). Заказ, который продавец ещё не принял
  // (awaiting_confirmation/awaiting_payment), но у которого дата получения
  // уже завтра — это ровно тот случай, где напоминание нужнее всего: он
  // рискует остаться незамеченным до самой даты (Блок 3, находка 3.8).
  // Верхняя граница окна — уже в самом запросе (экономит чтение заказов,
  // которым ещё рано), нижняя (fulfillment_at > now) и «уже отправлено» —
  // добавочная перепроверка isFulfillmentReminderEligible: она же защищает
  // от гонки, если fulfillment_at в прошлом (заказ проглядели) — таким
  // заказам напоминание уже бесполезно, шлём только на будущую дату.
  const { data: orders } = await s
    .from("orders")
    .select(
      "id, order_no, display_no, telegram_id, fulfillment_at, fulfillment_type, fulfillment_address, fulfillment_reminder_sent_at",
    )
    .eq("fulfillment_kind", "physical")
    .in("status", ["awaiting_confirmation", "awaiting_payment", ...PHYSICAL_STATUSES])
    .not("fulfillment_at", "is", null)
    .lte("fulfillment_at", in24h.toISOString())
    .is("fulfillment_reminder_sent_at", null);
  if (!orders?.length) return { checked: 0, sent: 0 };

  let sent = 0;
  for (const order of orders) {
    const fulfillmentAt = new Date(order.fulfillment_at!);
    const alreadySentAt = order.fulfillment_reminder_sent_at
      ? new Date(order.fulfillment_reminder_sent_at)
      : null;
    if (!isFulfillmentReminderEligible(fulfillmentAt, now, alreadySentAt)) continue;

    // CAS: только .is(null), потому что «уже отправлено» здесь не
    // перезаписывается вторым разом (в отличие от cart-reminder, где новая
    // активность в корзине сдвигает cartLastActivity и разрешает повторное
    // напоминание) — дата получения заказа после оформления не меняется.
    const { data: claimed } = await s
      .from("orders")
      .update({ fulfillment_reminder_sent_at: now.toISOString() })
      .eq("id", order.id)
      .is("fulfillment_reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    // Захват — до отправки, тем же приёмом, что и остальные напоминания
    // проекта (cart-reminder и т.д.): параллельный запуск крона не должен
    // отправить дважды. Откат claim'а при сбое отправки сюда сознательно
    // не добавлен — постоянно недоступный покупатель (заблокировал бота,
    // разрыв с Direct-каналом) заново пытался бы каждый час без остановки,
    // без потолка повторов (такой есть только у выдачи файлов,
    // DELIVERY_MAX_RETRIES). Отправка — лучшее старание, как и везде в
    // проекте; неудача просто уходит в лог.
    const displayNo = order.display_no ?? order.order_no ?? order.id;
    const dateLabel = isoDateToDisplay(order.fulfillment_at!.slice(0, 10));

    const { data: buyer } = await s
      .from("bot_users")
      .select("state")
      .eq("telegram_id", order.telegram_id)
      .maybeSingle();
    const buyerState =
      buyer?.state && typeof buyer.state === "object" ? (buyer.state as { locale?: string }) : null;
    const locale: Locale = isLocale(buyerState?.locale) ? buyerState.locale : "ru";

    const { notifyOrderCustomer } = await import("./orders.server");
    await notifyOrderCustomer(order.id, BUYER_TEXT[locale](displayNo, dateLabel)).catch((e) =>
      console.error(`[fulfillment-reminder] notifyOrderCustomer failed for order ${order.id}`, e),
    );

    const typeLabel = order.fulfillment_type === "delivery" ? "Доставка" : "Самовывоз";
    // escapeHtml — сообщение продавцу идёт с parse_mode: "HTML", а адрес
    // это свободный текст покупателя (Блок 6, находка 6.10): символ "<" в
    // адресе рвал HTML-разметку, Telegram отвечал 400, и продавец не
    // получал напоминание вовсе — тихо, только в console.error.
    const { escapeHtml } = await import("./vip-bot.server");
    const addressLine = order.fulfillment_address
      ? `\n📍 ${escapeHtml(order.fulfillment_address)}`
      : "";
    await notifyAdminsAboutUpcomingFulfillment(
      `⏰ Завтра (${dateLabel}) — заказ #${displayNo}. ${typeLabel}.${addressLine}`,
    );

    sent++;
  }

  return { checked: orders.length, sent };
}
