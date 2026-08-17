import {
  sendZernioInboxMessage,
  replyToInstagramComment,
  sendInstagramPrivateReply,
} from "./zernio.server";
import crypto from "node:crypto";
import { convertAmount } from "./currency.server";
import type { Json, TablesUpdate } from "@/integrations-supabase/types";

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

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

  /**
   * Все настройки автоответчика — одним запросом.
   *
   * Их было три подряд, каждая за своим ключом, и на каждое входящее сообщение
   * приходилось три обращения к базе вместо одного. Ключи лежат в одной
   * таблице у одного арендатора, так что выбрать их сразу ничего не стоит.
   */
  const { data: settingRows } = await s
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", process.env.BOT_ID?.trim() || "")
    .in("key", [
      "instagram_direct_bot_enabled",
      "instagram_direct_bot_features",
      "instagram_direct_bot_scope",
      "instagram_direct_bot_script",
      "instagram_direct_bot_triggers",
    ]);

  const setting = (key: string) =>
    (settingRows ?? []).find((row) => row.key === key)?.value?.trim() || "";

  if (setting("instagram_direct_bot_enabled") === "false") {
    console.log("[zernio-bot] Direct assistant is disabled; event recorded without a reply");
    return;
  }

  let features = { catalog: true, search: true, cart: true, checkout: true };
  try {
    features = { ...features, ...JSON.parse(setting("instagram_direct_bot_features") || "{}") };
  } catch { /* defaults */ }

  /**
   * Область ответов. По умолчанию — только покупки.
   *
   * Отвечая, бот неизбежно помечает переписку прочитанной: управлять этим у
   * Instagram нельзя, в API такого нет. Для продавца это значило, что он
   * перестал видеть в приложении, кому нужно ответить, — приходилось смотреть
   * ник в админке и вручную искать человека в Instagram. Поэтому по обычной
   * переписке бот теперь молчит: непрочитанное остаётся непрочитанным.
   */
  const answersEverything = setting("instagram_direct_bot_scope") === "all";

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

  /**
   * Пошаговая покупка. Стоит раньше всех прочих разборов: пока диалог на шаге
   * сценария, реплика покупателя — это ответ на заданный вопрос, а не команда
   * и не поисковый запрос. Раньше состояния не было вовсе, и «Казахстан» в
   * ответ на «из какой вы страны» уходило искать товар с таким названием.
   */
  const attachments: Array<{ url?: string }> = payload.message?.attachments || [];
  const handledByFlow = await handlePurchaseFlow({
    conversationId,
    accountId,
    user,
    text,
    attachmentUrl: attachments.find((item) => item.url)?.url,
    answersEverything,
  });
  if (handledByFlow) return;

  /**
   * Нажатие кнопки обрабатывается всегда, в любом режиме.
   *
   * Кнопка в DM появляется только потому, что её отправили мы — в
   * автоматизации воронки или в ответе бота. Человек по ней осознанно
   * постучался: это самый однозначный сигнал «хочу к боту», какой вообще
   * бывает, и путать его с обычной перепиской невозможно. Раньше проверка
   * режима стояла выше этого блока, и в тихом режиме кнопки молчали.
   */
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

  /**
   * Слово-вызов: им человек сам звонит боту.
   *
   * В тихом режиме бот молчит по обычной переписке, и нужен способ его
   * позвать. Список задаёт продавец — он лучше знает, что пишут в его
   * переписках, а значит и какие слова у него не встречаются в обычном
   * разговоре. Сравнение по целому сообщению, а не по вхождению: «а магазин
   * у вас где?» боту не адресовано, а «Магазин» — адресовано.
   */
  const triggerWords = parseTriggerWords(setting("instagram_direct_bot_triggers"));
  const isTrigger = triggerWords.includes(lower.trim().replace(/[.!?]+$/, ""));
  if (isTrigger) {
    await sendCatalogMenu(conversationId, accountId, user);
    return;
  }

  /**
   * Дальше идут ответы на всё подряд — команды, поиск, свободные вопросы.
   * В режиме «только покупки» мы сюда не заходим: выше уже отработало всё, что
   * относится к заказу и к осознанному обращению к боту, а остальное — обычная
   * переписка продавца с людьми, и лезть в неё незачем.
   */
  if (!answersEverything) {
    console.log(`[zernio-bot] режим «только покупки»: сообщение от ${userKey} оставлено продавцу`);
    return;
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

  /**
   * Поиск остаётся, но только по явной просьбе.
   *
   * Раньше в него проваливалась любая реплика, и это ломало разговор. Сам по
   * себе поиск полезен — покупатель может не знать номера, — поэтому он никуда
   * не делся, просто теперь его надо попросить: «поиск пазлы».
   */
  const searchMatch = lower.match(/^(?:поиск|найти|найди)\s+(.{2,})$/);
  if (features.search && searchMatch) {
    await sendInteractiveProductResults(conversationId, accountId, user, searchMatch[1].trim());
    return;
  }

  /**
   * Свободная реплика — это вопрос, а не поисковый запрос.
   *
   * Здесь была главная поломка Direct: в поиск товаров уходил любой текст
   * длиннее одного символа. «Здравствуйте», «а скидка есть?» и ответ на
   * авто-DM из воронки одинаково превращались в запрос к каталогу и получали
   * «ничего не нашлось» — человек упирался в стену на первой же фразе.
   *
   * Теперь поиском занимается только то, что похоже на номер товара (это
   * разбирает handlePurchaseFlow выше). Сюда доходит именно вопрос: отвечаем
   * заготовленным текстом и зовём продавца — ответить живому человеку он
   * может из админки.
   */
  const flow = await import("./direct-purchase.server");
  const questionState = flow.readDirectState(user.state);
  const now = Date.now();

  /**
   * Здороваемся один раз за разговор.
   *
   * Раньше полное приветствие уходило на каждую реплику: человек писал «не
   * нужно», а в ответ снова получал «Здравствуйте! …напишите номер товара», и
   * так по кругу. Теперь первое сообщение — приветствие, дальше короткое
   * подтверждение, что вопрос передан.
   */
  const greetedRecently =
    Boolean(questionState.greeted_at) &&
    now - Date.parse(questionState.greeted_at!) < 12 * 60 * 60 * 1000;

  /**
   * Продавца зовём не чаще раза в час на собеседника: переписка из пяти реплик
   * не должна превращаться в пять одинаковых уведомлений в Telegram.
   */
  const notifiedRecently =
    Boolean(questionState.notified_at) &&
    now - Date.parse(questionState.notified_at!) < 60 * 60 * 1000;

  if (!notifiedRecently) {
    await flow.notifyAdminAboutQuestion({ question: text, senderName, senderUsername });
  }

  const stamp = new Date().toISOString();
  await flow.setDirectState(user.user_key, {
    ...questionState,
    greeted_at: greetedRecently ? questionState.greeted_at : stamp,
    notified_at: notifiedRecently ? questionState.notified_at : stamp,
  });

  await sendZernioInboxMessage(
    conversationId,
    accountId,
    greetedRecently
      ? "Передал ваш вопрос продавцу — он ответит здесь же."
      : setting("instagram_direct_bot_script") ||
          `Здравствуйте, ${senderName}! 👋\n\n` +
            "Передал ваш вопрос продавцу — он ответит здесь же.\n\n" +
            "Если хотите что-то купить прямо сейчас, напишите номер товара из публикации — например «196».",
  );
}

