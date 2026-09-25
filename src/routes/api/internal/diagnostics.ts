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
          turn?: import("@/lib/consultant-v2/eval-turn.server").V2EvalTurnInput;
        };
        // Эталонный набор консультанта v2 (scripts/eval-consultant-v2.ts):
        // ход считается здесь, потому что ключ модели есть только у деплоя.
        if (body.probe === "consultant-v2-turn" || body.probe === "consultant-v2-catalog") {
          const evalMod = await import("@/lib/consultant-v2/eval-turn.server");
          const result =
            body.probe === "consultant-v2-turn"
              ? await evalMod.runV2EvalTurn(body.turn)
              : await evalMod.v2EvalCatalog();
          return Response.json(result, { status: result.ok ? 200 : 400 });
        }
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
