import { tg } from "./telegram.server";
import { hasModule } from "./modules/modules.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function requireBotId(): string {
  const id = process.env.BOT_ID?.trim();
  if (!id) throw new Error("BOT_ID не задан в переменных окружения этого деплоя.");
  return id;
}

const PREVIEW_LEN = 200;
type Sender = "customer" | "bot" | "manager";
type Direction = "in" | "out";

/**
 * Пишет реплику в лог (manager_chat_messages) и атомарно обновляет
 * «последнее состояние» (manager_chat_state) — превью, время, и
 * unread_count только для реплик клиента. manager_chat_touch (RPC) делает
 * upsert+инкремент одной операцией, чтобы не читать-изменять-писать
 * unread_count при параллельных сообщениях.
 */
export async function recordMessage(params: {
  telegramId: number;
  direction: Direction;
  sender: Sender;
  text: string;
}): Promise<void> {
  const { telegramId, direction, sender, text } = params;
  const s = await db();
  const botId = requireBotId();
  const preview = text.slice(0, PREVIEW_LEN);

  const { error: rpcError } = await s.rpc("manager_chat_touch", {
    p_bot_id: botId,
    p_telegram_id: telegramId,
    p_direction: direction,
    p_sender: sender,
    p_preview: preview,
  });
  if (rpcError) console.error("[manager-chat] manager_chat_touch failed", rpcError);

  const { error: insertError } = await s
    .from("manager_chat_messages")
    .insert({ bot_id: botId, telegram_id: telegramId, direction, sender, text });
  if (insertError) console.error("[manager-chat] message insert failed", insertError);
}

export async function isManagerConnected(telegramId: number): Promise<boolean> {
  const s = await db();
  const { data } = await s
    .from("manager_chat_state")
    .select("active")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return data?.active === true;
}

/**
 * Точка входа со стороны клиента — вызывается из bot.server.ts сразу после
 * replyIfBlocked, до всей остальной обработки входящего сообщения. Логирует
 * реплику клиента (для медиа без текста — плейсхолдер) и решает, обрывать
 * ли автоответ: true — менеджер подключён, дальше в bot.server.ts обработка
 * не идёт; false — бот работает как обычно.
 *
 * Если модуль не куплен — выходит сразу, без обращения к базе: строки в
 * manager_chat_state не может быть, раз кнопка «Подключиться» доступна
 * только за requireModule("manager_chat") в admin-панели.
 */
export async function handleManagerChatInbound(
  telegramId: number,
  text: string | undefined,
): Promise<boolean> {
  if (!(await hasModule("manager_chat"))) return false;

  await recordMessage({
    telegramId,
    direction: "in",
    sender: "customer",
    text: text?.trim() || "[без текста]",
  });

  return isManagerConnected(telegramId);
}

/** То же самое для callback-кнопок — нечего логировать как реплику, только обрыв автоматики. */
export async function isManagerChatBlockingCallbacks(telegramId: number): Promise<boolean> {
  if (!(await hasModule("manager_chat"))) return false;
  return isManagerConnected(telegramId);
}

export async function connect(telegramId: number): Promise<void> {
  const s = await db();
  const botId = requireBotId();
  const { error } = await s.from("manager_chat_state").upsert(
    {
      bot_id: botId,
      telegram_id: telegramId,
      active: true,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) throw new Error(error.message);
}

export async function disconnect(telegramId: number): Promise<void> {
  const s = await db();
  const { error } = await s
    .from("manager_chat_state")
    .update({ active: false })
    .eq("telegram_id", telegramId);
  if (error) throw new Error(error.message);
}

export async function markRead(telegramId: number): Promise<void> {
  const s = await db();
  const { error } = await s
    .from("manager_chat_state")
    .update({ unread_count: 0 })
    .eq("telegram_id", telegramId);
  if (error) throw new Error(error.message);
}

/**
 * Ответ менеджера из панели — тот же tg("sendMessage"), что и у автоответов
 * бота, поэтому клиент не видит разницы. skipChatLog: true, потому что
 * иначе центральное логирование в tg() записало бы эту же реплику ещё раз
 * под sender: "bot" — здесь она логируется явно под "manager".
 */
export async function sendManagerReply(telegramId: number, text: string): Promise<void> {
  const res = await tg("sendMessage", { chat_id: telegramId, text }, { skipChatLog: true });
  if (!res.ok) throw new Error(res.description || "Не удалось отправить сообщение в Telegram");
  await recordMessage({ telegramId, direction: "out", sender: "manager", text });
}

export type ManagerChatConversation = {
  telegram_id: number;
  active: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: string | null;
  unread_count: number;
  username: string | null;
  first_name: string | null;
};

export async function listConversations(): Promise<ManagerChatConversation[]> {
  const s = await db();
  const { data: states, error } = await s
    .from("manager_chat_state")
    .select(
      "telegram_id, active, last_message_at, last_message_preview, last_message_direction, unread_count",
    )
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  if (!states || states.length === 0) return [];

  const ids = states.map((r) => r.telegram_id);
  const { data: users } = await s
    .from("bot_users")
    .select("telegram_id, username, first_name")
    .in("telegram_id", ids);
  const byId = new Map((users ?? []).map((u) => [u.telegram_id, u]));

  return states.map((st) => ({
    ...st,
    username: byId.get(st.telegram_id)?.username ?? null,
    first_name: byId.get(st.telegram_id)?.first_name ?? null,
  }));
}

export type ManagerChatMessage = {
  id: string;
  direction: Direction;
  sender: Sender;
  text: string;
  created_at: string;
};

export async function listMessages(telegramId: number): Promise<ManagerChatMessage[]> {
  const s = await db();
  const { data, error } = await s
    .from("manager_chat_messages")
    .select("id, direction, sender, text, created_at")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as ManagerChatMessage[];
}

export async function totalUnread(): Promise<number> {
  const s = await db();
  const { data, error } = await s.from("manager_chat_state").select("unread_count");
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + (r.unread_count ?? 0), 0);
}
