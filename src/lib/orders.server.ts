import { tg, tgSendMultipart } from "./telegram.server";
import type { TablesUpdate } from "@/integrations-supabase/types";

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
  /** Какой язык уже отправлен покупателю — только для материалов, где заведены оба (RU и KZ). */
  delivered_language?: string | null;
  quantity: number;
};

export type MaterialFile = { path?: string | null; name?: string | null; url?: string | null };

// Orders placed before multi-file materials existed only have the single
// *_snapshot columns — wrap that into the same array shape so delivery code
// has one path to follow.
export function legacyAsMaterials(
  path?: string | null,
  name?: string | null,
  url?: string | null,
): MaterialFile[] {
  if (url) return [{ url }];
  if (path) return [{ path, name }];
  return [];
}

async function claimOrderForDelivery(orderId: number) {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .update({ status: "delivering", delivery_index: 0 })
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
    if (isFullRedeliver) patch.delivery_index = 0;

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
    if (!claimed) return { ok: true as const, alreadyDelivered: true };
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
    return { ok: true as const, pending: false, sent: 0, total: 0 };
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
  let announcedContinue = false;

  try {
    for (let n = 0; n < BATCH_SIZE; n++) {
      const { data: fresh, error: readErr } = await supabaseAdmin
        .from("orders")
        .select("status, delivery_index, telegram_id, order_no, display_no")
        .eq("id", orderId)
        .single();
      if (readErr || !fresh) throw new Error(readErr?.message || "Order not found");

      if (fresh.status !== "delivering") {
        return { ok: true as const, alreadyDelivered: true, sent, total: items.length };
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
      // Orders placed before multi-file materials existed only have the
      // single *_snapshot columns — fall back to those when the new arrays
      // are empty.
      const materialsRu = item.material_files_snapshot?.length
        ? item.material_files_snapshot
        : legacyAsMaterials(
            item.file_path_snapshot,
            item.file_name_snapshot,
            item.file_url_snapshot,
          );
      const materialsKz = item.material_files_kz_snapshot?.length
        ? item.material_files_kz_snapshot
        : legacyAsMaterials(
            item.file_path_kz_snapshot,
            item.file_name_kz_snapshot,
            item.file_url_kz_snapshot,
          );

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

      let itemOk = true;
      try {
        if (materialsRu.length === 0 && materialsKz.length === 0) {
          // Нет файла — ничего не отправляем
          itemOk = true;
        } else if (materialsRu.length > 0 && materialsKz.length > 0) {
          await tg("sendMessage", {
            chat_id: fresh.telegram_id,
            text: `📚 Материал «<b>${item.name_snapshot}</b>»\nВыберите язык, на котором хотите получить файл:`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🇷🇺 Русский", callback_data: `lang_ru:${orderId}:${idx}` },
                  { text: "🇰🇿 Қазақша", callback_data: `lang_kz:${orderId}:${idx}` },
                ],
              ],
            },
          });
          itemOk = true;
        } else {
          const materials = materialsRu.length > 0 ? materialsRu : materialsKz;
          // Always 1 copy — quantity is for cart price, not file copies
          itemOk = await sendMaterials(fresh.telegram_id, materials, item.name_snapshot, 1);
        }
      } catch (e) {
        itemOk = false;
        console.error(`[orders] deliver item ${idx} of order #${orderId} failed`, e);
      }

      if (!itemOk) {
        // Откат (Rollback) CAS лока с обязательным обновлением updated_at,
        // чтобы cron подождал 2 минуты до следующей попытки и не спамил
        await supabaseAdmin
          .from("orders")
          .update({ delivery_index: idx, updated_at: new Date().toISOString() })
          .eq("id", orderId);

        await tg("sendMessage", {
          chat_id: fresh.telegram_id,
          text: `⚠️ Не удалось отправить «${item.name_snapshot}». Попробую ещё раз чуть позже; если не придёт — продавец вышлет вручную.`,
        });
        break;
      }

      sent++;
      if (n + 1 < BATCH_SIZE && idx + 1 < items.length) await sleep(ITEM_DELAY_MS);
    }

    const { data: after } = await supabaseAdmin
      .from("orders")
      .select("delivery_index, status, telegram_id")
      .eq("id", orderId)
      .single();

    const doneIdx = Number(after?.delivery_index) || 0;
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
        await tg("sendMessage", {
          chat_id: after.telegram_id,
          text: `🙏 Спасибо за покупку! Заказ #${orderId} выдан (${items.length} материалов). Если что-то не так — напишите продавцу.`,
        });
      }
      return { ok: true as const, pending: false, sent, total: items.length };
    }

    return {
      ok: true as const,
      pending: after?.status === "delivering" && doneIdx < items.length,
      sent,
      next: doneIdx,
      total: items.length,
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

// Sends every material for one order item — the deliverable can be a single
// file or a set of photos (e.g. several worksheet pages), each sent in turn.
// Returns true only if every file in the set reached Telegram: the caller's
// CAS lock treats the item as one unit and retries the whole set on failure,
// so a partial send (2 of 3 photos) is not tracked separately.
export async function sendMaterials(
  chat_id: number,
  materials: MaterialFile[],
  caption: string,
  quantity: number,
): Promise<boolean> {
  let allOk = true;
  // With several photos for one material, repeating the product name on
  // every single one reads as spam — caption only the first file. A plain
  // for-loop (not forEach) so each send is awaited before the next starts.
  for (let idx = 0; idx < materials.length; idx++) {
    const m = materials[idx];
    const itemCaption = idx === 0 ? caption : "";
    if (m.url) {
      await tg("sendMessage", {
        chat_id,
        text: itemCaption
          ? `📁 <b>${itemCaption}</b>\n\n📥 <a href="${m.url}">Нажмите здесь, чтобы скачать файл</a>`
          : `📥 <a href="${m.url}">Нажмите здесь, чтобы скачать файл</a>`,
        parse_mode: "HTML",
      });
    } else if (m.path) {
      const ok = await sendFileToUser(chat_id, m.path, m.name || "file.bin", itemCaption, quantity);
      if (!ok) allOk = false;
    }
  }
  return allOk;
}

/** Returns true if the document reached Telegram. */
export async function sendFileToUser(
  chat_id: number,
  path: string,
  downloadName: string,
  caption: string,
  quantity: number,
): Promise<boolean> {
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
    if (await sendViaTelegramUrl()) return true;
  }

  const { data: dl, error: dlErr } = await supabaseAdmin.storage
    .from("product-files")
    .download(path);
  if (dlErr || !dl) {
    if (await sendViaTelegramUrl()) return true;
    console.error("[orders] storage download failed", path, dlErr);
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Не удалось получить файл «${caption}» из хранилища. Продавец вышлет вручную.`,
    });
    return true; // permanent — don't spin cron forever
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
    return true;
  }

  if (dl.size > TG_MAX) {
    if (await sendViaTelegramUrl()) return true;
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Файл «${caption}» слишком большой (${Math.round(dl.size / (1024 * 1024))} МБ, лимит ${Math.round(TG_MAX / (1024 * 1024))} МБ). Продавец вышлет вручную.`,
    });
    // Permanent size problem — treat as handled so we don't infinite-retry
    return true;
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
    if (photoRes?.ok) return true;
    console.error("[orders] sendPhoto multipart failed, falling back to sendDocument", photoRes);
  }

  const res = await tgSendMultipart(
    "sendDocument",
    { chat_id, caption },
    { field: "document", filename, blob: dl, contentType: mime },
  );

  if (res?.ok) return true;

  console.error("[orders] sendDocument multipart failed", res);
  if (await sendViaTelegramUrl()) return true;

  if (dl.size > CLOUD_TG_MAX) {
    await tg("sendMessage", {
      chat_id,
      text: `⚠️ Файл «${caption}» (${Math.round(dl.size / (1024 * 1024))} МБ) не проходит через облачный Telegram API (лимит ~50 МБ). Нужен Local Bot API или ручная выдача.`,
    });
    return true; // don't spin forever without Local API
  }

  return false;
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
function downloadFileName(displayName: string, storagePath: string): string {
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
 */
async function collectOrderFiles(
  orderId: number,
  items: OrderItem[],
): Promise<Array<{ name: string; url: string }>> {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  const files: Array<{ name: string; url: string }> = [];
  for (const item of items) {
    // Материалы бывают из нескольких файлов (модуль multi_files), и у старых
    // заказов заполнены только одиночные *_snapshot — разворачиваем оба вида
    // тем же помощником, что и выдача в Telegram, иначе часть файлов пропала
    // бы молча.
    let materials: MaterialFile[] = item.material_files_snapshot?.length
      ? item.material_files_snapshot
      : legacyAsMaterials(item.file_path_snapshot, item.file_name_snapshot, item.file_url_snapshot);

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
      materials = materialsForProduct(product, "ru");
      if (materials.length === 0) materials = materialsForProduct(product, "kz");
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
      const { data: signed } = await supabaseAdmin.storage
        .from("product-files")
        .createSignedUrl(material.path, EMAIL_LINK_DAYS * 24 * 60 * 60, {
          download: downloadFileName(displayName, material.path),
        });
      if (signed?.signedUrl) {
        files.push({ name: displayName, url: signed.signedUrl });
      }
    }
  }

  return files;
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
 * оплаченный и потерянный заказ.
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

  const files = await collectOrderFiles(orderId, items);
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
    throw new Error(
      opened.error ||
        "Не удалось написать покупателю в WhatsApp — окно ответа закрыто, а шаблон недоступен.",
    );
  }

  let sent = 0;
  for (const file of files) {
    const result = await sendZernioInboxMessage(conversationId, accountId, "", {
      attachmentUrl: file.url,
      attachmentType: "file",
      // Без имени WhatsApp выводит его из URL, а там подписанная ссылка
      // хранилища — покупатель увидел бы «Untitled» вместо названия материала.
      attachmentName: file.name,
      platform: "whatsapp",
    });
    if (result.ok) {
      sent += 1;
      await supabaseAdmin.from("orders").update({ delivery_index: sent }).eq("id", orderId);
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

  await supabaseAdmin
    .from("orders")
    .update({ status: "delivered", delivery_index: items.length })
    .eq("id", orderId);

  if (sent < files.length) {
    console.warn(`[orders] заказ ${orderId}: ушло ${sent} файлов из ${files.length}`);
  }

  return { ok: true as const, alreadyDelivered: false, pending: false, sent, total: files.length };
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

  const files = await collectOrderFiles(orderId, items);

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
        `Оплата подтверждена — материалы по заказу №${order.display_no ?? order.order_no ?? orderId} отправлены на ${email}.\n\n` +
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
    total: items.length,
    email,
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
