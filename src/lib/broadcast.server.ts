import { tg, tgSendMultipart, tgSendMultipartMany } from "./telegram.server";
import { errorMessage } from "@/lib/error-message";
import { fetchAll } from "./csv";
import { isExcludedWhatsAppSender } from "./whatsapp-contact-exclusions";

const BATCH_SIZE = 25;
const SEND_DELAY_MS = 80;
const TELEGRAM_MEDIA_GROUP_MAX = 10;

export type AudienceType = "all" | "country" | "buyers" | "non_buyers" | "test";

/** Канал рассылки. Телеграмный — исходный и остаётся значением по умолчанию. */
export type BroadcastChannel = "telegram" | "whatsapp";

export type BroadcastPayload = {
  message_text: string;
  photo_paths: string[];
  product_ids: string[];
  show_catalog: boolean;
  audience_type: AudienceType;
  audience_filter?: { country_code?: string };
  channel?: BroadcastChannel;
  /**
   * Дальше — только WhatsApp. Текст рассылки там задаёт не `message_text`, а
   * одобренный Meta шаблон: свободный текст вне 24-часового окна запрещён, а
   * у рассылки по базе окно закрыто почти у всех. `message_text` остаётся,
   * чтобы продавец видел в панели, что именно он разослал.
   */
  account_id?: string;
  template_name?: string;
  template_language?: string;
  /** Значения переменных шаблона одним плоским массивом, в порядке подстановки. */
  template_params?: string[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DownloadedImage = { bytes: Uint8Array; filename: string; contentType: string };

function broadcastStorageKey(path: string): string {
  if (path.startsWith("broadcast-images/")) return path.slice("broadcast-images/".length);
  return path;
}

async function downloadBroadcastImage(path: string): Promise<DownloadedImage> {
  const key = broadcastStorageKey(path);
  const s = await db();
  const { data, error } = await s.storage.from("broadcast-images").download(key);
  if (error || !data) throw new Error(`Не удалось загрузить фото: ${key}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return {
    bytes,
    filename: key,
    contentType: data.type || "image/jpeg",
  };
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

/**
 * Кому уходит телеграм-рассылка.
 *
 * Возвращает только настоящие Telegram-чаты. Фильтр по платформе здесь не
 * украшение: покупатели из Instagram и WhatsApp живут в той же `bot_users`, и
 * `telegram_id` у них синтетический — отрицательный хеш от ключа (см.
 * zernioCustomerId). Чата с таким номером не существует, и до этого фильтра
 * рассылка «всем» честно пыталась в них писать: каждая такая попытка — ошибка
 * от Telegram, а в отчёте о рассылке — раздутое число получателей, из которых
 * часть не могла получить ничего в принципе.
 *
 * Условие `telegram_id > 0` дублирует фильтр по платформе намеренно: у
 * аудитории `test` оно стояло и раньше, и это дешёвая страховка на случай
 * строки, где платформа не проставлена.
 */
export async function resolveAudienceIds(
  audience_type: AudienceType,
  audience_filter?: { country_code?: string },
): Promise<number[]> {
  const s = await db();

  if (audience_type === "test") {
    const { data: setting } = await s
      .from("app_settings")
      .select("value")
      .eq("key", "admin_chat_id")
      .maybeSingle();
    if (!setting?.value) return [];
    return setting.value
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  /**
   * Телеграмные получатели: реальный чат, а не синтетический ключ другого
   * канала. Постранично — PostgREST молча обрывает любой select на 1000
   * строках, и без этого «всем» уходило бы только первой тысяче клиентов, а
   * non_buyers ниже путал бы обрезанных покупателей с теми, кто ничего не
   * покупал, и слал бы им «новинки» повторно (Блок 3.3).
   */
  const telegramUsers = () =>
    fetchAll(
      (from, to) =>
        s.from("bot_users").select("telegram_id").eq("platform", "telegram").range(from, to),
      "получатели рассылки",
    );
  const realChat = (id: number) => Number.isFinite(id) && id > 0;

  if (audience_type === "buyers") {
    // "delivered" — не единственный признак покупателя (Блок 3, находка
    // 3.11): у физического заказа с внесённым задатком, который ещё в
    // работе (accepted/in_production/ready), деньги уже приняты — это
    // реальный покупатель, а не "ещё ни разу не покупал". Раньше такой
    // человек одновременно попадал в аудиторию non_buyers.
    const orders = await fetchAll(
      (from, to) =>
        s
          .from("orders")
          .select("telegram_id")
          .in("status", ["delivered", "accepted", "in_production", "ready"])
          .eq("platform", "telegram")
          .range(from, to),
      "покупатели для рассылки",
    );
    return [...new Set(orders.map((o) => o.telegram_id as number))].filter(realChat);
  }

  if (audience_type === "non_buyers") {
    const buyerIds = await resolveAudienceIds("buyers");
    const buyerSet = new Set(buyerIds);
    const users = await telegramUsers();
    return users
      .map((u) => u.telegram_id as number)
      .filter((id) => realChat(id) && !buyerSet.has(id));
  }

  if (audience_type === "country") {
    const code = audience_filter?.country_code?.trim().toUpperCase();
    if (!code) return [];
    const users = await fetchAll(
      (from, to) =>
        s.from("bot_users").select("telegram_id, state").eq("platform", "telegram").range(from, to),
      "получатели рассылки по стране",
    );
    return users
      .filter(
        (u) =>
          ((u.state as { country_code?: string } | null)?.country_code ?? "").toUpperCase() ===
          code,
      )
      .map((u) => u.telegram_id as number)
      .filter(realChat);
  }

  const users = await telegramUsers();
  return users.map((u) => u.telegram_id as number).filter(realChat);
}

async function buildInlineKeyboard(product_ids: string[], show_catalog: boolean) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (product_ids.length > 0) {
    const s = await db();
    const { data: products } = await s.from("products").select("id, name").in("id", product_ids);
    const byId = new Map((products ?? []).map((p) => [p.id as string, p.name as string]));
    for (const id of product_ids.slice(0, 8)) {
      const name = byId.get(id) || "Товар";
      const label = name.length > 36 ? `${name.slice(0, 33)}…` : name;
      rows.push([{ text: `📖 ${label}`, callback_data: `prod:${id}` }]);
    }
  }

  if (show_catalog) {
    rows.push([{ text: "📚 Открыть каталог", callback_data: "cat:root:0" }]);
  }

  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

async function tgOrThrow(method: string, payload: unknown) {
  const res = await tg(method, payload);
  if (!res.ok) {
    throw new Error(res.description || `${method} failed`);
  }
  return res;
}

async function tgMultipartOrThrow(
  method: string,
  fields: Record<string, string | number>,
  files: Array<{ field: string; filename: string; bytes: Uint8Array; contentType: string }>,
) {
  const res =
    files.length === 1
      ? await tgSendMultipart(method, fields, files[0])
      : await tgSendMultipartMany(method, fields, files);
  if (!res.ok) {
    throw new Error(res.description || `${method} failed`);
  }
  return res;
}

async function sendBroadcastPhotos(telegram_id: number, photoPaths: string[]) {
  const paths = photoPaths.slice(0, TELEGRAM_MEDIA_GROUP_MAX);
  if (paths.length === 0) return;

  const images = await Promise.all(paths.map(downloadBroadcastImage));

  if (images.length === 1) {
    const img = images[0];
    await tgMultipartOrThrow("sendPhoto", { chat_id: telegram_id }, [
      { field: "photo", filename: img.filename, bytes: img.bytes, contentType: img.contentType },
    ]);
    return;
  }

  const media = images.map((_, idx) => ({
    type: "photo",
    media: `attach://photo${idx}`,
  }));

  await tgMultipartOrThrow(
    "sendMediaGroup",
    {
      chat_id: telegram_id,
      media: JSON.stringify(media),
    },
    images.map((img, idx) => ({
      field: `photo${idx}`,
      filename: img.filename,
      bytes: img.bytes,
      contentType: img.contentType,
    })),
  );
}

