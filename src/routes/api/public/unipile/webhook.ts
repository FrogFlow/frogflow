import { createFileRoute } from "@tanstack/react-router";
import { verifyUnipileWebhookSignature } from "@/lib/unipile.server";

/**
 * Unipile webhooks:
 * - account status / hosted auth notify
 * - message.new (stub for future inbound DM handling)
 */
export const Route = createFileRoute("/api/public/unipile/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig =
          request.headers.get("x-unipile-signature") ||
          request.headers.get("Unipile-Signature") ||
          request.headers.get("x-webhook-secret") ||
          request.headers.get("authorization");

        if (!verifyUnipileWebhookSignature(raw, sig)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let body: any = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const event =
          body.event ||
          body.type ||
          body.AccountStatus?.event ||
          body.status ||
          "";
        const eventStr = String(event).toLowerCase();

        try {
          const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
          const s = supabaseAdmin;

          // Hosted auth notify_url often posts account_id directly
          const accountId = String(
            body.account_id ||
              body.accountId ||
              body.AccountStatus?.account_id ||
              body.data?.account_id ||
              "",
          ).trim();
          const accountName = String(
            body.name || body.username || body.AccountStatus?.name || body.data?.name || "",
          ).trim();
          const status = String(
            body.AccountStatus?.message ||
              body.message ||
              body.status ||
              body.AccountStatus?.status ||
              eventStr ||
              "",
          ).trim();

          const isAccountEvent =
            eventStr.includes("account") ||
            body.AccountStatus ||
            (accountId && !eventStr.includes("message"));

          if (isAccountEvent && accountId) {
            await s.from("app_settings").upsert([
              { key: "unipile_account_id", value: accountId, updated_at: new Date().toISOString() },
              ...(accountName
                ? [{ key: "unipile_account_name", value: accountName, updated_at: new Date().toISOString() }]
                : []),
              ...(status
                ? [{ key: "unipile_account_status", value: status, updated_at: new Date().toISOString() }]
                : []),
            ]);
            console.log("[unipile/webhook] account update", accountId, status);
          }

          if (eventStr.includes("message") || body.message_id || body.Message) {
            // Stub: inbound DM — log only for now
            console.log("[unipile/webhook] message.new stub", {
              account_id: accountId || body.account_id,
              chat_id: body.chat_id,
              message_id: body.message_id || body.Message?.id,
            });
          }
        } catch (e) {
          console.error("[unipile/webhook]", e);
          return Response.json({ ok: false }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
      GET: async () => Response.json({ ok: true, service: "unipile-webhook" }),
    },
  },
});
