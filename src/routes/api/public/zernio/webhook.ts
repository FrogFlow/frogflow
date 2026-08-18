import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";

export function verifyZernioWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
): boolean {
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
        const signature =
          request.headers.get("x-zernio-signature") || request.headers.get("x-late-signature");
        if (!secret) return new Response("webhook secret is not configured", { status: 503 });
        if (!verifyZernioWebhookSignature(rawBody, signature, secret)) {
          return new Response("invalid signature", { status: 401 });
        }
        let payload: {
          event?: string;
          id?: string;
          account?: {
            accountId?: string;
            id?: string;
            _id?: string;
            username?: string;
            name?: string;
          };
          message?: { accountId?: string };
          data?: { accountId?: string };
        };
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

        const accountId =
          payload.account?.accountId ||
          payload.account?.id ||
          payload.message?.accountId ||
          payload.data?.accountId;
        const eventType = payload.event || "unknown";

        /**
         * account.disconnected — единственное событие, где эта проверка не
         * применима. Она сверяет accountId со списком аккаунтов, которые
         * Zernio сейчас считает подключёнными к нашему профилю, а к моменту
         * доставки такого события отключившийся аккаунт из этого списка уже
         * мог пропасть — ровно то, о чём событие и сообщает. Отбрасывать его
         * за это значило бы отбрасывать единственное сообщение, ради которого
         * оно и заведено. Деплой и так получает только события своей рабочей
         * области Zernio (webhook регистрируется под собственным ключом
         * клиента), так что для событий уровня аккаунта этого достаточно.
         */
        if (eventType !== "account.disconnected") {
          const { isInstagramAccountInConfiguredProfile } = await import("@/lib/zernio.server");
          if (!(await isInstagramAccountInConfiguredProfile(String(accountId || "")))) {
            console.warn(
              "[instagram-webhook] ignored event for an account outside this deployment profile",
            );
            return new Response("ignored", { status: 202 });
          }
        }

        const eventId =
          payload.id ||
          request.headers.get("x-zernio-event-id") ||
          request.headers.get("x-late-event-id") ||
          null;

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

        /**
         * Дедупликация — на уникальном индексе, а не на «сначала посмотрим, потом
         * вставим». У Zernio доставка at-least-once с семью попытками, и одно и то
         * же событие приходит повторно, если ответ потерялся. Прежняя проверка
         * читала таблицу и вставляла отдельным запросом: две одновременные
         * доставки обе не находили строку, обе вставляли, нарушение индекса
         * `zernio_logs_bot_event_id_key` просто писалось в консоль — и обработка
         * шла дальше в обоих. Для клиента это второй одинаковый DM.
         *
         * Теперь конфликт вставки и есть ответ «уже принято»: строку держит тот,
         * кто вставил первым, остальные уходят с 200 и ничего не обрабатывают.
         * Код 23505 — unique_violation в PostgreSQL.
         */
        const { data: logEntry, error: insertError } = await supabaseAdmin
          .from("zernio_logs")
          .insert({
            event_id: eventId ? String(eventId) : null,
            event_type: eventType,
            status: "pending",
            payload,
          })
          .select("id")
          .single();

        if (insertError) {
          if (insertError.code === "23505") {
            return new Response("already processed", { status: 200 });
          }
          // Записать не вышло по другой причине. Обрабатывать вслепую нельзя:
          // без строки некому пометить событие обработанным, а повторная
          // доставка не отсеется — уж лучше отдать не-2xx и получить повтор
          // по расписанию Zernio.
          console.error("[instagram-webhook] failed to record event", insertError);
          return new Response("failed to record event", { status: 500 });
        }

        // Обрабатывается ровно то, на что мы подписаны (см. registerZernioWebhook).
        runInBackground(async () => {
          try {
            const { handleZernioMessage, handleZernioAccountDisconnected } =
              await import("@/lib/zernio-bot.server");
            const { runWithZernioEvent } = await import("@/lib/zernio-event-context.server");

            // Идентификатор события выставляется на всю обработку: отправки
            // внутри выводят из него Idempotency-Key, чтобы повторная доставка
            // не превратилась во второе сообщение клиенту.
            await runWithZernioEvent(eventId ? String(eventId) : null, async () => {
              // Граница доверия: тело запроса проверено секретом заголовка выше,
              // дальше типизированная форма — то, что обработчики реально читают.
              if (eventType === "message.received") {
                await handleZernioMessage(payload as Parameters<typeof handleZernioMessage>[0]);
              } else if (eventType === "account.disconnected") {
                await handleZernioAccountDisconnected(
                  payload as Parameters<typeof handleZernioAccountDisconnected>[0],
                );
              }
            });

            await supabaseAdmin
              .from("zernio_logs")
              .update({ status: "processed" })
              .eq("id", logEntry.id);
          } catch (err) {
            console.error(`Error processing zernio event ${eventId}:`, err);
            await supabaseAdmin
              .from("zernio_logs")
              .update({ status: "error" })
              .eq("id", logEntry.id);
          }
        });

        return new Response("ok", { status: 200 });
      },
    },
  },
});
