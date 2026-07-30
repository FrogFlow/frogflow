import {
  sendZernioInboxMessage,
  replyToInstagramComment,
  sendInstagramPrivateReply,
  ZernioWebhookMessagePayload,
} from "./zernio.server";
import { convertAmount } from "./currency.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function appUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://tg-bot-ashen-one.vercel.app"
  ).replace(/\/$/, "");
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
) {
  const s = await db();
  const { data: existing } = await s
    .from("bot_users")
    .select("*")
    .eq("user_key", userKey)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (conversationId) updates.zernio_conversation_id = conversationId;
    if (accountId) updates.zernio_account_id = accountId;
    if (username) updates.username = username;
    if (firstName) updates.first_name = firstName;

    await s.from("bot_users").update(updates).eq("user_key", userKey);
    return { ...existing, ...updates };
  }

  const newUser = {
    user_key: userKey,
    platform: "instagram",
    zernio_conversation_id: conversationId,
    zernio_account_id: accountId,
    username: username || null,
    first_name: firstName || "Инста-гость",
    state: {},
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
 */
export async function handleZernioMessage(payload: ZernioWebhookMessagePayload) {
  const data = payload.data;
  if (!data || !data.conversationId || !data.accountId) return;

  const conversationId = data.conversationId;
  const accountId = data.accountId;
  const senderId = data.senderId || data.senderUsername || "unknown";
  const userKey = `ig_${senderId}`;
  const text = (data.message || "").trim();

  // Логируем сообщение
  console.log(`[zernio-bot] DM from ${userKey} (${data.senderUsername}): "${text}"`);

  // Обновляем/создаем пользователя
  const user = await upsertZernioUser(
    userKey,
    conversationId,
    accountId,
    data.senderUsername,
    data.senderName,
  );

  const lower = text.toLowerCase();

  // Команда /start или каталог / меню
  if (lower === "/start" || lower.includes("старт") || lower.includes("меню") || lower.includes("каталог")) {
    await sendCatalogMenu(conversationId, accountId, user);
    return;
  }

  // Команда "корзина"
  if (lower.includes("корзин")) {
    await sendCart(conversationId, accountId, userKey);
    return;
  }

  // Команда "заказы"
  if (lower.includes("заказ")) {
    await sendOrders(conversationId, accountId, userKey);
    return;
  }

  // Если пользователь отправил текстовый запрос — ищем товары
  if (text.length > 1) {
    await searchAndSendProducts(conversationId, accountId, text);
    return;
  }

  // Дефолтный приветственный ответ
  const defaultReply =
    `Здравствуйте, ${data.senderName || "друг"}! 👋\n` +
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

  await sendZernioInboxMessage(conversationId, accountId, msg);
}

/**
 * Поиск и отправка товаров в DM
 */
async function searchAndSendProducts(conversationId: string, accountId: string, query: string) {
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
async function sendCart(conversationId: string, accountId: string, userKey: string) {
  const s = await db();
  const { data: items } = await s
    .from("cart_items")
    .select("*, products(*)")
    .eq("user_key", userKey);

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
async function sendOrders(conversationId: string, accountId: string, userKey: string) {
  const s = await db();
  const { data: orders } = await s
    .from("orders")
    .select("*")
    .eq("user_key", userKey)
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
    msg += `Заказ #${o.id} — ${o.total} ${o.currency} [${statusMap[o.status] || o.status}]\n`;
  });

  await sendZernioInboxMessage(conversationId, accountId, msg);
}

/**
 * Обработать входящий комментарий к публикации/Reels (Comment-to-DM).
 */
export async function handleZernioComment(payload: ZernioWebhookMessagePayload) {
  const data = payload.data;
  if (!data || !data.commentId || !data.accountId) return;

  const postId = data.postId;
  const commentId = data.commentId;
  const commentText = (data.commentText || data.message || "").trim();
  const accountId = data.accountId;

  console.log(`[zernio-bot] New comment on post ${postId}: "${commentText}"`);

  const s = await db();

  // Ищем совпадения в Comment-to-DM автоматизациях
  const { data: automations } = await s
    .from("zernio_automations")
    .select("*")
    .eq("is_active", true);

  let matchedAutomation = null;
  if (automations && automations.length > 0) {
    for (const auto of automations) {
      if (auto.post_id && auto.post_id !== postId) continue;

      const keywords = (auto.keywords || []).map((k: string) => k.toLowerCase().trim());
      if (keywords.length === 0) {
        matchedAutomation = auto;
        break;
      }

      const lowerComment = commentText.toLowerCase();
      if (keywords.some((kw: string) => kw && lowerComment.includes(kw))) {
        matchedAutomation = auto;
        break;
      }
    }
  }

  if (matchedAutomation) {
    console.log(`[zernio-bot] Matched automation "${matchedAutomation.title}"`);

    // 1. Отправляем публичный ответ на комментарий
    if (matchedAutomation.reply_text) {
      await replyToInstagramComment(
        postId || commentId,
        commentId,
        accountId,
        matchedAutomation.reply_text,
      );
    }

    // 2. Отправляем автоответ в DM (Private Reply)
    if (matchedAutomation.dm_text) {
      await sendInstagramPrivateReply(
        commentId,
        accountId,
        matchedAutomation.dm_text,
      );
    }

    // Увеличиваем счетчик срабатываний
    await s
      .from("zernio_automations")
      .update({ trigger_count: (matchedAutomation.trigger_count || 0) + 1 })
      .eq("id", matchedAutomation.id);

    return;
  }

  // Дефолтная авто-реакция на популярные запросы ("цена", "купить", "материал", "хочу")
  const lower = commentText.toLowerCase();
  if (
    lower.includes("цена") ||
    lower.includes("стоимость") ||
    lower.includes("купить") ||
    lower.includes("хочу") ||
    lower.includes("материал")
  ) {
    const publicReply = `Здравствуйте! Отправили вам всю информацию и ссылку на каталог в Директ! 📩`;
    const dmReply = `Здравствуйте! 👋\nНаши учебные материалы и полный каталог доступны на сайте: ${appUrl()}\n\nЕсли у вас есть вопросы по конкретному предмету — напишите нам в ответное сообщение!`;

    await replyToInstagramComment(postId || commentId, commentId, accountId, publicReply);
    await sendInstagramPrivateReply(commentId, accountId, dmReply);
  }
}
