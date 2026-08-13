import { useSession } from "@tanstack/react-start/server";

/**
 * Изоляция панели — три слоя (CONTROL-PLANE-PLAN.md §2):
 *   1. CONTROL_PLANE=1 задан только на проекте панели.
 *   2. Своя сессия: cookie "operator-session" и свой секрет
 *      OPERATOR_SESSION_SECRET, не пересекается с "admin-session".
 *   3. requireOperator() — первой строкой каждой серверной функции в
 *      src/lib/operator/*. Не в роутере: серверные функции TanStack Start
 *      вызываются по HTTP напрямую, beforeLoad их не прикрывает.
 */

export type OperatorSession = { authed?: boolean; username?: string };

const operatorSessionConfig = {
  password:
    process.env.OPERATOR_SESSION_SECRET ||
    "dev-insecure-secret-please-set-OPERATOR_SESSION_SECRET-32chars",
  name: "operator-session",
  maxAge: 60 * 60 * 24 * 7,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
  },
};

export async function getOperatorSession() {
  return useSession<OperatorSession>(operatorSessionConfig);
}

/**
 * Первая строка каждой серверной функции в src/lib/operator/*. Одна и та же
 * ошибка на «не тот деплой» и на «нет сессии» — намеренно: клиентский деплой
 * не должен подтверждать даже само наличие этой функции.
 */
export async function requireOperator(): Promise<Awaited<ReturnType<typeof getOperatorSession>>> {
  if (process.env.CONTROL_PLANE !== "1") {
    throw new Error("Not found");
  }
  const s = await getOperatorSession();
  if (s.data.authed !== true) {
    throw new Error("Unauthorized");
  }
  return s;
}

/**
 * Только для beforeLoad роутов /operator/* — не бросает, различает три
 * исхода, чтобы UI мог выбрать notFound() / redirect() / рендер. Не замена
 * requireOperator() внутри самих операторских действий.
 */
export async function operatorRouteStatus(): Promise<
  "not_this_deployment" | "unauthenticated" | "authenticated"
> {
  if (process.env.CONTROL_PLANE !== "1") return "not_this_deployment";
  const s = await getOperatorSession();
  return s.data.authed === true ? "authenticated" : "unauthenticated";
}
