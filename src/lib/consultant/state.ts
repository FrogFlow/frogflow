import type { Json } from "@/integrations-supabase/types";
import { looksLikeConsultantBotReply, foldReply } from "./copy";
import { isConsultantGreeting, type ConsultantCountry } from "./intent";

export type PauseReason = "manager_intervention" | "purchase" | "error" | "other";
export type ConsultantConversationState =
  | "awaiting_country"
  | "awaiting_product"
  | "consulting"
  | "awaiting_contact"
  | "handed_off";

export type ConsultantTurn = { role: "customer" | "assistant"; text: string };

export type ConsultantState = {
  country?: ConsultantCountry;
  /**
   * Страну не называли — мы подставили её по умолчанию (магазин в Алматы,
   * прайс в тенге). Пока отметка стоит, бот предлагает пересчёт в рубли;
   * как только страну назвали словом или кнопкой, отметка снимается.
   */
  country_assumed?: boolean;
  /**
   * Сколько раз бот ответил с последнего сброса или передачи менеджеру. По
   * нему длинный разговор уходит человеку — см. LONG_DIALOGUE_TURNS.
   */
  bot_turns?: number;
  /** Сколько пустых реплик («дорого», «фуууув», «хорошо») было с того же момента. */
  idle_turns?: number;
  automation_paused?: boolean;
  pause_reason?: PauseReason;
  conversation_state?: ConsultantConversationState;
  customer_contact?: string;
  last_product_ids?: string[];
  last_bot_reply?: string;
  last_bot_reply_at?: string;
  last_customer_text?: string;
  last_claim_at?: string;
  recent?: ConsultantTurn[];
  ru_cdek_sent?: boolean;
  ab_bucket?: "a" | "b";
  resumed_at?: string;
  pending_product_query?: string;
  pending_story_id?: string;
  pending_story_url?: string;
  /** Когда запомнили публикацию: она живёт минуты, а не вечно. */
  pending_story_at?: string;
  /** Публикация, к которой относился прошлый вопрос — для защиты от дублей. */
  last_story_id?: string;
  /** Кто занял прошлое входящее — вебхук или опрос ящика. */
  last_claim_source?: "webhook" | "poll";
  /**
   * Ответы менеджера, отправленные покупателю через бота (свайп-ответ на
   * уведомление в Telegram). Уходят они с нашего же аккаунта Zernio, поэтому
   * в переписке выглядят как исходящие, которых бот «не писал» — и проверка
   * «в чате менеджер» принимала их за живого человека и ставила паузу.
   * Помним последние, чтобы узнавать свой же голос.
   */
  relayed?: string[];
  /** Консультант v2: что покупатель сказал о своей задаче (remember_customer). */
  v2_profile?: import("@/lib/consultant-v2/tools").V2Profile;
  /** Консультант v2: покупатель смотрит цены в рублях (переводит код). */
  v2_rub?: boolean;
};

/** Сколько переданных ответов менеджера помним для опознания своего голоса. */
export const RELAYED_LIMIT = 10;

export function appendRelayed(state: ConsultantState, text: string): string[] {
  const body = text.trim();
  if (!body) return state.relayed ?? [];
  return [...(state.relayed ?? []), body].slice(-RELAYED_LIMIT);
}

const RECENT_LIMIT = 24;

export function appendRecent(
  state: ConsultantState,
  customer: string,
  assistant: string,
): ConsultantTurn[] {
  const next = [
    ...(state.recent ?? []),
    { role: "customer" as const, text: customer.slice(0, 500) },
  ];
  if (assistant.trim()) next.push({ role: "assistant", text: assistant.slice(0, 800) });
  return next.slice(-RECENT_LIMIT);
}

const KEY = "consultant";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as object) } : {};
}

export function readConsultantState(raw: unknown): ConsultantState {
  const root = asObject(raw);
  const nested = asObject(root[KEY]);
  return nested as ConsultantState;
}

