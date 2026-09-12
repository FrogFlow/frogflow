import { USER_KEY_PREFIX } from "@/lib/zernio-platform";
import { handleConsultantZernioEvent } from "./handle-message";
import { isAutomationPaused, loadConsultantState } from "./state";
import { logConsultantEvent, consultantRequestId } from "./log";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CONVOS = 12;

export function shouldAnswerLastIncoming(params: {
  incomingAt?: string;
  outgoingAt?: string;
  incomingText?: string;
  paused: boolean;
  now?: number;
}): boolean {
  if (params.paused) return false;
  const text = params.incomingText?.trim();
  if (!text) return false;
  const now = params.now ?? Date.now();
  const incomingTs = params.incomingAt ? Date.parse(params.incomingAt) : NaN;
  if (Number.isFinite(incomingTs) && now - incomingTs > MAX_AGE_MS) return false;
  const outgoingTs = params.outgoingAt ? Date.parse(params.outgoingAt) : NaN;
  if (Number.isFinite(outgoingTs) && Number.isFinite(incomingTs) && outgoingTs >= incomingTs) {
    return false;
  }
  if (Number.isFinite(outgoingTs) && !Number.isFinite(incomingTs)) return false;
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
  const { listZernioAccounts, listZernioConversations, listZernioConversationMessages } =
    await import("@/lib/zernio.server");
  const { upsertZernioUser } = await import("@/lib/zernio-bot.server");
  const accounts = (await listZernioAccounts().catch(() => [])).filter(
    (a) => (a.platform || "instagram") === "instagram",
  );
  let checked = 0;
  let replied = 0;
  let skipped = 0;
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
      const messages = await listZernioConversationMessages(acc._id, convo.id);
      const lastIncoming = [...messages]
        .reverse()
        .find((m) => m.direction === "incoming" && m.message?.trim());
      const lastOutgoing = [...messages]
        .reverse()
        .find((m) => m.direction === "outgoing" && m.message?.trim());
      const senderId = convo.participantId || convo.participantUsername || convo.id;
      const userKey = `${USER_KEY_PREFIX.instagram}${senderId}`;
      const { consultant } = await loadConsultantState(userKey).catch(() => ({
        consultant: {},
      }));
      if (
        !shouldAnswerLastIncoming({
          incomingAt: lastIncoming?.createdAt,
          outgoingAt: lastOutgoing?.createdAt,
          incomingText: lastIncoming?.message,
          paused: isAutomationPaused(consultant),
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
