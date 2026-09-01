import { validateTelegramInitData, type TelegramWebAppUser } from "./telegram-init-data.server";
import { tg } from "./telegram.server";

const INIT_DATA_HEADER = "x-telegram-init-data";

export function miniAppPath(): string {
  return "/mini-app";
}

export function miniAppUrl(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${miniAppPath()}`;
}

export type MiniAppAuth =
  { ok: true; user: TelegramWebAppUser } | { ok: false; status: number; error: string };

export async function authorizeMiniAppRequest(request: Request): Promise<MiniAppAuth> {
  if (!(await miniAppModuleEnabled())) {
    return { ok: false, status: 404, error: "not_found" };
  }

  // API credentials belong in a header: query parameters leak to access
  // logs, browser history and Referer headers.
  const initData = request.headers.get(INIT_DATA_HEADER)?.trim() || "";

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, status: 503, error: "bot_unavailable" };
  }

  // Mutating Mini App APIs should not accept a captured launch payload all
  // day. Reopening the app gives Telegram a fresh auth_date.
  const validated = validateTelegramInitData(initData, token, 60 * 60);
  if (!validated.ok) {
    const status =
      validated.reason === "expired" ? 401 : validated.reason === "missing" ? 401 : 403;
    return { ok: false, status, error: validated.reason };
  }

  return { ok: true, user: validated.user };
}

export async function miniAppModuleEnabled(): Promise<boolean> {
  try {
    const { hasModule } = await import("./modules/modules.server");
    return await hasModule("telegram_mini_app");
  } catch (error) {
    console.error("[mini-app] module status unavailable", error);
    return false;
  }
}

/** Кнопка меню бота (Menu Button) — вход в Mini App без reply-клавиатуры. */
export async function syncMiniAppMenuButton(
  chatId?: number,
  text = "🛍 Магазин",
): Promise<void> {
  if (!(await miniAppModuleEnabled())) {
    await tg("setChatMenuButton", {
      ...(chatId ? { chat_id: chatId } : {}),
      menu_button: { type: "default" },
    }).catch((e) => console.error("[mini-app] reset ChatMenuButton failed", e));
    return;
  }
  const { appOrigin } = await import("./app-origin.server");
  const origin = appOrigin();
  if (!origin) return;
  const url = miniAppUrl(origin);
  await tg("setChatMenuButton", {
    ...(chatId ? { chat_id: chatId } : {}),
    menu_button: {
      type: "web_app",
      text,
      web_app: { url },
    },
  }).catch((e) => console.error("[mini-app] setChatMenuButton failed", e));
}
