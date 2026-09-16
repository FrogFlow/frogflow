import type { ZernioPlatform } from "@/lib/zernio-platform";
import type { ZernioWebhookMessagePayload } from "@/lib/zernio.server";
import { sendZernioInboxMessage } from "@/lib/zernio.server";
import type { ResolvedTenant } from "@/lib/tenant-router.server";
import { resolvePresetProfile, type UniversalBusinessProfile } from "./profile";
import { getPresetKnowledgeDocs, retrieveKnowledge, type KnowledgeDocument } from "./knowledge";
import { runUniversalConsultantClaude, type UniversalTurn } from "./claude";
import { logger } from "@/lib/logger.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

export type UniversalConsultantEventParams = {
  payload: ZernioWebhookMessagePayload;
  conversationId: string;
  accountId: string;
  userKey: string;
  text: string;
  platform: ZernioPlatform;
  postback?: string | null;
  storyId?: string | null;
  storyMediaUrl?: string | null;
  tenant: ResolvedTenant;
};

export type UniversalConsultantState = {
  automation_paused?: boolean;
  recent?: UniversalTurn[];
  last_reply_at?: string;
  customer_contact?: string;
};

/**
 * Чтение состояния диалога из bot_users.state
 */
export async function loadUniversalState(userKey: string): Promise<{
  raw: Record<string, any>;
  state: UniversalConsultantState;
}> {
  try {
    const s = await db();
    const { data } = await s
      .from("bot_users")
      .select("state")
      .eq("user_key", userKey)
      .maybeSingle();

    const raw = data?.state && typeof data.state === "object" && !Array.isArray(data.state)
      ? (data.state as Record<string, any>)
      : {};
    const state = (raw["consultant_universal"] || {}) as UniversalConsultantState;
    return { raw, state };
  } catch (e) {
    logger.warn("universal_consultant.load_state_failed", { error: String(e) });
    return { raw: {}, state: {} };
  }
}

/**
 * Запись состояния диалога в bot_users.state
 */
export async function saveUniversalState(
  userKey: string,
  raw: Record<string, any>,
  patch: Partial<UniversalConsultantState>,
): Promise<void> {
  try {
    const nextState = { ...(raw["consultant_universal"] || {}), ...patch };
    const s = await db();
    await s
      .from("bot_users")
      .update({
        state: { ...raw, consultant_universal: nextState },
        updated_at: new Date().toISOString(),
      })
      .eq("user_key", userKey);
  } catch (e) {
    logger.warn("universal_consultant.save_state_failed", { error: String(e) });
  }
}

/**
 * Загрузка кастомного профиля и базы знаний из базы или возврат пресета
 */
export async function loadProfileAndKnowledge(tenant: ResolvedTenant): Promise<{
  profile: UniversalBusinessProfile;
  knowledgeDocs: KnowledgeDocument[];
}> {
  try {
    const s = await db();
    const { data: rows } = await s
      .from("app_settings")
      .select("key, value")
      .eq("bot_id", tenant.bot_id)
      .in("key", ["consultant_profile", "consultant_knowledge"]);

    let customProfile: UniversalBusinessProfile | null = null;
    let customDocs: KnowledgeDocument[] | null = null;

    for (const r of rows || []) {
      if (r.key === "consultant_profile" && r.value) {
        try {
          customProfile = JSON.parse(r.value);
        } catch {}
      }
      if (r.key === "consultant_knowledge" && r.value) {
        try {
          customDocs = JSON.parse(r.value);
        } catch {}
      }
    }

    const profile = customProfile || resolvePresetProfile(tenant.niche, tenant.bot_id);
    const knowledgeDocs = customDocs && customDocs.length > 0
      ? customDocs
      : getPresetKnowledgeDocs(profile.niche);

    return { profile, knowledgeDocs };
  } catch {
    const profile = resolvePresetProfile(tenant.niche, tenant.bot_id);
    return { profile, knowledgeDocs: getPresetKnowledgeDocs(profile.niche) };
  }
}

/**
 * Отправка уведомления владельцу магазина / менеджеру в Telegram
 */
