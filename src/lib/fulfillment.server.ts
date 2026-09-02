import { addDaysToIsoDate, appTimeZone } from "./datetime";
import { DELIVERABLE_STATUSES } from "./orders.server";
import type { Locale } from "./i18n";
import { isLocale } from "./i18n";

export { addDaysToIsoDate };

/**
 * Статусная машина физического заказа (Ниши, Блок 6) — сосед orders.server.ts,
 * а не правка внутри: deliverOrder остаётся функцией отправки файлов и не
 * знает о физических заказах вовсе.
 *
 *   awaiting_payment/awaiting_confirmation → accepted → in_production → ready → delivered
 *                                                                    ↘ rejected
 *
 * "delivered" и "rejected" — те же значения, что и у цифровых заказов, не
 * новые. Вся аналитика, баллы, реферальные награды и право на отзыв уже
 * держатся на status === "delivered" (export.functions.ts,
 * analytics.functions.ts, reviews.server.ts, referrals.server.ts) — заводить
 * отдельный терминальный статус означало бы сделать выручку кондитерской
 * невидимой для всего этого кода. rejectOrderSafely() (orders.server.ts)
 * доработана отдельным REJECTABLE_STATUSES: изначально стрелка ↘ rejected
 * выше была недостижима из accepted/in_production/ready (гейт был
 * DELIVERABLE_STATUSES, которая их не включает) — покупательница, передумавшая
 * после того, как продавец принял торт в работу, не могла отменить заказ
 * иначе как удалением строки (Блок 3, находка 3.1). Починено.
 */

export const PHYSICAL_STATUSES = ["accepted", "in_production", "ready"] as const;
export type PhysicalStatus = (typeof PHYSICAL_STATUSES)[number];

const NEXT_STATUS: Record<string, PhysicalStatus | "delivered"> = {
  accepted: "in_production",
  in_production: "ready",
  ready: "delivered",
};

// Откат на шаг назад (Блок 3, находка 3.6) — только между "живыми" статусами,
// без "delivered": та переход необратим сознательно — с ним связаны баллы,
// реферальная награда и право на отзыв (advanceFulfillment), откатывать их
// назад значило бы придумывать логику отмены начислений, которой в проекте
// нет ни для одного другого перехода.
const PREV_STATUS: Partial<Record<PhysicalStatus, PhysicalStatus>> = {
  in_production: "accepted",
  ready: "in_production",
};

// Аргумент — display_no/order_no ("Заказ #N", что уже видел покупатель в
// «Заказ №N создан»), а не PK orders.id: два разных числа, и подстановка PK
// сюда путает покупателя, который до этого момента видел только display_no.
//
// Локализовано на все 4 языка (Блок 5, находка 5.1) — раньше это был голый
// Record<string, …> с русскими строками независимо от того, что покупатель
// выбрал в /language. Сосед, fulfillment-reminder.server.ts, уже был
// локализован — из-за этого напоминание за сутки до получения приходило на
// казахском, а следующий за ним статус "принят в работу" — по-русски.
//
// Блок 5, находка 5.6 (сознательно отложена) — текст "in_production" зашит
// под кондитерскую (👩‍🍳, "в работе"), а не берётся из реестра ниш
// (registry.ts, VerticalDef). Следующая физическая ниша (не еда) получит
// повара в эмодзи. Полноценная правка — новое поле в VerticalDef под
// тексты статусов на все 4 языка и чтение отсюда вместо константы — вне
// объёма точечной правки; сейчас в проекте только одна физическая ниша.
const NOTICE_FOR_STATUS: Record<Locale, Record<string, (displayNo: number) => string>> = {
  ru: {
    accepted: (n) => `✅ Заказ #${n} принят в работу. Сообщим, когда он будет готов.`,
    in_production: (n) => `👩‍🍳 Заказ #${n} в работе.`,
    ready: (n) => `📦 Заказ #${n} готов! Уточните у продавца детали получения.`,
    delivered: (n) => `🙏 Спасибо за покупку! Заказ #${n} выдан.`,
  },
  kk: {
    accepted: (n) => `✅ №${n} тапсырыс жұмысқа қабылданды. Дайын болғанда хабарлаймыз.`,
    in_production: (n) => `👩‍🍳 №${n} тапсырыс дайындалуда.`,
    ready: (n) => `📦 №${n} тапсырыс дайын! Алу мәліметтерін сатушыдан нақтылаңыз.`,
    delivered: (n) => `🙏 Сатып алғаныңызға рахмет! №${n} тапсырыс берілді.`,
  },
  en: {
    accepted: (n) => `✅ Order #${n} accepted. We'll let you know when it's ready.`,
    in_production: (n) => `👩‍🍳 Order #${n} is being made.`,
    ready: (n) => `📦 Order #${n} is ready! Check pickup/delivery details with the seller.`,
    delivered: (n) => `🙏 Thanks for your purchase! Order #${n} has been delivered.`,
  },
  uz: {
    accepted: (n) => `✅ #${n} buyurtma qabul qilindi. Tayyor bo'lganda xabar beramiz.`,
    in_production: (n) => `👩‍🍳 #${n} buyurtma tayyorlanmoqda.`,
    ready: (n) => `📦 #${n} buyurtma tayyor! Olish tafsilotlarini sotuvchidan aniqlashtiring.`,
    delivered: (n) => `🙏 Xaridingiz uchun rahmat! #${n} buyurtma topshirildi.`,
  },
};

