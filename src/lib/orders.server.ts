import { tg, tgSendMultipart } from "./telegram.server";
import type { TablesUpdate } from "@/integrations-supabase/types";
import type { Locale } from "./i18n";
import { localeNames, localeFlags } from "./i18n";
import {
  MATERIAL_LANGUAGES,
  legacyAsMaterials,
  materialsForOrderItem,
  materialsForOrderItemAnyLang,
  parseDeliveredLanguages,
  type MaterialSnapshot,
  type DeliveryLangChoice,
} from "./product-materials";

export { legacyAsMaterials, materialsForOrderItem, materialsForOrderItemAnyLang };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Files per serverless run. Override with DELIVERY_BATCH_SIZE (1–20). */
const BATCH_SIZE = Math.min(20, Math.max(1, Number(process.env.DELIVERY_BATCH_SIZE) || 8));
const ITEM_DELAY_MS = 350;

/** Max file size for auto send (MB). Default 100. */
const MAX_FILE_BYTES =
  Math.min(200, Math.max(1, Number(process.env.DELIVERY_MAX_FILE_MB) || 100)) * 1024 * 1024;

const DELIVERABLE_STATUSES = ["awaiting_confirmation", "awaiting_payment"] as const;

/**
 * Сколько раз подряд подождать 2-минутную аренду и попробовать снова, прежде
 * чем сдаться и отдать материал продавцу вручную. Без потолка застрявшая
 * выдача (например, покупатель заблокировал бота) крутится в кроне вечно —
 * см. Блок 1.7.
 */
const MAX_DELIVERY_RETRIES = 5;

export type OrderItem = {
  id?: string;
  /** Нужен, чтобы достать файлы товара, когда снимок заказа оказался пустым. */
  product_id?: string | null;
  name_snapshot: string;
  file_path_snapshot: string | null;
  file_name_snapshot: string | null;
  file_path_kz_snapshot?: string | null;
  file_name_kz_snapshot?: string | null;
  file_url_snapshot?: string | null;
  file_url_kz_snapshot?: string | null;
  material_files_snapshot?: MaterialFile[] | null;
  material_files_kz_snapshot?: MaterialFile[] | null;
  /** Снимок по всем языкам сразу — пишется для заказов после MIGRATION-37. */
  material_files_by_lang?: Record<string, MaterialFile[]> | null;
  /** Какой язык уже отправлен покупателю — "both" означает «все доступные». */
  delivered_language?: string | null;
  quantity: number;
};

export type MaterialFile = MaterialSnapshot;

/**
 * Написать всем Telegram-адресам продавца из `admin_chat_id`, что заказ
 * требует внимания — файл нужно выслать вручную или что-то не доставилось
 * молча. Тот же паттерн, что уже есть в bot.server.ts/direct-purchase.server.ts,
 * но именно для сбоев выдачи ни один из них раньше не вызывался: продавец
 * узнавал о проблеме только по логам Vercel, если вообще узнавал.
 */
async function notifyAdminsAboutDeliveryIssue(text: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: setting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "admin_chat_id")
    .maybeSingle();

  const raw = setting?.value?.trim();
  if (!raw) return;

  for (const chatId of raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
    } catch (e) {
      console.error("[orders] notifyAdminsAboutDeliveryIssue failed", e);
    }
  }
}

async function claimOrderForDelivery(orderId: number) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "delivering", delivery_index: 0, delivery_retry_count: 0 })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("*, order_items(*)")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (order) return order;

  const { data: existing, error: readErr } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) throw new Error("Order not found");
  if (existing.status === "delivered" || existing.status === "delivering") {
    return null;
  }
  throw new Error(`Заказ #${orderId} нельзя выдать (статус: ${existing.status})`);
}

/**
 * Reject an order with the same compare-and-swap guard deliverOrder uses:
 * a stray reject: tap or a stale button in the admin chat must not stomp a
 * status that already left the awaiting-* set (delivered, delivering,
 * already rejected). `note` is only written when the caller actually passed
 * one — the admin_note column also carries the `proof_auto` OCR marker, and
 * an unconditional write here used to erase it on every reject.
 */
export async function rejectOrderSafely(orderId: number, note?: string | null) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "rejected", ...(note !== undefined ? { admin_note: note } : {}) })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("order_no, display_no, telegram_id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (order) return { ok: true as const, order };

  const { data: existing, error: readErr } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) throw new Error("Order not found");
  return { ok: false as const, status: existing.status };
}

/**
 * Deliver product files as Telegram documents in batches.
 * Each item is claimed with compare-and-swap so parallel cron/admin cannot double-send.
 * Digital goods: always 1 file copy (quantity is for price only).
 */
