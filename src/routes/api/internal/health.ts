import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest, botHealth } from "@/lib/internal/internal-api.server";

export const Route = createFileRoute("/api/internal/health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }
        const res = await botHealth();
        if (!res.ok) {
          return Response.json({ ok: false, error: res.message }, { status: res.status });
        }
        return Response.json({ ok: true, report: res.report });
      },
    },
  },
});
