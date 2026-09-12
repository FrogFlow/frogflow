import type { Json } from "@/integrations-supabase/types";
import { looksLikeConsultantBotReply } from "./copy";
import { isConsultantGreeting, type ConsultantCountry } from "./intent";

export type PauseReason = "manager_intervention" | "purchase" | "error" | "other";
export type ConsultantConversationState =
  "awaiting_country" | "awaiting_product" | "consulting" | "handed_off";

export type ConsultantTurn = { role: "customer" | "assistant"; text: string };

export type ConsultantState = {
  country?: ConsultantCountry;
  automation_paused?: boolean;
  pause_reason?: PauseReason;
  conversation_state?: ConsultantConversationState;
  last_product_ids?: string[];
  last_bot_reply?: string;
  last_bot_reply_at?: string;
  last_customer_text?: string;
  last_claim_at?: string;
  recent?: ConsultantTurn[];
  ru_cdek_sent?: boolean;
  ab_bucket?: "a" | "b";
};

const RECENT_LIMIT = 8;

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
  const next: ConsultantState = {
    ...consultant,
    automation_paused: false,
    conversation_state: consultant.country ? "consulting" : "awaiting_country",
  };
  delete next.pause_reason;
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

function foldReply(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isBotEcho(state: ConsultantState, text: string): boolean {
  const reply = foldReply(state.last_bot_reply ?? "");
  const incoming = foldReply(text);
  if (!reply || !incoming) return false;
  if (reply === incoming) return true;
  return (
    incoming.length >= 24 &&
    (incoming.startsWith(reply.slice(0, 24)) || reply.startsWith(incoming.slice(0, 24)))
  );
}

/** Пауза «менеджер» после нашей же карточки — бот тогда молчит навсегда. */
export function isFalseManagerPause(state: ConsultantState, lastOutgoingText?: string): boolean {
  if (!isAutomationPaused(state)) return false;
  if (state.pause_reason && state.pause_reason !== "manager_intervention") return false;
  return Boolean(lastOutgoingText && looksLikeConsultantBotReply(lastOutgoingText));
}

const IN_FLIGHT_MS = 15_000;
const REPLY_TTL_MS = 3 * 60_000;

export type IncomingSource = "webhook" | "poll";

/** Webhook и inbox-poll не должны отвечать на одно и то же входящее дважды. */
export function alreadyAnsweredIncoming(
  state: ConsultantState,
  text: string,
  now = Date.now(),
  source: IncomingSource = "poll",
): boolean {
  const incoming = text.trim();
  if (!incoming || incoming !== (state.last_customer_text ?? "").trim()) return false;
  const claimed = Date.parse(state.last_claim_at ?? "");
  const replied = Date.parse(state.last_bot_reply_at ?? "");
  const inFlight =
    Number.isFinite(claimed) &&
    now - claimed < IN_FLIGHT_MS &&
    (!Number.isFinite(replied) || replied < claimed);
  if (inFlight) return true;
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
          updatedAt: row.updated_at,
        },
      ];
    })
    .slice(0, limit);
}
