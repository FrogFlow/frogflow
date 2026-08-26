/**
 * Реферальная программа (Кейс 3, №2).
 *
 * Ссылка вида t.me/<bot>?start=ref_<telegram_id_пригласившего> — свой же
 * telegram_id и есть реферальный код, отдельной таблицы кодов не нужно.
 * Награда обеим сторонам — персональный одноразовый промокод (переиспользует
 * promo_codes из Кейса 3 №1, а не отдельный механизм баллов/кошелька):
 * приглашённый получает его сразу при первом /start по ссылке (стимул
 * купить), пригласивший — когда у приглашённого случается первая
 * выданная покупка (подтверждение, что это не пустой переход по ссылке).
 *
 * Отдельно от bot.server.ts и orders.server.ts, потому что нужен обоим:
 * bot.server.ts — на входе (/start), orders.server.ts — на выходе (после
 * выдачи). Прямой импорт друг у друга между ними дал бы цикл.
 */
import { tg } from "./telegram.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function referralDiscountPercent(): Promise<number> {
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", "referral_discount_percent")
    .maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 10;
}

function randomPromoSuffix(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function issuePersonalPromoCode(prefix: string, percent: number): Promise<string | null> {
  const s = await db();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = `${prefix}-${randomPromoSuffix()}`;
    const { error } = await s.from("promo_codes").insert({
      code,
      discount_type: "percent",
      discount_value: percent,
      max_uses: 1,
      is_active: true,
    });
    // Коллизия суффикса статистически ничтожна, но unique(bot_id, code)
    // формально может её вернуть — пробуем другой суффикс, а не падаем.
    if (!error) return code;
  }
  console.error("[referrals] issuePersonalPromoCode: не удалось подобрать код за 3 попытки");
  return null;
}

/**
 * Обработать `/start ref_<id>` для нового перехода по ссылке. Идемпотентно:
 * повторный `/start` по той же ссылке (или чужой) не создаёт вторую запись
 * благодаря UNIQUE(bot_id, referred_telegram_id) — эта функция вызывается
 * при каждом /start, а не только у по-настоящему новых пользователей.
 */
export async function registerReferral(referredId: number, referrerIdRaw: string): Promise<void> {
  const referrerId = Number(referrerIdRaw);
  if (!Number.isFinite(referrerId) || referrerId <= 0 || referrerId === referredId) return;

  const s = await db();
  const { data: referrer } = await s
    .from("bot_users")
    .select("telegram_id")
    .eq("telegram_id", referrerId)
    .maybeSingle();
  // Реферер должен быть реальным пользователем этого же бота — иначе ссылка
  // подделана или скопирована из другого магазина на общей базе.
  if (!referrer) return;

  const { error } = await s.from("referrals").insert({
    referrer_telegram_id: referrerId,
    referred_telegram_id: referredId,
  });
  // UNIQUE(bot_id, referred_telegram_id) — этот пользователь уже переходил
  // по чьей-то ссылке раньше, повторно не начисляем.
  if (error) return;

  const percent = await referralDiscountPercent();
  const code = await issuePersonalPromoCode("WELCOME", percent);
  if (!code) return;
  await tg("sendMessage", {
    chat_id: referredId,
    text: `🎁 Вам подарок за переход по приглашению — промокод на скидку ${percent}% на первую покупку: <code>${code}</code>`,
    parse_mode: "HTML",
  }).catch(() => {});
}

/**
 * Вызывается сразу после того, как заказ покупателя реально перешёл в
 * delivered (см. orders.server.ts) — награждает пригласившего один раз, на
 * первой выданной покупке приглашённого.
 */
export async function rewardReferralIfFirstDelivery(referredTelegramId: number): Promise<void> {
  const s = await db();
  const { data: referral } = await s
    .from("referrals")
    .select("id, referrer_telegram_id, status, created_at")
    .eq("referred_telegram_id", referredTelegramId)
    .maybeSingle();
  if (!referral || referral.status !== "pending") return;

  // «Первая покупка после перехода по ссылке» — не «первая за всю историю
  // аккаунта»: у постоянного клиента, который сначала что-то купил, а потом
  // перешёл по чьей-то реферальной ссылке, общий счётчик доставленных
  // заказов никогда не будет равен 1, и награда не пришла бы вообще
  // (проверено по коду). CAS ниже (status pending→rewarded) сам защищает
  // от двойной награды — считать заказы нужно только чтобы отличить
  // «переход по ссылке был пустым» от «купил хоть раз после перехода».
  const { count } = await s
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", referredTelegramId)
    .eq("status", "delivered")
    .gte("created_at", referral.created_at);
  if ((count ?? 0) < 1) return;

  // CAS: чужой параллельный вызов (два независимых заказа выданы почти
  // одновременно) не наградит пригласившего дважды.
  const { data: claimed } = await s
    .from("referrals")
    .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
    .eq("id", referral.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  const percent = await referralDiscountPercent();
  const code = await issuePersonalPromoCode("REF", percent);
  if (!code) return;
  await s.from("referrals").update({ reward_promo_code: code }).eq("id", referral.id);
  await tg("sendMessage", {
    chat_id: referral.referrer_telegram_id,
    text: `🎉 Ваш приглашённый друг совершил первую покупку! Промокод на скидку ${percent}% для вас: <code>${code}</code>`,
    parse_mode: "HTML",
  }).catch(() => {});
}