/**
 * Язык покупателя для уведомления о статусе — тот же приём, что уже был у
 * fulfillment-reminder.server.ts (bot_users.state.locale по telegram_id,
 * который заведён и для Direct-заказов синтетическим отрицательным id, не
 * только для Telegram). Запасное значение "ru" — для покупателей, ещё не
 * прошедших шаг выбора языка.
 */
async function localeForOrderBuyer(telegramId: number | null): Promise<Locale> {
  if (telegramId === null) return "ru";
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: buyer } = await supabaseAdmin
    .from("bot_users")
    .select("state")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  const state =
    buyer?.state && typeof buyer.state === "object" ? (buyer.state as { locale?: string }) : null;
  return isLocale(state?.locale) ? state.locale : "ru";
}

/**
 * Принять оплаченный (или ожидающий оплаты — при payment_mode=on_receipt,
 * Блок 7) физический заказ в работу. Аналог deliverOrder() для digital: та
 * же CAS-развилка из DELIVERABLE_STATUSES, что и claimOrderForDelivery.
 */
export async function acceptOrder(
  orderId: number,
): Promise<{ ok: true; alreadyAccepted: boolean }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: claimed, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "accepted" })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("id, order_no, display_no, telegram_id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!claimed) {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("orders")
      .select("status, order_no, display_no")
      .eq("id", orderId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Order not found");
    // Блок 14, находка 14.2 — "accepted" уже входит в PHYSICAL_STATUSES,
    // отдельная проверка на него никогда не была решающей.
    if (
      (PHYSICAL_STATUSES as readonly string[]).includes(existing.status) ||
      existing.status === "delivered"
    ) {
      return { ok: true, alreadyAccepted: true };
    }
    const displayNo = existing.display_no ?? existing.order_no ?? orderId;
    throw new Error(`Заказ #${displayNo} нельзя принять в работу (статус: ${existing.status})`);
  }

  const displayNo = claimed.display_no ?? claimed.order_no ?? orderId;
  const { notifyOrderCustomer } = await import("./orders.server");
  const locale = await localeForOrderBuyer(claimed.telegram_id ?? null);
  await notifyOrderCustomer(orderId, NOTICE_FOR_STATUS[locale].accepted(displayNo)).catch((e) =>
    console.error("[fulfillment] notifyOrderCustomer(accepted) failed", e),
  );
  return { ok: true, alreadyAccepted: false };
}

/**
 * Продвинуть физический заказ на следующий шаг: accepted → in_production →
 * ready → delivered. CAS по текущему статусу — двойное нажатие кнопки в
 * админке не должно проматывать заказ на два шага вперёд.
 */
