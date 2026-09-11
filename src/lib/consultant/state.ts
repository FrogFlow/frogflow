import type { Json } from "@/integrations-supabase/types";
import type { ConsultantCountry } from "./intent";

export type PauseReason = "manager_intervention" | "purchase" | "error" | "other";
export type ConsultantConversationState = "awaiting_country" | "consulting" | "handed_off";

export type ConsultantTurn = { role: "customer" | "assistant"; text: string };

export type ConsultantState = {
  country?: ConsultantCountry;
  automation_paused?: boolean;
  pause_reason?: PauseReason;
  conversation_state?: ConsultantConversationState;
  last_product_ids?: string[];
  last_bot_reply?: string;
  last_bot_reply_at?: string;
  recent?: ConsultantTurn[];
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

export function isAutomationPaused(state: ConsultantState): boolean {
  return state.automation_paused === true;
}

export function isBotEcho(state: ConsultantState, text: string): boolean {
  const reply = state.last_bot_reply?.trim();
  return Boolean(reply && reply === text.trim());
}
