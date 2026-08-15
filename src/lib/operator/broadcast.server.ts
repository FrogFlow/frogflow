import { requireOperator } from "./guard.server";
import { callInternal } from "./internal-client.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type DeliveryStatus = "sent" | "failed" | "unreachable" | "skipped";

export type DeliveryResult = {
  bot_id: string;
  bot_name: string;
  status: DeliveryStatus;
  error?: string;
  at: string;
};

type Recipient = {
  id: string;
  bot_name: string;
  app_url: string | null;
  internal_secret: string | null;
};

/** Один HTTP-запрос к одному деплою — любой исход становится строкой отчёта, а не обрывает рассылку. */
async function deliverToOne(bot: Recipient, text: string): Promise<DeliveryResult> {
  const base = { bot_id: bot.id, bot_name: bot.bot_name, at: new Date().toISOString() };
  const res = await callInternal(bot, "/api/internal/notify-owner", { text });
  return res.ok ? { ...base, status: "sent" } : { ...base, status: res.kind, error: res.error };
}

export type BroadcastOutcome = {
  id: string;
  results: DeliveryResult[];
};

/**
 * Рассылка владельцам — N запросов к N деплоям, последовательно (§6 плана).
 * Результат по каждому получателю сохраняется и возвращается отдельно: лежащий
 * деплой означает недоставленное сообщение, и это обязано быть видно.
 */
export async function broadcastToOwners(
  botIds: string[],
  text: string,
  actor: string,
): Promise<BroadcastOutcome> {
  await requireOperator();

  const trimmed = text.trim();
  if (!trimmed) throw new Error("Текст сообщения пуст");
  if (botIds.length === 0) throw new Error("Не выбран ни один получатель");

  const s = await db();
  const { data, error } = await s
    .from("bots")
    .select("id, bot_name, app_url, internal_secret")
    .in("id", botIds);
  if (error) throw new Error(`Не удалось получить получателей: ${error.message}`);

  const recipients = (data ?? []) as Recipient[];
  const found = new Set(recipients.map((r) => r.id));
  const results: DeliveryResult[] = [];

  // Запрошенный, но отсутствующий в базе id — тоже строка отчёта, а не тишина.
  for (const missing of botIds.filter((id) => !found.has(id))) {
    results.push({
      bot_id: missing,
      bot_name: "—",
      status: "skipped",
      error: "Клиент не найден в базе",
      at: new Date().toISOString(),
    });
  }

  // Параллельно, а не по очереди. Каждый запрос ждёт до INTERNAL_TIMEOUT_MS,
  // и последовательная доставка складывала эти ожидания: пять лежащих деплоев
  // — уже 50 секунд, что дольше лимита serverless-функции. Оператор получал
  // ошибку шлюза вместо отчёта, хотя часть сообщений успевала уйти. Теперь
  // общее время равно самому медленному получателю, а не их сумме.
  results.push(...(await Promise.all(recipients.map((bot) => deliverToOne(bot, trimmed)))));

  const { data: saved, error: saveErr } = await s
    .from("operator_broadcasts")
    .insert({
      actor,
      message_text: trimmed,
      target: botIds.length === 1 ? "selected" : "all",
      results: results as unknown as never,
    })
    .select("id")
    .single();
  if (saveErr) {
    // Сообщения уже разосланы — журнал вторичен, но молчать о потере нельзя.
    console.error("[operator] не удалось записать operator_broadcasts:", saveErr.message);
  }

  // Журнал по каждому клиенту, чтобы «что мы ему писали» было видно в карточке.
  const events = results
    .filter((r) => r.status === "sent")
    .map((r) => ({
      bot_id: r.bot_id,
      actor,
      kind: "message" as const,
      payload: { text: trimmed } as unknown as never,
    }));
  if (events.length > 0) {
    const { error: evErr } = await s.from("bot_events").insert(events);
    if (evErr) console.error("[operator] не удалось записать bot_events:", evErr.message);
  }

  return { id: saved?.id ?? "", results };
}

export type BroadcastHistoryItem = {
  id: string;
  created_at: string;
  actor: string;
  message_text: string;
  target: string;
  results: DeliveryResult[];
};

export async function listBroadcasts(limit = 20): Promise<BroadcastHistoryItem[]> {
  await requireOperator();
  const s = await db();
  const { data, error } = await s
    .from("operator_broadcasts")
    .select("id, created_at, actor, message_text, target, results")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Не удалось получить журнал рассылок: ${error.message}`);
  return (data ?? []) as unknown as BroadcastHistoryItem[];
}
