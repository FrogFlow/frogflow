import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";
import { consumeMiniAppRateLimit } from "@/lib/mini-app-rate-limit.server";
import { PAYMENT_PROOF_MAX_BYTES, processMiniAppPaymentProof } from "@/lib/payment-proof.server";
import { logger } from "@/lib/logger.server";

function errorStatus(error: string): number {
  if (error === "file_too_large") return 413;
  if (error === "order_not_found") return 404;
  if (error === "proof_in_progress" || error === "order_already_processed") return 409;
  if (error === "storage_failed") return 503;
  return 400;
}

export const Route = createFileRoute("/api/public/mini-app/proof")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }
        const limit = consumeMiniAppRateLimit("proof", auth.user.id);
        if (!limit.ok) {
          return Response.json(
            { error: "rate_limited" },
            { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
          );
        }

        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > PAYMENT_PROOF_MAX_BYTES + 1024 * 1024) {
          return Response.json({ error: "file_too_large" }, { status: 413 });
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "invalid_form" }, { status: 400 });
        }
        const value = form.get("file");
        if (!value || typeof value === "string" || typeof value.arrayBuffer !== "function") {
          return Response.json({ error: "invalid_file" }, { status: 400 });
        }
        if (value.size > PAYMENT_PROOF_MAX_BYTES) {
          return Response.json({ error: "file_too_large" }, { status: 413 });
        }

        const orderRaw = form.get("order_id");
        const orderId =
          typeof orderRaw === "string" && orderRaw.trim() ? Number(orderRaw) : undefined;
        if (orderId !== undefined && (!Number.isInteger(orderId) || orderId <= 0)) {
          return Response.json({ error: "invalid_order" }, { status: 400 });
        }

        const result = await processMiniAppPaymentProof({
          telegramId: auth.user.id,
          orderId,
          file: {
            bytes: new Uint8Array(await value.arrayBuffer()),
            mime: value.type,
            filename: value.name,
          },
        });
        logger.info("mini_app.proof_upload", {
          telegram_id: auth.user.id,
          order_id: result.ok ? result.orderId : orderId,
          outcome: result.ok ? result.outcome : undefined,
          error: result.ok ? undefined : result.error,
          source: "mini_app",
        });
        if (!result.ok) {
          return Response.json(result, { status: errorStatus(result.error) });
        }
        return Response.json(result);
      },
    },
  },
});