export async function advanceFulfillment(
  orderId: number,
): Promise<{ ok: true; status: PhysicalStatus | "delivered" }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: current, error: readErr } = await supabaseAdmin
    .from("orders")
    .select("status, telegram_id, platform, order_no, display_no")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("Order not found");

  const displayNo = current.display_no ?? current.order_no ?? orderId;
  const from = current.status;
  const to = NEXT_STATUS[from];
  if (!to) throw new Error(`Заказ #${displayNo} нельзя продвинуть дальше (статус: ${from})`);

  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error(`Заказ #${displayNo} уже изменился — обновите страницу и попробуйте снова`);
  }

  const { notifyOrderCustomer } = await import("./orders.server");
  const locale = await localeForOrderBuyer(current.telegram_id ?? null);
  await notifyOrderCustomer(orderId, NOTICE_FOR_STATUS[locale][to](displayNo)).catch((e) =>
    console.error(`[fulfillment] notifyOrderCustomer(${to}) failed`, e),
  );

  if (to === "delivered") {
    // Реферальные награды и баллы сегодня начисляются только на Telegram-
    // ветке deliverOrder (orders.server.ts) — deliverOrderToWhatsApp/
    // deliverOrderByEmail их не зовут вовсе. Не расширяем это здесь, только
    // повторяем то же ограничение, а не молчаливую новую дыру.
    if (current.platform === "telegram" && current.telegram_id) {
      const { rewardReferralIfFirstDelivery } = await import("./referrals.server");
      await rewardReferralIfFirstDelivery(current.telegram_id).catch((e) =>
        console.error("[fulfillment] rewardReferralIfFirstDelivery failed", e),
      );
      const { awardPointsForDelivery } = await import("./loyalty.server");
      await awardPointsForDelivery(orderId, current.telegram_id).catch((e) =>
        console.error("[fulfillment] awardPointsForDelivery failed", e),
      );
    }
  }

  return { ok: true, status: to };
}

/**
 * Откатить статус на шаг назад — accepted ← in_production ← ready (Блок 3,
 * находка 3.6): продавец промахнулся кнопкой ("Готов" вместо "В работу"),
 * и без этой функции исправить было нечем — только ждать, пока заказ сам
 * доедет до delivered. Покупателю уже могло уйти неверное уведомление
 * ("📦 Заказ готов!") — шлём исправляющее сообщение, а не молчим: тихий
 * откат в базе оставил бы покупателя с неверным представлением о заказе.
 */
const CORRECTION_FOR_REVERT: Record<
  Locale,
  Record<PhysicalStatus, (displayNo: number) => string>
> = {
  ru: {
    accepted: (n) =>
      `↩️ Уточнение по заказу #${n}: он снова в очереди на изготовление, статус «готов» был выставлен по ошибке.`,
    in_production: (n) =>
      `↩️ Уточнение по заказу #${n}: он ещё в работе, статус «готов» был выставлен по ошибке.`,
    ready: (n) => `↩️ Уточнение по заказу #${n}: статус изменён по ошибке.`,
  },
  kk: {
    accepted: (n) =>
      `↩️ №${n} тапсырыс бойынша нақтылау: ол қайта дайындау кезегіне қойылды, «дайын» мәртебесі қателесіп қойылған.`,
    in_production: (n) =>
      `↩️ №${n} тапсырыс бойынша нақтылау: ол әлі дайындалуда, «дайын» мәртебесі қателесіп қойылған.`,
    ready: (n) => `↩️ №${n} тапсырыс бойынша нақтылау: мәртебе қателесіп өзгертілген.`,
  },
  en: {
    accepted: (n) =>
      `↩️ Update on order #${n}: it's back in the production queue — "ready" was set by mistake.`,
    in_production: (n) =>
      `↩️ Update on order #${n}: it's still being made — "ready" was set by mistake.`,
    ready: (n) => `↩️ Update on order #${n}: status was changed by mistake.`,
  },
  uz: {
    accepted: (n) =>
      `↩️ #${n} buyurtma bo'yicha aniqlik: u yana tayyorlash navbatiga qaytdi, "tayyor" holati xato qo'yilgan edi.`,
    in_production: (n) =>
      `↩️ #${n} buyurtma bo'yicha aniqlik: u hali tayyorlanmoqda, "tayyor" holati xato qo'yilgan edi.`,
    ready: (n) => `↩️ #${n} buyurtma bo'yicha aniqlik: holat xato o'zgartirilgan edi.`,
  },
};

