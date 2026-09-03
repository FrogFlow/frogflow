/**
 * Счета на оплату подписки — оператор выставляет владельцу бота счёт со
 * своими реквизитами через его же бота, тем же приёмом, что и обычный чек
 * по заказу (payment-proof.server.ts, bot.server.ts): владелец присылает
 * фото/документ боту, бот сохраняет его в тот же бакет "payment-proofs" и
 * помечает счёт status="proof_uploaded", оператор смотрит чек в панели и
 * подтверждает или отклоняет.
 *
 * Подтверждение не придумывает новую бухгалтерию — оно вызывает уже
 * существующий addPayment() (subscriptions.server.ts), который пишет в
 * subscription_payments и полагается на триггер MIGRATION-09, чтобы
 * пересчитать bots.subscription_expires_at. Эта таблица — только слой
 * "выставлено → чек прислан → подтверждено/отклонено" перед ним, реальная
 * дата подписки этой таблицей не движется никогда.
 *
 * MIGRATION-58-subscription-invoices.sql — не применена в этой среде (нет
 * доступа к боевой БД), см. MIGRATION-README.md.
 */
import { requireOperator } from "./guard.server";
import { logEvent } from "./events.server";
import { callInternal } from "./internal-client.server";
import { addPayment } from "./subscriptions.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

const REQUISITES_KEY = "payout_requisites";

export async function getPayoutRequisites(): Promise<string> {
  await requireOperator();
  const s = await db();
  const { data } = await s
    .from("operator_settings")
    .select("value")
    .eq("key", REQUISITES_KEY)
    .maybeSingle();
  return data?.value ?? "";
}

export async function setPayoutRequisites(value: string): Promise<void> {
  await requireOperator();
  const s = await db();
  const { error } = await s
    .from("operator_settings")
    .upsert({ key: REQUISITES_KEY, value: value.trim() });
  if (error) throw new Error(`Не удалось сохранить реквизиты: ${error.message}`);
}

export type InvoiceStatus = "sent" | "proof_uploaded" | "paid" | "rejected" | "cancelled";

export type SubscriptionInvoice = {
  id: string;
  bot_id: string;
  bot_name: string;
  amount: number;
  currency: string;
  note: string | null;
  requisites_snapshot: string;
  status: InvoiceStatus;
  proof_path: string | null;
  proof_uploaded_at: string | null;
  created_at: string;
  created_by: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
};

type InvoiceRow = Omit<SubscriptionInvoice, "bot_name"> & { bots: { bot_name: string } | null };

function toInvoice(row: InvoiceRow): SubscriptionInvoice {
  const { bots, ...rest } = row;
  return { ...rest, bot_name: bots?.bot_name ?? "—" };
}

const INVOICE_SELECT =
  "id, bot_id, amount, currency, note, requisites_snapshot, status, proof_path, proof_uploaded_at, created_at, created_by, confirmed_at, reject_reason, bots(bot_name)";

export type CreateInvoiceOutcome = {
  invoice: SubscriptionInvoice;
  delivered: boolean;
  deliveryError: string | null;
};

/**
 * Заводит счёт и сразу пытается доставить его текстом владельцу через его
 * же бота (тот же internal-эндпоинт, что и рассылка — broadcast.server.ts).
 * Недоставленное сообщение не откатывает счёт: он всё равно виден в панели
 * оператора и владелец может получить сумму/реквизиты любым другим каналом
 * (звонок, WhatsApp) — то же рассуждение, что и у остальной рассылки:
 * лежащий деплой не должен прятать сам факт "счёт выставлен".
 */
export async function createInvoice(
  botId: string,
  amount: number,
  currency: string,
  note: string | null,
  actor: string,
): Promise<CreateInvoiceOutcome> {
  await requireOperator();
  const s = await db();

  const { data: bot, error: botErr } = await s
    .from("bots")
    .select("bot_name, app_url, internal_secret")
    .eq("id", botId)
    .single();
  if (botErr || !bot) throw new Error(`Клиент не найден: ${botErr?.message ?? "нет данных"}`);

  const requisites = await getPayoutRequisites();
  if (!requisites.trim()) {
    throw new Error(
      "Реквизиты для выплат не заданы — заполните их выше, прежде чем выставлять счета.",
    );
  }

  const { data: inserted, error: insertErr } = await s
    .from("subscription_invoices")
    .insert({
      bot_id: botId,
      amount,
      currency,
      note,
      requisites_snapshot: requisites,
      created_by: actor,
    })
    .select(INVOICE_SELECT)
    .single();
  if (insertErr || !inserted) {
    throw new Error(`Не удалось создать счёт: ${insertErr?.message ?? "нет данных"}`);
  }

  const invoice = toInvoice(inserted as unknown as InvoiceRow);

  await logEvent(botId, actor, "payment", {
    action: "invoice_created",
    invoice_id: invoice.id,
    amount,
    currency,
  });

  const text =
    `Счёт на оплату подписки\n\n` +
    `Сумма: ${amount} ${currency}` +
    (note ? `\nЗа что: ${note}` : "") +
    `\n\nРеквизиты для оплаты:\n${requisites}\n\n` +
    `После оплаты пришлите, пожалуйста, фото или файл с чеком следующим сообщением в этот чат.`;
  const delivery = await callInternal(bot, "/api/internal/notify-owner", { text });

  return {
    invoice,
    delivered: delivery.ok,
    deliveryError: delivery.ok ? null : delivery.error,
  };
}