/**
 * Отправить главное меню и список категорий
 */
/**
 * Меню в ответ на команду.
 *
 * Было хуже, чем бесполезно, и это видно по живой переписке. Меню печатало
 * нумерованный список разделов и просило «написать название категории или тему
 * для поиска», но:
 *
 *  • названия категорий бот не понимал вовсе, а обычный текст перестал уходить
 *    в поиск (для него теперь нужно «поиск …») — то есть инструкция врала;
 *  • номера разделов сталкивались с номерами товаров. Человек отвечал «1»,
 *    имея в виду первый раздел, а бот находил товар «001» и начинал оформление
 *    заказа на него. Ровно это и произошло при проверке;
 *  • кнопка «Корзина» вела в старый путь с оплатой через Robokassa, тогда как
 *    заказы теперь оформляются по чеку с выдачей на почту.
 *
 * Теперь меню говорит ровно то, что бот действительно умеет: принять номер
 * товара. Разбирать каталог удобнее в Telegram-боте — туда и ведём.
 */
async function sendCatalogMenu(conversationId: string, accountId: string, user: any) {
  void user;
  const botLink = await telegramBotLink();

  const lines = [
    "Здесь можно оформить заказ по номеру материала.",
    "",
    "Напишите номер из публикации — например «018», — и я подскажу, как оплатить.",
  ];

  if (botLink) {
    lines.push(
      "",
      `А чтобы посмотреть весь каталог, поискать по теме и получить файлы, заходите в наш бот: ${botLink}`,
    );
  }

  await sendZernioInboxMessage(conversationId, accountId, lines.join("\n"));
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
      `По запросу «${query}» ничего не найдено.\nПопробуйте другое слово или посмотрите весь каталог в нашем боте: ${(await telegramBotLink()) ?? ""}`,
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
    msg += `🔗 Подробнее в нашем боте: ${(await telegramBotLink()) ?? ""}\n\n`;
  }

  msg += "Чтобы оформить заказ, напишите номер материала — например «018».";

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
      `По запросу «${query}» ничего не найдено. Попробуйте другое слово или откройте каталог в нашем боте: ${(await telegramBotLink()) ?? ""}`,
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
      `Ваша корзина пуста. 🛒\nНапишите номер материала из публикации — например «018».`,
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
  msg += "\nЧтобы оформить, напишите «оформить».";

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

