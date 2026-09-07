/**
 * Отправка первого/повторного сообщения лиду из WhatsApp Business и
 * Instagram Business FrogFlow через Zernio.
 *
 * Не путать с магазином клиента: ключ на панели должен быть своим. Если в
 * рабочей области уже висит `/api/public/zernio/webhook`, это чужой WABA —
 * отправку блокируем, store-webhook не трогаем.
 */
import { errorMessage } from "@/lib/error-message";
import {
  instagramHref,
  pickZernioAccount,
  whatsappHref,
  type OutreachChannel,
} from "./leads-pipeline";

export type OutreachSendResult = {
  ok: boolean;
  channel: OutreachChannel;
  conversationId?: string;
  accountId?: string;
  error?: string;
  fallbackHref?: string | null;
};

export type OutreachStatus = {
  configured: boolean;
  blockedAsClientWorkspace: boolean;
  webhookFit?: string;
  webhookUrl?: string | null;
  error?: string;
  whatsapp: Array<{ username: string; expired: boolean }>;
  instagram: Array<{ username: string; expired: boolean }>;
};

export function isZernioOutreachConfigured(): boolean {
  return Boolean(process.env.ZERNIO_API_KEY?.trim());
}

export async function getOutreachStatus(): Promise<OutreachStatus> {
  if (!isZernioOutreachConfigured()) {
    return {
      configured: false,
      blockedAsClientWorkspace: false,
      whatsapp: [],
      instagram: [],
      error: "На панели нет ZERNIO_API_KEY — сообщения уйдут не из бизнес-аккаунта.",
    };
  }
  try {
    const { inspectOperatorZernioConnection } = await import("@/lib/zernio.server");
    const report = await inspectOperatorZernioConnection();
    return {
      configured: true,
      blockedAsClientWorkspace: report.blockedAsClientWorkspace,
      webhookFit: report.fit,
      webhookUrl: report.currentUrl,
      error: report.error,
      whatsapp: report.accounts
        .filter((a) => a.platform === "whatsapp")
        .map((a) => ({ username: a.username, expired: a.expired })),
      instagram: report.accounts
        .filter((a) => a.platform === "instagram")
        .map((a) => ({ username: a.username, expired: a.expired })),
    };
  } catch (e: unknown) {
    return {
      configured: true,
      blockedAsClientWorkspace: false,
      whatsapp: [],
      instagram: [],
      error: errorMessage(e),
    };
  }
}

export async function sendSalesMessage(params: {
  channel: "whatsapp" | "instagram";
  preferredAccountId?: string | null;
  conversationId?: string | null;
  phone?: string | null;
  instagramHandle?: string | null;
  text: string;
  templateName?: string;
  templateLanguage?: string;
}): Promise<OutreachSendResult> {
  const channel = params.channel;
  const fallbackHref =
    channel === "whatsapp" && params.phone
      ? whatsappHref(params.phone, params.text)
      : channel === "instagram" && params.instagramHandle
        ? instagramHref(params.instagramHandle)
        : null;

  if (!isZernioOutreachConfigured()) {
    return {
      ok: false,
      channel,
      fallbackHref,
      error: "На панели нет ZERNIO_API_KEY своего бизнеса FrogFlow.",
    };
  }
  if (!params.text.trim()) {
    return { ok: false, channel, fallbackHref, error: "Нет текста черновика." };
  }

  const {
    listZernioAccounts,
    ensureOperatorZernioWebhook,
    inspectOperatorZernioConnection,
    sendZernioInboxMessage,
    startInstagramConversation,
  } = await import("@/lib/zernio.server");

  const inspect = await inspectOperatorZernioConnection();
  if (inspect.blockedAsClientWorkspace) {
    return {
      ok: false,
      channel,
      fallbackHref,
      error: inspect.error || "Ключ Zernio принадлежит магазину клиента.",
    };
  }

  await ensureOperatorZernioWebhook();
  const accounts = await listZernioAccounts();
  const account = pickZernioAccount(accounts, channel, params.preferredAccountId);
  if (!account) {
    return {
      ok: false,
      channel,
      fallbackHref,
      error:
        channel === "whatsapp"
          ? "В Zernio нет подключённого WhatsApp Business."
          : "В Zernio нет подключённого Instagram Business.",
    };
  }

  if (channel === "whatsapp") {
    const { sendWhatsAppOutsideWindow } = await import("@/lib/whatsapp.server");
    const sent = await sendWhatsAppOutsideWindow({
      accountId: account._id,
      conversationId: params.conversationId,
      phone: params.phone,
      text: params.text,
      templateName: params.templateName,
      templateLanguage: params.templateLanguage,
    });
    return sent.ok
      ? {
          ok: true,
          channel,
          conversationId: sent.conversationId,
          accountId: account._id,
          fallbackHref,
        }
      : {
          ok: false,
          channel,
          accountId: account._id,
          fallbackHref,
          error: sent.error || "WhatsApp Business не принял сообщение.",
        };
  }

  if (params.conversationId) {
    const existing = await sendZernioInboxMessage(params.conversationId, account._id, params.text, {
      platform: "instagram",
    });
    if (existing.ok) {
      return {
        ok: true,
        channel,
        conversationId: params.conversationId,
        accountId: account._id,
        fallbackHref,
      };
    }
  }

  if (!params.instagramHandle?.trim()) {
    return {
      ok: false,
      channel,
      accountId: account._id,
      fallbackHref,
      error: "Нет Instagram-ника, Direct открыть некуда.",
    };
  }

  const started = await startInstagramConversation({
    accountId: account._id,
    username: params.instagramHandle,
    message: params.text,
  });
  return started.ok
    ? {
        ok: true,
        channel,
        conversationId: started.conversationId,
        accountId: account._id,
        fallbackHref,
      }
    : {
        ok: false,
        channel,
        accountId: account._id,
        fallbackHref,
        error: started.error || "Instagram не принял сообщение.",
      };
}
