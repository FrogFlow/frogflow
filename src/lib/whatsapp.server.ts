/**
 * WhatsApp: шаблоны Meta и отправка вне 24-часового окна.
 *
 * Всё, что здесь есть, существует из-за одного правила Meta: свободный текст
 * покупателю можно слать только 24 часа с его последнего сообщения. Внутри
 * окна WhatsApp ничем не отличается от Instagram Direct и обслуживается общим
 * кодом (`zernio-bot.server.ts`). Этот модуль — про то, что делать, когда окно
 * закрылось, а сказать надо: заказ подтверждён, материалы готовы, оплата не
 * дошла.
 *
 * Разговор с покупателем на этом не заканчивается: как только он ответит на
 * шаблон, окно открывается снова и дальше всё идёт обычным путём.
 */
import type { Json } from "@/integrations-supabase/types";
import {
  listWhatsAppTemplates,
  startWhatsAppConversation,
  type WhatsAppTemplate,
} from "./zernio.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function botId(): string {
  const id = process.env.BOT_ID?.trim();
  if (!id) throw new Error("BOT_ID environment variable is not configured");
  return id;
}

/**
 * Событие `whatsapp.template.status_updated` — вердикт ревью Meta.
 *
 * Приходит само, опрашивать список шаблонов ради него не надо: ревью идёт до
 * суток, и опрос означал бы либо задержку, либо холостые запросы.
 */
export type WhatsAppTemplateStatusPayload = {
  event?: string;
  account?: { accountId?: string; id?: string };
  template?: { name?: string; language?: string; status?: string; reason?: string };
  data?: { name?: string; language?: string; status?: string; reason?: string };
};

export async function handleWhatsAppTemplateStatus(
  payload: WhatsAppTemplateStatusPayload,
): Promise<void> {
  // Zernio кладёт шаблон то в `template`, то в `data` — принимаем оба.
  const template = payload.template ?? payload.data ?? {};
  const accountId = payload.account?.accountId || payload.account?.id;
  const name = template.name;
  const language = template.language;

  if (!accountId || !name || !language) {
    console.warn("[whatsapp] вердикт по шаблону без accountId/name/language — пропущен");
    return;
  }

  const s = await db();
  /**
   * Обновляем только существующую запись, а не upsert'им.
   *
   * Шаблон мог быть заведён прямо в WhatsApp Manager, минуя нашу панель, — у
   * такого шаблона нет ни категории, ни компонентов, и придумывать их, чтобы
   * заполнить NOT NULL колонки, значило бы записать в базу выдумку. Такие
   * шаблоны подтянет `syncWhatsAppTemplates` из списка Meta, где они лежат
   * целиком.
   */
  const { data: updated } = await s
    .from("whatsapp_templates")
    .update({
      status: template.status ?? "PENDING",
      // Meta присылает "NONE" при одобрении — это не причина, а её отсутствие.
      reason: template.reason && template.reason !== "NONE" ? template.reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq("bot_id", botId())
    .eq("account_id", accountId)
    .eq("name", name)
    .eq("language", language)
    .select("id");

  if (!updated?.length) {
    // Запись не наша или заведена мимо панели — подтянем её целиком из Meta.
    await syncWhatsAppTemplates(accountId);
  }
}

/**
 * Привести локальный список шаблонов в соответствие с Meta.
 *
 * Источник истины — Meta; здесь мы только держим копию, чтобы показать
 * продавцу статус, не дёргая Zernio на каждый рендер вкладки.
 */
export async function syncWhatsAppTemplates(accountId: string): Promise<WhatsAppTemplate[]> {
  const templates = await listWhatsAppTemplates(accountId);
  if (!templates.length) return [];

  const s = await db();
  const now = new Date().toISOString();
  const rows = templates.map((template) => ({
    bot_id: botId(),
    account_id: accountId,
    name: template.name,
    language: template.language,
    category: template.category ?? "UTILITY",
    status: String(template.status ?? "PENDING"),
    reason: template.reason && template.reason !== "NONE" ? template.reason : null,
    components: (template.components ?? []) as Json,
    updated_at: now,
  }));

  const { error } = await s
    .from("whatsapp_templates")
    .upsert(rows, { onConflict: "bot_id,account_id,name,language" });
  if (error) console.error("[whatsapp] не удалось сохранить шаблоны", error);

  return templates;
}

/** Одобренные шаблоны — единственные, которыми Meta разрешает отправку. */
export async function listApprovedTemplates(accountId: string) {
  const s = await db();
  const { data } = await s
    .from("whatsapp_templates")
    .select("name, language, category, components")
    .eq("bot_id", botId())
    .eq("account_id", accountId)
    .eq("status", "APPROVED")
    .order("name", { ascending: true });
  return data ?? [];
}

/**
 * Написать покупателю, когда 24-часовое окно уже могло закрыться.
 *
 * Порядок попыток выбран так, чтобы не тратить деньги клиента зря и при этом
 * не потерять сообщение:
 *
 *  1. Обычная отправка в существующий диалог. Внутри окна она бесплатна, а
 *     окно открыто в подавляющем большинстве случаев — покупатель только что
 *     переписывался с ботом.
 *  2. Шаблон, если он передан и одобрен. Работает всегда, но платный.
 *  3. Direct Send (`category: "utility"`) — служебное сообщение без заранее
 *     одобренного шаблона. Доступен не каждому WABA, поэтому идёт последним:
 *     это попытка, а не гарантия.
 *
 * Возвращает false, если не прошло ничего. Вызывающий код обязан это
 * учитывать: для покупателя молчание после оплаты выглядит как потерянный
 * заказ, поэтому такие случаи надо показывать продавцу, а не глотать.
 */
export async function sendWhatsAppOutsideWindow(params: {
  accountId: string;
  conversationId?: string | null;
  /** Телефон получателя — нужен, когда диалога ещё нет. */
  phone?: string | null;
  text: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const { sendZernioInboxMessage } = await import("./zernio.server");

  if (params.conversationId) {
    const direct = await sendZernioInboxMessage(
      params.conversationId,
      params.accountId,
      params.text,
      { platform: "whatsapp" },
    );
    if (direct.ok) return { ok: true };
  }

  if (!params.phone) {
    return {
      ok: false,
      error: "Окно ответа закрыто, а номера покупателя нет — написать первым не получится.",
    };
  }

  if (params.templateName) {
    const viaTemplate = await startWhatsAppConversation({
      accountId: params.accountId,
      phone: params.phone,
      templateName: params.templateName,
      templateLanguage: params.templateLanguage,
      templateParams: params.templateParams,
    });
    if (viaTemplate.ok) return { ok: true };
  }

  const viaUtility = await startWhatsAppConversation({
    accountId: params.accountId,
    phone: params.phone,
    message: params.text,
  });
  return viaUtility.ok ? { ok: true } : { ok: false, error: viaUtility.error };
}