export async function deliverOrder(
  orderId: number,
  options?: { force?: boolean; resume?: boolean },
) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  let order: NonNullable<Awaited<ReturnType<typeof claimOrderForDelivery>>>;
  const isFullRedeliver = Boolean(options?.force && !options?.resume);

  if (options?.force) {
    const patch: TablesUpdate<"orders"> = { status: "delivering" };
    if (isFullRedeliver) {
      patch.delivery_index = 0;
      patch.delivery_retry_count = 0;
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update(patch)
      .eq("id", orderId)
      .select("*, order_items(*)")
      .single();
    if (error || !data) throw new Error(error?.message || "Order not found");
    order = data;
  } else {
    const claimed = await claimOrderForDelivery(orderId);
    if (!claimed) return { ok: true as const, alreadyDelivered: true, manualRequired: false };
    order = claimed;
  }

  const items = ((order.order_items as OrderItem[]) || []).slice().sort((a, b) => {
    const ai = String(a.id || "");
    const bi = String(b.id || "");
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  if (items.length === 0) {
    await supabaseAdmin
      .from("orders")
      .update({ status: "delivered", delivery_index: 0 })
      .eq("id", orderId);
    return { ok: true as const, pending: false, sent: 0, total: 0, manualRequired: false };
  }

  /**
   * Заказы из каналов Zernio выдаются не в Telegram.
   *
   * Ниже весь код отправляет файлы в Telegram по `order.telegram_id`, а у
   * покупателя из Instagram или WhatsApp этот идентификатор синтетический
   * (отрицательный хеш от user_key) — чата с таким номером не существует, и
   * подтверждение такого заказа здесь просто упало бы.
   *
   * Дальше пути расходятся, и расходятся они по возможностям площадки:
   *
   *  - Instagram Direct не принимает вложениями документы (только картинки,
   *    видео и аудио), а продаются здесь PDF и ZIP. Плюс окно в 24 часа,
   *    открыть которое в Instagram нечем. Обе беды снимает письмо.
   *  - WhatsApp документы принимает, до 100 МБ, и окно умеет открывать
   *    шаблоном. Значит, материалы уходят туда же, где человек платил, —
   *    письмо там только запасной путь.
   */
  if (order.platform === "instagram" || order.platform === "whatsapp") {
    /**
     * Сорвалась выдача — заказ обязан вернуться в исходное состояние.
     *
     * Без этого он оставался в статусе «выдаётся», а такой заказ повторно взять
     * в работу нельзя: claimOrderForDelivery видит «delivering» и честно
     * отвечает «уже выдаётся». Кнопка «Подтвердить и выдать» после этого не
     * делает ничего, и заказ заперт навсегда.
     *
     * Так и вышло с заказом №484: оплата получена, чек и почта на месте, выдача
     * упала на пустом снимке файлов — и продавец больше ничего не мог сделать,
     * а покупательница осталась без материалов. Причина падения ложится в
     * заметку заказа, чтобы её было видно в панели, а не только в логах Vercel.
     */
    try {
      return order.platform === "whatsapp"
        ? await deliverOrderToWhatsApp(orderId, order, items)
        : await deliverOrderByEmail(orderId, order, items);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("orders")
        .update({
          status: "awaiting_confirmation",
          admin_note: `Выдача не удалась: ${reason}`.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("status", "delivering");
      throw e;
    }
  }

  let sent = 0;
  let manualRequired = false;
  let announcedContinue = false;

  // multi_language выключен → без выбора языка и без казахских материалов,
  // даже если они когда-то были заведены в товаре: снимок заказа хранит обе
  // версии всегда (см. bot.server.ts placeOrder), а какую отдавать — решает
  // модуль, а не наличие файла.
  const { hasModule } = await import("./modules/modules.server");
  const multiLanguageOn = await hasModule("multi_language");

  try {
    for (let n = 0; n < BATCH_SIZE; n++) {
      const { data: fresh, error: readErr } = await supabaseAdmin
        .from("orders")
        .select(
          "status, delivery_index, delivery_retry_count, admin_note, telegram_id, order_no, display_no, delivery_lang_choice",
        )
        .eq("id", orderId)
        .single();
      if (readErr || !fresh) throw new Error(readErr?.message || "Order not found");

      if (fresh.status !== "delivering") {
        return {
          ok: true as const,
          alreadyDelivered: true,
          sent,
          total: items.length,
          manualRequired,
        };
      }

      const idx = Math.max(0, Number(fresh.delivery_index) || 0);
      if (idx >= items.length) break;

      // Тот же номер, что покупатель уже видел при оформлении — не живой
      // order_no (его двигает ночная перенумерация заказов), см. MIGRATION-28.
      const displayNo = fresh.display_no ?? fresh.order_no ?? orderId;

      // Мы не увеличиваем delivery_index заранее (чтобы не пропустить файл при краше Vercel/таймауте).
      // Если файл успешно отправлен, мы делаем CAS-обновление индекса.
      if (idx === 0) {
        await tg("sendMessage", {
          chat_id: fresh.telegram_id,
          text: `✅ Оплата подтверждена! Заказ #${displayNo}.\nОтправляю ваши материалы файлами (${items.length} шт.)…`,
        });
      } else if (!announcedContinue) {
        announcedContinue = true;
        await tg("sendMessage", {
          chat_id: fresh.telegram_id,
          text: `📤 Продолжаю выдачу заказа #${displayNo}: с позиции ${idx + 1} из ${items.length}…`,
        });
      }

      const item = items[idx];
      // multi_language выключен → только ru, как и раньше, независимо от
      // того, сколько языков реально заведено у товара.
      const availableLangs: Locale[] = multiLanguageOn
        ? MATERIAL_LANGUAGES.filter((lang) => materialsForOrderItem(item, lang).length > 0)
        : materialsForOrderItem(item, "ru").length > 0
          ? ["ru"]
          : [];
      // Язык уже выбран ДО оформления (delivery_lang_timing = "before",
      // см. bot.server.ts proceedToLanguageOrPlace) — тогда после оплаты
      // никаких вопросов, сразу отправляем.
      const langChoice = multiLanguageOn
        ? (fresh.delivery_lang_choice as DeliveryLangChoice | null)
        : null;

      // 1. Продвигаем индекс вперёд с помощью CAS ДО отправки файла
      const { data: updated } = await supabaseAdmin
        .from("orders")
        .update({ delivery_index: idx + 1, updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("status", "delivering")
        .eq("delivery_index", idx)
        .select("id")
        .maybeSingle();

      if (!updated) {
        // Другой воркер уже взял этот файл в работу (состояние гонки предотвращено).
        break;
      }

      // "sent" — фактически ушло покупателю; "failed_retry" — стоит попробовать
      // ещё раз (сеть моргнула, Telegram на секунду отклонил запрос);
      // "failed_manual" — повторять бессмысленно (файл пуст, слишком велик,
      // хранилище не отдаёт), это работа для продавца, а не для крона.
      let itemOutcome: "sent" | "failed_retry" | "failed_manual" = "sent";
      let failReason: string | undefined;
      try {
        if (availableLangs.length === 0) {
          // Нет файла — ничего не отправляем
          itemOutcome = "sent";
        } else if (langChoice === "all") {
          // «Все языки» — цена уже учла множитель при оформлении, здесь
          // просто отправляем каждый доступный для этой позиции язык.
          let allOk = true;
          for (const lang of availableLangs) {
            const materials = materialsForOrderItem(item, lang);
            const result = await sendMaterials(
              fresh.telegram_id,
              materials,
              `${item.name_snapshot} (${localeNames[lang]})`,
              1,
            );
            if (result.outcome !== "sent") {
              allOk = false;
              failReason = result.reason;
            }
          }
          itemOutcome = allOk ? "sent" : "failed_retry";
        } else if (langChoice) {
          // Конкретный язык выбран заранее — если у этой позиции его нет
          // (у другой позиции корзины он был), берём любой доступный вместо
          // того, чтобы переспрашивать после оплаты.
          const materials = availableLangs.includes(langChoice)
            ? materialsForOrderItem(item, langChoice)
            : materialsForOrderItemAnyLang(item);
          const result = await sendMaterials(fresh.telegram_id, materials, item.name_snapshot, 1);
          itemOutcome = result.outcome;
          failReason = result.reason;
        } else if (availableLangs.length > 1) {
          const pickRes = await tg("sendMessage", {
            chat_id: fresh.telegram_id,
            text: `📚 Материал «<b>${item.name_snapshot}</b>»\nВыберите язык, на котором хотите получить файл:`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                availableLangs.map((lang) => ({
                  text: `${localeFlags[lang]} ${localeNames[lang]}`,
                  callback_data: `lang_${lang}:${orderId}:${idx}`,
                })),
              ],
            },
          });
          if (!pickRes?.ok) {
            itemOutcome = "failed_retry";
            console.error("[orders] language-pick message failed", pickRes);
          }
        } else {
          const materials = materialsForOrderItem(item, availableLangs[0]);
          // Always 1 copy — quantity is for cart price, not file copies
          const result = await sendMaterials(fresh.telegram_id, materials, item.name_snapshot, 1);
          itemOutcome = result.outcome;
          failReason = result.reason;
        }
      } catch (e) {
        itemOutcome = "failed_retry";
        console.error(`[orders] deliver item ${idx} of order #${orderId} failed`, e);
      }

      if (itemOutcome === "sent") {
        sent++;
        // Индекс уже сдвинут на idx+1 выше — сбрасываем счётчик попыток, чтобы
        // он не переносился со сбоя прошлого материала на следующий.
        if (fresh.delivery_retry_count) {
          await supabaseAdmin.from("orders").update({ delivery_retry_count: 0 }).eq("id", orderId);
        }
        if (n + 1 < BATCH_SIZE && idx + 1 < items.length) await sleep(ITEM_DELAY_MS);
        continue;
      }

      if (itemOutcome === "failed_retry") {
        const retryCount = (Number(fresh.delivery_retry_count) || 0) + 1;

        if (retryCount > MAX_DELIVERY_RETRIES) {
          // Сдаёмся автоматически повторять — дальше это работа продавца.
          manualRequired = true;
          const note =
            `Не удалось выдать «${item.name_snapshot}» после ${MAX_DELIVERY_RETRIES} попыток — вышлите вручную.`.slice(
              0,
              500,
            );
          await supabaseAdmin
            .from("orders")
            .update({
              delivery_retry_count: 0,
              admin_note: note,
              updated_at: new Date().toISOString(),
            })
            .eq("id", orderId);
          await notifyAdminsAboutDeliveryIssue(`⚠️ Заказ #${displayNo}: ${note}`);
          await tg("sendMessage", {
            chat_id: fresh.telegram_id,
            text: `⚠️ Не удалось отправить «${item.name_snapshot}» — продавец вышлет вручную.`,
          });
          sent++;
          if (n + 1 < BATCH_SIZE && idx + 1 < items.length) await sleep(ITEM_DELAY_MS);
          continue;
        }

        // Откат CAS лока с обязательным обновлением updated_at, чтобы cron
        // подождал 2 минуты до следующей попытки и не спамил. Счётчик попыток
        // растёт вместе с откатом — это и есть потолок Блока 1.7.
        //
        // Условие `.eq("delivery_index", idx + 1)` — сам откат тоже CAS
        // (Блок 1.5): аренда на выдачу живёт 2 минуты, а одна большая
        // загрузка может пережить этот срок. Тогда cron уже мог поднять
        // второго воркера, который ушёл вперёд с той же позиции. Безусловная
        // запись откатила бы его прогресс назад, и уже отправленные позиции
        // ушли бы покупателю повторно.
        const { data: rolledBack } = await supabaseAdmin
          .from("orders")
          .update({
            delivery_index: idx,
            delivery_retry_count: retryCount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId)
          .eq("status", "delivering")
          .eq("delivery_index", idx + 1)
          .select("id")
          .maybeSingle();

        if (!rolledBack) {
          // Другой воркер уже продвинул выдачу дальше нашего отката — он
          // устарел бы и заставил повторно отправить уже доставленные
          // позиции. Оставляем прогресс как есть, помечаем на ручную проверку.
          manualRequired = true;
          const note =
            `Не удалось отправить «${item.name_snapshot}», но выдачу уже продолжил другой процесс — проверьте вручную.`.slice(
              0,
              500,
            );
          await notifyAdminsAboutDeliveryIssue(`⚠️ Заказ #${displayNo}: ${note}`);
          break;
        }

        await tg("sendMessage", {
          chat_id: fresh.telegram_id,
          text: `⚠️ Не удалось отправить «${item.name_snapshot}». Попробую ещё раз чуть позже; если не придёт — продавец вышлет вручную.`,
        });
        break;
      }

      // itemOutcome === "failed_manual" — повторять нет смысла, индекс уже
      // сдвинут, просто фиксируем и идём дальше.
      manualRequired = true;
      const note =
        `Материал «${item.name_snapshot}» требует ручной отправки${failReason ? `: ${failReason}` : ""}.`.slice(
          0,
          500,
        );
      await supabaseAdmin
        .from("orders")
        .update({ delivery_retry_count: 0, admin_note: note, updated_at: new Date().toISOString() })
        .eq("id", orderId);
      await notifyAdminsAboutDeliveryIssue(`⚠️ Заказ #${displayNo}: ${note}`);
      sent++;
      if (n + 1 < BATCH_SIZE && idx + 1 < items.length) await sleep(ITEM_DELAY_MS);
    }

    const { data: after } = await supabaseAdmin
      .from("orders")
      .select("delivery_index, status, telegram_id, admin_note")
      .eq("id", orderId)
      .single();

    const doneIdx = Number(after?.delivery_index) || 0;
    const everManualRequired = manualRequired || Boolean(after?.admin_note?.trim());
    if (after?.status === "delivering" && doneIdx >= items.length) {
      const { data: finished } = await supabaseAdmin
        .from("orders")
        .update({ status: "delivered" })
        .eq("id", orderId)
        .eq("status", "delivering")
        .gte("delivery_index", items.length)
        .select("id")
        .maybeSingle();

      if (finished) {
        const text = everManualRequired
          ? `🙏 Оплата по заказу #${orderId} подтверждена. Часть материалов продавец вышлет вручную — ожидайте, пожалуйста.`
          : `🙏 Спасибо за покупку! Заказ #${orderId} выдан (${items.length} материалов). Если что-то не так — напишите продавцу.`;
        await tg("sendMessage", { chat_id: after.telegram_id, text });
        const { rewardReferralIfFirstDelivery } = await import("./referrals.server");
        await rewardReferralIfFirstDelivery(after.telegram_id).catch((e) =>
          console.error("[orders] rewardReferralIfFirstDelivery failed", e),
        );
        const { awardPointsForDelivery } = await import("./loyalty.server");
        await awardPointsForDelivery(orderId, after.telegram_id).catch((e) =>
          console.error("[orders] awardPointsForDelivery failed", e),
        );
      }
      return {
        ok: true as const,
        pending: false,
        sent,
        total: items.length,
        manualRequired: everManualRequired,
      };
    }

    return {
      ok: true as const,
      pending: after?.status === "delivering" && doneIdx < items.length,
      sent,
      next: doneIdx,
      total: items.length,
      manualRequired: everManualRequired,
    };
  } catch (e) {
    console.error(`[orders] deliverOrder #${orderId} interrupted`, e);
    throw e;
  }
}

/** Continue all orders stuck in delivering (called from cron). */
export async function processPendingDeliveries(limit = 3) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("status", "delivering")
    // Подхватывать зависшие только если прошло > 2 минут с последнего действия
    .lte("updated_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!rows?.length) return { processed: 0, continued: 0, finished: 0 };

  let continued = 0;
  let finished = 0;
  for (const row of rows) {
    try {
      const res = await deliverOrder(row.id as number, { force: true, resume: true });
      if ("pending" in res && res.pending) continued++;
      else if (!("alreadyDelivered" in res && res.alreadyDelivered)) finished++;
    } catch (e) {
      console.error("[orders] pending delivery failed", row.id, e);
    }
  }
  return { processed: rows.length, continued, finished };
}

/**
 * Кейс 3, №4 — самообслуживание «Мои покупки»: повторная отправка уже
 * выданных файлов заказа по запросу самого покупателя. В отличие от
 * deliverOrder({force:true}) не трогает статус/delivery_index заказа вообще
 * — просто ещё раз шлёт то, что один раз уже ушло покупателю, без побочных
 * эффектов на выдачу (и без повторных наград за баллы/рефералов — те
 * привязаны к самому событию deliverOrder, а не к этой функции).
 */
export async function resendOrderFiles(
  orderId: number,
  telegramId: number,
): Promise<{ ok: true; sent: number } | { ok: false; reason: "not_found" | "not_delivered" }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, status, telegram_id, delivery_lang_choice, order_items(*)")
    .eq("id", orderId)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!order) return { ok: false, reason: "not_found" };
  if (order.status !== "delivered") return { ok: false, reason: "not_delivered" };

  const items = (order.order_items as OrderItem[]) || [];
  // order.delivery_lang_choice — только у заказов с delivery_lang_timing =
  // "before" (язык спрошен ДО оформления, см. bot.server.ts
  // proceedToLanguageOrPlace). У более распространённого сценария — язык
  // спрашивается ВО ВРЕМЯ выдачи, кнопкой на каждую позицию — эта колонка
  // остаётся null навсегда, а реально отправленный язык записан по каждой
  // позиции отдельно в item.delivered_language (см. bot.server.ts,
  // обработчик callback_data "lang_<lang>:").
  const langChoice = order.delivery_lang_choice as DeliveryLangChoice | null;
  let sent = 0;
  for (const item of items) {
    if (langChoice === "all") {
      const langs = MATERIAL_LANGUAGES.filter(
        (lang) => materialsForOrderItem(item, lang).length > 0,
      );
      for (const lang of langs) {
        const materials = materialsForOrderItem(item, lang);
        if (materials.length === 0) continue;
        await sendMaterials(
          telegramId,
          materials,
          `${item.name_snapshot} (${localeNames[lang]})`,
          1,
        );
      }
      if (langs.length > 0) sent++;
      continue;
    }
    if (langChoice && materialsForOrderItem(item, langChoice).length > 0) {
      await sendMaterials(
        telegramId,
        materialsForOrderItem(item, langChoice),
        item.name_snapshot,
        1,
      );
      sent++;
      continue;
    }
    // Ни "все языки", ни конкретный дозаказный выбор не применимы — берём
    // то, что реально было отправлено на выдаче (может быть несколько
    // языков, если покупатель запрашивал не один). Только если для этой
    // позиции вообще ничего не записано (совсем старый заказ до этой
    // колонки, либо магазин без мультиязычности), берём любой доступный —
    // раньше отправлялось всегда именно так, независимо от того, что
    // покупатель на самом деле получил.
    const deliveredLangs = [...parseDeliveredLanguages(item.delivered_language)];
    if (deliveredLangs.length > 0) {
      for (const lang of deliveredLangs) {
        const materials = materialsForOrderItem(item, lang);
        if (materials.length === 0) continue;
        await sendMaterials(
          telegramId,
          materials,
          deliveredLangs.length > 1
            ? `${item.name_snapshot} (${localeNames[lang]})`
            : item.name_snapshot,
          1,
        );
      }
      sent++;
      continue;
    }
    const materials = materialsForOrderItemAnyLang(item);
    if (materials.length === 0) continue;
    await sendMaterials(telegramId, materials, item.name_snapshot, 1);
    sent++;
  }
  return { ok: true, sent };
}

export type SendMaterialsResult = {
  outcome: "sent" | "failed_retry" | "failed_manual";
  reason?: string;
};

// Sends every material for one order item — the deliverable can be a single
// file or a set of photos (e.g. several worksheet pages), each sent in turn.
// Aggregates to "sent" only if every file in the set reached Telegram: the
// caller's CAS lock treats the item as one unit and retries/gives up on the
// whole set, so a partial send (2 of 3 photos) is not tracked separately.
// A single "failed_retry" material makes the whole set "failed_retry" (worth
// a full re-attempt); otherwise a "failed_manual" material makes the whole
// set "failed_manual".
export async function sendMaterials(
  chat_id: number,
  materials: MaterialFile[],
  caption: string,
  quantity: number,
): Promise<SendMaterialsResult> {
  let worst: SendMaterialsResult["outcome"] = "sent";
  let reason: string | undefined;
  // With several photos for one material, repeating the product name on
  // every single one reads as spam — caption only the first file. A plain
  // for-loop (not forEach) so each send is awaited before the next starts.
  for (let idx = 0; idx < materials.length; idx++) {
    const m = materials[idx];
    const itemCaption = idx === 0 ? caption : "";
    if (m.url) {
      const res = await tg("sendMessage", {
        chat_id,
        text: itemCaption
          ? `📁 <b>${itemCaption}</b>\n\n📥 <a href="${m.url}">Нажмите здесь, чтобы скачать файл</a>`
          : `📥 <a href="${m.url}">Нажмите здесь, чтобы скачать файл</a>`,
        parse_mode: "HTML",
      });
      if (!res?.ok) {
        console.error("[orders] sendMessage (url material) failed", res);
        if (worst !== "failed_retry") {
          worst = "failed_retry";
          reason = "не удалось отправить ссылку в Telegram";
        }
      }
    } else if (m.path) {
      const result = await sendFileToUser(
        chat_id,
        m.path,
        m.name || "file.bin",
        itemCaption,
        quantity,
      );
      if (!result.delivered) {
        if (result.retry) {
          worst = "failed_retry";
          reason = result.reason ?? reason;
        } else if (worst !== "failed_retry") {
          worst = "failed_manual";
          reason = result.reason ?? reason;
        }
      }
    }
  }
  return { outcome: worst, reason };
}

export type SendFileResult =
  { delivered: true } | { delivered: false; retry: boolean; reason?: string };

/** Sends one document to Telegram, reporting whether it actually reached the chat. */
export async function sendFileToUser(
  chat_id: number,
  path: string,
  downloadName: string,
  caption: string,
  quantity: number,
): Promise<SendFileResult> {
  void quantity;
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const filename = downloadName || "file.bin";
  const ext = (filename.split(".").pop() || "").toLowerCase();
  // Telegram can fetch these by URL — avoids Vercel RAM/timeout on big PDFs
  const telegramUrlTypes = new Set(["pdf", "zip", "gif"]);

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("product-files")
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  let fileSize = 0;
  if (!signErr && signed?.signedUrl) {
    try {
      const headRes = await fetch(signed.signedUrl, { method: "HEAD" });
      fileSize = Number(headRes.headers.get("content-length")) || 0;
    } catch {
      /* ignore */
    }
  }

  const TG_MAX = MAX_FILE_BYTES;
  // Cloud Bot API hard limit ~50MB; Local Bot API can go higher via TELEGRAM_API_BASE
  const CLOUD_TG_MAX = 50 * 1024 * 1024;

  async function sendViaTelegramUrl(): Promise<boolean> {
    if (!signed?.signedUrl || !telegramUrlTypes.has(ext)) return false;
    if (
      fileSize > 0 &&
      fileSize > Math.min(TG_MAX, CLOUD_TG_MAX) &&
      !process.env.TELEGRAM_API_BASE
    ) {
      // URL method also capped ~20MB by Telegram for some cases; still try below for pdf
    }
    const res = await tg("sendDocument", {
      chat_id,
      document: signed.signedUrl,
      caption,
    });
    if (!res?.ok) {
      console.error("[orders] sendDocument URL failed", res);
      return false;
    }
    return true;
  }

  // Prefer URL for pdf/zip/gif — Telegram downloads itself, no heavy Vercel upload
  if (telegramUrlTypes.has(ext)) {
    if (await sendViaTelegramUrl()) return { delivered: true };
  }

  const { data: dl, error: dlErr } = await supabaseAdmin.storage
    .from("product-files")
    .download(path);
  if (dlErr || !dl) {
    if (await sendViaTelegramUrl()) return { delivered: true };
    console.error("[orders] storage download failed", path, dlErr);
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Не удалось получить файл «${caption}» из хранилища. Продавец вышлет вручную.`,
    });
    // Хранилище не отдаёт файл — повтор ничего не изменит, это ручная выдача.
    return { delivered: false, retry: false, reason: "хранилище не отдало файл" };
  }

  // Прокидываем Blob напрямую в FormData через обновленный tgSendMultipart
  // Это потоковая передача, которая защищает Vercel от краша по памяти (OOM) на больших файлах (например, тяжелые .7z)
  const mime = dl.type || "application/octet-stream";

  if (dl.size === 0) {
    console.error("[orders] empty file", path);
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Файл «${caption}» пустой. Продавец вышлет вручную.`,
    });
    return { delivered: false, retry: false, reason: "файл пустой" };
  }

  if (dl.size > TG_MAX) {
    if (await sendViaTelegramUrl()) return { delivered: true };
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Файл «${caption}» слишком большой (${Math.round(dl.size / (1024 * 1024))} МБ, лимит ${Math.round(TG_MAX / (1024 * 1024))} МБ). Продавец вышлет вручную.`,
    });
    // Постоянная проблема размера — повтор её не решит.
    return { delivered: false, retry: false, reason: "файл больше лимита" };
  }

  // Telegram renders sendPhoto inline in the chat — what the client asked
  // for instead of a downloadable file attachment. sendPhoto's own upload
  // limit is 10MB and it rejects some image subtypes, so fall back to
  // sendDocument below whenever it fails.
  if (mime.startsWith("image/") && dl.size < 10 * 1024 * 1024) {
    const photoRes = await tgSendMultipart(
      "sendPhoto",
      { chat_id, caption },
      { field: "photo", filename, blob: dl, contentType: mime },
    );
    if (photoRes?.ok) return { delivered: true };
    console.error("[orders] sendPhoto multipart failed, falling back to sendDocument", photoRes);
  }

  const res = await tgSendMultipart(
    "sendDocument",
    { chat_id, caption },
    { field: "document", filename, blob: dl, contentType: mime },
  );

  if (res?.ok) return { delivered: true };

  console.error("[orders] sendDocument multipart failed", res);
  if (await sendViaTelegramUrl()) return { delivered: true };

  if (dl.size > CLOUD_TG_MAX) {
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Файл «${caption}» (${Math.round(dl.size / (1024 * 1024))} МБ) не проходит через облачный Telegram API (лимит ~50 МБ). Нужен Local Bot API или ручная выдача.`,
    });
    // Без Local Bot API повтор не поможет.
    return { delivered: false, retry: false, reason: "нужен Local Bot API" };
  }

  // Отправка не прошла, но причина может быть временной (сеть, троттлинг) —
  // стоит попробовать ещё раз.
  return { delivered: false, retry: true, reason: "Telegram отклонил отправку" };
}

