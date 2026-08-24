/**
 * Решения VIP-подписки — без побочных действий, чтобы можно было проверить
 * тестом. Без БД, без Telegram API, только даты и числа.
 *
 * Заведено после прод-инцидента: инвайт-ссылка, чей `expire_date` считался
 * инлайн в обработчике оплаты, уходила клиенту уже просроченной в
 * тест-режиме. Ту же арифметику (тест-режим = минуты вместо дней, окна
 * напоминаний, пересчёт срока при продлении) раньше нельзя было проверить
 * тестом отдельно от реальной БД и Telegram — теперь можно.
 */

/** Тарифы часто не задают duration_minutes — единственный фолбэк для тест-режима. */
export const TEST_MODE_DEFAULT_MINUTES = 5;

const INVITE_MIN_WINDOW_MS = 10 * 60_000;
const INVITE_MAX_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Инвайт-ссылка должна прожить достаточно, чтобы по ней успели перейти —
 * подписка, истекающая раньше (тест-режим, очень короткий тариф), иначе
 * выдаёт ссылку, уже мёртвую при получении. Ограничена и сверху: привязка
 * expire_date напрямую к многомесячной подписке оставляла одноразовую
 * ссылку рабочей месяцами после отправки — куда дольше, чем она правдоподобно
 * ещё может понадобиться для вступления.
 */
export function inviteExpireDate(expiresAt: Date, now: number = Date.now()): number {
  const floor = now + INVITE_MIN_WINDOW_MS;
  const ceiling = now + INVITE_MAX_WINDOW_MS;
  return Math.floor(Math.min(Math.max(expiresAt.getTime(), floor), ceiling) / 1000);
}

/** В тест-режиме срок тарифа считается в минутах, а не в днях. */
export function addTariffDuration(
  base: Date,
  tariff: { duration_minutes?: number | null; duration_days?: number | null } | null,
  isTest: boolean,
): Date {
  const expiresAt = new Date(base);
  if (isTest) {
    expiresAt.setMinutes(
      expiresAt.getMinutes() + (tariff?.duration_minutes || TEST_MODE_DEFAULT_MINUTES),
    );
  } else {
    expiresAt.setDate(expiresAt.getDate() + (tariff?.duration_days || 30));
  }
  return expiresAt;
}

/** Тот же тест-режим — минуты вместо дней — для окон предупреждений крона. */
export function addWarnOffset(base: Date, amount: number, isTest: boolean): Date {
  const d = new Date(base);
  if (isTest) d.setMinutes(d.getMinutes() + amount);
  else d.setDate(d.getDate() + amount);
  return d;
}

export type WarnWindows = { warnDays: number; warnDays2: number };

/**
 * Настройки предупреждений валидируются здесь, а не только в форме: значение
 * могло быть сохранено раньше (или отредактировано напрямую в БД) и не
 * пройти текущие правила. Окно второго предупреждения обязано быть строго
 * ближе первого — иначе оба сработают в одном тике и подписчик получит
 * два одинаковых по смыслу сообщения подряд.
 */
export function resolveWarnWindows(rawWarnDays: string, rawWarnDays2: string): WarnWindows {
  let warnDays = parseInt(rawWarnDays || "3", 10);
  let warnDays2 = parseInt(rawWarnDays2 || "1", 10);
  if (!Number.isFinite(warnDays) || warnDays < 1) warnDays = 3;
  if (!Number.isFinite(warnDays2) || warnDays2 < 1) warnDays2 = 1;
  if (warnDays2 >= warnDays) warnDays2 = Math.max(1, warnDays - 1);
  return { warnDays, warnDays2 };
}

/**
 * Предпочитает предупреждать по самой поздней активной подписке пользователя
 * — страховка от дублей активных строк (не должно возникать штатно, но
 * возникает: см. UNIQUE-индексы, которые это со временем закроют на уровне
 * БД). Без неё дубль получает то же предупреждение дважды, с разными датами.
 */
export function pickLatestPerUser<
  T extends { telegram_id: number | null; expires_at: string | null },
>(rows: T[] | null): T[] {
  const best = new Map<number, T>();
  for (const sub of rows ?? []) {
    const tid = sub.telegram_id as number;
    const prev = best.get(tid);
    if (!prev || new Date(sub.expires_at as string) > new Date(prev.expires_at as string)) {
      best.set(tid, sub);
    }
  }
  return [...best.values()];
}

export type VipExtensionDecision = {
  /** Подписка была не-активной или просроченной на момент запроса. */
  wasInactive: boolean;
  /** Новая дата истечения после применения +/- дней. */
  baseSafe: Date;
  /** Уменьшение утащило дату в прошлое — подписку нужно завершить, а не продлить. */
  shortenedPast: boolean;
};

/**
 * Арифметика «Продлить/±дни»: с какой даты считать (текущий срок или
 * «сейчас», если подписка уже не активна/просрочена), и не увело ли
 * уменьшение результат в прошлое.
 */
export function resolveVipExtension(
  sub: { status: string; expires_at: string },
  days: number,
  now: Date = new Date(),
): VipExtensionDecision {
  const pastDue = sub.status === "active" && new Date(sub.expires_at).getTime() <= now.getTime();
  const wasInactive = sub.status !== "active" || pastDue;

  const base = wasInactive ? new Date(now) : new Date(sub.expires_at);
  const baseSafe = base.getTime() < now.getTime() && days > 0 ? new Date(now) : new Date(base);
  baseSafe.setDate(baseSafe.getDate() + days);

  const shortenedPast = days < 0 && baseSafe.getTime() <= now.getTime();

  return { wasInactive, baseSafe, shortenedPast };
}
