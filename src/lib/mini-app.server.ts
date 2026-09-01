import { validateTelegramInitData, type TelegramWebAppUser } from "./telegram-init-data.server";

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
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("telegram_mini_app"))) {
    return { ok: false, status: 404, error: "not_found" };
  }

  const initData =
    request.headers.get(INIT_DATA_HEADER)?.trim() ||
    new URL(request.url).searchParams.get("initData")?.trim() ||
    "";

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { ok: false, status: 503, error: "bot_unavailable" };
  }

  const validated = validateTelegramInitData(initData, token);
  if (!validated.ok) {
    const status =
      validated.reason === "expired" ? 401 : validated.reason === "missing" ? 401 : 403;
    return { ok: false, status, error: validated.reason };
  }

  return { ok: true, user: validated.user };
}