/** Сколько живут ссылки в письме. То же значение, что у выдачи в Telegram. */
const EMAIL_LINK_DAYS = 7;

/**
 * Имя, под которым файл сохранится у покупателя.
 *
 * Название товара расширения не содержит, а в хранилище лежит обезличенное
 * `1782643012614-ni1xub.pdf` — берём человеческое имя и дописываем к нему
 * расширение из настоящего пути. Символы, запрещённые в именах файлов,
 * заменяем, иначе часть систем сохранит файл под случайным именем.
 */
export function downloadFileName(displayName: string, storagePath: string): string {
  const extension = storagePath.includes(".") ? storagePath.split(".").pop()!.toLowerCase() : "";
  const base = displayName
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const safeBase = base || "Материал";
  if (!extension) return safeBase;
  return safeBase.toLowerCase().endsWith(`.${extension}`) ? safeBase : `${safeBase}.${extension}`;
}

/**
 * Собрать подписанные ссылки на все файлы заказа.
 *
 * Вынесено из выдачи письмом, когда те же файлы понадобились WhatsApp: там
 * материалы уходят вложением прямо в переписку, но правила сборки списка те
 * же самые — снимок заказа, откат на текущие файлы товара, если снимок пуст,
 * и подпись со скачиванием под человеческим именем.
 *
 * `missing` — имена материалов, для которых не удалось подписать ссылку
 * (`createSignedUrl` вернул ошибку). Раньше такой материал просто выпадал из
 * `files` без следа, и покупатель, оплативший 5 материалов, получал письмо
 * с 3 ссылками, а заказ всё равно закрывался как «выдан» — см. Блок 1.3.
 */
