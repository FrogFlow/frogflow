import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getOperatorSession, operatorRouteStatus } from "./guard.server";

/** Used by /operator/* routes' beforeLoad to pick notFound() vs redirect() vs render. */
export const operatorRouteStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  return { status: await operatorRouteStatus() };
});

const LoginInput = z.object({ username: z.string().min(1), password: z.string().min(1) });

export const operatorLoginFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => LoginInput.parse(data))
  .handler(async ({ data }) => {
    // Same "not found" outcome as any other operator-only function on a
    // deployment that isn't the panel — see guard.server.ts.
    if (process.env.CONTROL_PLANE !== "1") {
      throw new Error("Not found");
    }
    const expectedUser = process.env.OPERATOR_USERNAME;
    const expectedPass = process.env.OPERATOR_PASSWORD;
    if (!expectedUser || !expectedPass) {
      throw new Error(
        "OPERATOR_USERNAME / OPERATOR_PASSWORD не заданы в переменных окружения проекта панели.",
      );
    }
    if (data.username !== expectedUser || data.password !== expectedPass) {
      return { ok: false as const };
    }
    const s = await getOperatorSession();
    await s.update({ authed: true, username: data.username });
    return { ok: true as const };
  });

export const operatorLogoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await getOperatorSession();
  await s.clear();
  return { ok: true as const };
});