export async function loadConsultantState(userKey: string): Promise<{
  raw: Record<string, unknown>;
  consultant: ConsultantState;
}> {
  const s = await db();
  const { data } = await s.from("bot_users").select("state").eq("user_key", userKey).maybeSingle();
  const raw = asObject(data?.state);
  return { raw, consultant: readConsultantState(raw) };
}

export async function patchConsultantState(
  userKey: string,
  patch: Partial<ConsultantState>,
): Promise<ConsultantState> {
  const { raw, consultant } = await loadConsultantState(userKey);
  const next = { ...consultant, ...patch };
  const s = await db();
  await s
    .from("bot_users")
    .update({
      state: { ...raw, [KEY]: next } as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("user_key", userKey);
  return next;
}

export async function pauseConsultant(
  userKey: string,
  reason: PauseReason,
): Promise<ConsultantState> {
  return patchConsultantState(userKey, {
    automation_paused: true,
    pause_reason: reason,
    conversation_state: "handed_off",
  });
}

export async function pauseConsultantByConversation(
  conversationId: string,
  reason: PauseReason,
): Promise<boolean> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select("user_key")
    .eq("zernio_conversation_id", conversationId)
    .maybeSingle();
  if (!data?.user_key) return false;
  await pauseConsultant(data.user_key, reason);
  return true;
}

export async function resumeConsultant(userKey: string): Promise<ConsultantState> {
  const { raw, consultant } = await loadConsultantState(userKey);
  const nowIso = new Date().toISOString();
  const next: ConsultantState = {
    ...consultant,
    automation_paused: false,
    resumed_at: nowIso,
    conversation_state: consultant.country ? "consulting" : "awaiting_country",
    customer_contact: undefined,
    last_product_ids: [],
    recent: [],
    ru_cdek_sent: false,
  };
  delete next.pause_reason;
  const s = await db();
  await s
    .from("bot_users")
    .update({
      state: { ...raw, [KEY]: next } as unknown as Json,
      updated_at: nowIso,
    })
    .eq("user_key", userKey);
  return next;
}

export async function resumeConsultantByConversation(conversationId: string): Promise<boolean> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select("user_key")
    .eq("zernio_conversation_id", conversationId)
    .maybeSingle();
  if (!data?.user_key) return false;
  await resumeConsultant(data.user_key);
  return true;
}

/**
 * Полный сброс диалога с консультантом:
 * Забывает страну, историю реплик, предложенные товары, контакты, снимает паузу.
 * Позволяет покупателю или владельцу протестировать сценарий заново с чистого листа.
 */
export async function resetConsultantState(userKey: string): Promise<ConsultantState> {
  const { raw } = await loadConsultantState(userKey);
  const nowIso = new Date().toISOString();
  const resetState: ConsultantState = {
    conversation_state: "awaiting_country",
    automation_paused: false,
    resumed_at: nowIso,
    last_product_ids: [],
    recent: [],
    ru_cdek_sent: false,
  };

  const s = await db();
  await s
    .from("bot_users")
    .update({
      state: { ...raw, [KEY]: resetState } as unknown as Json,
      updated_at: nowIso,
    })
    .eq("user_key", userKey);
  return resetState;
}

export async function resetConsultantByConversation(conversationId: string): Promise<boolean> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select("user_key")
    .eq("zernio_conversation_id", conversationId)
    .maybeSingle();
  if (!data?.user_key) return false;
  await resetConsultantState(data.user_key);
  return true;
}

export type PausedConsultation = {
  userKey: string;
  label: string;
  conversationId: string | null;
  platform: string;
  pauseReason: PauseReason | undefined;
  updatedAt: string;
};

function displayLabel(row: {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  user_key: string;
}): string {
  if (row.username) return `@${row.username}`;
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  return name || row.user_key;
}

/** Недавние диалоги с паузой — оператор может вернуть бота. */
export async function listPausedConsultations(limit = 40): Promise<PausedConsultation[]> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select(
      "user_key, username, first_name, last_name, platform, zernio_conversation_id, updated_at, state",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? [])
    .flatMap((row) => {
      const consultant = readConsultantState(row.state);
      if (!isAutomationPaused(consultant)) return [];
      return [
        {
          userKey: row.user_key,
          label: displayLabel(row),
          conversationId: row.zernio_conversation_id,
          platform: row.platform,
          pauseReason: consultant.pause_reason,
          updatedAt: row.updated_at,
        },
      ];
    })
    .slice(0, limit);
}

