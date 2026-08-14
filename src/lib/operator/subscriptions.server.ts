import { requireOperator } from "./guard.server";

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

  await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: "message",
    payload: { action: "payment_added", period_end: p.period_end, amount: p.amount },
  });
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

  await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: "message",
    payload: { action: "payment_deleted", payment_id: paymentId },
  });
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

  await s.from("bot_events").insert({
    bot_id: botId,
    actor,
    kind: "message",
    payload: { action: "policy_changed", ...policy },
  });
}
