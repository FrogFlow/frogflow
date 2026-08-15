import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest } from "@/lib/internal/internal-api.server";

/**
 * Деплой рассказывает панели, что у него настроено. Только имена переменных и
 * флаги — ни одного значения: ответ доезжает до браузера оператора.
 *
 * Как и остальной внутренний API, закрыт bots.internal_secret.
 */
export const Route = createFileRoute("/api/internal/diagnostics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }
        const { selfDiagnostics } = await import("@/lib/internal/diagnostics.server");
        return Response.json({ ok: true, diagnostics: await selfDiagnostics() });
      },
    },
  },
});
