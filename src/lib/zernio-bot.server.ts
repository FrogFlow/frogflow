import {
  sendZernioInboxMessage,
  replyToInstagramComment,
  sendInstagramPrivateReply,
} from "./zernio.server";
import crypto from "node:crypto";
import { convertAmount } from "./currency.server";
import { requireAppOrigin } from "./app-origin.server";
import type { Json, TablesUpdate } from "@/integrations-supabase/types";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

// Уходит в текст сообщения покупателю в директе — ссылка на свой каталог.
const appUrl = requireAppOrigin;

// The legacy cart/order schema uses bot_users.telegram_id as its customer key.
// Reserve negative, deterministic IDs for Instagram so a Direct customer can
// safely use the same cart and order tables without colliding with Telegram.
function instagramCustomerId(userKey: string): number {
  const hex = crypto.createHash("sha256").update(userKey).digest("hex").slice(0, 13);
  return -parseInt(hex, 16);
}

/**
 * Создать или обновить пользователя Instagram в базе данных.
 */
export async function upsertZernioUser(
  userKey: string,
  conversationId?: string,
  accountId?: string,
  username?: string,
  firstName?: string,
  metadata?: Record<string, any>,
) {
  const s = await db();
  const { data: existing } = await s
    .from("bot_users")
    .select("*")
    .eq("user_key", userKey)
    .maybeSingle();

  if (existing) {
    const updates: TablesUpdate<"bot_users"> = {
      updated_at: new Date().toISOString(),
    };
    if (conversationId) updates.zernio_conversation_id = conversationId;
    if (accountId) updates.zernio_account_id = accountId;
    if (username) updates.username = username;
    if (firstName) updates.first_name = firstName;
    if (metadata) {
      // `metadata` в базе — jsonb, то есть с точки зрения типов это Json:
      // строка, число и массив там столь же допустимы, как объект. Разворачивать
      // спредом можно только объект, поэтому всё остальное (включая null и
      // случайно записанный скаляр) считаем «накопленного нет» и начинаем с
      // пустого — иначе на такой строке падал бы весь разбор входящего сообщения.
      const prev = existing.metadata;
      const base = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {};
      updates.metadata = { ...base, ...metadata };
    }

    await s.from("bot_users").update(updates).eq("user_key", userKey);
    return { ...existing, ...updates };
  }

  const newUser = {
    telegram_id: instagramCustomerId(userKey),
    user_key: userKey,
    platform: "instagram",
    zernio_conversation_id: conversationId,
    zernio_account_id: accountId,
    username: username || null,
    first_name: firstName || "Инста-гость",
    state: {},
    metadata: metadata || {},
  };

  const { data: inserted, error } = await s.from("bot_users").insert(newUser).select().single();
  if (error) {
    console.error("[zernio-bot] error upserting user:", error);
    return newUser;
  }
  return inserted;
}

/**
 * Обработать входящее личное сообщение (DM) из Instagram Direct.
 * Соответствует спецификации Zernio Webhooks: payload.message, payload.conversation, payload.account
 */
