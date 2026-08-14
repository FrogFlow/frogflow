import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest, notifyOwner } from "@/lib/internal/internal-api.server";

export const Route = createFileRoute("/api/internal/notify-owner")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }

        let body: { text?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Bad JSON" }, { status: 400 });
        }

        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) {
          return Response.json({ ok: false, error: "Пустое поле text" }, { status: 400 });
        }

        const sent = await notifyOwner(text);
        if (!sent.ok) {
          return Response.json({ ok: false, error: sent.message }, { status: sent.status });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
