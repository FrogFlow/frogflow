import { randomBytes } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { assertTenantDeployment } from "./control-plane.server";

export type AdminSession = { authed?: boolean };

/**
 * Секрет подписи cookie админки магазина.
 *
 * Раньше при отсутствии SESSION_SECRET подставлялось общеизвестное значение
 * из исходников — cookie можно было подделать и войти в админку любого из
 * клиентских деплоев без пароля. Тот же класс бага уже был найден и починен
 * для панели оператора (см. operator/guard.server.ts) — здесь тот же приём:
 * секрет процесса вместо предсказуемого, плюс явный отказ входа, пока
 * настоящий секрет не задан (adminSessionSecretReady).
 */
const MIN_SECRET_LEN = 32;
const PROCESS_FALLBACK = randomBytes(32).toString("hex");

export function adminSessionSecretReady(): boolean {
  return (process.env.SESSION_SECRET?.trim().length ?? 0) >= MIN_SECRET_LEN;
}

function adminSessionPassword(): string {
  const s = process.env.SESSION_SECRET?.trim();
  return s && s.length >= MIN_SECRET_LEN ? s : PROCESS_FALLBACK;
}

export const adminSessionConfig = {
  password: adminSessionPassword(),
  name: "admin-session",
  maxAge: 60 * 60 * 24 * 30,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
  },
};

export async function getAdminSession() {
  return useSession<AdminSession>(adminSessionConfig);
}

export async function isAdminAuthed(): Promise<boolean> {
  const s = await getAdminSession();
  return s.data.authed === true;
}

export async function requireAdmin() {
  // Панель — не арендатор: её подключение к базе идёт под service_role,
  // и клиентская админка там видела бы данные всех клиентов сразу.
  assertTenantDeployment();
  const s = await getAdminSession();
  if (s.data.authed !== true) {
    throw new Error("Unauthorized");
  }
  return s;
}
