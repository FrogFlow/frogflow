import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getOperatorSession,
  operatorPasswordFingerprint,
  operatorRouteStatus,
  operatorSessionSecretReady,
} from "./guard.server";

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
    if (!operatorSessionSecretReady()) {
      throw new Error(
        "OPERATOR_SESSION_SECRET не задан или короче 32 символов. Пока он не задан, вход " +
          "закрыт: иначе cookie оператора подписывалась бы значением из исходников, и её " +
          "мог бы подделать кто угодно.",
      );
    }

    const { checkLockout, recordAttempt, secretsMatch, clientIp, loginDelay } =
      await import("./login-guard.server");
    const ip = clientIp();

    const lock = await checkLockout(data.username, ip);
    if (lock.locked) {
      // Саму попытку тоже пишем: иначе в журнале не видно, что перебор продолжается.
      await recordAttempt(data.username, ip, false);
      throw new Error(
        `Слишком много неудачных попыток входа. Попробуйте через ${lock.retryAfterMin} минут.`,
      );
    }

    // Задержка до сравнения — одинаковая и для верного, и для неверного пароля.
    await loginDelay();
    // Оба сравнения выполняются всегда: не && , чтобы неверное имя не отвечало
    // заметно быстрее неверного пароля.
    const userOk = secretsMatch(data.username, expectedUser);
    const passOk = secretsMatch(data.password, expectedPass);
    if (!userOk || !passOk) {
      await recordAttempt(data.username, ip, false);
      return { ok: false as const };
    }

    await recordAttempt(data.username, ip, true);
    const s = await getOperatorSession();
    await s.update({
      authed: true,
      username: data.username,
      passFp: operatorPasswordFingerprint(),
    });
    return { ok: true as const };
  });

export const operatorLogoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await getOperatorSession();
  await s.clear();
  return { ok: true as const };
});
