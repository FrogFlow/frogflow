export const WHATSAPP_START_PROMPT =
  "Здравствуйте! Чтобы активировать бота и открыть каталог, напишите /start";

export function resolveWhatsAppStartPrompt(value?: string | null): string {
  return value?.trim() || WHATSAPP_START_PROMPT;
}

export type WhatsAppActivationAction = "continue" | "start" | "prompt" | "wait";

/**
 * WhatsApp starts with a single opt-in prompt. Until the customer explicitly
 * sends /start, arbitrary messages must not enter the store flow.
 */
export function whatsappActivationAction(params: {
  platform: string;
  state: { locale?: unknown; mode?: unknown; start_prompted_at?: unknown };
  isStartCommand: boolean;
  hasIncomingContent: boolean;
  startPromptEnabled: boolean;
}): WhatsAppActivationAction {
  if (params.platform !== "whatsapp") return "continue";

  // /start is an explicit request to (re)activate the bot. It must win over
  // every remembered conversation state, including an active checkout or a
  // recent hand-off to the seller. Otherwise an already known customer sends
  // /start and silently falls through to the old conversation guards.
  if (params.isStartCommand) return "start";
  if (params.state.locale || params.state.mode) return "continue";
  if (!params.startPromptEnabled || !params.hasIncomingContent || params.state.start_prompted_at) {
    return "wait";
  }
  return "prompt";
}
