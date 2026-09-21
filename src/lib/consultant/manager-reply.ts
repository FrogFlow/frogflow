/**
 * Ответ менеджера покупателю прямо из Telegram.
 *
 * Бот присылает менеджеру вопрос, на который сам ответить не смог. Дальше до
 * сих пор было пусто: продавец написал ответ в чат бота — и получил в ответ
 * приветствие консультанта, потому что на Telegram у того же бота работает
 * тот же консультант. Единственным путём оставалась кнопка «Открыть диалог в
 * Instagram» и набрать текст там.
 *
 * Теперь менеджер отвечает на само уведомление (свайп-ответ в Telegram), и
 * текст уходит покупателю в Instagram Direct. Связь держится на паре
 * «чат менеджера + номер сообщения»: Telegram присылает её в reply_to_message,
 * и по ней находится диалог покупателя.
 *
 * Список ограничен и стареет: это почтовый адрес на пару дней, а не история.
 */
const KEY = "consultant_reply_targets";
const LIMIT = 120;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ReplyTarget = {
  /** Чат менеджера в Telegram. */
  chatId: string;
  /** Сообщение-уведомление, на которое он отвечает. */
  messageId: number;
  /** Кому отвечаем — покупатель в Instagram. */
  userKey: string;
  /** Задача в панели, чтобы отметить её сделанной. */
  taskId?: string;
  at: string;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export async function loadReplyTargets(): Promise<ReplyTarget[]> {
  try {
    const s = await db();
    const { data } = await s.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (!data?.value) return [];
    const parsed = JSON.parse(data.value) as unknown;
    return Array.isArray(parsed) ? (parsed as ReplyTarget[]) : [];
  } catch {
    return [];
  }
}

/** Оставляет только свежие и не больше LIMIT — список чистится при записи. */
export function pruneReplyTargets(list: ReplyTarget[], now = Date.now()): ReplyTarget[] {
  return list
    .filter((t) => {
      const at = Date.parse(t.at);
      return Number.isFinite(at) && now - at < TTL_MS;
    })
    .slice(-LIMIT);
}

export async function rememberReplyTargets(targets: ReplyTarget[]): Promise<void> {
  if (targets.length === 0) return;
  try {
    const list = pruneReplyTargets([...(await loadReplyTargets()), ...targets]);
    const s = await db();
    await s.from("app_settings").upsert({
      key: KEY,
      value: JSON.stringify(list),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    // Потеря адреса не должна ронять отправку уведомления: менеджер в худшем
    // случае ответит через кнопку «Открыть диалог в Instagram».
    console.warn("[consultant] не удалось запомнить адрес для ответа", err);
  }
}

export function findReplyTarget(
  list: ReplyTarget[],
  chatId: string | number,
  messageId: number | undefined,
): ReplyTarget | null {
  if (!messageId) return null;
  const chat = String(chatId);
  return list.find((t) => t.chatId === chat && t.messageId === messageId) ?? null;
}

export async function lookupReplyTarget(
  chatId: string | number,
  messageId: number | undefined,
): Promise<ReplyTarget | null> {
  if (!messageId) return null;
  return findReplyTarget(await loadReplyTargets(), chatId, messageId);
}

/**
 * Отправляет текст менеджера покупателю в тот диалог, из которого пришёл
 * вопрос. Адрес диалога берётся из карточки покупателя: Zernio знает его по
 * паре «аккаунт магазина + разговор».
 */
export async function sendManagerReplyToCustomer(
  userKey: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = text.trim();
  if (!body) return { ok: false, error: "пустой текст" };
  try {
    const s = await db();
    const { data } = await s
      .from("bot_users")
      .select("zernio_conversation_id, zernio_account_id")
      .eq("user_key", userKey)
      .maybeSingle();
    const conversationId = data?.zernio_conversation_id?.trim();
    const accountId = data?.zernio_account_id?.trim();
    if (!conversationId || !accountId) {
      return { ok: false, error: "у покупателя не записан диалог Instagram" };
    }
    const { sendZernioInboxMessage } = await import("@/lib/zernio.server");
    return await sendZernioInboxMessage(conversationId, accountId, body);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Полный путь ответа: отправить покупателю, отметить задачу сделанной и
 * сказать менеджеру, что получилось. Пауза после этого не снимается: раз
 * человек заговорил с покупателем, диалог его.
 */
export async function deliverManagerReply(
  target: ReplyTarget,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const sent = await sendManagerReplyToCustomer(target.userKey, text);
  if (!sent.ok) return sent;
  // Запоминаем свой же голос. Без этого проверка «в чате менеджер» увидит в
  // переписке исходящее, которого бот не писал, и поставит паузу — хотя
  // менеджер в чат не заходил, а лишь передал один факт через нас. На живом
  // диалоге так и вышло: бот замолчал сразу после «300г», и следующий вопрос
  // покупателя — «А есть подушки?» — остался без ответа.
  try {
    const { loadConsultantState, patchConsultantState, appendRelayed } = await import("./state");
    const { consultant } = await loadConsultantState(target.userKey);
    await patchConsultantState(target.userKey, {
      relayed: appendRelayed(consultant, text),
    });
  } catch (err) {
    console.warn("[consultant] ответ отправлен, но не запомнен как свой", err);
  }
  if (target.taskId) {
    try {
      const { setConsultantTaskDone } = await import("./tasks");
      await setConsultantTaskDone(target.taskId, true);
    } catch (err) {
      // Отметка в панели — удобство, а не условие: сообщение уже ушло.
      console.warn("[consultant] ответ отправлен, но задача не отмечена", err);
    }
  }
  return { ok: true };
}
