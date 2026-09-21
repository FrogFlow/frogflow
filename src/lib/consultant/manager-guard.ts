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

/**
 * Менеджер, написавший недавно, остаётся в чате, даже если бот успел
 * ответить после него. Поэтому окно не сводится к «после нашего последнего
 * ответа»: последние полчаса переписки смотрим всегда.
 */
export const ACTIVE_MANAGER_WINDOW_MS = 30 * 60 * 1000;

/**
 * Через сколько бот снова заговорит после того, как в чат влез менеджер.
 *
 * Отсчёт идёт не от паузы, а от последнего исходящего сообщения: менеджер
 * ответил ещё раз — окно началось заново. Пока оно не вышло, бот молчит, даже
 * если покупатель пишет.
 *
 * Цифра — это компромисс продавца, а не техники, поэтому она в настройках.
 * Короткое окно рискует тем, что бот вклинится в разговор, который менеджер
 * ещё ведёт; длинное — тем, что вернувшийся вечером покупатель не получит
 * ответа, когда менеджер уже ушёл. Было зашито 12 часов: менеджер, ответивший
 * в одиннадцать утра, держал бота молчащим до одиннадцати вечера, то есть весь
 * рабочий день бутика.
 */
export const MANAGER_PAUSE_HOURS_KEY = "consultant_manager_pause_hours";
export const DEFAULT_MANAGER_PAUSE_HOURS = 6;
export const MIN_MANAGER_PAUSE_HOURS = 1;
export const MAX_MANAGER_PAUSE_HOURS = 24;

/** Приводит значение из настроек к допустимым границам. */
export function normalizeManagerPauseHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MANAGER_PAUSE_HOURS;
  return Math.min(MAX_MANAGER_PAUSE_HOURS, Math.max(MIN_MANAGER_PAUSE_HOURS, n));
}

export function managerPauseMs(hours: number): number {
  return normalizeManagerPauseHours(hours) * 60 * 60 * 1000;
}

/** Окно из настроек магазина, в часах; при любой ошибке — значение по умолчанию. */
export async function loadManagerPauseHours(): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", MANAGER_PAUSE_HOURS_KEY)
      .maybeSingle();
    return normalizeManagerPauseHours(data?.value);
  } catch {
    return DEFAULT_MANAGER_PAUSE_HOURS;
  }
}

export async function loadManagerPauseMs(): Promise<number> {
  return managerPauseMs(await loadManagerPauseHours());
}

export async function saveManagerPauseHours(hours: unknown): Promise<number> {
  const value = normalizeManagerPauseHours(hours);
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  // Тот же случай, что в store-info.ts: ON CONFLICT (key) не совпадает с
  // первичным ключом (bot_id, key), и ошибку нельзя глотать — иначе окно
  // молча останется прежним, а продавец будет думать, что поменял.
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key: MANAGER_PAUSE_HOURS_KEY, value: String(value) });
  if (error) throw new Error(`Не удалось сохранить окно паузы: ${error.message}`);
  return value;
}

/**
 * Пора ли снимать паузу менеджера: с его последнего сообщения прошло больше
 * окна. Без времени последнего исходящего судить не о чем — молчим дальше.
 */
export function managerPauseExpired(
  lastOutgoingAt: string | number | undefined | null,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const at = typeof lastOutgoingAt === "number" ? lastOutgoingAt : Date.parse(lastOutgoingAt ?? "");
  if (!Number.isFinite(at) || at <= 0) return false;
  return now - at > windowMs;
}

export function findManagerMessage(
  messages: ZernioInboxMessage[],
  state: ConsultantState,
  now: number = Date.now(),
  ourReplies: string[] = [],
): ManagerMessage | null {
  const botAt = Date.parse(state.last_bot_reply_at ?? "");
  const base = Number.isFinite(botAt)
    ? Math.min(botAt + BOT_ECHO_GRACE_MS, now - ACTIVE_MANAGER_WINDOW_MS)
    : now - MANAGER_LOOKBACK_MS;
  // Дальше явного включения не смотрим. Иначе получалось так: менеджер
  // написал, бот встал на паузу, человек нажал в панели «вернуть бота» — и на
  // следующем же сообщении покупателя окно в полчаса находило ту же реплику
  // менеджера и ставило паузу заново. Кнопка выглядела сломанной, а покупатель
  // молча оставался без ответа. Нажатие — это решение человека: всё, что было
  // до него, уже учтено. Менеджер, написавший ПОСЛЕ включения, паузу вернёт.
  const resumedAt = Date.parse(state.resumed_at ?? "");
  const since = Number.isFinite(resumedAt) ? Math.max(base, resumedAt) : base;
  const ourLast = foldReply(state.last_bot_reply ?? "");
  // Свой голос — и ответы бота, и ответы менеджера, переданные покупателю
  // через нас: они ушли с нашего аккаунта и в переписке от бота неотличимы,
  // но живым человеком в чате не являются. Читаем их из состояния прямо
  // здесь, чтобы ни один вызов не забыл их подмешать.
  const ourVoice = new Set(
    [...ourReplies, ...(state.relayed ?? [])].map(foldReply).filter(Boolean),
  );
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
    // Свои прошлые ответы знаем по журналу: память процесса на serverless
    // живёт минуты, а менеджер приходит и через час.
    if (ourVoice.has(foldReply(text))) continue;
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
  userKey?: string;
  state: ConsultantState;
}): Promise<ManagerCheck> {
  if (!params.accountId || !params.conversationId) {
    return { status: "no_conversation", checked: 0 };
  }
  try {
    const { listZernioConversationMessages } = await import("@/lib/zernio.server");
    const messages = await listZernioConversationMessages(params.accountId, params.conversationId);
    if (messages.length === 0) return { status: "empty", checked: 0 };
    const { loadRecentBotReplies } = await import("./runs");
    const ourReplies = params.userKey ? await loadRecentBotReplies(params.userKey) : [];
    const found = findManagerMessage(messages, params.state, Date.now(), ourReplies);
    const stats = describeMessages(messages, params.state, Date.now());
    return found
      ? { status: "found", checked: messages.length, message: found, stats }
      : { status: "clear", checked: messages.length, stats };
  } catch (e) {
    console.error("[consultant] не удалось проверить, писал ли менеджер", e);
    return { status: "error", checked: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
