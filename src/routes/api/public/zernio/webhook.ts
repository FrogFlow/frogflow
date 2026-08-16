import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";

export function verifyZernioWebhookSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = Buffer.from(signature, "utf8");
  const computed = Buffer.from(expected, "utf8");
  return received.length === computed.length && crypto.timingSafeEqual(received, computed);
}

async function runInBackground(task: () => Promise<void>) {
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(task());
  } catch {
    await task();
  }
}

export const Route = createFileRoute("/api/public/zernio/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const secret = process.env.ZERNIO_WEBHOOK_SECRET?.trim();
        const signature = request.headers.get("x-zernio-signature") || request.headers.get("x-late-signature");
        if (!secret) return new Response("webhook secret is not configured", { status: 503 });
        if (!verifyZernioWebhookSignature(rawBody, signature, secret)) {
          return new Response("invalid signature", { status: 401 });
        }
        let payload: any;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        // Как и у VIP-бота: выключенный модуль обязан гасить обработку, иначе
        // тумблер «Instagram» убирает только раздел админки. 200 вместо ошибки —
        // чтобы Zernio не копил повторные доставки, пока модуль выключен.
        const { hasModule } = await import("@/lib/modules/modules.server");
        if (!(await hasModule("instagram"))) return new Response("ok");

        const accountId = payload.account?.accountId || payload.account?.id || payload.message?.accountId || payload.data?.accountId;
        const { isInstagramAccountInConfiguredProfile } = await import("@/lib/zernio.server");
        if (!(await isInstagramAccountInConfiguredProfile(String(accountId || "")))) {
          console.warn("[instagram-webhook] ignored event for an account outside this deployment profile");
          return new Response("ignored", { status: 202 });
        }

        const eventId = payload.id || request.headers.get("x-zernio-event-id") || request.headers.get("x-late-event-id") || null;
        const eventType = payload.event || "unknown";

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

        // Проверка дедупликации
        if (eventId) {
          const { data: existing } = await supabaseAdmin
            .from("zernio_logs")
            .select("id")
            .eq("event_id", String(eventId))
            .maybeSingle();

          if (existing) {
            return new Response("already processed", { status: 200 });
          }
        }

        // Логирование входящего события
        const { data: logEntry, error: insertError } = await supabaseAdmin.from("zernio_logs").insert({
          event_id: eventId ? String(eventId) : null,
          event_type: eventType,
          status: "pending",
          payload,
        }).select("id").single();

        if (insertError) {
          console.error("Failed to insert zernio log:", insertError);
        }

        // Запуск асинхронной обработки события
        runInBackground(async () => {
          try {
            const { handleZernioMessage, handleZernioComment } = await import("@/lib/zernio-bot.server");
            if (eventType === "message.received") {
              await handleZernioMessage(payload);
            } else if (eventType === "comment.received") {
              await handleZernioComment(payload);
            }
            
            if (logEntry?.id) {
              await supabaseAdmin.from("zernio_logs").update({ status: "processed" }).eq("id", logEntry.id);
            }
          } catch (err) {
            console.error(`Error processing zernio event ${eventId}:`, err);
            if (logEntry?.id) {
              await supabaseAdmin.from("zernio_logs").update({ status: "error" }).eq("id", logEntry.id);
            }
          }
        });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
