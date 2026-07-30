import { createFileRoute } from "@tanstack/react-router";

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
        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const eventId = payload.id || payload.data?.commentId || payload.data?.messageId || null;
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
        await supabaseAdmin.from("zernio_logs").insert({
          event_id: eventId ? String(eventId) : null,
          event_type: eventType,
          status: "processed",
          payload,
        });

        // Запуск асинхронной обработки события
        await runInBackground(async () => {
          const { handleZernioMessage, handleZernioComment } = await import("@/lib/zernio-bot.server");
          if (eventType === "message.received") {
            await handleZernioMessage(payload);
          } else if (eventType === "comment.received") {
            await handleZernioComment(payload);
          }
        });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