/**
 * Шаги сценария покупки. Возвращает true, если реплика обработана и дальше её
 * разбирать не надо.
 *
 * Порядок здесь и есть весь смысл: сначала смотрим, на каком шаге стоит
 * диалог, и только если ни на каком — пытаемся понять свободную реплику. До
 * появления состояния бот делал наоборот и потому отправлял в поиск товаров
 * и «Здравствуйте», и «Казахстан», и односложный ответ на авто-DM воронки.
 */
async function handlePurchaseFlow(params: {
  conversationId: string;
  accountId: string;
  user: any;
  text: string;
  attachmentUrl?: string;
  /** false — режим «только покупки»: на всё, кроме заказа, бот молчит. */
  answersEverything: boolean;
}): Promise<boolean> {
  const { conversationId, accountId, user, text, attachmentUrl, answersEverything } = params;
  const flow = await import("./direct-purchase.server");
  const { classifyIncoming } = await import("./direct-flow");
  const state = flow.readDirectState(user.state);
  const say = (message: string) => sendZernioInboxMessage(conversationId, accountId, message);

  /**
   * Выход из сценария — на любом шаге, а не только на ожидании чека.
   *
   * Раньше «отмена» понималась лишь при ожидании чека, а на выборе страны
   * человек оказывался запертым: при проверке отправили «/start» и получили
   * «Не понял страну» — и так по кругу, потому что любая реплика на этом шаге
   * считалась попыткой назвать страну.
   *
   * Слова здесь заданы прямо, а не через настраиваемый список команд: выход
   * должен работать всегда и одинаково, даже если продавец переопределил
   * команды вызова.
   */
  const { isCancel } = await import("./direct-flow");
  if (state.mode && isCancel(text)) {
    await flow.clearDirectFlow(user.user_key);
    await say("Отменил. Напишите номер материала, когда будете готовы — например «018».");
    return true;
  }

  // ── Ждём чек ────────────────────────────────────────────────────────────
  if (state.mode === "awaiting_proof") {
    if (!attachmentUrl) {
      await say(
        "Жду чек об оплате — пришлите его сюда картинкой или файлом.\n\n" +
          "Если передумали, напишите «отмена».",
      );
      return true;
    }

    const order = await flow.createDirectOrder({
      user,
      productId: state.product_id!,
      countryCode: state.country_code!,
    });
    if (!order) {
      await say("Не получилось оформить заказ. Напишите номер товара ещё раз, пожалуйста.");
      await flow.clearDirectFlow(user.user_key);
      return true;
    }

    const proofPath = await flow.storeReceipt(attachmentUrl, order.id);
    const s = await db();
    await s
      .from("orders")
      .update({ payment_proof_path: proofPath })
      .eq("id", order.id);

    const displayNo = order.order_no || order.id;
    await flow.notifyAdminAboutDirectOrder(order.id, displayNo);

    // Чек не сохранился — продавцу нечего будет проверять, и сказать об этом
    // надо сразу, а не оставлять его гадать над заказом без вложения.
    if (!proofPath) {
      await say("Чек не удалось сохранить. Пришлите его, пожалуйста, ещё раз — картинкой или файлом.");
      await flow.setDirectState(user.user_key, {
        mode: "awaiting_proof",
        product_id: state.product_id,
        country_code: state.country_code,
      });
      return true;
    }

    // Почту спрашиваем после чека: пока человек не заплатил, адрес у него
    // просить не за что, а после оплаты он уже заинтересован ответить.
    if (user.email) {
      await s.from("orders").update({ customer_email: user.email }).eq("id", order.id);
      /**
       * Адрес уже знаем, но остаёмся на шаге почты — иначе обещание «напишите
       * другой адрес» бот бы не выполнил: состояние было бы сброшено, и
       * присланная почта никуда не попала бы.
       *
       * `email_optional` отличает этот шаг от обязательного: если человек
       * напишет не адрес, а что-то другое, мы не будем требовать почту — просто
       * выйдем из сценария и дадим сообщению обычный ход.
       */
      await flow.setDirectState(user.user_key, {
        mode: "awaiting_email",
        pending_order_id: order.id,
        email_optional: true,
      });
      await say(
        `Чек получил, заказ №${displayNo} принят. Проверим оплату и пришлём материалы на ${user.email}.\n\n` +
          "Если нужен другой адрес — напишите его сюда.",
      );
      return true;
    }

    await flow.setDirectState(user.user_key, { mode: "awaiting_email", pending_order_id: order.id });
    await say(
      `Чек получил, заказ №${displayNo} принят.\n\n` +
        "На какую почту прислать материалы? Instagram не умеет пересылать документы, поэтому файлы уходят письмом.",
    );
    return true;
  }

  // ── Ждём страну ─────────────────────────────────────────────────────────
  if (state.mode === "awaiting_country") {
    const options = await flow.listCountries();
    const chosen = flow.matchCountry(text, options);
    if (!chosen) {
      await say(
        "Не понял страну. Ответьте номером из списка или названием — например «1» или «Казахстан».\n\nЧтобы выйти, напишите «отмена».",
      );
      return true;
    }

    const requisites = await flow.paymentInstructionsFor(chosen.code);
    if (!requisites) {
      await say(
        "Для этой страны реквизиты пока не заведены. Продавец свяжется с вами и подскажет, как оплатить.",
      );
      await flow.clearDirectFlow(user.user_key);
      return true;
    }

    const s = await db();
    const { data: product } = await s
      .from("products")
      .select("id, name, price, currency, country_prices")
      .eq("id", state.product_id!)
      .maybeSingle();
    if (!product) {
      await say("Товар больше недоступен. Напишите номер другого, пожалуйста.");
      await flow.clearDirectFlow(user.user_key);
      return true;
    }

    const { amount, currency } = flow.priceForCountry(product, chosen.code);
    await flow.setDirectState(user.user_key, {
      mode: "awaiting_proof",
      product_id: product.id,
      country_code: chosen.code,
    });
    await say(
      `«${product.name}» — ${amount} ${currency}\n\n` +
        `${requisites.instructions}\n\n` +
        "После оплаты пришлите чек сюда — картинкой или файлом.",
    );
    return true;
  }

  // ── Ждём почту ──────────────────────────────────────────────────────────
  if (state.mode === "awaiting_email") {
    const email = flow.extractEmail(text);
    if (!email) {
      /**
       * Шаг был необязательным — адрес мы уже знали и лишь предложили его
       * заменить. Значит, человек написал о чём-то другом: выходим из сценария
       * и отдаём сообщение обычному разбору, а не требуем почту.
       */
      if (state.email_optional) {
        await flow.clearDirectFlow(user.user_key);
        return false;
      }
      await say(
        "Это не похоже на адрес почты. Напишите его целиком, например anna@mail.ru\n\nЧтобы выйти, напишите «отмена».",
      );
      return true;
    }
    const s = await db();
    await s.from("bot_users").update({ email }).eq("user_key", user.user_key);
    if (state.pending_order_id) {
      await s.from("orders").update({ customer_email: email }).eq("id", state.pending_order_id);
    }
    await flow.clearDirectFlow(user.user_key);
    await say(
      `Записал: ${email}\n\n` +
        "Проверим оплату и пришлём материалы на этот адрес. Обычно это занимает несколько часов.",
    );
    return true;
  }

  // ── Сценарий не начат: разбираем свободную реплику ──────────────────────
  if (!text.trim()) return false;

  const incoming = classifyIncoming(text);

  if (incoming.kind === "product_number") {
    const lookup = await flow.findProductByNumber(incoming.number);

    if (lookup.kind === "ambiguous") {
      // Под одним номером несколько товаров. Не угадываем: продать не тот
      // материал хуже, чем задать лишний вопрос.
      const names = lookup.products.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
      await say(
        `Под номером ${incoming.number} у нас несколько материалов:\n\n${names}\n\n` +
          "Напишите точное название нужного или уточните номер у продавца.",
      );
      return true;
    }

    const product = lookup.kind === "found" ? lookup.product : null;
    if (!product) {
      /**
       * Номер есть, а товара по нему нет.
       *
       * В тихом режиме молчим: человек мог написать «5» в обычном разговоре
       * («штук 5 хватит»), и «товар №5 не нашёл» в ответ выглядит дико. Пусть
       * продавец разберётся сам — переписка останется непрочитанной.
       */
      if (!answersEverything) return false;
      await say(
        `Товар с номером ${incoming.number} не нашёл. Проверьте номер в публикации — ` +
          "или напишите, что ищете, и продавец подскажет.",
      );
      return true;
    }
    const options = await flow.listCountries();
    if (options.length === 0) {
      await say("Реквизиты для оплаты пока не заведены. Продавец свяжется с вами.");
      return true;
    }
    await flow.setDirectState(user.user_key, { mode: "awaiting_country", product_id: product.id });
    await say(flow.renderCountryPrompt(product.name, options));
    return true;
  }

  if (incoming.kind === "affirmative") {
    // Односложный ответ — почти всегда реакция на автоматический DM из
    // воронки. Но такое же «да» звучит и в обычном разговоре с продавцом,
    // поэтому в тихом режиме не вмешиваемся.
    if (!answersEverything) return false;
    await say(
      "Отлично! Напишите номер товара из публикации — например «196», — и я подскажу, как оплатить.",
    );
    return true;
  }

  if (incoming.kind === "dismissal") {
    /**
     * Разговор закрывают: «не нужно», «спасибо», «понятно».
     *
     * Отвечаем коротко и на этом замолкаем. Раньше такая реплика попадала в
     * разбор вопросов и человек получал полное приветствие с предложением
     * назвать номер товара — то есть бот здоровался с ним заново после того,
     * как тот вежливо отказался. Продавца тут не зовём: звать его на «спасибо»
     * незачем.
     */
    if (!answersEverything) return false;
    await say("Хорошо! Если что-то понадобится — просто напишите сюда. 🙂");
    return true;
  }

  return false;
}