export async function handleZernioMessage(payload: any) {
  const { parseZernioMessage } = await import("./zernio-message");
  const {
    conversationId,
    accountId,
    userKey,
    senderUsername,
    senderName,
    text,
    metadata,
    postbackPayload,
  } = parseZernioMessage(payload);

  if (!conversationId || !accountId) {
    console.warn("[zernio-bot] message.received missing conversationId or accountId:", payload);
    return;
  }

  const s = await db();
  const { data: directBotSetting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .eq("key", "instagram_direct_bot_enabled")
    .maybeSingle();
  if (directBotSetting?.value === "false") {
    console.log("[zernio-bot] Direct assistant is disabled; event recorded without a reply");
    return;
  }
  const { data: featureSetting } = await s.from("app_settings").select("value").eq("bot_id", process.env.BOT_ID?.trim() || "").eq("key", "instagram_direct_bot_features").maybeSingle();
  let features = { catalog: true, search: true, cart: true, checkout: true };
  try { features = { ...features, ...JSON.parse(featureSetting?.value || "{}") }; } catch { /* defaults */ }

  // Логируем сообщение
  console.log(`[zernio-bot] DM from ${userKey} (${senderUsername}): "${text}"`);

  // Обновляем/создаем пользователя
  const user = await upsertZernioUser(
    userKey,
    conversationId,
    accountId,
    senderUsername,
    senderName,
    metadata,
  );

  const lower = text.toLowerCase();

  // A DM button click (postback) carries no text — only its payload, set when
  // the automation's button was configured in the admin panel. Generic
  // routing only: a specific payload's reply is business content that
  // belongs in the automation's own DM message, not hardcoded here.
  if (postbackPayload !== null) {
    console.log(`[zernio-bot] postback from ${userKey}: "${postbackPayload}"`);
    if (postbackPayload.startsWith("BUY:")) {
      await addProductToCart(conversationId, accountId, user, postbackPayload.slice(4));
      return;
    }
    if (features.cart && postbackPayload === "CART") {
      await sendCart(conversationId, accountId, user);
      return;
    }
    if (features.checkout && postbackPayload === "CHECKOUT") {
      await startInstagramCheckout(conversationId, accountId, user);
      return;
    }
    if (features.catalog && postbackPayload === "CATALOG") {
      await sendCatalogMenu(conversationId, accountId, user);
      return;
    }
    if (postbackPayload) return; // handled by the automation that sent the button
  }

  // Команда /start или каталог / меню
  if (lower === "/start" || lower.includes("старт") || lower.includes("меню") || lower.includes("каталог")) {
    await sendCatalogMenu(conversationId, accountId, user);
    return;
  }

  // Команда "корзина"
  if (lower.includes("корзин")) {
    await sendCart(conversationId, accountId, user);
    return;
  }

  if (lower.includes("оформ") || lower.includes("оплат")) {
    await startInstagramCheckout(conversationId, accountId, user);
    return;
  }

  // Команда "заказы"
  if (lower.includes("заказ")) {
    await sendOrders(conversationId, accountId, user);
    return;
  }

  // Если пользователь отправил текстовый запрос — ищем товары
  if (features.search && text.length > 1) {
    await sendInteractiveProductResults(conversationId, accountId, user, text);
    return;
  }

  // Дефолтный приветственный ответ
  const { data: scriptSetting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .eq("key", "instagram_direct_bot_script")
    .maybeSingle();
  if (scriptSetting?.value?.trim()) {
    await sendZernioInboxMessage(conversationId, accountId, scriptSetting.value.trim());
    return;
  }

  const defaultReply =
    `Здравствуйте, ${senderName}! 👋\n` +
    `Добро пожаловать в наш магазин учебных материалов.\n\n` +
    `Напишите название предмета или темы для поиска материалов, или отправьте "Каталог" для просмотра категорий.\n\n` +
    `Ссылка на наш веб-каталог: ${appUrl()}`;

  await sendZernioInboxMessage(conversationId, accountId, defaultReply);
}

/**
 * Отправить главное меню и список категорий
 */
async function sendCatalogMenu(conversationId: string, accountId: string, user: any) {
  const s = await db();
  const { data: categories } = await s
    .from("categories")
    .select("*")
    .eq("is_visible", true)
    .is("parent_id", null)
    .order("sort_order", { ascending: true })
    .limit(8);

  let msg = `📚 Каталог цифровых учебных материалов\n\n`;
  if (categories && categories.length > 0) {
    msg += `Разделы каталога:\n`;
    categories.forEach((cat: any, i: number) => {
      msg += `${i + 1}. 📁 ${cat.name}\n`;
    });
    msg += `\nНапишите название категории или тему для поиска материалов.\n`;
  } else {
    msg += `В данный момент каталог обновляется.\n`;
  }

  msg += `\nВы также можете открыть веб-версию: ${appUrl()}`;

  await sendZernioInboxMessage(conversationId, accountId, msg, undefined, undefined, [
    { type: "postback", title: "Корзина", payload: "CART" },
  ]);
}

/**
 * Поиск и отправка товаров в DM
 */
async function searchAndSendProducts(conversationId: string, accountId: string, _user: any, query: string) {
  const s = await db();

  const { data: products } = await s
    .from("products")
    .select("*, categories(name)")
    .eq("is_active", true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%,keywords.ilike.%${query}%`)
    .limit(5);

  if (!products || products.length === 0) {
    await sendZernioInboxMessage(
      conversationId,
      accountId,
      `К сожалению, по запросу "${query}" ничего не найдено.\nПопробуйте другое ключевое слово или перейдите в веб-каталог: ${appUrl()}`,
    );
    return;
  }

  let msg = `🔍 Результаты поиска по запросу "${query}":\n\n`;

  for (const p of products) {
    msg += `📌 **${p.name}**\n`;
    msg += `💰 Цена: ${p.price} ${p.currency}\n`;
    if (p.description) {
      msg += `📝 ${p.description.slice(0, 100)}...\n`;
    }
    msg += `🔗 Подробнее: ${appUrl()}\n\n`;
  }

  msg += `Для заказа перейдите в наш онлайн-магазин: ${appUrl()}`;

  await sendZernioInboxMessage(conversationId, accountId, msg);
}

/**
 * Показать корзину пользователя
 */
async function sendInteractiveProductResults(conversationId: string, accountId: string, _user: any, query: string) {
  const s = await db();
  const { data: products } = await s
    .from("products")
    .select("id, name, price, currency, description, is_active")
    .eq("is_active", true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%,keywords.ilike.%${query}%`)
    .limit(5);

  if (!products?.length) {
    await sendZernioInboxMessage(
      conversationId,
      accountId,
      `По запросу «${query}» ничего не найдено. Попробуйте другое слово или откройте каталог: ${appUrl()}`,
      undefined,
      undefined,
      [{ type: "postback", title: "Каталог", payload: "CATALOG" }],
    );
    return;
  }

  await sendZernioInboxMessage(conversationId, accountId, `🔎 Нашли ${products.length} вариантов:`);
  for (const product of products) {
    const description = product.description ? `\n${String(product.description).slice(0, 180)}` : "";
    await sendZernioInboxMessage(
      conversationId,
      accountId,
      `📌 ${product.name}\n💰 ${product.price} ${product.currency}${description}`,
      undefined,
      undefined,
      [
        { type: "postback", title: "Добавить в корзину", payload: `BUY:${product.id}` },
        { type: "postback", title: "Корзина", payload: "CART" },
      ],
    );
  }
}

async function addProductToCart(conversationId: string, accountId: string, user: any, productId: string) {
  const s = await db();
  const { data: product } = await s
    .from("products")
    .select("id, name, is_active")
    .eq("id", productId)
    .maybeSingle();
  if (!product?.is_active) {
    await sendZernioInboxMessage(conversationId, accountId, "Этот товар больше недоступен.");
    return;
  }
  const { data: existing } = await s
    .from("cart_items")
    .select("id, quantity")
    .eq("telegram_id", user.telegram_id)
    .eq("product_id", product.id)
    .maybeSingle();
  if (existing) {
    await s.from("cart_items").update({ quantity: Number(existing.quantity) + 1 }).eq("id", existing.id);
  } else {
    await s.from("cart_items").insert({ telegram_id: user.telegram_id, product_id: product.id, quantity: 1 });
  }
  await sendZernioInboxMessage(conversationId, accountId, `✅ «${product.name}» добавлен в корзину.`);
  await sendCart(conversationId, accountId, user);
}

async function sendCart(conversationId: string, accountId: string, user: any) {
  const s = await db();
  const { data: items } = await s
    .from("cart_items")
    .select("*, products(*)")
    .eq("telegram_id", user.telegram_id);

  if (!items || items.length === 0) {
    await sendZernioInboxMessage(
      conversationId,
      accountId,
      `Ваша корзина пуста. 🛒\nВы можете выбрать товары на нашем сайте: ${appUrl()}`,
    );
    return;
  }

  let total = 0;
  let currency = "KZT";
  let msg = `🛒 Ваша корзина:\n\n`;

  items.forEach((item: any, i: number) => {
    const p = item.products;
    if (p) {
      const sum = Number(p.price) * item.quantity;
      total += sum;
      currency = p.currency;
      msg += `${i + 1}. ${p.name} (${item.quantity} шт.) — ${sum} ${p.currency}\n`;
    }
  });

  msg += `\n💵 **Итого: ${total} ${currency}**\n`;
  msg += `\nДля оформления заказа перейдите по ссылке: ${appUrl()}`;

  await sendZernioInboxMessage(conversationId, accountId, msg);
}

/**
 * Показать историю заказов
 */
async function sendOrders(conversationId: string, accountId: string, user: any) {
  const s = await db();
  const { data: orders } = await s
    .from("orders")
    .select("*")
    .eq("telegram_id", user.telegram_id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!orders || orders.length === 0) {
    await sendZernioInboxMessage(
      conversationId,
      accountId,
      `У вас пока нет заказов. 📋`,
    );
    return;
  }

  const statusMap: Record<string, string> = {
    awaiting_payment: "⏳ Ожидает оплаты",
    paid: "✅ Оплачен",
    delivered: "📦 Выдан",
    cancelled: "❌ Отменен",
  };

  let msg = `📋 Ваши заказы:\n\n`;
  orders.forEach((o: any) => {
    msg += `Заказ #${o.order_no ?? o.id} — ${o.total} ${o.currency} [${statusMap[o.status] || o.status}]\n`;
  });

  await sendZernioInboxMessage(conversationId, accountId, msg);
}

/**
 * Обработать входящий комментарий к публикации/Reels (Comment-to-DM).
 * Соответствует спецификации Zernio Webhooks: payload.comment, payload.post, payload.account
 */
async function startInstagramCheckout(conversationId: string, accountId: string, user: any) {
  const s = await db();
  const { data: items } = await s
    .from("cart_items")
    .select("quantity, products(id, name, price, currency, file_path, file_name, file_url)")
    .eq("telegram_id", user.telegram_id);
  const validItems = (items || []).filter((item: any) => item.products);
  if (!validItems.length) {
    await sendZernioInboxMessage(conversationId, accountId, "Корзина пуста — сначала добавьте товар.");
    return;
  }
  const currency = String(validItems[0].products.currency || "KZT");
  if (validItems.some((item: any) => String(item.products.currency || "KZT") !== currency)) {
    await sendZernioInboxMessage(conversationId, accountId, "В корзине несколько валют. Оформите товары по отдельности.");
    return;
  }
  const total = validItems.reduce((sum: number, item: any) => sum + Number(item.products.price) * Number(item.quantity), 0);
  const { data: order, error } = await s
    .from("orders")
    .insert({
      telegram_id: user.telegram_id,
      user_key: user.user_key,
      platform: "instagram",
      username: user.username || null,
      display_name: user.first_name || user.username || "Instagram customer",
      contact: user.username ? `@${user.username}` : null,
      total,
      currency,
      status: "awaiting_payment",
    })
    .select("id, order_no")
    .single();
  if (error || !order) {
    console.error("[zernio-bot] create Instagram order failed", error);
    await sendZernioInboxMessage(conversationId, accountId, "Не удалось оформить заказ. Попробуйте ещё раз позже.");
    return;
  }
  const { error: rowsError } = await s.from("order_items").insert(validItems.map((item: any) => ({
    order_id: order.id,
    product_id: item.products.id,
    name_snapshot: item.products.name,
    price_snapshot: item.products.price,
    quantity: item.quantity,
    file_path_snapshot: item.products.file_path || null,
    file_name_snapshot: item.products.file_name || null,
  })));
  if (rowsError) {
    await s.from("orders").delete().eq("id", order.id);
    await sendZernioInboxMessage(conversationId, accountId, "Не удалось сохранить состав заказа. Попробуйте ещё раз позже.");
    return;
  }
  await s.from("cart_items").delete().eq("telegram_id", user.telegram_id);

  const { data: settings } = await s.from("app_settings").select("key, value");
  const value = (key: string) => settings?.find((row: any) => row.key === key)?.value?.trim() || "";
  const isTest = value("robokassa_test_mode") === "true";
  const login = value("robokassa_login");
  const pass1 = isTest ? value("robokassa_pass1_test") : value("robokassa_pass1");
  if (value("robokassa_enabled") !== "true" || !login || !pass1) {
    await sendZernioInboxMessage(conversationId, accountId, `Заказ #${order.order_no || order.id} создан. Менеджер пришлёт реквизиты для оплаты.`);
    return;
  }
  const { buildRobokassaPaymentUrl } = await import("./robokassa.server");
  const paymentUrl = buildRobokassaPaymentUrl({
    login,
    pass1,
    outSum: Number(total).toFixed(2),
    invId: Number(order.id),
    description: `Заказ #${order.order_no || order.id}`,
    isTest,
  });
  await sendZernioInboxMessage(
    conversationId,
    accountId,
    `Заказ #${order.order_no || order.id} на сумму ${total} ${currency} создан. Оплатите его по кнопке ниже.`,
    undefined,
    undefined,
    [{ type: "url", title: "Оплатить", url: paymentUrl }],
  );
}

export async function deliverInstagramOrder(orderId: number) {
  const s = await db();
  const { data: order } = await s
    .from("orders")
    .select("telegram_id, order_items(name_snapshot, quantity, file_path_snapshot, file_name_snapshot)")
    .eq("id", orderId)
    .single();
  if (!order) throw new Error(`Instagram order ${orderId} not found`);
  const { data: user } = await s
    .from("bot_users")
    .select("zernio_conversation_id, zernio_account_id")
    .eq("telegram_id", order.telegram_id)
    .maybeSingle();
  if (!user?.zernio_conversation_id || !user.zernio_account_id) throw new Error("Instagram conversation is unavailable");
  await sendZernioInboxMessage(user.zernio_conversation_id, user.zernio_account_id, "✅ Оплата получена. Отправляем ваши материалы.");
  for (const item of (order.order_items || []) as any[]) {
    let attachmentUrl: string | undefined;
    if (item.file_path_snapshot) {
      const { data: signed } = await s.storage.from("product-files").createSignedUrl(item.file_path_snapshot, 60 * 60 * 24 * 7);
      attachmentUrl = signed?.signedUrl;
    }
    const message = attachmentUrl ? `📎 ${item.name_snapshot}` : `Материал «${item.name_snapshot}» подготовлен менеджером.`;
    await sendZernioInboxMessage(user.zernio_conversation_id, user.zernio_account_id, message, attachmentUrl, attachmentUrl ? "file" : undefined);
  }
  await s.from("orders").update({ status: "delivered" }).eq("id", orderId);
}

/*
 * Обработчика комментариев здесь намеренно нет. Ответы на комментарии и DM по
 * ключевым словам делают родные Comment-to-DM автоматизации Zernio — им наше
 * участие не нужно, и прежний handleZernioComment сводился к console.log.
 * Вместе с ним снята и подписка на `comment.received` (см. комментарий к
 * событиям в registerZernioWebhook): она давала 69 % всего трафика вебхука без
 * единого полезного действия.
 */
