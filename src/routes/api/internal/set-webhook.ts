import { createFileRoute } from "@tanstack/react-router";
import { authenticateInternalRequest, setOwnWebhook } from "@/lib/internal/internal-api.server";

export const Route = createFileRoute("/api/internal/set-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternalRequest(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: auth.status });
        }
        const res = await setOwnWebhook();
        const { ensureZernioWebhook } = await import("@/lib/zernio.server");
        const zernio = await ensureZernioWebhook({ force: true }).catch((e) => ({
          ok: false,
          error: String(e),
        }));
        if (!res.ok) {
          return Response.json(
            { ok: false, error: res.message, bots: res.bots, zernio },
            { status: res.status },
          );
        }
        // bots — по строке на каждого бота арендатора: панель показывает их
        // раздельно, иначе не видно, что VIP-бот не встал.
        return Response.json({ ok: true, url: res.url, bots: res.bots, zernio });
      },
    },
  },
});
