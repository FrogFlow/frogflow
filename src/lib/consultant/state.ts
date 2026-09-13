import { supabaseAdmin } from "../integrations-supabase/client.server";

export interface ConsultantState {
  automation_paused: boolean;
  pause_reason?: string | null;
  conversation_state: string;
  country?: "KZ" | "RU" | null;
  last_product_context?: any;
  last_currency_rate?: number;
  last_currency_update?: string;
  recent: Array<{ role: "user" | "assistant", content: string }>;
}

const DEFAULT_STATE: ConsultantState = {
  automation_paused: false,
  conversation_state: "start",
  recent: []
};

/**
 * Loads the current consultant state from the bot_users table.
 */
export async function loadConsultantState(userKey: string): Promise<{ consultant: ConsultantState, dbState: any }> {
  const { data, error } = await supabaseAdmin
    .from("bot_users")
    .select("state")
    .eq("user_key", userKey)
    .single();

  if (error || !data) {
    return { consultant: DEFAULT_STATE, dbState: {} };
  }

  const state = data.state as Record<string, any> || {};
  const consultantState = state.consultant as ConsultantState | undefined;

  return {
    consultant: consultantState ? { ...DEFAULT_STATE, ...consultantState } : DEFAULT_STATE,
    dbState: state
  };
}

/**
 * Updates the consultant state in the bot_users table.
 */
export async function patchConsultantState(userKey: string, partial: Partial<ConsultantState>): Promise<void> {
  const { dbState, consultant } = await loadConsultantState(userKey);
  const updatedConsultant = { ...consultant, ...partial };
  const updatedDbState = { ...dbState, consultant: updatedConsultant };

  await supabaseAdmin
    .from("bot_users")
    .update({ state: updatedDbState })
    .eq("user_key", userKey);
}

/**
 * Appends a recent conversation turn and truncates the history to save tokens.
 */
export function appendRecent(state: ConsultantState, userText: string, botText?: string): ConsultantState["recent"] {
  const newRecent = [...(state.recent || [])];
  
  if (userText) {
    newRecent.push({ role: "user", content: userText });
  }
  
  if (botText) {
    newRecent.push({ role: "assistant", content: botText });
  }
  
  // Keep only the last 10 turns to avoid blowing up context
  if (newRecent.length > 10) {
    return newRecent.slice(newRecent.length - 10);
  }
  
  return newRecent;
}

/**
 * Pauses automation by setting flags in the state.
 */
export async function pauseConsultantByConversation(conversationId: string, reason: string): Promise<void> {
  // Find the user_key for this conversation via consultant_message_runs or we could just 
  // lookup the bot_user by user_key if conversationId is tied to it.
  // In the current architecture, bot.server.ts passes userKey everywhere.
  // Wait, the hook `pauseConsultantByConversation` in instagram.functions.ts receives `conversationId`.
  // Let's resolve conversationId to user_key.
  
  const { data } = await supabaseAdmin
    .from("consultant_message_runs")
    .select("user_key")
    .eq("conversation_id", conversationId)
    .limit(1)
    .single();
    
  if (data?.user_key) {
    await patchConsultantState(data.user_key, {
      automation_paused: true,
      pause_reason: reason
    });
  }
}

/**
 * Resumes automation by clearing the pause flags.
 */
export async function resumeConsultantByConversation(conversationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("consultant_message_runs")
    .select("user_key")
    .eq("conversation_id", conversationId)
    .limit(1)
    .single();
    
  if (data?.user_key) {
    await patchConsultantState(data.user_key, {
      automation_paused: false,
      pause_reason: null
    });
    return true;
  }
  
  return false;
}
