import { supabaseAdmin } from "../integrations-supabase/client.server";
import { loadConsultantState, patchConsultantState, appendRecent, pauseConsultantByConversation, ConsultantState } from "./state";
import { askClaude } from "./claude";
import { executeConsultantTool } from "./tools";
import { COPY } from "./copy";

export interface ConsultantEvent {
  payload: any;
  conversationId: string;
  accountId: string;
  userKey: string;
  text?: string;
  platform: string;
  postback?: any;
}

export async function handleConsultantZernioEvent(event: ConsultantEvent): Promise<void> {
  if (!event.text) return; // Ignore non-text for now

  // Extract messageId from payload or generate one to deduplicate
  const messageId = event.payload?.message?.mid || event.payload?.message_id || `msg-${Date.now()}`;
  const botId = event.userKey.split(":")[0]; // Typically bot_id:platform_user_id

  // 1. Verify idempotency / deduplication
  const { data: existingRun } = await supabaseAdmin
    .from("consultant_message_runs")
    .select("id, status")
    .eq("bot_id", botId)
    .eq("message_id", messageId)
    .single();

  if (existingRun && existingRun.status !== 'received' && existingRun.status !== 'retryable_failed') {
    return; // Already processed
  }

  if (!existingRun) {
    await supabaseAdmin.from("consultant_message_runs").insert({
      bot_id: botId,
      message_id: messageId,
      conversation_id: event.conversationId,
      user_key: event.userKey,
      status: "processing",
      incoming_text: event.text
    });
  } else {
    await supabaseAdmin.from("consultant_message_runs").update({ status: "processing" }).eq("id", existingRun.id);
  }

  // 2. Load State
  const { consultant } = await loadConsultantState(event.userKey);
  
  // 3. Pause check
  if (consultant.automation_paused) {
    await updateRunStatus(botId, messageId, "cancelled");
    return;
  }

  // 4. Decide Reply
  try {
    const reply = await decideConsultantReply(event.text, consultant, { botId, conversationId: event.conversationId, userKey: event.userKey });
    
    // Check pause immediately before send
    const { consultant: latestState } = await loadConsultantState(event.userKey);
    if (latestState.automation_paused) {
      await updateRunStatus(botId, messageId, "cancelled");
      return;
    }

    // Update state with the interaction
    await patchConsultantState(event.userKey, {
      recent: appendRecent(latestState, event.text, reply.text)
    });

    // We rely on the caller or a dedicated sender to actually deliver the message to IG.
    // In BOVI architecture, zernio-bot typically sends it if we integrate back, or we send it here.
    // For now, update the run.
    await supabaseAdmin.from("consultant_message_runs").update({
      status: "replied",
      reply_text: reply.text,
      sent_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    }).eq("bot_id", botId).eq("message_id", messageId);
    
  } catch (error) {
    console.error("Consultant error:", error);
    await updateRunStatus(botId, messageId, "terminal_failed");
  }
}

async function updateRunStatus(botId: string, messageId: string, status: string) {
  await supabaseAdmin.from("consultant_message_runs").update({ status }).eq("bot_id", botId).eq("message_id", messageId);
}

export async function decideConsultantReply(text: string, state: ConsultantState, context: { botId: string, conversationId: string, userKey: string }): Promise<{ text: string }> {
  // Construct System Prompt
  const systemPrompt = `
You are the AI customer consultant for BOVI in Instagram Direct.
ROLE: Businesslike, concise, and factual. Address the customer formally ("Вы").
Do not use emotional sales clichés. Never invent product, stock, price, delivery, or currency information.
Use backend tools for factual data.

REGULATED TEXT:
- If they ask for delivery options in RU: "${COPY.cdekDelivery}"
- If they want the full catalog: "${COPY.fullCatalog}"
- Cross-sell phrase: "${COPY.crossSell}"

When the customer confirms a purchase or asks for a human, invoke handoff_to_manager tool.
`;

  // Get Claude API key from process.env or settings. 
  // Normally we would query bot settings, for now assume env var or placeholder.
  const apiKey = process.env.ANTHROPIC_API_KEY || "dummy_key";

  const messages = [...(state.recent || [])];
  messages.push({ role: "user", content: text });

  try {
    let aiResponse = await askClaude(systemPrompt, messages, apiKey);
    
    // Handle Tool calls
    if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
      const toolResults = [];
      let handoffTriggered = false;

      for (const call of aiResponse.toolCalls) {
        const result = await executeConsultantTool(context.botId, call.name, call.input);
        
        if (call.name === "handoff_to_manager") {
          handoffTriggered = true;
          // create task and pause
          await supabaseAdmin.from("consultant_handoffs").insert({
            bot_id: context.botId,
            user_key: context.userKey,
            conversation_id: context.conversationId,
            reason: call.input.reason || "other",
            customer_text: text
          });
          await pauseConsultantByConversation(context.conversationId, call.input.reason || "manager_request");
          
          if (call.input.reason === "purchase") return { text: COPY.purchaseConfirmed };
          if (call.input.reason === "out_of_stock") return { text: COPY.outOfStock };
          return { text: COPY.technicalFailure };
        }
        
        toolResults.push({ tool_use_id: call.id, content: JSON.stringify(result) });
      }

      if (handoffTriggered) {
        return { text: COPY.technicalFailure }; // Fallback if not caught above
      }

      // If there are tool results, we would normally send them back to Claude for the final answer.
      // This is a simplified single-turn logic for demonstration.
      messages.push({ role: "assistant", content: JSON.stringify(aiResponse.toolCalls) });
      messages.push({ role: "user", content: JSON.stringify(toolResults) });
      
      aiResponse = await askClaude(systemPrompt, messages, apiKey);
    }
    
    return { text: aiResponse.text || COPY.technicalFailure };

  } catch (err) {
    console.error("LLM Error:", err);
    await pauseConsultantByConversation(context.conversationId, "ai_error");
    return { text: COPY.technicalFailure };
  }
}
