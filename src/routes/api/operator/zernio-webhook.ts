import { createFileRoute } from "@tanstack/react-router";
import { verifyZernioWebhookSignature } from "@/routes/api/public/zernio/webhook";
import { errorMessage } from "@/lib/error-message";
import type { ZernioWebhookMessagePayload } from "@/lib/zernio.server";

/**
 * Входящие WhatsApp/Instagram лидов FrogFlow. Только панель (CONTROL_PLANE):
 * на клиентском деплое этот путь — 404, магазин слушает
 * /api/public/zernio/webhook.
 *
 * Не гоняем событие через магазинный бот (hasModule/BOT_ID): здесь нет
 * арендатора. Сопоставляем с sales_leads и ставим «Ответил».
 */
export const Route = createFileRoute("/api/operator/zernio-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env.CONTROL_PLANE !== "1") {
          return new Response("Not found", { status: 404 });
        }
        const rawBody = await request.text();
        const secret = process.env.ZERNIO_WEBHOOK_SECRET?.trim();
        const signature =
          request.headers.get("x-zernio-signature") || request.headers.get("x-late-signature");
        if (!secret) return new Response("webhook secret is not configured", { status: 503 });
        if (!verifyZernioWebhookSignature(rawBody, signature, secret)) {
          return new Response("invalid signature", { status: 401 });
        }
        let payload: ZernioWebhookMessagePayload;
        try {
          payload = JSON.parse(rawBody) as ZernioWebhookMessagePayload;
        } catch {
          return new Response("bad json", { status: 400 });
        }
        if ((payload.event || "unknown") !== "message.received") {
          return new Response("ok", { status: 200 });
        }
        try {
          const { ingestLeadInbound } = await import("@/lib/operator/leads.server");
          const result = await ingestLeadInbound(payload);
          return Response.json({ ok: true, ...result });
        } catch (e: unknown) {
          console.error("[operator-zernio] ingest failed:", e);
          return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
        }
      },
    },
  },
});