export async function listInvoices(botId?: string): Promise<SubscriptionInvoice[]> {
  await requireOperator();
  const s = await db();
  let q = s.from("subscription_invoices").select(INVOICE_SELECT).order("created_at", {
    ascending: false,
  });
  if (botId) q = q.eq("bot_id", botId);
  const { data, error } = await q;
  if (error) throw new Error(`Не удалось получить счета: ${error.message}`);
  return (data ?? []).map((row) => toInvoice(row as unknown as InvoiceRow));
}

async function getInvoiceOrThrow(invoiceId: string): Promise<SubscriptionInvoice> {
  const s = await db();
  const { data, error } = await s
    .from("subscription_invoices")
    .select(INVOICE_SELECT)
    .eq("id", invoiceId)
    .single();
  if (error || !data) throw new Error(`Счёт не найден: ${error?.message ?? "нет данных"}`);
  return toInvoice(data as unknown as InvoiceRow);
}

/** Короткая signed-ссылка на чек — тот же бакет "payment-proofs", что и у заказов. */
export async function getInvoiceProofUrl(invoiceId: string): Promise<string | null> {
  await requireOperator();
  const invoice = await getInvoiceOrThrow(invoiceId);
  if (!invoice.proof_path) return null;
  const s = await db();
  const { data, error } = await s.storage
    .from("payment-proofs")
    .createSignedUrl(invoice.proof_path, 300);
  if (error || !data) {
    console.error("[operator] createSignedUrl(invoice proof) failed", error?.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * Подтверждает счёт и заводит реальный платёж — единственное место, где
 * подписка действительно продлевается. period_start/period_end передаёт
 * оператор (форма в панели, по умолчанию сегодня → +30 дней): счёт сам не
 * знает период подписки, только сумму.
 */
export async function confirmInvoice(
  invoiceId: string,
  periodStart: string,
  periodEnd: string,
  actor: string,
): Promise<void> {
  await requireOperator();
  const invoice = await getInvoiceOrThrow(invoiceId);
  if (invoice.status !== "proof_uploaded" && invoice.status !== "sent") {
    throw new Error(`Счёт уже в статусе "${invoice.status}" — подтверждать нечего`);
  }

  const s = await db();
  // Атомарный "захват" счёта условным UPDATE — вторая одновременная попытка
  // подтвердить тот же счёт (двойной клик, два оператора разом) не пройдёт
  // мимо этого условия, потому что статус уже не "sent"/"proof_uploaded"
  // (находка аудита H7: раньше проверка статуса и запись были раздельными
  // операциями, и гонка давала два платежа за один счёт). Если addPayment
  // ниже упадёт — статус откатывается обратно, а не застревает в "paid" без
  // реального платежа (находка C4: раньше addPayment вызывался ПОСЛЕ
  // пометки "paid", и любой сбой — например, невалидный период — оставлял
  // счёт в терминальном статусе, который confirmInvoice/rejectInvoice/
  // cancelInvoice больше не соглашались трогать; починить можно было
  // только SQL-ом напрямую в боевой базе).
  const { data: claimed, error: claimErr } = await s
    .from("subscription_invoices")
    .update({ status: "paid", confirmed_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .in("status", ["sent", "proof_uploaded"])
    .select("id")
    .maybeSingle();
  if (claimErr) throw new Error(`Не удалось подтвердить счёт: ${claimErr.message}`);
  if (!claimed) throw new Error("Счёт уже обработан — обновите список");

  try {
    await addPayment(
      invoice.bot_id,
      {
        period_start: periodStart,
        period_end: periodEnd,
        amount: invoice.amount,
        currency: invoice.currency,
        note: invoice.note ? `Счёт: ${invoice.note}` : "По счёту из панели оператора",
      },
      actor,
    );
  } catch (e) {
    await s
      .from("subscription_invoices")
      .update({ status: invoice.status, confirmed_at: null })
      .eq("id", invoiceId);
    throw e;
  }

  await logEvent(invoice.bot_id, actor, "payment", {
    action: "invoice_confirmed",
    invoice_id: invoiceId,
    amount: invoice.amount,
    currency: invoice.currency,
  });
}

export async function rejectInvoice(
  invoiceId: string,
  reason: string,
  actor: string,
): Promise<void> {
  await requireOperator();
  const invoice = await getInvoiceOrThrow(invoiceId);
  if (invoice.status === "paid") throw new Error("Счёт уже оплачен — отклонять нечего");

  const s = await db();
  const { error } = await s
    .from("subscription_invoices")
    .update({ status: "rejected", reject_reason: reason.trim() || null })
    .eq("id", invoiceId);
  if (error) throw new Error(`Не удалось отклонить счёт: ${error.message}`);

  await logEvent(invoice.bot_id, actor, "payment", {
    action: "invoice_rejected",
    invoice_id: invoiceId,
    reason: reason.trim() || null,
  });
}

/** Отменить счёт можно, только пока по нему ещё не прислали чек — иначе это уже "отклонить". */
export async function cancelInvoice(invoiceId: string, actor: string): Promise<void> {
  await requireOperator();
  const invoice = await getInvoiceOrThrow(invoiceId);
  if (invoice.status !== "sent") {
    throw new Error("Отменить можно только счёт, по которому ещё не прислали чек");
  }

  const s = await db();
  const { error } = await s
    .from("subscription_invoices")
    .update({ status: "cancelled" })
    .eq("id", invoiceId);
  if (error) throw new Error(`Не удалось отменить счёт: ${error.message}`);

  await logEvent(invoice.bot_id, actor, "payment", {
    action: "invoice_cancelled",
    invoice_id: invoiceId,
  });
}
