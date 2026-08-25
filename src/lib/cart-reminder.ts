/**
 * Возврат брошенной корзины (Кейс 3, №6) — чистая логика решения «пора ли
 * напомнить», без БД.
 */

export function shouldSendCartReminder(
  cartLastActivity: Date,
  now: Date,
  reminderHours: number,
  lastReminderSentAt: Date | null,
): boolean {
  if (reminderHours <= 0) return false;
  const elapsedMs = now.getTime() - cartLastActivity.getTime();
  if (elapsedMs < reminderHours * 60 * 60 * 1000) return false;
  // Уже напоминали про эту же самую (не тронутую с тех пор) корзину — не
  // спамим повторно. Новый товар в корзине сдвигает cartLastActivity вперёд
  // и делает следующее напоминание снова допустимым.
  if (lastReminderSentAt && lastReminderSentAt.getTime() >= cartLastActivity.getTime())
    return false;
  return true;
}