export async function revertFulfillment(
  orderId: number,
): Promise<{ ok: true; status: PhysicalStatus }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: current, error: readErr } = await supabaseAdmin
    .from("orders")
    .select("status, order_no, display_no, telegram_id")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("Order not found");

  const displayNo = current.display_no ?? current.order_no ?? orderId;
  const from = current.status as PhysicalStatus;
  const to = PREV_STATUS[from];
  if (!to) throw new Error(`Заказ #${displayNo} нельзя вернуть на шаг назад (статус: ${from})`);

  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error(`Заказ #${displayNo} уже изменился — обновите страницу и попробуйте снова`);
  }

  const { notifyOrderCustomer } = await import("./orders.server");
  const locale = await localeForOrderBuyer(current.telegram_id ?? null);
  const correction = CORRECTION_FOR_REVERT[locale][to](displayNo);
  await notifyOrderCustomer(orderId, correction).catch((e) =>
    console.error("[fulfillment] notifyOrderCustomer(revert) failed", e),
  );

  return { ok: true, status: to };
}

/**
 * Записать платёж (задаток/остаток) — CAS-цикл по образцу decrementStock()
 * в bot.server.ts: наращивание paid_amount без атомарности потеряло бы
 * деньги при двух чеках подряд.
 */
export async function recordPayment(orderId: number, amount: number): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("paid_amount")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return false;
    const current = Number(order.paid_amount) || 0;
    const { data: updated } = await supabaseAdmin
      .from("orders")
      .update({ paid_amount: current + amount })
      .eq("id", orderId)
      .eq("paid_amount", current)
      .select("id")
      .maybeSingle();
    if (updated) return true;
  }
  return false;
}

/**
 * payment_mode для физических заказов (Ниши, Блок 7) — "full", если не
 * настроено. Раньше жила приватной в bot.server.ts; переехала сюда вместе с
 * amountDueNow(), чтобы не тянуть весь bot.server.ts туда, где физический
 * заказ подтверждается не из Telegram (admin-панель, Direct-каналы).
 */
export async function loadPaymentMode(): Promise<"full" | "deposit" | "on_receipt"> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "payment_mode")
    .maybeSingle();
  return data?.value === "deposit" || data?.value === "on_receipt" ? data.value : "full";
}

/**
 * Сколько просить сейчас за заказ — единая точка правды, вместо того чтобы
 * каждое место денежного пути читало order.total напрямую (Ниши, Блок 8.2).
 * on_receipt возвращает 0, но до оплаты эта ветка недостижима — заказ уходит
 * в acceptOrder(), минуя любой из трёх send*-путей, которые вызывают эту
 * функцию.
 */
export async function amountDueNow(order: {
  total: number;
  fulfillment_kind: string;
}): Promise<number> {
  if (order.fulfillment_kind !== "physical") return order.total;
  const mode = await loadPaymentMode();
  if (mode === "on_receipt") return 0;
  if (mode === "deposit") {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "deposit_percent")
      .maybeSingle();
    // Пустое поле в настройках даёт Number("") === 0 — просили бы 0 ₸;
    // мусор даёт NaN — просили бы NaN ₸. Оба варианта раньше уходили прямо
    // в сумму платежа без проверки (Блок 1, находка 1.7). Зажимаем в
    // 1..100 и откатываемся на умолчание 30 при нечисловом/битом значении —
    // тем же приёмом, что и остальной денежный путь: не изобретаем число,
    // безопасное умолчание лучше, чем сломанный платёж.
    const raw = Number(data?.value);
    const pct = Number.isFinite(raw) && raw >= 1 && raw <= 100 ? raw : 30;
    return Math.round(order.total * (pct / 100));
  }
  return order.total;
}

