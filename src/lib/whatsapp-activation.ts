export const WHATSAPP_START_PROMPT =
  "Здравствуйте! Чтобы активировать бота и открыть каталог, напишите /start";

export function resolveWhatsAppStartPrompt(value?: string | null): string {
  return value?.trim() || WHATSAPP_START_PROMPT;
}

export type WhatsAppActivationAction = "continue" | "start" | "prompt" | "wait";

/**
 * True when the incoming event is an explicit shop start.
 *
 * Instagram CMD buttons put the visible label in `message.text` («купить»)
 * and the configured command in `metadata.postbackPayload`. A typed
 * «купить» in ordinary chat is not a start — only `/start` itself, or a
 * postback whose payload is `/start` / `start` / a seller trigger word.
 */
export function isStartToken(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (normalized === "start" || normalized === "/start") return true;
  return normalized.startsWith("/start ") || normalized.startsWith("/start@");
}

export function isZernioStartIntent(
  text: string,
  postbackPayload: string | null,
  triggerWords: readonly string[] = [],
): boolean {
  if (isStartToken(text) || isStartToken(postbackPayload)) return true;
  const payload = postbackPayload?.trim().toLowerCase() ?? "";
  return payload.length > 0 && triggerWords.includes(payload);
}

/**
 * WhatsApp starts with a single opt-in prompt. Until the customer explicitly
 * sends /start, arbitrary messages must not enter the store flow.
 *
 * `/start` (typed or CMD postback) restarts the shop on WhatsApp and
 * Instagram alike. Otherwise a returning Instagram buyer taps «Купить»
 * (`/start`) and the event is swallowed by an old locale/mode, or treated
 * as a wrong answer on the language step.
 */
export function whatsappActivationAction(params: {
  platform: string;
  state: { locale?: unknown; mode?: unknown; start_prompted_at?: unknown };
  isStartCommand: boolean;
  hasIncomingContent: boolean;
  startPromptEnabled: boolean;
}): WhatsAppActivationAction {
  // /start is an explicit request to (re)activate the bot. It must win over
  // every remembered conversation state, including an active checkout or a
  // recent hand-off to the seller. Otherwise an already known customer sends
  // /start and silently falls through to the old conversation guards.
  if (params.isStartCommand) return "start";
  if (params.platform !== "whatsapp") return "continue";
  if (params.state.locale || params.state.mode) return "continue";
  if (!params.startPromptEnabled || !params.hasIncomingContent || params.state.start_prompted_at) {
    return "wait";
  }
  return "prompt";
}