export async function sendBroadcastMessage(
  telegram_id: number,
  payload: Pick<BroadcastPayload, "message_text" | "photo_paths" | "product_ids" | "show_catalog">,
) {
  const text = payload.message_text.trim();
  const photos = payload.photo_paths.slice(0, TELEGRAM_MEDIA_GROUP_MAX);
  const reply_markup = await buildInlineKeyboard(payload.product_ids, payload.show_catalog);

  if (photos.length === 0) {
    await tgOrThrow("sendMessage", {
      chat_id: telegram_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(reply_markup ? { reply_markup } : {}),
    });
    return;
  }

  if (text) {
    await tgOrThrow("sendMessage", {
      chat_id: telegram_id,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  await sendBroadcastPhotos(telegram_id, photos);

  if (reply_markup) {
    await tgOrThrow("sendMessage", {
      chat_id: telegram_id,
      text: "👇 Выберите материал:",
      reply_markup,
    });
  }
}

/**
 * Отличить «этот человек больше недостижим» от «не получилось сейчас».
 *
 * Разница не косметическая: заблокировавшие считаются отдельным счётчиком и не
 * выглядят как поломка рассылки. У WhatsApp свои коды на то же самое — номер
 * не в WhatsApp (131021) и получатель недоступен (131026); без них такие
 * получатели попадали бы в «ошибки», и продавец видел бы красную рассылку там,
 * где всё отработало правильно.
 */
function classifyTelegramError(description?: string): "blocked" | "failed" {
  const msg = (description || "").toLowerCase();
  if (msg.includes("blocked") || msg.includes("deactivated") || msg.includes("chat not found")) {
    return "blocked";
  }
  if (msg.includes("131021") || msg.includes("131026") || msg.includes("not a whatsapp user")) {
    return "blocked";
  }
  return "failed";
}

/**
 * Получатели WhatsApp-рассылки: номер плюс синтетический ключ покупателя.
 *
 * Номер лежит прямо в `user_key` (`wa_<телефон>`, см. USER_KEY_PREFIX), так что
 * отдельного справочника номеров заводить не пришлось. Аудитории те же, что и
 * у телеграмной рассылки, только считаются по своей платформе.
 */
export async function resolveWhatsAppAudience(
  audience_type: AudienceType,
  audience_filter?: { country_code?: string },
): Promise<Array<{ telegram_id: number; phone: string }>> {
  const s = await db();

  // «Себе на пробу» у WhatsApp нет: писать некому — у продавца в этой базе
  // нет собственной записи покупателя. Пустой список честнее, чем отправка
  // непонятно кому.
  if (audience_type === "test") return [];

  let userKeys: string[] | null = null;

  if (audience_type === "buyers" || audience_type === "non_buyers") {
    // Постранично — тот же потолок PostgREST в 1000 строк, что уже чинили
    // для telegramUsers/buyers выше (Блок 3.3): без него «всем» ушло бы
    // только первой тысяче, а non_buyers перепутал бы обрезанных покупателей
    // с теми, кто ничего не покупал.
    // Те же дополнительные статусы, что и в Telegram-ветке выше (Блок 3,
    // находка 3.11) — покупатель с задатком на торт в работе уже покупатель.
    const orders = await fetchAll(
      (from, to) =>
        s
          .from("orders")
          .select("user_key")
          .in("status", ["delivered", "accepted", "in_production", "ready"])
          .eq("platform", "whatsapp")
          .range(from, to),
      "покупатели WhatsApp для рассылки",
    );
    const buyers = new Set(orders.map((o) => String(o.user_key ?? "")).filter(Boolean));
    if (audience_type === "buyers") userKeys = [...buyers];
    else {
      const all = await fetchAll(
        (from, to) =>
          s.from("bot_users").select("user_key").eq("platform", "whatsapp").range(from, to),
        "получатели WhatsApp для рассылки",
      );
      userKeys = all.map((u) => String(u.user_key)).filter((key) => !buyers.has(key));
    }
  }

  const users = userKeys
    ? await fetchAll(
        (from, to) =>
          s
            .from("bot_users")
            .select("user_key, telegram_id, state")
            .eq("platform", "whatsapp")
            .in("user_key", userKeys!)
            .range(from, to),
        "получатели WhatsApp для рассылки",
      )
    : await fetchAll(
        (from, to) =>
          s
            .from("bot_users")
            .select("user_key, telegram_id, state")
            .eq("platform", "whatsapp")
            .range(from, to),
        "получатели WhatsApp для рассылки",
      );

  /**
   * Список исключённых номеров (Блок B.3, кейс 2, раунд 2) — раньше
   * рассылка его не читала вовсе, только живой автоответчик
   * (zernio-bot.server.ts). Продавец добавляет номер сюда, когда клиент
   * попросил не писать; рассылка — это тоже «написать», причём без повода,
   * и именно такое сообщение WhatsApp Business считает жалобой при подсчёте
   * рейтинга качества номера.
   */
  const { data: excludedRow } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .eq("key", "whatsapp_bot_excluded_phones")
    .maybeSingle();
  const excludedPhones = excludedRow?.value?.trim() || "";

  const code = audience_filter?.country_code?.trim().toUpperCase();
  return users
    .filter((u) => {
      if (audience_type !== "country") return true;
      if (!code) return false;
      return (
        ((u.state as { country_code?: string } | null)?.country_code ?? "").toUpperCase() === code
      );
    })
    .map((u) => ({
      telegram_id: u.telegram_id as number,
      phone: String(u.user_key).startsWith("wa_") ? String(u.user_key).slice(3) : "",
    }))
    .filter((r) => r.phone.length > 0)
    .filter((r) => {
      if (!excludedPhones) return true;
      return !isExcludedWhatsAppSender({ senderPhone: r.phone, excludedPhones });
    });
}

export async function createBroadcast(payload: BroadcastPayload) {
  const s = await db();
  const channel = payload.channel ?? "telegram";

  /**
   * WhatsApp-рассылка обязана нести одобренный шаблон.
   *
   * Вне 24-часового окна Meta не пропускает свободный текст, а рассылка по
   * базе — это ровно такой случай. Отказать здесь, до создания записи и
   * списка получателей, честнее, чем создать рассылку, которая потом упадёт
   * на каждом получателе по очереди.
   */
  if (channel === "whatsapp" && !payload.template_name) {
    throw new Error(
      "Для рассылки в WhatsApp нужен одобренный шаблон Meta — выберите его в списке шаблонов.",
    );
  }
  if (channel === "whatsapp" && !payload.account_id) {
    throw new Error("Не выбран аккаунт WhatsApp, от которого идёт рассылка.");
  }
  if (channel === "whatsapp") {
    // wa_broadcasts был отдельным пунктом прайса без единой проверки в коде —
    // тумблер в панели ничего не решал, WhatsApp-рассылка создавалась при
    // любом статусе модуля, пока по нему был настроен шаблон и аккаунт.
    const { hasModule } = await import("./modules/modules.server");
    if (!(await hasModule("wa_broadcasts"))) {
      throw new Error("Модуль «Рассылки в WhatsApp» не подключён к вашему тарифу.");
    }
  }

  const whatsappRecipients =
    channel === "whatsapp"
      ? await resolveWhatsAppAudience(payload.audience_type, payload.audience_filter)
      : [];
  const telegramIds =
    channel === "whatsapp"
      ? []
      : await resolveAudienceIds(payload.audience_type, payload.audience_filter);

  const uniqueIds =
    channel === "whatsapp"
      ? [...new Map(whatsappRecipients.map((r) => [r.phone, r])).values()]
      : [...new Set(telegramIds)].map((telegram_id) => ({ telegram_id, phone: "" }));

  if (uniqueIds.length === 0) {
    throw new Error("Не найдено получателей для выбранной аудитории.");
  }

  // Деструктуризация здесь обязательна: `await` над построителем PostgREST
  // отдаёт конверт `{data, error, …}`, а он истинный всегда — даже когда
  // ничего не нашлось. Без неё условие срабатывало на каждом вызове, и
  // createBroadcast бросал «Уже идёт другая рассылка» при пустой очереди,
  // то есть рассылку нельзя было создать вообще ни разу.
  const { data: active, error: activeError } = await s
    .from("broadcasts")
    .select("id")
    .in("status", ["queued", "sending"])
    .eq("channel", channel)
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error(`Не удалось проверить очередь рассылок: ${activeError.message}`);
  if (active) {
    throw new Error("Уже идёт другая рассылка. Дождитесь завершения.");
  }

  const { data: broadcast, error } = await s
    .from("broadcasts")
    .insert({
      status: "queued",
      channel,
      account_id: payload.account_id ?? null,
      template_name: payload.template_name ?? null,
      template_language: payload.template_language ?? null,
      template_params: payload.template_params ?? [],
      message_text: payload.message_text,
      photo_paths: payload.photo_paths,
      product_ids: payload.product_ids,
      show_catalog: payload.show_catalog,
      audience_type: payload.audience_type,
      audience_filter: payload.audience_filter ?? {},
      total_count: uniqueIds.length,
    })
    .select("*")
    .single();

  if (error || !broadcast) throw new Error(error?.message || "Не удалось создать рассылку");

  const rows = uniqueIds.map((recipient) => ({
    broadcast_id: broadcast.id,
    telegram_id: recipient.telegram_id,
    phone: recipient.phone || null,
    status: "pending",
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: insErr } = await s.from("broadcast_recipients").insert(chunk);
    if (insErr) throw new Error(insErr.message);
  }

  return broadcast;
}

/**
 * Одно сообщение WhatsApp-рассылки.
 *
 * Всегда шаблоном и всегда через `POST /inbox/conversations`: этот эндпоинт
 * работает и когда диалога с номером ещё нет, и когда он есть, но окно
 * закрыто, — а у рассылки по базе один из этих двух случаев практически
 * всегда. Ошибку бросаем наружу, чтобы её разобрал общий обработчик пакета и
 * записал по получателю, как это уже делает телеграмная ветка.
 */
async function sendWhatsAppBroadcastMessage(
  phone: string | null,
  params: {
    accountId: string;
    templateName: string;
    templateLanguage?: string;
    templateParams: string[];
  },
) {
  if (!phone) throw new Error("У получателя не сохранён номер WhatsApp");

  const { startWhatsAppConversation } = await import("./zernio.server");
  const result = await startWhatsAppConversation({
    accountId: params.accountId,
    phone,
    templateName: params.templateName,
    templateLanguage: params.templateLanguage,
    templateParams: params.templateParams,
  });
  if (!result.ok) throw new Error(result.error || "Zernio не принял отправку");
}

export async function processBroadcastBatch() {
  const s = await db();

  const { data: broadcast } = await s
    .from("broadcasts")
    .select("*")
    .in("status", ["queued", "sending"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!broadcast) return { processed: 0, done: true };

  if (broadcast.status === "queued") {
    await s
      .from("broadcasts")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", broadcast.id);
  }

  const { data: pending } = await s
    .from("broadcast_recipients")
    .select("id, telegram_id, phone")
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  if (!pending?.length) {
    const { data: final } = await s
      .from("broadcasts")
      .select("sent_count, total_count")
      .eq("id", broadcast.id)
      .single();
    const finalStatus =
      final && final.sent_count === 0 && final.total_count > 0 ? "failed" : "completed";
    await s
      .from("broadcasts")
      .update({ status: finalStatus, completed_at: new Date().toISOString() })
      .eq("id", broadcast.id);
    return { processed: 0, done: true, broadcast_id: broadcast.id };
  }

  const payload = {
    message_text: broadcast.message_text as string,
    photo_paths: (broadcast.photo_paths as string[]) ?? [],
    product_ids: (broadcast.product_ids as string[]) ?? [],
    show_catalog: Boolean(broadcast.show_catalog),
  };

  let sent = 0;
  let failed = 0;
  let blocked = 0;

  const isWhatsApp = broadcast.channel === "whatsapp";

  for (let i = 0; i < pending.length; i++) {
    const recipient = pending[i];
    try {
      if (isWhatsApp) {
        await sendWhatsAppBroadcastMessage(recipient.phone, {
          accountId: String(broadcast.account_id ?? ""),
          templateName: String(broadcast.template_name ?? ""),
          templateLanguage: broadcast.template_language ?? undefined,
          templateParams: (broadcast.template_params as string[]) ?? [],
        });
      } else {
        await sendBroadcastMessage(recipient.telegram_id as number, payload);
      }
      await s
        .from("broadcast_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("id", recipient.id);
      sent++;
    } catch (e: unknown) {
      const kind = classifyTelegramError(errorMessage(e));
      await s
        .from("broadcast_recipients")
        .update({
          status: kind,
          error_message: errorMessage(e) || "Unknown error",
        })
        .eq("id", recipient.id);
      if (kind === "blocked") blocked++;
      else failed++;
    }

    if (i + 1 < pending.length) await sleep(SEND_DELAY_MS);
  }

  // Атомарное обновление счётчиков через SQL-инкремент (защита от Race Condition при параллельных воркерах)
  if (sent > 0 || failed > 0 || blocked > 0) {
    const increments: Record<string, string> = {};
    if (sent > 0) increments["sent_count"] = `sent_count + ${sent}`;
    if (failed > 0) increments["failed_count"] = `failed_count + ${failed}`;
    if (blocked > 0) increments["blocked_count"] = `blocked_count + ${blocked}`;

    // Используем raw SQL через rpc для атомарного инкремента
    await s
      .rpc("increment_broadcast_counts", {
        p_broadcast_id: broadcast.id,
        p_sent: sent,
        p_failed: failed,
        p_blocked: blocked,
      })
      .then(({ error }) => {
        if (error) {
          // Fallback: если rpc не создан, используем read-then-write
          return s
            .from("broadcasts")
            .select("sent_count, failed_count, blocked_count")
            .eq("id", broadcast.id)
            .single()
            .then(({ data: fresh }) =>
              s
                .from("broadcasts")
                .update({
                  sent_count: (fresh?.sent_count ?? 0) + sent,
                  failed_count: (fresh?.failed_count ?? 0) + failed,
                  blocked_count: (fresh?.blocked_count ?? 0) + blocked,
                })
                .eq("id", broadcast.id),
            );
        }
      });
  }

  const { count } = await s
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending");

  if (!count) {
    const { data: final2 } = await s
      .from("broadcasts")
      .select("sent_count, total_count")
      .eq("id", broadcast.id)
      .single();
    const finalStatus2 =
      final2 && final2.sent_count === 0 && final2.total_count > 0 ? "failed" : "completed";
    await s
      .from("broadcasts")
      .update({ status: finalStatus2, completed_at: new Date().toISOString() })
      .eq("id", broadcast.id);
    return { processed: pending.length, done: true, broadcast_id: broadcast.id };
  }

  return { processed: pending.length, done: false, broadcast_id: broadcast.id };
}

export async function cancelBroadcast(broadcastId: string) {
  const s = await db();
  const { data: row } = await s
    .from("broadcasts")
    .select("id, status")
    .eq("id", broadcastId)
    .single();

  if (!row) throw new Error("Рассылка не найдена.");
  if (row.status !== "queued" && row.status !== "sending") {
    throw new Error("Отменить можно только активную рассылку.");
  }

  await s
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: "cancelled" })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending");

  await s
    .from("broadcasts")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", broadcastId);

  return { ok: true as const };
}

export async function sendTestBroadcast(payload: BroadcastPayload) {
  const ids = await resolveAudienceIds("test");
  if (!ids.length) throw new Error("Не настроен admin_chat_id в настройках.");
  for (const telegram_id of ids) {
    await sendBroadcastMessage(telegram_id, payload);
  }
  return { ok: true as const, sent_to: ids.length };
}
