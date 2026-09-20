import { findManagerMessage } from "./manager-guard";
import { loadConsultantState, pauseConsultant } from "./state";
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
      const ts = convo.updatedTime ? Date.parse(convo.updatedTime) : 0;
      if (ts && Date.now() - ts > 2 * 60 * 60 * 1000) continue;

      checked += 1;
      const messages = await listZernioConversationMessages(acc._id, convo.id);
      if (messages.length === 0) continue;
      const { data } = await s
        .from("bot_users")
        .select("user_key, state")
        .eq("zernio_conversation_id", convo.id)
        .maybeSingle();
      if (!data?.user_key) continue;
      const { consultant } = await loadConsultantState(data.user_key);
      // Ищем сообщение менеджера в хвосте переписки, а не только последнее:
      // ответил менеджер, следом написал покупатель — и прежняя проверка
      // проходила мимо, потому что последним оказывалось входящее.
      if (!findManagerMessage(messages, consultant)) continue;
      await pauseConsultant(data.user_key, "manager_intervention");
      paused += 1;
      logConsultantEvent(consultantRequestId(), "paused_poll", { userKey: data.user_key });
    }
  }
  return { checked, paused };
}