async function collectOrderFiles(
  orderId: number,
  items: OrderItem[],
): Promise<{ files: Array<{ name: string; url: string }>; missing: string[] }> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const files: Array<{ name: string; url: string }> = [];
  const missing: string[] = [];
  for (const item of items) {
    // Материалы бывают из нескольких файлов (модуль multi_files), и у старых
    // заказов заполнены только одиночные *_snapshot — разворачиваем оба вида
    // тем же помощником, что и выдача в Telegram, иначе часть файлов пропала
    // бы молча.
    let materials: MaterialFile[] = materialsForOrderItemAnyLang(item);

    /**
     * Снимок пуст — берём файлы товара как они есть сейчас.
     *
     * Пустой снимок ничего не хранит, поэтому «сохранить проданное» тут нечего
     * терять: отправить актуальный файл строго лучше, чем отказать человеку,
     * который заплатил. Так спасаются заказы, оформленные до того, как снимок
     * научился копировать product_material_files (см. product-materials.ts) —
     * заказ №484 в том числе: продавцу достаточно нажать «Выдать повторно».
     */
    if (materials.length === 0 && item.product_id) {
      const { materialsForProduct } = await import("./product-materials");
      const { data: product } = await supabaseAdmin
        .from("products")
        .select(
          "file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz, product_material_files(language, file_path, file_name, sort_order)",
        )
        .eq("id", item.product_id)
        .maybeSingle();
      for (const lang of MATERIAL_LANGUAGES) {
        materials = materialsForProduct(product, lang);
        if (materials.length > 0) break;
      }
      if (materials.length > 0) {
        console.warn(
          `[orders] заказ ${orderId}: снимок файлов пуст, отправляю текущие файлы товара ${item.product_id}`,
        );
      }
    }

    for (const material of materials) {
      // Готовая внешняя ссылка — отдаём как есть, подписывать нечего.
      if (material.url) {
        files.push({ name: material.name || item.name_snapshot || "Материал", url: material.url });
        continue;
      }
      if (!material.path) continue;
      /**
       * `download` в подписи — не украшение.
       *
       * Без него ссылка отдаётся с `Content-Disposition: inline`, и покупатель
       * попадает на страницу хранилища: PDF открывается прямо в браузере, а
       * ZIP и вовсе показывается непонятной технической страницей. Человек
       * ждал файл, а получил «ссылку на какую-то базу данных».
       *
       * С этим параметром сервер отдаёт вложение и подставляет то имя, что мы
       * передали: покупатель видит «Пазлы БУКВЫ.pdf», а не `1782643012614-ni1xub.pdf`.
       */
      const displayName = material.name || item.name_snapshot || "Материал";
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from("product-files")
        .createSignedUrl(material.path, EMAIL_LINK_DAYS * 24 * 60 * 60, {
          download: downloadFileName(displayName, material.path),
        });
      if (signed?.signedUrl) {
        files.push({ name: displayName, url: signed.signedUrl });
      } else {
        console.error(
          `[orders] заказ ${orderId}: не удалось подписать ссылку для «${displayName}»`,
          signErr,
        );
        missing.push(displayName);
      }
    }
  }

  return { files, missing };
}

