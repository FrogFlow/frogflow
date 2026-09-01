import { createFileRoute } from "@tanstack/react-router";
import { deliverOrder } from "@/lib/orders.server";
import { verifyRobokassaResultSignature } from "@/lib/robokassa.server";
import { logger } from "@/lib/logger.server";
import { isControlPlane } from "@/lib/control-plane.server";

export const Route = createFileRoute("/api/public/robokassa/result")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRobokassaResult(request),
      GET: async ({ request }) => handleRobokassaResult(request),
    },
  },
});

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function handleRobokassaResult(request: Request) {
  // Панель оператора (CONTROL_PLANE=1) не арендатор: её service_role-подключение
  // обходит RLS, а app_settings/orders ниже читаются без фильтра по bot_id —
  // на клиентском деплое от этого спасает RLS, на панели нет (см.
  // control-plane.server.ts).
  if (isControlPlane()) {
    return new Response("Not found", { status: 404 });
  }
  let body: URLSearchParams;
  if (request.method === "POST") {
    const text = await request.text();
    body = new URLSearchParams(text);
  } else {
    body = new URL(request.url).searchParams;
  }

  const outSum = body.get("OutSum");
  const invId = body.get("InvId");
  const signature = body.get("SignatureValue");
  const isTest = body.get("IsTest");

  if (!outSum || !invId || !signature) {
    return new Response("bad request", { status: 400 });
  }

  const s = await db();
  const { data: settings } = await s.from("app_settings").select("*");
  const getSetting = (key: string) => settings?.find((row) => row.key === key)?.value;

  if (getSetting("robokassa_enabled") !== "true") {
    return new Response("robokassa disabled", { status: 403 });
  }

  const testMode = getSetting("robokassa_test_mode") === "true";
  // Пароль для проверки подписи выбирается ТОЛЬКО по настройке продавца
  // (robokassa_test_mode), а не по полю IsTest из тела запроса — иначе
  // приславший IsTest=1 проверялся бы тестовым паролем, а тестовый пароль —
  // секрет низкой ценности. Раньше `isTest === "1"` само по себе переключало
  // пароль, то есть подделать подпись было можно тестовым паролем даже на
  // проде (Блок 1.6b).
  const pass2 = (
    testMode ? getSetting("robokassa_pass2_test") : getSetting("robokassa_pass2")
  )?.trim();

  if (!pass2) {
    return new Response("robokassa not configured", { status: 500 });
  }

  const shpEntries: Array<{ key: string; value: string }> = [];
  for (const [key, value] of body.entries()) {
    if (key.toLowerCase().startsWith("shp_")) shpEntries.push({ key, value });
  }

  const ok = verifyRobokassaResultSignature({
    outSum,
    invId,
    signature,
    pass2,
    shpEntries,
  });

  if (!ok) {
    logger.error("robokassa.signature_mismatch", {
      out_sum: outSum,
      inv_id: invId,
      is_test: isTest,
    });
    return new Response("bad sign", { status: 400 });
  }

  const orderId = Number(invId);
  const { data: order } = await s
    .from("orders")
    .select("status, total, platform, fulfillment_kind, admin_note")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    return new Response("order not found", { status: 404 });
  }

  // Защита от подделки суммы. `Number()` от нечислового OutSum даёт NaN, а
  // `NaN > 0.01` — false, то есть без явной проверки на конечность подмена
  // OutSum мусором тихо проходила бы мимо этой защиты (Блок 4).
  //
  // Сверяем не с order.total, а с amountDueNow() — при payment_mode=deposit
  // с физического заказа просят не полную сумму, а задаток (Ниши, Блок 8.2).
  const { amountDueNow } = await import("@/lib/fulfillment.server");
  const expected = await amountDueNow({
    total: Number(order.total),
    fulfillment_kind: order.fulfillment_kind,
  });
  const outSumNum = Number(outSum);
  if (!Number.isFinite(outSumNum) || Math.abs(outSumNum - expected) > 0.01) {
    logger.error("robokassa.amount_mismatch", {
      order_id: orderId,
      out_sum: outSum,
      expected,
    });
    return new Response("amount mismatch", { status: 400 });
  }

  // Выдавать только если заказ ожидает оплаты или подтверждения (защита от выдачи отклонённых)
  if (!["awaiting_payment", "awaiting_confirmation"].includes(order.status)) {
    // Не тихое "ничего не делаем": повторный или запоздалый колбэк на заказ
    // в неожиданном статусе стоит видеть в логах, а не терять молча.
    logger.warn("robokassa.unexpected_order_status", { order_id: orderId, status: order.status });
    return new Response(`OK${invId}`);
  }

  /**
   * Факт получения денег фиксируется ДО попытки выдачи, а не после (Блок 1.6).
   *
   * Раньше запись `payment_proof_path`/`admin_note` шла после deliverOrder() —
   * если выдача падала, catch ниже глушил ошибку в лог, а ответ всё равно
   * был "OK", то есть Robokassa не повторяла колбэк. Деньги списаны, а от
   * этого в базе не оставалось никакого следа: заказ так и стоял
   * awaiting_payment, будто оплаты не было вовсе.
   *
   * Если саму запись не удалось сохранить — отвечаем не "OK", чтобы
   * Robokassa повторила колбэк, а не решила, что всё прошло.
   */
  // Дописываем к уже существующей заметке, не затираем её (Блок 1, находка
  // 1.14) — там может быть маркер proof_auto (OCR) или причина сбоя
  // предыдущей выдачи, который безусловная перезапись стирала.
  const prevNote = order.admin_note ? String(order.admin_note) : "";
  const noteAddition = `Paid via Robokassa. Amount: ${outSum}`;
  const nextNote = prevNote ? `${prevNote}; ${noteAddition}` : noteAddition;
  const { error: recordErr } = await s
    .from("orders")
    .update({
      payment_proof_path: "robokassa",
      admin_note: nextNote.slice(0, 500),
    })
    .eq("id", orderId);

  if (recordErr) {
    logger.error("robokassa.payment_record_failed", { order_id: orderId, err: recordErr.message });
    return new Response("db error", { status: 500 });
  }

  try {
    if (order.fulfillment_kind === "physical") {
      const { acceptOrder, recordPayment } = await import("@/lib/fulfillment.server");
      // Robokassa повторяет колбэк, пока не получит "OK<InvId>" — двойной
      // вызов на один и тот же платёж реален. alreadyAccepted защищает от
      // повторной записи суммы в paid_amount (Блок 1, находка 1.1).
      const result = await acceptOrder(orderId);
      if (!result.alreadyAccepted) {
        const paid = await recordPayment(orderId, expected).catch((e) => {
          logger.error("robokassa.record_payment_failed", { order_id: orderId, err: e });
          return false;
        });
        if (!paid) logger.error("robokassa.record_payment_returned_false", { order_id: orderId });
      }
    } else if (order.platform === "instagram") {
      const { deliverInstagramOrder } = await import("@/lib/zernio-bot.server");
      await deliverInstagramOrder(orderId);
    } else {
      await deliverOrder(orderId);
    }
  } catch (e) {
    logger.error("robokassa.deliver_failed", { order_id: orderId, err: e });
  }

  return new Response(`OK${invId}`);
}
