import { looksLikeConsultantBotReply } from "./copy";
import { isBotEcho, loadConsultantState, pauseConsultant } from "./state";
import { logConsultantEvent, consultantRequestId } from "./log";

/** Запасной детектор исходящего менеджера, если webhook не прислал outgoing. */
export async function pollOutgoingManagerMessages(): Promise<{ checked: number; paused: number }> {
  const { listZernioConversations, listZernioConversationMessages, listZernioAccounts } =
    await import("@/lib/zernio.server");
  const s = await (await import("@/integrations-supabase/client.server")).supabaseAdmin;
  const accounts = await listZernioAccounts().catch(() => []);
  const instagram = accounts.filter((a) => (a.platform || "instagram") === "instagram");
  let checked = 0;
  let paused = 0;
  for (const acc of instagram.slice(0, 2)) {
    const convos = await listZernioConversations(acc._id, "instagram");
    for (const convo of convos.slice(0, 15)) {
      checked += 1;
      const messages = await listZernioConversationMessages(acc._id, convo.id);
      const last = [...messages].reverse().find((m) => m.message?.trim());
      if (!last || last.direction !== "outgoing") continue;
      const { data } = await s
        .from("bot_users")
        .select("user_key, state")
        .eq("zernio_conversation_id", convo.id)
        .maybeSingle();
      if (!data?.user_key) continue;
      const { consultant } = await loadConsultantState(data.user_key);
      if (consultant.automation_paused) continue;
      if (isBotEcho(consultant, last.message || "")) continue;
      if (looksLikeConsultantBotReply(last.message || "")) continue;
      await pauseConsultant(data.user_key, "manager_intervention");
      paused += 1;
      logConsultantEvent(consultantRequestId(), "paused_poll", { userKey: data.user_key });
    }
  }
  return { checked, paused };
}