export function isAutomationPaused(state: ConsultantState): boolean {
  return state.automation_paused === true;
}

const recentBotOutgoingFingerprints = new Map<string, number>();

export function registerBotOutgoingText(text: string): void {
  const folded = foldReply(text);
  if (!folded) return;
  recentBotOutgoingFingerprints.set(folded, Date.now());
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, ts] of recentBotOutgoingFingerprints.entries()) {
    if (ts < cutoff) recentBotOutgoingFingerprints.delete(key);
  }
}

export function isRecentBotOutgoingText(text: string): boolean {
  const incoming = foldReply(text);
  if (!incoming) return false;
  if (recentBotOutgoingFingerprints.has(incoming)) return true;
  for (const [key] of recentBotOutgoingFingerprints.entries()) {
    if (
      incoming.length >= 20 &&
      (incoming.startsWith(key.slice(0, 20)) || key.startsWith(incoming.slice(0, 20)))
    ) {
      return true;
    }
  }
  return false;
}

export function isBotEcho(state: ConsultantState, text: string): boolean {
  if (isRecentBotOutgoingText(text)) return true;
  const reply = foldReply(state.last_bot_reply ?? "");
  const incoming = foldReply(text);
  if (!incoming) return false;
  if (
    reply &&
    (reply === incoming ||
      (incoming.length >= 24 &&
        (incoming.startsWith(reply.slice(0, 24)) || reply.startsWith(incoming.slice(0, 24)))))
  ) {
    return true;
  }
  // Also check all recent assistant messages in conversation history
  const recent = state.recent ?? [];
  for (const turn of recent) {
    if (turn.role !== "assistant") continue;
    const turnFolded = foldReply(turn.text);
    if (turnFolded === incoming) return true;
    if (
      incoming.length >= 24 &&
      (incoming.startsWith(turnFolded.slice(0, 24)) || turnFolded.startsWith(incoming.slice(0, 24)))
    ) {
      return true;
    }
  }
  return false;
}

/** Пауза «менеджер» после нашей же карточки — бот тогда молчит навсегда. */
export function isFalseManagerPause(state: ConsultantState, lastOutgoingText?: string): boolean {
  if (!isAutomationPaused(state)) return false;
  if (state.pause_reason && state.pause_reason !== "manager_intervention") return false;
  if (!lastOutgoingText) return false;
  if (isBotEcho(state, lastOutgoingText)) return true;
  return looksLikeConsultantBotReply(lastOutgoingText);
}

const IN_FLIGHT_MS = 15_000;
const REPLY_TTL_MS = 25_000;
const POLL_COOLDOWN_MS = 15 * 60_000;

export function recentlyReplied(state: ConsultantState, now = Date.now(), windowMs = POLL_COOLDOWN_MS): boolean {
  const replied = Date.parse(state.last_bot_reply_at ?? "");
  return Number.isFinite(replied) && now - replied < windowMs;
}

export type IncomingSource = "webhook" | "poll";