/** Слова по умолчанию, которыми человек зовёт бота. Продавец может задать свои. */
export const DEFAULT_TRIGGER_WORDS = ["заказать", "купить", "магазин", "каталог", "/start"];

/**
 * Список слов-вызовов из настройки. Пустая настройка не должна оставлять бота
 * без единого способа его позвать, поэтому падаем на значения по умолчанию.
 */
function parseTriggerWords(raw: string): string[] {
  const words = raw
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return words.length > 0 ? words : DEFAULT_TRIGGER_WORDS;
}

/**
 * Ссылка на Telegram-бота этого клиента.
 *
 * Раньше в Direct уходила ссылка на веб-адрес деплоя — а это админка, и
 * покупателю там делать нечего. Правильный адресат — Telegram-бот: в нём
 * каталог, поиск и выдача файлов, ради которых из Instagram и приходят.
 *
 * Юзернейм спрашиваем у самого Telegram по токену, который у деплоя и так
 * есть: так его не надо прописывать руками ни в панели, ни в переменных, и он
 * не разъедется с действительностью, если бота переименуют. Ответ кешируем на
 * процесс — он меняется раз в никогда, а дёргать getMe на каждое сообщение
 * незачем. Переопределить можно переменной TELEGRAM_BOT_USERNAME.
 */
let cachedBotUsername: string | null = null;

export async function telegramBotLink(): Promise<string | null> {
  const override = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (override) return `https://t.me/${override}`;
  if (cachedBotUsername) return `https://t.me/${cachedBotUsername}`;

  try {
    const { tg } = await import("./telegram.server");
    const response = (await tg("getMe", {})) as { ok?: boolean; result?: { username?: string } };
    const username = response?.result?.username?.trim();
    if (!username) return null;
    cachedBotUsername = username;
    return `https://t.me/${username}`;
  } catch (e) {
    console.error("[zernio-bot] не удалось узнать юзернейм Telegram-бота", e);
    return null;
  }
}