/**
 * Выдача заказа прямо в переписку WhatsApp.
 *
 * Здесь снимается ограничение, из-за которого заказы из Instagram приходится
 * отправлять письмом: WhatsApp принимает документы вложением, до 100 МБ. То
 * есть покупатель получает файл там же, где платил, — без письма, без папки
 * «Спам» и без просьбы продиктовать адрес.
 *
 * Что осталось от Meta и обойти нельзя — окно в 24 часа. Продавец подтверждает
 * оплату когда придётся, нередко на следующий день, и к этому моменту писать
 * свободным текстом уже нельзя. Поэтому:
 *
 *  - файлы уходят обычной отправкой (внутри окна она бесплатна и работает);
 *  - если окно закрыто, `sendWhatsAppOutsideWindow` открывает его шаблоном или
 *    служебным сообщением, и после этого файлы уходят следом;
 *  - если не удалось и это — откатываемся на письмо, когда адрес известен.
 *
 * Молча «не отправить» нельзя ни в одном из вариантов: для покупателя это
 * оплаченный и потерянный заказ. По той же причине заказ помечается
 * `delivered` только если реально ушли все файлы — если часть застряла,
 * статус остаётся «на подтверждении», продавец получает уведомление
 * (см. Блок 1.2), и повторное «Подтвердить» можно нажать снова.
 */
