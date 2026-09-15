import { USER_KEY_PREFIX } from "@/lib/zernio-platform";
import { looksLikeConsultantBotReply } from "./copy";
import { handleConsultantZernioEvent } from "./handle-message";
import {
  alreadyAnsweredIncoming,
  findUserKeyByConversation,
  isAutomationPaused,
  isFalseManagerPause,
  loadConsultantState,
  recentlyReplied,
  resumeConsultant,
  type ConsultantState,
} from "./state";
import { logConsultantEvent, consultantRequestId } from "./log";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CONVOS = 12;

export function shouldAnswerLastIncoming(params: {
  incomingAt?: string;
  outgoingAt?: string;
  incomingText?: string;
  paused: boolean;
  now?: number;
  lastDirection?: "incoming" | "outgoing";
  alreadyAnswered?: boolean;
  recentlyReplied?: boolean;
  incomingLooksLikeBot?: boolean;
  sameAsLastAnswered?: boolean;
  resetAt?: number;
}): boolean {
  if (params.paused) return false;
  if (params.alreadyAnswered) return false;
  if (params.incomingLooksLikeBot) return false;
  // Не глушить follow-up вроде «А одеяла?» из‑за недавней карточки
  // или того, что в Inbox последнее видимое ещё исходящее.
  const text = params.incomingText?.trim();
  if (!text) return false;
  const now = params.now ?? Date.now();
  const incomingTs = params.incomingAt ? Date.parse(params.incomingAt) : NaN;
  if (Number.isFinite(incomingTs) && now - incomingTs > MAX_AGE_MS) return false;
  if (params.resetAt && Number.isFinite(incomingTs) && incomingTs < params.resetAt) return false;
  return true;
}

/**
 * Если webhook Zernio не доставил message.received, консультант молчит,
 * хотя диалог уже есть в Inbox. Добираем последние входящие без ответа.
 */
