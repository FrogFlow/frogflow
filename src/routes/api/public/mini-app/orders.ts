import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { authorizeMiniAppRequest } from "@/lib/mini-app.server";
import { consumeMiniAppRateLimit } from "@/lib/mini-app-rate-limit.server";
import { getCachedBotUrl } from "@/lib/bot-url.server";

function limited(telegramId: number): Response | null {
  const limit = consumeMiniAppRateLimit("orders", telegramId);
  return limit.ok
    ? null
    : Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
}

export const Route = createFileRoute("/api/public/mini-app/orders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }
        const rateResponse = limited(auth.user.id);
        if (rateResponse) return rateResponse;

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("orders")
          .select(
            "id, order_no, display_no, status, total, currency, created_at, fulfillment_kind, fulfillment_type, fulfillment_at, paid_amount, payment_proof_path",
          )
          .eq("telegram_id", auth.user.id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) {
          return Response.json({ error: "orders_failed" }, { status: 503 });
        }
        return Response.json({
          orders: (data ?? []).map((order) => ({
            id: order.id,
            displayNo: order.display_no ?? order.order_no ?? order.id,
            status: order.status,
            total: Number(order.total),
            currency: order.currency,
            createdAt: order.created_at,
            fulfillmentKind: order.fulfillment_kind,
            fulfillmentType: order.fulfillment_type,
            fulfillmentAt: order.fulfillment_at,
            paidAmount: Number(order.paid_amount ?? 0),
            hasProof: Boolean(order.payment_proof_path),
          })),
          botUrl: await getCachedBotUrl(),
        });
      },
      POST: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        const auth = await authorizeMiniAppRequest(request);
        if (!auth.ok) {
          return Response.json({ error: auth.error }, { status: auth.status });
        }
        const rateResponse = limited(auth.user.id);
        if (rateResponse) return rateResponse;
        let body: { action?: string; order_id?: number };
        try {
          body = (await request.json()) as { action?: string; order_id?: number };
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        if (body.action !== "resend" || !Number.isInteger(Number(body.order_id))) {
          return Response.json({ error: "invalid_action" }, { status: 400 });
        }
        const { resendOrderFiles } = await import("@/lib/orders.server");
        const result = await resendOrderFiles(Number(body.order_id), auth.user.id);
        if (!result.ok) {
          return Response.json({ error: result.reason }, { status: 400 });
        }
        return Response.json(result);
      },
    },
  },
});