async function deliverOrderToWhatsApp(
  orderId: number,
  order: {
    customer_email?: string | null;
    order_no?: number | null;
    display_no?: number | null;
    user_key?: string | null;
  },
  items: OrderItem[],
) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { sendZernioInboxMessage } = await import("./zernio.server");
  const { sendWhatsAppOutsideWindow } = await import("./whatsapp.server");

  const { data: buyer } = await supabaseAdmin
    .from("bot_users")
    .select("zernio_conversation_id, zernio_account_id, user_key")
    .eq("user_key", order.user_key || "")
    .maybeSingle();

  const conversationId = buyer?.zernio_conversation_id;
  const accountId = buyer?.zernio_account_id;
  if (!conversationId || !accountId) {
    throw new Error(
      "У покупателя не сохранён диалог WhatsApp — отправлять материалы некуда. " +
        "Напишите ему из админки, вкладка WhatsApp → Чаты.",
    );
  }

  const { files, missing } = await collectOrderFiles(orderId, items);
  if (files.length === 0) {
    throw new Error("У товаров в заказе не приложены файлы — отправлять нечего.");
  }

  const displayNo = order.display_no ?? order.order_no ?? orderId;
  // `wa_<телефон>` — номер покупателя лежит прямо в ключе (см. USER_KEY_PREFIX).
  const phone = (buyer?.user_key || "").startsWith("wa_") ? (buyer?.user_key || "").slice(3) : null;

  const opened = await sendWhatsAppOutsideWindow({
    accountId,
    conversationId,
    phone,
    text: `✅ Оплата подтверждена! Заказ №${displayNo}.\nОтправляю ваши материалы (${files.length} шт.)…`,
  });
  if (!opened.ok) {
    /**
     * Открыть окно не вышло — обычный случай для WABA без доступа к Direct
     * Send: продавец подтверждает оплату часто на следующий день, окно
     * закрыто, а одобренный шаблон для заказов никто не настраивал (Блок
     * B.1, кейс 2, раунд 2). Комментарий выше по функции всегда обещал
     * откат на письмо здесь же — раньше он был реализован только для
     * случая «окно открылось, но файлы не прошли» (ниже), не для этого.
     */
    if (order.customer_email?.trim()) {
      console.warn(
        `[orders] заказ ${orderId}: не удалось открыть окно WhatsApp (${opened.error}), отправляю письмом`,
      );
      return await deliverOrderByEmail(orderId, order, items);
    }
    throw new Error(
      opened.error ||
        "Не удалось написать покупателю в WhatsApp — окно ответа закрыто, а шаблон недоступен.",
    );
  }

  // Открытие окна шаблоном/Direct Send шло по телефону, а не по старому
  // диалогу, и Zernio мог вернуть другой id (Блок B.2) — используем его для
  // вложений ниже и запоминаем на будущее, иначе следующее сообщение снова
  // уйдёт по устаревшему id.
  const activeConversationId = opened.conversationId || conversationId;
  if (activeConversationId !== conversationId) {
    await supabaseAdmin
      .from("bot_users")
      .update({ zernio_conversation_id: activeConversationId })
      .eq("user_key", order.user_key || "");
  }

  let sent = 0;
  for (const file of files) {
    const result = await sendZernioInboxMessage(activeConversationId, accountId, "", {
      attachmentUrl: file.url,
      attachmentType: "file",
      // Без имени WhatsApp выводит его из URL, а там подписанная ссылка
      // хранилища — покупатель увидел бы «Untitled» вместо названия материала.
      attachmentName: file.name,
      platform: "whatsapp",
    });
    if (result.ok) {
      sent += 1;
    } else {
      console.error(`[orders] заказ ${orderId}: файл «${file.name}» не ушёл — ${result.error}`);
    }
  }

  if (sent === 0) {
    /**
     * Ни один файл не дошёл. Письмо — честный запасной путь, но только если
     * адрес известен: выдумывать его неоткуда, а сделать вид, что материалы
     * отправлены, нельзя.
     */
    if (order.customer_email?.trim()) {
      console.warn(`[orders] заказ ${orderId}: вложения в WhatsApp не прошли, отправляю письмом`);
      return await deliverOrderByEmail(orderId, order, items);
    }
    throw new Error("Материалы не удалось отправить вложением, а почты у заказа нет.");
  }

  const totalExpected = files.length + missing.length;
  const fullyDelivered = sent === files.length && missing.length === 0;

  if (fullyDelivered) {
    await supabaseAdmin
      .from("orders")
      .update({ status: "delivered", delivery_index: items.length })
      .eq("id", orderId);
  } else {
    const parts: string[] = [];
    if (sent < files.length) parts.push(`ушло ${sent} из ${files.length} вложений`);
    if (missing.length) parts.push(`не удалось подготовить: ${missing.join(", ")}`);
    const note = `WhatsApp: ${parts.join("; ")}. Остальное вышлите вручную.`.slice(0, 500);

    await supabaseAdmin
      .from("orders")
      .update({
        status: "awaiting_confirmation",
        admin_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("status", "delivering");

    await notifyAdminsAboutDeliveryIssue(`⚠️ Заказ #${displayNo}: ${note}`);

    try {
      await sendZernioInboxMessage(
        conversationId,
        accountId,
        `⚠️ Отправили ${sent} из ${totalExpected} материалов. Остальное вышлет продавец вручную — доступ уже оплачен, не переживайте.`,
        { platform: "whatsapp" },
      );
    } catch (e) {
      console.error(`[orders] заказ ${orderId}: не удалось предупредить о частичной выдаче`, e);
    }
  }

  return {
    ok: true as const,
    alreadyDelivered: false,
    pending: !fullyDelivered,
    sent,
    total: totalExpected,
    manualRequired: !fullyDelivered,
  };
}

/**
 * Выдача заказа письмом — для покупателей из Instagram.
 *
 * Материалы уходят подписанными ссылками, а не вложениями: файлы бывают до
 * 100 МБ, и почтовый сервер такое письмо просто отобьёт — причём уже после
 * того, как продавец нажал «Подтвердить», и он об этом не узнает.
 */
async function deliverOrderByEmail(
  orderId: number,
  order: {
    customer_email?: string | null;
    order_no?: number | null;
    display_no?: number | null;
    user_key?: string | null;
  },
  items: OrderItem[],
) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const { sendOrderMaterialsEmail, isMailConfigured } = await import("./mail.server");

  let email = order.customer_email?.trim();

  /*
   * Some early Direct orders retained the buyer's address only in bot_users.
   * Do not reject a paid order merely because its order snapshot is missing it:
   * restore the address from the same buyer profile and persist it so every
   * subsequent delivery attempt uses the immutable order record.
   */
  if (!email && order.user_key) {
    const { data: buyer, error } = await supabaseAdmin
      .from("bot_users")
      .select("email")
      .eq("user_key", order.user_key)
      .maybeSingle();
    if (error) throw new Error(error.message);

    email = buyer?.email?.trim();
    if (email) {
      const { error: updateError } = await supabaseAdmin
        .from("orders")
        .update({ customer_email: email })
        .eq("id", orderId);
      if (updateError) throw new Error(updateError.message);
    }
  }

  if (!email) {
    throw new Error(
      "У заказа не указана почта покупателя — отправлять материалы некуда. " +
        "Спросите адрес в переписке и впишите его в заказ.",
    );
  }
  if (!isMailConfigured()) {
    throw new Error(
      "Отправка почты не настроена: задайте SMTP_HOST, SMTP_USER и SMTP_PASSWORD в переменных окружения.",
    );
  }

  const { files, missing } = await collectOrderFiles(orderId, items);

  if (files.length === 0) {
    throw new Error("У товаров в заказе не приложены файлы — отправлять нечего.");
  }

  const { data: shopSetting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "shop_name")
    .maybeSingle();

  const result = await sendOrderMaterialsEmail({
    to: email,
    orderNo: order.display_no ?? order.order_no ?? orderId,
    shopName: shopSetting?.value?.trim() || "Магазин",
    files,
    linkDays: EMAIL_LINK_DAYS,
  });

  if (!result.ok) {
    throw new Error(`Письмо не отправилось: ${result.error}`);
  }

  const displayNo = order.display_no ?? order.order_no ?? orderId;

  // Часть материалов не попала в письмо — сказать продавцу прямо, а не
  // полагаться на то, что кто-то заметит меньшее число вложений (Блок 1.3).
  if (missing.length > 0) {
    const note =
      `Письмо отправлено, но не удалось приложить: ${missing.join(", ")}. Отправьте вручную.`.slice(
        0,
        500,
      );
    await supabaseAdmin.from("orders").update({ admin_note: note }).eq("id", orderId);
    await notifyAdminsAboutDeliveryIssue(`⚠️ Заказ #${displayNo}: ${note}`);
  }

  /**
   * Сказать покупателю в переписке, что письмо ушло.
   *
   * Без этого он остаётся в тишине: заказ подтвердили, письмо отправили, а в
   * Direct — ничего. Человек не знает, случилось ли что-нибудь вообще, и идёт
   * спрашивать.
   *
   * Отправка может не пройти: Instagram запрещает писать позже 24 часов с
   * последнего сообщения покупателя, а подтверждение продавца часто приходит
   * на следующий день. Это ожидаемо и не должно ронять выдачу — письмо уже
   * ушло, а оно здесь главное. Поэтому ошибку только пишем в журнал.
   */
  try {
    const { data: buyer } = await supabaseAdmin
      .from("bot_users")
      .select("zernio_conversation_id, zernio_account_id")
      .eq("user_key", order.user_key || "")
      .maybeSingle();

    if (buyer?.zernio_conversation_id && buyer?.zernio_account_id) {
      const { sendZernioInboxMessage } = await import("./zernio.server");
      await sendZernioInboxMessage(
        buyer.zernio_conversation_id,
        buyer.zernio_account_id,
        `Оплата подтверждена — материалы по заказу №${displayNo} отправлены на ${email}.\n\n` +
          `Ссылки в письме действуют ${EMAIL_LINK_DAYS} дней, лучше скачать файлы сразу.\n\n` +
          "Если письма нет — проверьте папку «Спам» и напишите сюда, поможем.",
      );
    }
  } catch (e) {
    console.error("[orders] не удалось сообщить покупателю в Direct об отправке письма", e);
  }

  await supabaseAdmin
    .from("orders")
    .update({ status: "delivered", delivery_index: items.length })
    .eq("id", orderId);

  // `alreadyDelivered` держим в форме ответа намеренно: его читают и админка,
  // и бот, и без него ветка почты выпала бы из общего типа результата.
  return {
    ok: true as const,
    alreadyDelivered: false,
    pending: false,
    sent: files.length,
    total: files.length + missing.length,
    email,
    manualRequired: missing.length > 0,
  };
}