/**
 * Сколько ещё дописать в paid_amount при приёмке. amountDueNow — «сколько
 * просить сейчас» (задаток / полная сумма), без учёта уже внесённого.
 * Если кондитер нажала «Внести оплату», а потом «Принять заказ», запись
 * amountDueNow целиком задвоила бы задаток.
 */
export function remainingDueNow(
  dueNow: number,
  paidAmount: number | string | null | undefined,
): number {
  if (!Number.isFinite(dueNow) || dueNow <= 0) return 0;
  const paid = Number(paidAmount);
  const already = Number.isFinite(paid) ? paid : 0;
  return Math.max(0, Math.round((dueNow - already) * 100) / 100);
}

/**
 * Тип корзины покупателя — физическая или цифровая. Смешанная невозможна
 * (см. addToCart в bot.server.ts, cartAllowsProduct в
 * direct-purchase.server.ts, Ниши Блок 5). Канало-независима — принимает
 * голый telegram_id, а не BotUser: у Direct-каналов свои синтетические
 * отрицательные id (zernioCustomerId), пишущиеся в ту же таблицу
 * cart_items, поэтому переехала сюда из bot.server.ts вместе с остальными
 * хелперами чекаута физических заказов (Ниши, Блок 8.3).
 */
export async function cartFulfillmentKind(telegram_id: number): Promise<"digital" | "physical"> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("cart_items")
    .select("products(fulfillment_kind)")
    .eq("telegram_id", telegram_id)
    .limit(1)
    .maybeSingle();
  const kind = (data as { products?: { fulfillment_kind?: string } } | null)?.products
    ?.fulfillment_kind;
  return kind === "physical" ? "physical" : "digital";
}

/** Самый долгий срок изготовления среди товаров в корзине — минимальный сдвиг даты получения. */
export async function maxLeadTimeDaysInCart(telegram_id: number): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("cart_items")
    .select("products(lead_time_days)")
    .eq("telegram_id", telegram_id);
  let max = 0;
  for (const row of data ?? []) {
    const days = (row as { products?: { lead_time_days?: number | null } }).products
      ?.lead_time_days;
    if (typeof days === "number" && days > max) max = days;
  }
  return max;
}

export type DeliveryZone = { id: string; name: string; price: number };

/**
 * Активные зоны доставки продавца (Ниши, Блок B), отсортированные по
 * sort_order — пустой массив, если зоны не заведены вовсе (продавец ещё не
 * пользуется этой функцией, или у него доставка без разбивки на районы).
 * Каналы, где используется — Telegram и Direct (тот же приём, что и
 * остальные хелперы этого файла).
 */
export async function activeDeliveryZones(): Promise<DeliveryZone[]> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("delivery_zones")
    .select("id, name, price")
    .eq("is_active", true)
    .order("sort_order");
  return data ?? [];
}

/** Доступность самовывоза/доставки — по умолчанию оба включены, пока продавец явно не отключил. */
export async function fulfillmentOptionsEnabled(): Promise<{
  pickup: boolean;
  delivery: boolean;
}> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["fulfillment_pickup_enabled", "fulfillment_delivery_enabled"]);
  const get = (key: string) => data?.find((r) => r.key === key)?.value;
  return {
    pickup: get("fulfillment_pickup_enabled") !== "false",
    delivery: get("fulfillment_delivery_enabled") !== "false",
  };
}

/** "Сегодня" в таймзоне продавца (APP_TIMEZONE, см. datetime.ts) — не UTC-дата сервера. */
export function todayInAppTZ(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: appTimeZone() });
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ДД.ММ.ГГГГ → "YYYY-MM-DD", либо null на нераспознанном/невозможном вводе. */
export function parseFulfillmentDateInput(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoDateToDisplay(iso: string): string {
  const [y, mo, d] = iso.split("-");
  return `${d}.${mo}.${y}`;
}