/** Webhook и inbox-poll не должны отвечать на одно и то же входящее дважды. */
export function alreadyAnsweredIncoming(
  state: ConsultantState,
  text: string,
  now = Date.now(),
  source: IncomingSource = "poll",
  /** Публикация, к которой относится это сообщение, если она есть. */
  storyId?: string | null,
): boolean {
  const incoming = text.trim();
  if (!incoming || incoming !== (state.last_customer_text ?? "").trim()) return false;
  /**
   * Тот же текст, но про другую публикацию — это другой вопрос, а не повтор
   * доставки.
   *
   * Живой случай 22.09: покупатель переслал рилс и спросил «Сколько стоит?»,
   * через восемнадцать секунд ответил на сторис теми же словами. Второе
   * сообщение проглотила защита от дублей — у неё правило «тот же текст
   * меньше чем через двадцать секунд = ретрай вебхука», — и вопрос про
   * сторис остался без ответа, хотя к ней привязаны товары.
   */
  const story = (storyId ?? "").trim();
  const lastStory = (state.last_story_id ?? "").trim();
  /**
   * Но опрос и вебхук видят одно и то же сообщение по-разному: опрос берёт
   * публикацию из трёх последних входящих, вебхук — только из самого
   * сообщения. Живой случай 23.09 в 16:08: опрос ответил про комплект со
   * сторис, через четыре секунды вебхук принёс тот же текст без сторис,
   * и покупательница получила второй, другой ответ. Когда одна сторона
   * публикацию не знает, а сообщение пришло другим путём, это повтор
   * доставки, а не новый вопрос.
   */
  const otherPath = Boolean(state.last_claim_source) && state.last_claim_source !== source;
  const storyUnknownOnOneSide = !story || !lastStory;
  if (story !== lastStory && !(otherPath && storyUnknownOnOneSide)) return false;
  const claimed = Date.parse(state.last_claim_at ?? "");
  const replied = Date.parse(state.last_bot_reply_at ?? "");
  const inFlight =
    Number.isFinite(claimed) &&
    now - claimed < IN_FLIGHT_MS &&
    (!Number.isFinite(replied) || replied < claimed);
  if (inFlight) return true;

  // Если на этот же входящий текст уже ответили менее 20 с назад — это 100%
  // дубликат доставки/retry вебхука. Никогда не отправлять дубликат в пределах 20 с.
  if (Number.isFinite(replied) && now - replied < 20_000) {
    return true;
  }

  // Заняли эту реплику после последней отправки — ответа на неё ещё нет.
  if (Number.isFinite(claimed) && Number.isFinite(replied) && replied < claimed) {
    return false;
  }
  if (source === "poll" && (state.last_bot_reply?.trim() || Number.isFinite(replied))) {
    return true;
  }
  if (
    source === "webhook" &&
    isConsultantGreeting(incoming) &&
    (!state.country || state.conversation_state === "awaiting_country")
  ) {
    return false;
  }
  if (Number.isFinite(replied) && now - replied < REPLY_TTL_MS) {
    if (!Number.isFinite(claimed) || replied >= claimed) return true;
  }
  return false;
}

export function hasConsultantHistory(state: ConsultantState): boolean {
  return Boolean(
    state.country ||
      state.conversation_state ||
      state.last_customer_text ||
      state.last_bot_reply ||
      (state.recent && state.recent.length > 0),
  );
}

/** Если webhook и poll завели двух покупателей на один тред — берём того, кто уже консультирует. */
export function pickConversationUserKey(
  rows: { user_key: string; state?: unknown }[],
): string | null {
  if (rows.length === 0) return null;
  const withHistory = rows.find((row) => hasConsultantHistory(readConsultantState(row.state)));
  return (withHistory ?? rows[0]).user_key;
}

export async function findUserKeyByConversation(conversationId: string): Promise<string | null> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select("user_key, state")
    .eq("zernio_conversation_id", conversationId)
    .order("updated_at", { ascending: false })
    .limit(5);
  return pickConversationUserKey(data ?? []);
}

/**
 * Занять входящее атомарно: второй обработчик (poll / повтор webhook)
 * видит 0 обновлённых строк и выходит. Read-modify-write здесь гоняется.
 */
export async function claimIncomingMessage(
  userKey: string,
  text: string,
  source: IncomingSource = "poll",
): Promise<boolean> {
  const incoming = text.trim();
  if (!incoming) return false;
  const s = await db();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data } = await s
      .from("bot_users")
      .select("state, updated_at")
      .eq("user_key", userKey)
      .maybeSingle();
    if (!data) return false;
    const raw = asObject(data.state);
    const consultant = readConsultantState(raw);
    if (alreadyAnsweredIncoming(consultant, incoming, Date.now(), source)) return false;
    const claimAt = new Date().toISOString();
    const next: ConsultantState = {
      ...consultant,
      last_customer_text: incoming,
      last_claim_at: claimAt,
      last_claim_source: source,
    };
    let query = s
      .from("bot_users")
      .update({
        state: { ...raw, [KEY]: next } as unknown as Json,
        updated_at: claimAt,
      })
      .eq("user_key", userKey);
    query = data.updated_at ? query.eq("updated_at", data.updated_at) : query.is("updated_at", null);
    const { data: updated } = await query.select("user_key");
    if (updated && updated.length > 0) return true;
  }
  return false;
}

