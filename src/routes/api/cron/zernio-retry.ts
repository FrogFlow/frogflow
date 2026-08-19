import { createFileRoute } from "@tanstack/react-router";
import { errorMessage } from "@/lib/error-message";
import { retryStuckZernioEvents } from "@/lib/zernio-retry.server";
import { isCronAuthorized } from "@/lib/cron-auth.server";

/**
 * Добор зависших Instagram-событий Zernio — раньше жил внутри
 * /api/cron/broadcast (см. историю в DEPLOYMENT.md), потому что на тарифе
 * Hobby второй внешний cron-вызов ради одной задачи не окупался. На Vercel
 * Pro лимита на число cron-заданий практически нет, так что задача вынесена
 * в собственный роут — можно гонять её независимо от рассылок и чаще, чем
 * раз в 1-2 минуты, без риска замедлить или уронить основной cron/broadcast.
 */
export const Route = createFileRoute("/api/cron/zernio-retry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // У панели оператора (CONTROL_PLANE=1) нет своего BOT_ID и нет
        // Instagram-событий — эту задачу ей выполнять нечего и не над чем.
        // Явный no-op вместо ошибки: vercel.json crons одинаков для всех
        // деплоев этого репозитория, и без этой проверки нативный cron бил бы
        // сюда и на деплое панели тоже.
        if (process.env.CONTROL_PLANE === "1") {
          return new Response("Not found", { status: 404 });
        }
        if (!isCronAuthorized(request)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await retryStuckZernioEvents();
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[cron/zernio-retry]", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