export async function pollIncomingConsultantMessages(): Promise<{
  checked: number;
  replied: number;
  skipped: number;
}> {
  const { isConsultantBotGloballyEnabled } = await import("./state");
  if (!(await isConsultantBotGloballyEnabled())) {
    return { checked: 0, replied: 0, skipped: 0 };
  }

  const { listZernioAccounts, listZernioConversations, listZernioConversationMessages } =
    await import("@/lib/zernio.server");
  const { upsertZernioUser } = await import("@/lib/zernio-bot.server");
  const accounts = (await listZernioAccounts().catch(() => [])).filter(
    (a) => (a.platform || "instagram") === "instagram",
  );
  let checked = 0;
  let replied = 0;
  let skipped = 0;
  const db = await import("@/integrations-supabase/client.server").then(m => m.supabaseAdmin);
  const resetRow = await db.from("app_settings").select("value").eq("key", "consultant_reset_at").maybeSingle();
  const resetAt = resetRow.data?.value ? Date.parse(resetRow.data.value) : undefined;
  const requestId = consultantRequestId();

  for (const acc of accounts.slice(0, 2)) {
    const convos = await listZernioConversations(acc._id, "instagram");
    const recent = convos
      .filter((c) => {
        const unread = (c.unreadCount ?? 0) > 0;
        const ts = c.updatedTime ? Date.parse(c.updatedTime) : 0;
        return unread || (Number.isFinite(ts) && Date.now() - ts < 2 * 60 * 60 * 1000);
      })
      .slice(0, MAX_CONVOS);

    for (const convo of recent) {
      checked += 1;

      // Prevent 429: Short-circuit if the last message is already known and we are not paused
      const senderId = convo.participantId || convo.participantUsername || convo.id;
      const userKey =
        (await findUserKeyByConversation(convo.id).catch(() => null)) ||
        `${USER_KEY_PREFIX.instagram}${senderId}`;
      let { consultant } = await loadConsultantState(userKey).catch(() => ({
        consultant: {} as ConsultantState,
      }));

      const lastMsgStr = convo.lastMessage?.trim();
      const knownLastMsg =
        lastMsgStr &&
        (lastMsgStr === (consultant.last_customer_text ?? "").trim() ||
         lastMsgStr === (consultant.last_bot_reply ?? "").trim());

      if (knownLastMsg && !consultant.automation_paused) {
        skipped += 1;
        continue;
      }

      // Add a tiny delay to avoid Zernio 429s when fetching many conversations
      await new Promise(r => setTimeout(r, 200));

      const messages = await listZernioConversationMessages(acc._id, convo.id);
      const lastIncoming = [...messages]
        .reverse()
        .find((m) => m.direction === "incoming" && m.message?.trim());
      const lastOutgoing = [...messages]
        .reverse()
        .find((m) => m.direction === "outgoing" && m.message?.trim());
      const lastText = [...messages].reverse().find((m) => m.message?.trim());
      if (isFalseManagerPause(consultant, lastOutgoing?.message)) {
        consultant = await resumeConsultant(userKey);
      }
      const outgoingTs = lastOutgoing?.createdAt ? Date.parse(lastOutgoing.createdAt) : 0;
      if (consultant.automation_paused && outgoingTs > 0 && Date.now() - outgoingTs > 12 * 60 * 60 * 1000) {
        consultant = await resumeConsultant(userKey);
      }
      const incomingText = lastIncoming?.message?.trim() ?? "";
      const sameAsLastAnswered =
        Boolean(incomingText) && incomingText === (consultant.last_customer_text ?? "").trim();
      if (
        !shouldAnswerLastIncoming({
          incomingAt: lastIncoming?.createdAt,
          outgoingAt: lastOutgoing?.createdAt,
          incomingText: lastIncoming?.message,
          paused: isAutomationPaused(consultant),
          lastDirection: lastText?.direction,
          alreadyAnswered: alreadyAnsweredIncoming(consultant, incomingText, Date.now(), "poll"),
          recentlyReplied: recentlyReplied(consultant),
          incomingLooksLikeBot: looksLikeConsultantBotReply(lastIncoming?.message ?? ""),
          sameAsLastAnswered,
          resetAt,
        })
      ) {
        skipped += 1;
        continue;
      }

      await upsertZernioUser(
        userKey,
        convo.id,
        acc._id,
        convo.participantUsername,
        convo.participantName,
        {},
        "instagram",
      );
      let storyMediaUrl: string | undefined;
      let storyId: string | undefined;
      const recentIncoming = [...messages].reverse().filter(m => m.direction === "incoming").slice(0, 3);
      for (const m of recentIncoming) {
        const att = m.attachments?.find(
          (a) => a.type === "story_reply" || a.type === "story_share" || a.type === "story" || a.type === "image"
        );
        if (att?.url) {
          storyMediaUrl = att.url;
          storyId = att.id; // Try to use the attachment ID as the story_id
          break;
        }
      }

      await handleConsultantZernioEvent({
        payload: {
          event: "message.received",
          message: {
            direction: "incoming",
            text: lastIncoming!.message,
            conversationId: convo.id,
          },
          conversation: { id: convo.id },
          account: { accountId: acc._id, platform: "instagram" },
        },
        conversationId: convo.id,
        accountId: acc._id,
        userKey,
        text: lastIncoming!.message!.trim(),
        platform: "instagram",
        source: "poll",
        storyMediaUrl,
        storyId,
      });
      replied += 1;
    }
  }

  logConsultantEvent(requestId, "inbox_poll", { checked, replied, skipped });
  return { checked, replied, skipped };
}

const BURST_MS = 50_000;
const BURST_GAP_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Vercel cron не чаще раза в минуту. Если webhook молчит, без этого
 * «здравствуйте» ждёт весь тик. Крутим Inbox до конца слота функции.
 */
export async function pollIncomingConsultantBurst(maxMs = BURST_MS): Promise<{
  rounds: number;
  checked: number;
  replied: number;
  skipped: number;
}> {
  const started = Date.now();
  let rounds = 0;
  let checked = 0;
  let replied = 0;
  let skipped = 0;
  const db = await import("@/integrations-supabase/client.server").then(m => m.supabaseAdmin);
  const resetRow = await db.from("app_settings").select("value").eq("key", "consultant_reset_at").maybeSingle();
  const resetAt = resetRow.data?.value ? Date.parse(resetRow.data.value) : undefined;
  while (Date.now() - started < maxMs) {
    const once = await pollIncomingConsultantMessages();
    rounds += 1;
    checked += once.checked;
    replied += once.replied;
    skipped += once.skipped;
    const left = maxMs - (Date.now() - started);
    if (left < BURST_GAP_MS) break;
    await sleep(BURST_GAP_MS);
  }
  return { rounds, checked, replied, skipped };
}
