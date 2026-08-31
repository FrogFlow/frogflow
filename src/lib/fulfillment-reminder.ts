/**
 * Напоминание о дате получения физического заказа — чистая логика решения
 * «пора ли напомнить», без БД. Тот же приём, что cart-reminder.ts.
 */

/**
 * Окно в 24 часа, а не «календарный день до»: APP_TIMEZONE — одна глобальная
 * переменная окружения деплоя, не свойство конкретного заказа, так что
 * «вчера в 9 утра по местному» нечем посчитать честно для каждого продавца.
 * Проще и надёжнее — напомнить, как только дата получения впервые попадает
 * в ближайшие сутки, и ровно один раз.
 */
export function isFulfillmentReminderEligible(
  fulfillmentAt: Date,
  now: Date,
  alreadySentAt: Date | null,
): boolean {
  if (alreadySentAt) return false;
  const msUntil = fulfillmentAt.getTime() - now.getTime();
  return msUntil > 0 && msUntil <= 24 * 60 * 60 * 1000;
}