export type ConsultantCustomer = {
  userKey: string;
  label: string;
  platform: string;
  country?: ConsultantCountry;
  conversationState?: ConsultantConversationState;
  paused: boolean;
  lastReply?: string;
  recent?: ConsultantTurn[];
  updatedAt: string;
};

export async function listConsultantCustomers(limit = 40): Promise<ConsultantCustomer[]> {
  const s = await db();
  const { data } = await s
    .from("bot_users")
    .select("user_key, username, first_name, last_name, platform, updated_at, state")
    .order("updated_at", { ascending: false })
    .limit(200);
  return (data ?? [])
    .flatMap((row) => {
      const consultant = readConsultantState(row.state);
      if (!consultant.country && !consultant.conversation_state && !consultant.recent?.length) {
        return [];
      }
      return [
        {
          userKey: row.user_key,
          label: displayLabel(row),
          platform: row.platform,
          country: consultant.country,
          conversationState: consultant.conversation_state,
          paused: isAutomationPaused(consultant),
          lastReply: consultant.last_bot_reply,
          recent: consultant.recent,
          updatedAt: row.updated_at,
        },
      ];
    })
    .slice(0, limit);
}

export const CONSULTANT_BOT_ENABLED_KEY = "consultant_bot_enabled";
export const CONSULTANT_BOT_ENABLED_AT_KEY = "consultant_bot_enabled_at";

let botEnabledCache: { at: number; enabled: boolean } | null = null;
let botEnabledAtCache: number | null = null;
const BOT_ENABLED_CACHE_MS = 10_000;

export function invalidateBotEnabledCache(): void {
  botEnabledCache = null;
  botEnabledAtCache = null;
}

export async function isConsultantBotGloballyEnabled(): Promise<boolean> {
  if (botEnabledCache && Date.now() - botEnabledCache.at < BOT_ENABLED_CACHE_MS) {
    return botEnabledCache.enabled;
  }
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", CONSULTANT_BOT_ENABLED_KEY)
    .maybeSingle();
  const val = data?.value?.trim()?.toLowerCase();
  const enabled = val !== "false" && val !== "0" && val !== "disabled";
  botEnabledCache = { at: Date.now(), enabled };
  return enabled;
}

export async function getConsultantBotEnabledAt(): Promise<number | undefined> {
  if (botEnabledAtCache != null) return botEnabledAtCache;
  const s = await db();
  const { data } = await s
    .from("app_settings")
    .select("value")
    .eq("key", CONSULTANT_BOT_ENABLED_AT_KEY)
    .maybeSingle();
  if (data?.value) {
    const ts = Date.parse(data.value);
    if (Number.isFinite(ts)) {
      botEnabledAtCache = ts;
      return ts;
    }
  }
  return undefined;
}

export async function setConsultantBotGloballyEnabled(enabled: boolean): Promise<boolean> {
  const s = await db();
  const nowIso = new Date().toISOString();
  await s.from("app_settings").upsert({
    key: CONSULTANT_BOT_ENABLED_KEY,
    value: enabled ? "true" : "false",
    updated_at: nowIso,
  });
  if (enabled) {
    await s.from("app_settings").upsert({
      key: CONSULTANT_BOT_ENABLED_AT_KEY,
      value: nowIso,
      updated_at: nowIso,
    });
    botEnabledAtCache = Date.parse(nowIso);
  } else {
    botEnabledAtCache = null;
  }
  botEnabledCache = { at: Date.now(), enabled };
  return enabled;
}

