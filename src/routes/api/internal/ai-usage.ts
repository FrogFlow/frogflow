import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest } from "@/lib/internal/internal-api.server";

/**
 * Накопленный расход умного поиска и автопроверки чеков.
 * Панель оператора читает и обнуляет после оплаты клиентом.
 */
export const Route = createFileRoute("/api/internal/ai-usage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }

        let action = "get";
        try {
          const body = (await request.json()) as { action?: unknown };
          if (body?.action === "reset" || body?.action === "get") action = body.action;
        } catch {
          /* пустое тело — чтение */
        }

        const { readAiUsage, resetAiUsage } = await import("@/lib/ai-usage.server");
        if (action === "reset") {
          const usage = await resetAiUsage();
          return Response.json({ ok: true, usage });
        }
        const usage = await readAiUsage();
        return Response.json({ ok: true, usage });
      },
    },
  },
});
