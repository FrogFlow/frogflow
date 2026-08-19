import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminSessionSecretReady, getAdminSession, isAdminAuthed } from "./admin-session.server";
import { assertTenantDeployment } from "./control-plane.server";

const LoginInput = z.object({ username: z.string().min(1), password: z.string().min(1) });

export const adminLogin = createServerFn({ method: "POST" })
  .validator((data: unknown) => LoginInput.parse(data))
  .handler(async ({ data }) => {
    assertTenantDeployment();
    const expectedUser = process.env.ADMIN_USERNAME;
    const expectedPass = process.env.ADMIN_PASSWORD;
    if (!expectedUser || !expectedPass) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD не заданы в переменных окружения проекта.");
    }
    if (!adminSessionSecretReady()) {
      throw new Error(
        "SESSION_SECRET не задан или короче 32 символов. Пока он не задан, вход закрыт: " +
          "иначе cookie админки подписывалась бы значением из исходников, и её мог бы " +
          "подделать кто угодно.",
      );
    }

    const { checkLockout, recordAttempt, secretsMatch, clientIp, loginDelay } =
      await import("./admin-login-guard.server");
    const ip = clientIp();

    const lock = await checkLockout(ip);
    if (lock.locked) {
      await recordAttempt(ip, false);
      throw new Error(
        `Слишком много неудачных попыток входа. Попробуйте через ${lock.retryAfterMin} минут.`,
      );
    }

    await loginDelay();
    // Оба сравнения выполняются всегда — неверное имя не должно отвечать
    // заметно быстрее неверного пароля.
    const userOk = secretsMatch(data.username, expectedUser);
    const passOk = secretsMatch(data.password, expectedPass);
    if (!userOk || !passOk) {
      await recordAttempt(ip, false);
      return { ok: false as const };
    }

    await recordAttempt(ip, true);
    const s = await getAdminSession();
    await s.update({ authed: true });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  assertTenantDeployment();
  const s = await getAdminSession();
  await s.clear();
  return { ok: true as const };
});

export const adminCheck = createServerFn({ method: "GET" }).handler(async () => {
  assertTenantDeployment();
  return { authed: await isAdminAuthed() };
});