async function notifyManager(params: {
  tenant: ResolvedTenant;
  reason: string;
  summary: string;
  customerName?: string;
  customerContact?: string;
  userKey: string;
}) {
  try {
    const s = await db();
    const { data: adminSetting } = await s
      .from("app_settings")
      .select("value")
      .eq("bot_id", params.tenant.bot_id)
      .eq("key", "admin_chat_id")
      .maybeSingle();

    const adminChatId = adminSetting?.value?.trim();
    if (!adminChatId) return;

    const { tg } = await import("@/lib/telegram.server");
    const lines = [
      `🔔 <b>Новая заявка / перевод диалога</b>`,
      `Бизнес: <b>${params.tenant.bot_id}</b>`,
      `Причина: ${params.reason}`,
      ``,
      params.customerName ? `👤 Клиент: ${params.customerName}` : "",
      params.customerContact ? `📞 Контакт: <b>${params.customerContact}</b>` : "",
      `📝 Суть: ${params.summary}`,
    ].filter(Boolean);

    await tg("sendMessage", {
      chat_id: adminChatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.warn("universal_consultant.notify_manager_failed", { error: String(err) });
  }
}

/**
 * Главный обработчик входящего сообщения для Универсального Консультанта
 */
export async function handleUniversalConsultantEvent(
  params: UniversalConsultantEventParams,
): Promise<{ ok: boolean; replyText?: string }> {
  const { conversationId, accountId, userKey, platform, tenant } = params;
  const incomingText = (params.text || params.postback || "").trim();

  if (!incomingText && !params.storyMediaUrl) {
    return { ok: true };
  }

  // 1. Загрузка состояния диалога
  const { raw, state } = await loadUniversalState(userKey);

  // Сброс диалога для повторного тестирования
  const isReset =
    /^(?:\/reset|\/start|reset|restart|заново|сброс|нач(?:ни|ать)\s+(?:заново|сначала)|сбрось|сбросить|очистить|забудь(?:те)?\s+меня)(?:[.!?…\s]|$)/i.test(
      incomingText,
    );
  if (isReset) {
    const { profile } = await loadProfileAndKnowledge(tenant);
    await saveUniversalState(userKey, raw, {
      automation_paused: false,
      recent: [],
      last_reply_at: new Date().toISOString(),
      customer_contact: undefined,
    });
    const welcome = `Здравствуйте! Рады приветствовать вас в «${profile.brand_name}». Чем могу помочь вам сегодня?`;
    await sendZernioInboxMessage(conversationId, accountId, welcome, { platform });
    return { ok: true, replyText: welcome };
  }

  // Если автоматизация на паузе (менеджер перехватил диалог)
  if (state.automation_paused) {
    logger.info("universal_consultant.paused_manager_in_charge", { userKey });
    return { ok: true };
  }

  // 2. Загрузка профиля и документов компании
  const { profile, knowledgeDocs } = await loadProfileAndKnowledge(tenant);

  // 3. Семантический отбор подходящих документов под запрос
  const relevantDocs = retrieveKnowledge(incomingText, knowledgeDocs, 3);

  // 4. Формирование контекста сессии
  const sessionInfo = [
    `Платформа: ${platform}`,
    `Тенант / Магазин: ${tenant.bot_id}`,
    profile.countries?.length ? `Страны: ${profile.countries.join(", ")}` : "",
    profile.currency ? `Валюта: ${profile.currency}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 5. Вызов Claude с защитой от галлюцинаций и белыми перчатками
  const result = await runUniversalConsultantClaude({
    profile,
    text: incomingText,
    recentHistory: state.recent || [],
    knowledgeDocs: relevantDocs,
    sessionContext: sessionInfo,
  });

  const replyText = result.text.trim();
  if (!replyText) {
    return { ok: true };
  }

  // 6. Отправка ответа клиенту в Direct / мессенджер
  await sendZernioInboxMessage(conversationId, accountId, replyText, {
    platform,
  });

  // 7. Обновление истории диалога
  const nextRecent: UniversalTurn[] = [
    ...(state.recent || []),
    { role: "customer" as const, text: incomingText.slice(0, 400) },
    { role: "assistant" as const, text: replyText.slice(0, 600) },
  ].slice(-20);

  const statePatch: Partial<UniversalConsultantState> = {
    recent: nextRecent,
    last_reply_at: new Date().toISOString(),
  };

  // 8. Если был handoff или фиксация лида — оповещаем менеджера
  if (result.handoff && result.handoffData) {
    statePatch.automation_paused = true;
    if (result.handoffData.customer_contact) {
      statePatch.customer_contact = result.handoffData.customer_contact;
    }
    await notifyManager({
      tenant,
      reason: result.handoffData.reason,
      summary: result.handoffData.summary || result.handoffData.details || incomingText,
      customerName: result.handoffData.customer_name,
      customerContact: result.handoffData.customer_contact,
      userKey,
    });
  }

  await saveUniversalState(userKey, raw, statePatch);

  return { ok: true, replyText };
}
