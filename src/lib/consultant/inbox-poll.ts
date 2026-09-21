import { USER_KEY_PREFIX } from "@/lib/zernio-platform";
import { extractInstagramMediaInfo } from "@/lib/instagram-media";
import { looksLikeConsultantBotReply } from "./copy";
import { managerPauseExpired } from "./manager-guard";
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

const MAX_AGE_MS = 15 * 60 * 1000;
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
  botEnabledAt?: number;
  resumedAt?: string;
}): boolean {
  if (params.paused) return false;
  if (params.alreadyAnswered) return false;
  if (params.incomingLooksLikeBot) return false;

  const text = params.incomingText?.trim();
  if (!text) return false;

  const incomingTs = params.incomingAt ? Date.parse(params.incomingAt) : NaN;
  const outgoingTs = params.outgoingAt ? Date.parse(params.outgoingAt) : NaN;

  // Если последнее исходящее было отправлено ПОСЛЕ или ОДНОВРЕМЕННО с входящим,
  // значит на входящее уже ответили (менеджер или бот) — повторно не пишем!
  if (Number.isFinite(outgoingTs) && Number.isFinite(incomingTs) && outgoingTs >= incomingTs) {
    return false;
  }

  const now = params.now ?? Date.now();
  if (Number.isFinite(incomingTs) && now - incomingTs > MAX_AGE_MS) return false;
  if (params.resetAt && Number.isFinite(incomingTs) && incomingTs < params.resetAt) return false;

  // Если входящее сообщение пришло ДО того, как бота включили — не отвечаем
  if (params.botEnabledAt && Number.isFinite(incomingTs) && incomingTs < params.botEnabledAt) {
    return false;
  }

  // Если входящее сообщение пришло ДО или ВО ВРЕМЯ снятия пользователя с паузы — не отвечаем
  if (params.resumedAt && Number.isFinite(incomingTs)) {
    const resumedTs = Date.parse(params.resumedAt);
    if (Number.isFinite(resumedTs) && incomingTs <= resumedTs) {
      return false;
    }
  }

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
  const { isConsultantBotGloballyEnabled, getConsultantBotEnabledAt } = await import("./state");
  if (!(await isConsultantBotGloballyEnabled())) {
    return { checked: 0, replied: 0, skipped: 0 };
  }
  const botEnabledAt = await getConsultantBotEnabledAt();

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
        skipped += 1;
        continue;
      }
      if (
        consultant.automation_paused &&
        managerPauseExpired(lastOutgoing?.createdAt, await managerPauseWindow())
      ) {
        consultant = await resumeConsultant(userKey);
        skipped += 1;
        continue;
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
          botEnabledAt,
          resumedAt: consultant.resumed_at,
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
      const POLL_STORY_TYPES = new Set([
        "story_reply",
        "story_share",
        "story",
        "share",
        "reel",
        "ig_reel",
        "reels",
        "media_share",
        "video",
        "image",
      ]);
      for (const m of recentIncoming) {
        const rawM = m as any;
        if (!storyId) {
          const directId =
            rawM.story?.id ||
            rawM.reel?.id ||
            rawM.story_id ||
            rawM.reel_id ||
            rawM.reply_to?.story?.id ||
            rawM.reply_to?.reel?.id ||
            rawM.reply_to?.story_id ||
            rawM.reply_to?.reel_id;
          if (directId) storyId = String(directId);
        }
        if (!storyMediaUrl) {
          const directUrl =
            rawM.story?.url ||
            rawM.reel?.url ||
            rawM.reply_to?.story?.url ||
            rawM.reply_to?.reel?.url;
          if (directUrl) storyMediaUrl = String(directUrl);
        }

        const att = m.attachments?.find((a) => POLL_STORY_TYPES.has(String(a.type || "").toLowerCase()));
        if (att) {
          const p = ((att as any).payload ?? {}) as Record<string, any>;
          const candidateUrl =
            att.url ||
            p.url ||
            p.story?.url ||
            p.reel?.url ||
            p.share?.url;
          if (!storyMediaUrl && candidateUrl) storyMediaUrl = candidateUrl;
          const candidateId =
            p.story?.id ||
            p.reel?.id ||
            p.share?.id ||
            p.reel_id ||
            p.story_id ||
            p.id ||
            p.media_id ||
            att.id;
          if (!storyId && candidateId) storyId = String(candidateId);
          if (!storyId && storyMediaUrl) {
            const info = extractInstagramMediaInfo(storyMediaUrl);
            if (info.shortcode) storyId = info.shortcode;
          }
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
/**
 * Окно паузы на один проход опроса. Читать настройку на каждый диалог — лишний
 * запрос к базе на каждой итерации цикла, а за минуту она не меняется.
 */
let pauseWindowCache: { at: number; ms: number } | null = null;
const PAUSE_WINDOW_TTL_MS = 60_000;

async function managerPauseWindow(): Promise<number> {
  if (pauseWindowCache && Date.now() - pauseWindowCache.at < PAUSE_WINDOW_TTL_MS) {
    return pauseWindowCache.ms;
  }
  const { loadManagerPauseMs } = await import("./manager-guard");
  const ms = await loadManagerPauseMs();
  pauseWindowCache = { at: Date.now(), ms };
  return ms;
}

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
