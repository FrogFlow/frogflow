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
        const body = (await request.json().catch(() => ({}))) as {
          probe?: string;
          conversationId?: string;
        };
        const mod = await import("@/lib/internal/diagnostics.server");
        if (body.probe === "consultant-dialogue") {
          return Response.json({
            ok: true,
            probe: await mod.consultantDialogueProbe(body.conversationId),
          });
        }
        return Response.json({ ok: true, diagnostics: await mod.selfDiagnostics() });
      },
    },
  },
});
