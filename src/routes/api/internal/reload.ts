import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest } from "@/lib/internal/internal-api.server";
import { resetModuleCache } from "@/lib/modules/modules.server";

export const Route = createFileRoute("/api/internal/reload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }
        resetModuleCache();
        return Response.json({ ok: true });
      },
    },
  },
});
