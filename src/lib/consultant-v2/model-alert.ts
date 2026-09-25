/**
 * Сигнал владельцу, когда модель консультанта перестала отвечать не на
 * минуту, а насовсем: кончились деньги на счёте Anthropic, ключ не принят
 * или не задан.
 *
 * 25.09 баланс ушёл в минус, и об этом никто не узнал: боевой бот BOVI без
 * модели отвечал невпопад, v2 молча отдавал каждый диалог менеджеру. Узнали
 * по журналу через несколько часов. Теперь первая такая ошибка — сообщение в
 * Telegram владельцу бота, не чаще раза в ALERT_EVERY_MS на вид сбоя.
 * Перегрузка (529), ошибка сервера и сеть проходят сами — о них не пишем.
 *
 * Кому: владелец бота из карточки (bots.owner_telegram_id) — счёт Anthropic
 * его забота, а не продавцов. Владельца нет — Telegram из настроек
 * (admin_chat_id).
 */

export type ModelFailureKind = "billing" | "auth" | "no_key" | "limit";

export const MODEL_ALERT_KEY = "consultant_model_alert_json";
const ALERT_EVERY_MS = 3 * 60 * 60 * 1000;

/**
 * Вид сбоя по ошибке движка («anthropic_400:{...}», «no_api_key») или null,
 * если сбой временный и писать о нём незачем.
 */
export function classifyModelFailure(error: string | null | undefined): ModelFailureKind | null {
  if (!error) return null;
  if (error === "no_api_key") return "no_key";
  const status = /^anthropic_(\d{3})/.exec(error)?.[1];
  if (!status) return null;
  if (/credit balance|billing|payment/i.test(error)) return "billing";
  if (status === "401" || status === "403") return "auth";
  if (status === "429") return "limit";
  return null;
}

export function modelFailureText(kind: ModelFailureKind): string {
  const tail = "Пока это не исправлено, бот сам не отвечает: каждый диалог уходит менеджеру.";
  switch (kind) {
    case "billing":
      return `⚠️ Консультант: на счёте Anthropic закончились деньги.\n${tail}\nПополнить: console.anthropic.com → Billing.`;
    case "auth":
      return `⚠️ Консультант: Anthropic не принимает ключ (отозван или неверный).\n${tail}\nПроверьте ключ в настройках деплоя.`;
    case "no_key":
      return `⚠️ Консультант: в деплое не задан ключ Anthropic.\n${tail}`;
    case "limit":
      return "⚠️ Консультант: Anthropic отклоняет запросы по лимиту (429) — скорость или месячный лимит расходов. Часть ответов уходит менеджеру.\nПроверьте лимиты: console.anthropic.com → Limits.";
  }
}

/** Написать владельцу о сбое — если сбой не временный и о нём не писали недавно. */
export async function alertModelFailure(error: string | null | undefined): Promise<void> {
  const kind = classifyModelFailure(error);
  if (!kind) return;
  try {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", MODEL_ALERT_KEY)
      .maybeSingle();
    let sent: Record<string, string> = {};
    try {
      sent = data?.value ? (JSON.parse(data.value) as Record<string, string>) : {};
    } catch {
      sent = {};
    }
    const last = Date.parse(sent[kind] ?? "");
    if (Number.isFinite(last) && Date.now() - last < ALERT_EVERY_MS) return;
    // Сначала отметка, потом отправка: два сообщения подряд с той же ошибкой
    // не должны дать два уведомления.
    await supabaseAdmin.from("app_settings").upsert({
      key: MODEL_ALERT_KEY,
      value: JSON.stringify({ ...sent, [kind]: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    });

    await sendToOwner(modelFailureText(kind));
  } catch (err) {
    console.error("[consultant-v2] не удалось сообщить о сбое модели", err);
  }
}

/**
 * Владелец бота из карточки (bots.owner_telegram_id), а если его нет — все
 * Telegram из настроек (admin_chat_id). Служебное — счёт Anthropic, сводка
 * качества — забота владельца, а не продавцов.
 */
export async function ownerChatIds(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const botId = process.env.BOT_ID?.trim();
  const { data: bot } = botId
    ? await supabaseAdmin.from("bots").select("owner_telegram_id").eq("id", botId).maybeSingle()
    : { data: null };
  if (bot?.owner_telegram_id) return [String(bot.owner_telegram_id)];
  const { data: admins } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "admin_chat_id")
    .maybeSingle();
  return (admins?.value ?? "").split(/[,;\s]+/).filter(Boolean);
}

/** Текст владельцу бота от имени этого бота. Возвращает, скольким ушло. */
export async function sendToOwner(text: string): Promise<number> {
  const recipients = await ownerChatIds();
  const { tg } = await import("@/lib/telegram.server");
  let sent = 0;
  for (const chatId of recipients) {
    const res = await tg("sendMessage", { chat_id: chatId, text });
    if (res?.ok) sent++;
  }
  return sent;
}
