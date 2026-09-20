/**
 * «В чате уже отвечает менеджер» — проверка перед тем, как бот заговорит.
 *
 * Как было. Пауза ставилась двумя путями, и оба не работали. Вебхук ловит
 * только message.received: исходящих событий Zernio нам не шлёт вовсе (в
 * журнале за последние сутки только message.received и comment.received),
 * поэтому ветка direction === "outgoing" в обработчике не срабатывала ни
 * разу. Оставался опрос раз в пятнадцать минут, и тот требовал, чтобы
 * сообщение менеджера было в переписке последним: ответил менеджер, следом
 * написал покупатель — и опрос проходит мимо. В базе это видно прямо:
 * тринадцать диалогов BOVI и ни одной паузы с причиной manager_intervention.
 *
 * Как стало. На каждое входящее сообщение смотрим хвост переписки глазами
 * Zernio: есть ли там исходящее, которое отправляли не мы и которое новее
 * нашего последнего ответа. Есть — ставим паузу и молчим. Это один лишний
 * запрос к Zernio на сообщение, и он того стоит: бот, перебивающий живого
 * менеджера, дороже.
 */
import type { ZernioInboxMessage } from "@/lib/zernio.server";
import { foldReply, looksLikeConsultantBotReply } from "./copy";
import { isBotEcho, type ConsultantState } from "./state";

/**
 * Наше собственное сообщение появляется в ленте Zernio не мгновенно, а его
 * время может разойтись с нашим на секунды. Полторы минуты запаса.
 */
export const BOT_ECHO_GRACE_MS = 90_000;

/**
 * Если бот в этом диалоге ещё не отвечал, сравнивать не с чем. Тогда
 * менеджером считается только свежее исходящее: переписка недельной
 * давности бота глушить не должна.
 */
export const MANAGER_LOOKBACK_MS = 12 * 60 * 60 * 1000;

/** Сколько последних сообщений переписки смотрим. */
const TAIL = 12;

export type ManagerMessage = { text: string; at: number };

export function findManagerMessage(
  messages: ZernioInboxMessage[],
  state: ConsultantState,
  now: number = Date.now(),
): ManagerMessage | null {
  const botAt = Date.parse(state.last_bot_reply_at ?? "");
  const since = Number.isFinite(botAt) ? botAt + BOT_ECHO_GRACE_MS : now - MANAGER_LOOKBACK_MS;
  const ourLast = foldReply(state.last_bot_reply ?? "");
  const tail = messages.slice(-TAIL);
  for (let i = tail.length - 1; i >= 0; i--) {
    const m = tail[i];
    if (m.direction !== "outgoing") continue;
    const text = (m.message ?? "").trim();
    if (!text) continue;
    const at = m.createdAt ? Date.parse(m.createdAt) : 0;
    if (!Number.isFinite(at) || at <= since) continue;
    // Наши же слова: свежая отправка, знакомый шаблон или дословный повтор
    // последнего ответа бота.
    if (isBotEcho(state, text)) continue;
    if (looksLikeConsultantBotReply(text)) continue;
    if (ourLast && foldReply(text) === ourLast) continue;
    return { text, at };
  }
  return null;
}

/**
 * Результат проверки. Он же пишется в журнал сообщений: когда в следующий
 * раз бот перебьёт менеджера, по строке журнала будет видно, что именно
 * увидела проверка, а не придётся гадать между «код не доехал», «Zernio не
 * отдал переписку» и «сообщение не распознано».
 */
export type ManagerCheck = {
  status: "found" | "clear" | "no_conversation" | "empty" | "error";
  /** Сколько сообщений вернул Zernio. */
  checked: number;
  message?: ManagerMessage;
  error?: string;
  /**
   * Из чего состоял ответ Zernio. Без этого «менеджера не видно» значит
   * одинаково и «его там правда нет», и «мы читаем не те поля»: первый раз
   * разбор упёрся ровно в это.
   */
  stats?: {
    /** Сколько сообщений по каждому значению direction. */
    directions: Record<string, number>;
    /** У скольких пустой текст — признак, что читаем не то поле. */
    emptyText: number;
    /** Время самого свежего исходящего, как его отдал Zernio. */
    lastOutgoingAt?: string;
    /** С какого момента сообщение считается ответом менеджера. */
    since: string;
  };
};

function describeMessages(messages: ZernioInboxMessage[], state: ConsultantState, now: number) {
  const directions: Record<string, number> = {};
  let emptyText = 0;
  let lastOutgoingAt: string | undefined;
  for (const m of messages) {
    const dir = m.direction ?? "(нет поля)";
    directions[dir] = (directions[dir] ?? 0) + 1;
    if (!(m.message ?? "").trim()) emptyText += 1;
    if (dir === "outgoing" && m.createdAt) lastOutgoingAt = m.createdAt;
  }
  const botAt = Date.parse(state.last_bot_reply_at ?? "");
  const since = Number.isFinite(botAt) ? botAt + BOT_ECHO_GRACE_MS : now - MANAGER_LOOKBACK_MS;
  return { directions, emptyText, lastOutgoingAt, since: new Date(since).toISOString() };
}

/**
 * Тот же вопрос, но с походом в Zernio. Ошибка запроса не должна затыкать
 * бота: не смогли проверить — отвечаем, как раньше.
 */
export async function managerSpokeInConversation(params: {
  accountId?: string | null;
  conversationId?: string | null;
  state: ConsultantState;
}): Promise<ManagerCheck> {
  if (!params.accountId || !params.conversationId) {
    return { status: "no_conversation", checked: 0 };
  }
  try {
    const { listZernioConversationMessages } = await import("@/lib/zernio.server");
    const messages = await listZernioConversationMessages(params.accountId, params.conversationId);
    if (messages.length === 0) return { status: "empty", checked: 0 };
    const found = findManagerMessage(messages, params.state);
    const stats = describeMessages(messages, params.state, Date.now());
    return found
      ? { status: "found", checked: messages.length, message: found, stats }
      : { status: "clear", checked: messages.length, stats };
  } catch (e) {
    console.error("[consultant] не удалось проверить, писал ли менеджер", e);
    return { status: "error", checked: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
