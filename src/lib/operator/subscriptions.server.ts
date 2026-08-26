import { requireOperator } from "./guard.server";
import { logEvent } from "./events.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/** Поведение при неоплате — из bots.settings, заведено ещё Фазой 0 (§10 плана). */
export type OverduePolicy = {
  on_overdue: "warn" | "suspend";
  warn_days_before: number;
  grace_days: number;
};

export const DEFAULT_POLICY: OverduePolicy = {
  on_overdue: "warn",
  warn_days_before: 5,
  grace_days: 3,
};

export function readPolicy(settings: unknown): OverduePolicy {
  const s = (settings ?? {}) as Partial<OverduePolicy>;
  return {
    on_overdue: s.on_overdue === "suspend" ? "suspend" : "warn",
    warn_days_before: Number.isFinite(s.warn_days_before)
      ? Number(s.warn_days_before)
      : DEFAULT_POLICY.warn_days_before,
    grace_days: Number.isFinite(s.grace_days) ? Number(s.grace_days) : DEFAULT_POLICY.grace_days,
  };
}

/**
 * Состояние подписки. Отличается от bots.status намеренно: статус — то, что
 * оператор выставил, состояние — то, что следует из дат. Их расхождение и
 * есть повод что-то сделать.
 */
export type SubscriptionState =
  | "no_data" // дата не заполнена — подписка не заведена
  | "ok"
  | "expiring" // истекает в ближайшие warn_days_before дней
  | "overdue" // просрочена, но ещё в пределах grace_days
  | "grace_over"; // просрочка дольше grace_days — пора применять политику

export type SubscriptionStatus = {
  state: SubscriptionState;
  expiresAt: string | null;
  /** Дней до истечения; отрицательное — сколько дней уже просрочено. */
  daysLeft: number | null;
  policy: OverduePolicy;
  /** Есть ли платежи под этой датой. Дата без платежей — унаследованное значение, а не подтверждённая оплата. */
  backedByPayments: boolean;
};

const DAY_MS = 86_400_000;

export function computeState(
  expiresAt: string | null,
  policy: OverduePolicy,
  backedByPayments: boolean,
  now = new Date(),
): SubscriptionStatus {
  if (!expiresAt) {
    return { state: "no_data", expiresAt: null, daysLeft: null, policy, backedByPayments };
  }
  // Сравниваем по календарным дням, а не по моментам: подписка «до 1 сентября»
  // не должна протухать в полночь по UTC для клиента в другом поясе.
  const end = new Date(expiresAt);
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysLeft = Math.round((endDay - nowDay) / DAY_MS);

  let state: SubscriptionState;
  if (daysLeft >= 0) {
    state = daysLeft <= policy.warn_days_before ? "expiring" : "ok";
  } else if (-daysLeft <= policy.grace_days) {
    state = "overdue";
  } else {
    state = "grace_over";
  }
  return { state, expiresAt, daysLeft, policy, backedByPayments };
}

export type Payment = {
  id: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  paid_at: string;
  note: string | null;
};

export async function listPayments(botId: string): Promise<Payment[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("subscription_payments")
    .select("id, period_start, period_end, amount, currency, paid_at, note")
    .eq("bot_id", botId)
    .order("period_end", { ascending: false });
  if (error) throw new Error(`Не удалось получить платежи: ${error.message}`);
  return (data ?? []) as Payment[];
}

export async function getSubscription(botId: string): Promise<SubscriptionStatus> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("subscription_expires_at, settings")
    .eq("id", botId)
    .single();
  if (error || !data) throw new Error(`Клиент не найден: ${error?.message ?? botId}`);

  const { count } = await s
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId);

  return computeState(data.subscription_expires_at, readPolicy(data.settings), (count ?? 0) > 0);
}

export type NewPayment = {
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  note: string | null;
};

export async function addPayment(botId: string, p: NewPayment, actor: string) {
  await requireOperator();
  const s = await db();
  // subscription_expires_at пересчитает триггер из MIGRATION-09 — здесь его
  // трогать нельзя, иначе появится второй источник истины.
  const { error } = await s.from("subscription_payments").insert({
    bot_id: botId,
    period_start: p.period_start,
    period_end: p.period_end,
    amount: p.amount,
    currency: p.currency,
    note: p.note,
  });
  if (error) throw new Error(`Не удалось записать платёж: ${error.message}`);

  await logEvent(botId, actor, "payment", {
    action: "added",
    period_end: p.period_end,
    amount: p.amount,
  });

  await reactivateIfPaidOff(botId, actor);
}

/**
 * Возврат из suspended после платежа.
 *
 * sweepSubscriptions() умеет приостановить бота за просрочку сама, но
 * обратно не включает — раньше это оставалось на памяти оператора: платёж
 * записан, «Подписка» показывает «оплачена», а бот молча стоит на паузе,
 * потому что status никто не тронул. Включаем сами, но только если новый
 * платёж действительно закрывает просрочку (дата уже пересчитана триггером
 * MIGRATION-09 к этому моменту) — старый платёж для истории не должен
 * поднимать бота, у которого текущий период всё равно не оплачен.
 */
