/**
 * Возврат брошенной корзины (Кейс 3, №6).
 *
 * Раз в 30 минут (см. vercel.json) крон ищет покупателей, у которых в
 * корзине лежат товары дольше настроенного порога и кому ещё не слали
 * напоминание про именно эту (не тронутую с тех пор) корзину — критерий
 * решает shouldSendCartReminder() в cart-reminder.ts. cart_items не хранит
 * собственный updated_at, поэтому «последняя активность» — это MAX(created_at)
 * среди текущих позиций корзины покупателя (новая позиция сдвигает его
 * вперёд и даёт право на новое напоминание).
 */
import type { Locale } from "./i18n";
import { isLocale } from "./i18n";
import { shouldSendCartReminder } from "./cart-reminder";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function cartReminderHours(): Promise<number> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "cart_reminder_hours")
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

const REMINDER_TEXT: Record<Locale, string> = {
  ru: "🛒 Вы оставили товары в корзине — они всё ещё вас ждут! Оформить заказ можно в любой момент.",
  kk: "🛒 Себетте тауарлар қалды — олар әлі де сізді күтуде! Тапсырысты кез келген уақытта рәсімдей аласыз.",
  en: "🛒 You left some items in your cart — they're still waiting for you! You can check out anytime.",
  uz: "🛒 Savatda mahsulotlar qoldi — ular hali ham sizni kutmoqda! Buyurtmani istalgan vaqtda rasmiylashtirishingiz mumkin.",
};

const VIEW_CART_BTN: Record<Locale, string> = {
  ru: "🛒 Открыть корзину",
  kk: "🛒 Себетті ашу",
  en: "🛒 Open cart",
  uz: "🛒 Savatni ochish",
};

export async function sendAbandonedCartReminders(): Promise<{ checked: number; sent: number }> {
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("cart_reminder"))) return { checked: 0, sent: 0 };
  const { tg } = await import("./telegram.server");
  const hours = await cartReminderHours();
  if (hours <= 0) return { checked: 0, sent: 0 };

  const s = await db();
  // По убыванию created_at: первое вхождение telegram_id в списке — самая
  // свежая позиция его корзины (последняя активность).
  const { data: items } = await s
    .from("cart_items")
    .select("telegram_id, created_at")
    .order("created_at", { ascending: false });
  if (!items?.length) return { checked: 0, sent: 0 };

  const lastActivity = new Map<number, string>();
  for (const it of items) {
    if (!lastActivity.has(it.telegram_id)) lastActivity.set(it.telegram_id, it.created_at);
  }

  const now = new Date();
  let sent = 0;
  for (const [telegramId, maxCreatedAt] of lastActivity) {
    const { data: user } = await s
      .from("bot_users")
      .select("cart_reminder_sent_at, state")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (!user) continue;

    const eligible = shouldSendCartReminder(
      new Date(maxCreatedAt),
      now,
      hours,
      user.cart_reminder_sent_at ? new Date(user.cart_reminder_sent_at) : null,
    );
    if (!eligible) continue;

    const state =
      user.state && typeof user.state === "object" ? (user.state as { locale?: string }) : null;
    const locale: Locale = isLocale(state?.locale) ? state.locale : "ru";

    // CAS на cart_reminder_sent_at — параллельный запуск того же крона (или
    // повторная попытка Vercel) не отправит напоминание дважды одному и
    // тому же покупателю. .is() сравнивает с NULL, .eq() — с прошлым
    // значением; они не взаимозаменяемы, отсюда ветка.
    const casQuery = s
      .from("bot_users")
      .update({ cart_reminder_sent_at: now.toISOString() })
      .eq("telegram_id", telegramId);
    const { data: claimed } = await (
      user.cart_reminder_sent_at
        ? casQuery.eq("cart_reminder_sent_at", user.cart_reminder_sent_at)
        : casQuery.is("cart_reminder_sent_at", null)
    )
      .select("telegram_id")
      .maybeSingle();
    if (!claimed) continue;

    await tg("sendMessage", {
      chat_id: telegramId,
      text: REMINDER_TEXT[locale],
      reply_markup: {
        inline_keyboard: [[{ text: VIEW_CART_BTN[locale], callback_data: "cart:show" }]],
      },
    }).catch((e: unknown) => console.error(`[cart-reminder] send failed for ${telegramId}`, e));
    sent++;
  }

  return { checked: lastActivity.size, sent };
}
