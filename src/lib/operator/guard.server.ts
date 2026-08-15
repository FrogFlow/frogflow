import { randomBytes } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";

/**
 * Секрет подписи cookie оператора.
 *
 * Раньше при отсутствии подставлялось общеизвестное значение из исходников —
 * то есть cookie оператора можно было подделать и получить доступ ко всем
 * клиентам сразу. Слишком короткий секрет был не лучше: iron-session требует
 * не меньше 32 символов и падал 500-й, без объяснения причины.
 *
 * Теперь оба случая ведут себя одинаково и предсказуемо: подпись идёт
 * случайным секретом этого процесса (подделать нельзя, но и войти нельзя —
 * см. operatorSessionSecretReady), а панель говорит об этом прямым текстом
 * в форме входа и в самопроверке.
 */
const MIN_SECRET_LEN = 32;
const PROCESS_FALLBACK = randomBytes(32).toString("hex");

export function operatorSessionSecretReady(): boolean {
  return (process.env.OPERATOR_SESSION_SECRET?.trim().length ?? 0) >= MIN_SECRET_LEN;
}

function operatorSessionPassword(): string {
  const s = process.env.OPERATOR_SESSION_SECRET?.trim();
  return s && s.length >= MIN_SECRET_LEN ? s : PROCESS_FALLBACK;
}

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
  password: operatorSessionPassword(),
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