async function reactivateIfPaidOff(botId: string, actor: string) {
  const s = await db();
  const { data: bot, error: readErr } = await s
    .from("bots")
    .select("status, subscription_expires_at, settings")
    .eq("id", botId)
    .single();
  if (readErr || !bot) {
    // Платёж уже записан к этому моменту — не роняем addPayment/updatePayment
    // из-за сбоя реактивации, но и не даём ему пройти незамеченным: раньше
    // ошибка чтения тут неотличима от «бот не suspended», и клиент, только
    // что оплативший счёт, оставался приостановленным без единого следа
    // причины в логах.
    console.error(
      `[operator] не удалось прочитать бота ${botId} для реактивации после платежа:`,
      readErr?.message,
    );
    return;
  }
  if (bot.status !== "suspended") return;

  const state = computeState(bot.subscription_expires_at, readPolicy(bot.settings), true);
  if (state.state === "overdue" || state.state === "grace_over" || state.state === "no_data")
    return;

  const { error } = await s.from("bots").update({ status: "active" }).eq("id", botId);
  if (error) {
    console.error(
      `[operator] не удалось вернуть ${botId} из suspended после платежа:`,
      error.message,
    );
    return;
  }
  await logEvent(botId, actor, "resume", { reason: "payment_covers_arrears" });
}

export async function updatePayment(
  botId: string,
  paymentId: string,
  p: NewPayment,
  actor: string,
) {
  await requireOperator();
  const s = await db();
  const { error } = await s
    .from("subscription_payments")
    .update({
      period_start: p.period_start,
      period_end: p.period_end,
      amount: p.amount,
      currency: p.currency,
      note: p.note,
    })
    .eq("id", paymentId)
    .eq("bot_id", botId);
  if (error) throw new Error(`Не удалось изменить платёж: ${error.message}`);

  await logEvent(botId, actor, "payment", {
    action: "edited",
    payment_id: paymentId,
    period_end: p.period_end,
    amount: p.amount,
  });

  await reactivateIfPaidOff(botId, actor);
}

export async function deletePayment(botId: string, paymentId: string, actor: string) {
  await requireOperator();
  const s = await db();
  const { error } = await s
    .from("subscription_payments")
    .delete()
    .eq("id", paymentId)
    .eq("bot_id", botId);
  if (error) throw new Error(`Не удалось удалить платёж: ${error.message}`);

  await logEvent(botId, actor, "payment", { action: "deleted", payment_id: paymentId });
}

export type RevenueTotals = {
  currency: string;
  total_all_time: number;
  total_this_month: number;
  /** Собрано за тот же по счёту, но прошлый календарный месяц — для сравнения динамики. */
  total_last_month: number;
};

/**
 * Сколько всего заплатили клиенты — сгруппировано по валюте (каждая сумма в
 * своей, конвертацию платёж-в-платёж не выдумываем). "В этом месяце"/"в
 * прошлом месяце" — по paid_at (когда деньги реально пришли), не по periodu,
 * который может быть в будущем при предоплате.
 */
export async function getRevenueSummary(): Promise<RevenueTotals[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.from("subscription_payments").select("amount, currency, paid_at");
  if (error) throw new Error(`Не удалось получить платежи: ${error.message}`);

  const now = new Date();
  const monthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const lastMonthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  ).toISOString();

  const map = new Map<string, RevenueTotals>();
  for (const p of data ?? []) {
    const cur = map.get(p.currency) ?? {
      currency: p.currency,
      total_all_time: 0,
      total_this_month: 0,
      total_last_month: 0,
    };
    cur.total_all_time += Number(p.amount);
    if (p.paid_at >= monthStartIso) cur.total_this_month += Number(p.amount);
    else if (p.paid_at >= lastMonthStartIso) cur.total_last_month += Number(p.amount);
    map.set(p.currency, cur);
  }
  return [...map.values()];
}

export type MonthlyRevenue = { month: string; currency: string; total: number };

/**
 * Сборы по месяцам — для мини-графика на главной странице панели. Месяц
 * берётся по paid_at (когда деньги реально пришли), той же логикой, что и
 * getRevenueSummary() выше. Валюты не смешиваются: клиент сам решает, какую
 * показать графиком, а остальные — сопроводительной строкой.
 */
export async function getRevenueByMonth(months = 6): Promise<MonthlyRevenue[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s.from("subscription_payments").select("amount, currency, paid_at");
  if (error) throw new Error(`Не удалось получить платежи: ${error.message}`);

  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const totals = new Map<string, number>();
  for (const p of data ?? []) {
    const paidAt = new Date(p.paid_at);
    if (paidAt < cutoff) continue;
    const month = `${paidAt.getUTCFullYear()}-${String(paidAt.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `${month}|${p.currency}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(p.amount));
  }

  return [...totals.entries()]
    .map(([key, total]) => {
      const [month, currency] = key.split("|");
      return { month, currency, total };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function setPolicy(botId: string, policy: OverduePolicy, actor: string) {
  await requireOperator();
  const s = await db();
  const { data, error: readErr } = await s.from("bots").select("settings").eq("id", botId).single();
  if (readErr || !data) throw new Error(`Клиент не найден: ${readErr?.message ?? botId}`);

  // Мержим, а не заменяем: в settings со временем появится и не относящееся
  // к неоплате.
  const settings = { ...((data.settings as Record<string, unknown>) ?? {}), ...policy };
  const { error } = await s.from("bots").update({ settings }).eq("id", botId);
  if (error) throw new Error(`Не удалось сохранить политику: ${error.message}`);

  await logEvent(botId, actor, "policy", { ...policy });
}