/**
 * Написать покупателю туда, откуда пришёл заказ.
 *
 * Понадобилось, потому что уведомления писались прямо в Telegram по
 * `order.telegram_id`. У покупателя из Instagram этот идентификатор
 * синтетический — отрицательный хеш от его ключа, — чата с таким номером не
 * существует, и сообщение уходило в пустоту. То есть отклонение заказа
 * инста-покупатель не узнавал вовсе: он просто ждал материалы, которых не
 * будет.
 *
 * Возвращает false, если написать не удалось. У Instagram это ожидаемо:
 * платформа запрещает писать позже 24 часов с последнего сообщения покупателя,
 * а продавец разбирает чеки не сразу. Вызывающий код должен учитывать, что
 * доставка сообщения не гарантирована, — но само действие (отклонение, выдача)
 * от этого срываться не должно.
 */
export async function notifyOrderCustomer(orderId: number, text: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("platform, telegram_id, user_key")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return false;

  if (order.platform === "instagram" || order.platform === "whatsapp") {
    const { data: buyer } = await supabaseAdmin
      .from("bot_users")
      .select("zernio_conversation_id, zernio_account_id, user_key")
      .eq("user_key", order.user_key || "")
      .maybeSingle();

    if (!buyer?.zernio_conversation_id || !buyer.zernio_account_id) return false;

    /**
     * В WhatsApp у сообщения продавца есть второй шанс.
     *
     * Отклонение заказа и уведомления о выдаче почти всегда приходят позже
     * суток с последнего сообщения покупателя, то есть за пределами окна Meta.
     * В Instagram на этом всё и заканчивается — там открыть окно нечем. В
     * WhatsApp можно: шаблоном или служебным сообщением. Разница ровно в том,
     * узнает ли человек, что его заказ отклонили.
     */
    if (order.platform === "whatsapp") {
      const { sendWhatsAppOutsideWindow } = await import("./whatsapp.server");
      const phone = (buyer.user_key || "").startsWith("wa_")
        ? (buyer.user_key || "").slice(3)
        : null;
      const result = await sendWhatsAppOutsideWindow({
        accountId: buyer.zernio_account_id,
        conversationId: buyer.zernio_conversation_id,
        phone,
        text,
      });
      // Открытие окна могло вернуть другой id диалога (Блок B.2) — сохраняем
      // его, иначе следующее сообщение этому покупателю уйдёт по старому.
      if (result.conversationId && result.conversationId !== buyer.zernio_conversation_id) {
        await supabaseAdmin
          .from("bot_users")
          .update({ zernio_conversation_id: result.conversationId })
          .eq("user_key", buyer.user_key || order.user_key || "");
      }
      return result.ok;
    }

    const { sendZernioInboxMessage } = await import("./zernio.server");
    const result = await sendZernioInboxMessage(
      buyer.zernio_conversation_id,
      buyer.zernio_account_id,
      text,
    );
    return result.ok;
  }

  try {
    const response = (await tg("sendMessage", { chat_id: order.telegram_id, text })) as {
      ok?: boolean;
    };
    return response?.ok === true;
  } catch (e) {
    console.error("[orders] не удалось написать покупателю в Telegram", e);
    return false;
  }
}
