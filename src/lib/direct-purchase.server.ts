import { sendZernioInboxMessage } from "./zernio.server";
import {
  matchCountry,
  extractEmail,
  type CountryOption,
  type DirectMode,
} from "./direct-flow";
import type { Json } from "@/integrations-supabase/types";

/**
 * Сценарий покупки в Instagram Direct: номер товара → страна → реквизиты →
 * чек → почта → подтверждение продавцом → материалы письмом.
 *
 * Почему письмом, а не прямо в переписку. Instagram Direct не принимает
 * вложениями документы — только картинки, видео и аудио, — а продаются здесь
 * PDF и ZIP. Плюс окно в 24 часа: написать покупателю позже суток с его
 * последнего сообщения нельзя, а подтверждение продавцом сплошь и рядом
 * приходится на следующее утро. Оба ограничения платформенные, обойти их
 * кодом нельзя, и почта снимает оба разом.
 *
 * Состояние диалога живёт в `bot_users.state` — там же, где его держит
 * Telegram-бот. До этого Direct-бот состояния не имел вовсе: он создавал
 * пустой `state` и никогда в него не заглядывал, поэтому пошаговый разговор
 * был невозможен, а любая реплика длиннее символа уходила в поиск товаров.
 */

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

function botId(): string {
  return process.env.BOT_ID?.trim() || "";
}

export type DirectState = {
  mode?: DirectMode;
  product_id?: string;
  country_code?: string;
  pending_order_id?: number;
  /** Когда поздоровались — чтобы не делать это заново на каждую реплику. */
  greeted_at?: string;
  /** Когда в последний раз дёргали продавца — чтобы не звать его на каждое слово. */
  notified_at?: string;
  /**
   * Шаг почты необязательный: адрес мы уже знаем и лишь предложили заменить.
   * Если пришло не письмо — выходим из сценария, а не требуем адрес.
   */
  email_optional?: boolean;
};

/** Поля шага покупки. Всё остальное в состоянии — память о разговоре. */
const FLOW_KEYS = [
  "mode",
  "product_id",
  "country_code",
  "pending_order_id",
  "email_optional",
] as const;

/**
 * Дописывает поля в состояние, не затирая остальные.
 *
 * Раньше эта функция писала объект целиком, а шаги сценария передавали только
 * свои поля — и каждый шаг стирал `greeted_at` с `notified_at`. Получалось, что
 * покупатель, начавший заказ, потом снова получал полное приветствие, а
 * продавец — повторное уведомление: тот же дефект, что чинился, только через
 * другой путь. Память о разговоре и шаг сценария живут в одном jsonb, но это
 * разные вещи, и трогать их надо раздельно.
 */
export async function setDirectState(userKey: string, patch: DirectState): Promise<void> {
  const s = await db();
  const { data: existing } = await s
    .from("bot_users")
    .select("state")
    .eq("user_key", userKey)
    .maybeSingle();

  const merged = { ...readDirectState(existing?.state), ...patch };
  await s
    .from("bot_users")
    .update({ state: merged as unknown as Json, updated_at: new Date().toISOString() })
    .eq("user_key", userKey);
}

/**
 * Завершает сценарий покупки, сохраняя память о разговоре.
 *
 * Именно этим и отличается от «записать пустое состояние»: приветствие и время
 * последнего уведомления продавца к заказу не относятся и переживать отмену
 * обязаны — иначе после каждой отмены бот здоровается заново.
 */
export async function clearDirectFlow(userKey: string): Promise<void> {
  const s = await db();
  const { data: existing } = await s
    .from("bot_users")
    .select("state")
    .eq("user_key", userKey)
    .maybeSingle();

  const kept = { ...readDirectState(existing?.state) };
  for (const key of FLOW_KEYS) delete kept[key];

  await s
    .from("bot_users")
    .update({ state: kept as unknown as Json, updated_at: new Date().toISOString() })
    .eq("user_key", userKey);
}

export function readDirectState(raw: unknown): DirectState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as DirectState;
}

/** Страны, по которым у этого клиента заведены реквизиты. */
export async function listCountries(): Promise<CountryOption[]> {
  const s = await db();
  const { data } = await s
    .from("payment_methods")
    .select("country_code, country_name, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const seen = new Set<string>();
  const options: CountryOption[] = [];
  for (const row of data ?? []) {
    const code = row.country_code;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    options.push({ code, name: row.country_name || code });
  }
  return options;
}

/**
 * Найти товар по номеру, который написал покупатель.
 *
 * Клиенты нумеруют товары сами: «018. Набор „Пазлы БУКВЫ“». Отдельного поля
 * под код не заводили намеренно — это был бы второй источник правды и просьба
 * заново заполнить почти пять сотен товаров.
 *
 * Порядок важен, и он обратный тому, что был здесь сначала. Главный источник —
 * **название**: на живом каталоге номер в названии есть у 285 товаров из 490, и
 * ни один номер не достаётся двум товарам сразу. Ключевые слова — только
 * запас, и с жёстким условием (номер целым первым словом): там встречается
 * «1 класс русский язык», из-за чего товар «358. Тетрадь» получал номер 1 и на
 * «1» бот выдавал то его, то «001. Наглядные карточки». Вместе покрытие 377 из
 * 490 при нуле коллизий.
 *
 * Неоднозначность не разрешается угадыванием: сегодня её нет, но каталог
 * пополняется, а молча продать не тот товар — худшее из возможного.
 */
export type ProductLookup =
  | { kind: "found"; product: ProductRow }
  | { kind: "none" }
  | { kind: "ambiguous"; products: ProductRow[] };

type ProductRow = {
  id: string;
  name: string;
  price: number;
  currency: string | null;
  keywords: string | null;
  country_prices: Json | null;
};

const PRODUCT_COLUMNS = "id, name, price, currency, keywords, country_prices";

export async function findProductByNumber(number: string): Promise<ProductLookup> {
  const s = await db();

  /**
   * Фильтруем в базе, а не в приложении.
   *
   * Раньше выгружались все активные товары (у одного клиента их 490) на каждое
   * сообщение с номером, и разбор шёл в памяти. При росте каталога это только
   * дорожает, а сама выборка ничем не помогает: нужен один товар.
   *
   * `0*` в начале — потому что покупатель пишет и «18», и «018»; хвост
   * `[^0-9]` не даёт номеру 18 поймать товар 180. Подстановка безопасна:
   * `number` приходит из extractProductNumber и состоит только из цифр.
   */
  const byName = await s
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .filter("name", "imatch", `^0*${number}[.)]`)
    .limit(5);

  const nameMatches = (byName.data ?? []) as ProductRow[];
  if (nameMatches.length === 1) return { kind: "found", product: nameMatches[0] };
  if (nameMatches.length > 1) return { kind: "ambiguous", products: nameMatches };

  // Запас для товаров, у которых номер только в ключевых словах: там он должен
  // быть целым первым словом, иначе «1 класс …» снова станет товаром №1.
  const byKeywords = await s
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .filter("keywords", "imatch", `^0*${number}\\s*,`)
    .limit(5);

  const keywordMatches = (byKeywords.data ?? []) as ProductRow[];
  if (keywordMatches.length === 1) return { kind: "found", product: keywordMatches[0] };
  if (keywordMatches.length > 1) return { kind: "ambiguous", products: keywordMatches };

  return { kind: "none" };
}

/** Цена в валюте выбранной страны, если для неё задана отдельная. */
export function priceForCountry(
  product: { price: number; currency: string | null; country_prices: Json | null },
  countryCode: string,
): { amount: number; currency: string } {
  const table = product.country_prices;
  if (table && typeof table === "object" && !Array.isArray(table)) {
    const entry = (table as Record<string, Json>)[countryCode];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const row = entry as Record<string, Json>;
      const amount = Number(row.price);
      if (Number.isFinite(amount) && amount > 0) {
        return { amount, currency: String(row.currency || product.currency || "KZT") };
      }
    }
    const plain = Number((table as Record<string, Json>)[countryCode]);
    if (Number.isFinite(plain) && plain > 0) {
      return { amount: plain, currency: String(product.currency || "KZT") };
    }
  }
  return { amount: Number(product.price), currency: String(product.currency || "KZT") };
}

/** Список стран, пронумерованный — покупатель отвечает цифрой или названием. */
export function renderCountryPrompt(options: CountryOption[]): string {
  const lines = options.map((option, index) => `${index + 1}. ${option.name}`);
  return (
    `Из какой вы страны? Реквизиты для оплаты у каждой свои.\n\n` +
    `${lines.join("\n")}\n\n` +
    `Ответьте номером или названием.`
  );
}

/** Реквизиты выбранной страны. */
export async function paymentInstructionsFor(
  countryCode: string,
): Promise<{ instructions: string; currency: string } | null> {
  const s = await db();
  const { data } = await s
    .from("payment_methods")
    .select("instructions, currency")
    .eq("is_active", true)
    .eq("country_code", countryCode)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.instructions?.trim()) return null;
  return { instructions: data.instructions.trim(), currency: data.currency || "KZT" };
}

/**
 * Забрать чек из вложения и положить в приватный бакет.
 *
 * Ссылка на вложение у Instagram — прямая ссылка на CDN платформы, без
 * авторизации, и живёт она недолго. Поэтому файл нужно скачать сразу, а не
 * хранить ссылку: через сутки по ней уже ничего не будет.
 */
export async function storeReceipt(
  attachmentUrl: string,
  /**
   * Папка в бакете. Раньше сюда передавался номер заказа, из-за чего чек можно
   * было сохранить только после его создания — а значит, при сбое загрузки в
   * базе оставался заказ без чека, о котором продавцу уже успели сообщить.
   * Теперь ключ строится от покупателя, и порядок стал правильным: сперва чек,
   * потом заказ.
   */
  folder: string,
): Promise<string | null> {
  try {
    const response = await fetch(attachmentUrl);
    if (!response.ok) {
      console.error("[direct] receipt download failed", response.status);
      return null;
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const bytes = new Uint8Array(await response.arrayBuffer());

    const extension = contentType.includes("pdf")
      ? "pdf"
      : contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : "jpg";

    const s = await db();
    const key = `${folder}/${Date.now()}.${extension}`;
    const { error } = await s.storage
      .from("payment-proofs")
      .upload(key, new Blob([bytes as BlobPart], { type: contentType }), {
        contentType,
        upsert: true,
      });
    if (error) {
      console.error("[direct] receipt upload failed", error);
      return null;
    }
    return key;
  } catch (e) {
    console.error("[direct] storeReceipt failed", e);
    return null;
  }
}

/** Создаёт заказ из выбранного товара — по одному товару за раз, как в сценарии. */
/** Сообщение продавцу о новом заказе — тем же путём, что и у Telegram-бота. */
export async function notifyAdminAboutDirectOrder(orderId: number, displayNo: number | string) {
  const s = await db();
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId())
    .eq("key", "admin_chat_id")
    .maybeSingle();

  const raw = setting?.value?.trim();
  if (!raw) return;

  const { tg } = await import("./telegram.server");
  for (const chatId of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    try {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          `📸 <b>Заказ #${displayNo} из Instagram</b>\n\n` +
          `Покупатель прислал чек. Проверьте оплату и подтвердите заказ в админке — ` +
          `после подтверждения материалы уйдут ему на почту.`,
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("[direct] notify admin failed", e);
    }
  }
}

/** Короткое уведомление продавцу о вопросе, на который бот не отвечает сам. */
export async function notifyAdminAboutQuestion(params: {
  question: string;
  senderName: string;
  senderUsername: string;
}) {
  const s = await db();
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId())
    .eq("key", "admin_chat_id")
    .maybeSingle();

  const raw = setting?.value?.trim();
  if (!raw) return;

  const who = params.senderUsername ? `@${params.senderUsername}` : params.senderName;
  const { tg } = await import("./telegram.server");
  for (const chatId of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    try {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          `💬 <b>Вопрос в Instagram Direct</b>\n\n` +
          `От: ${who}\n\n` +
          `${params.question.slice(0, 500)}\n\n` +
          `Ответить можно в админке, вкладка Instagram → Direct.`,
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("[direct] notify admin about question failed", e);
    }
  }
}

export { matchCountry, extractEmail, sendZernioInboxMessage };

// ─── Корзина ────────────────────────────────────────────────────────────────
//
// Покупают часто не по одному материалу: у продавца это методички по 100–1000 ₸,
// и брать их по одной, каждый раз заново присылая чек, — мучение и для
// покупателя, и для продавца. Корзина (`cart_items`) в базе была и раньше, ею
// пользовался старый путь с оплатой через Robokassa; теперь она стала общим
// накопителем для сценария с чеком.

export type CartLine = {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  currency: string;
  countryPrices: Json | null;
};

/**
 * Материал, у которого нет ни файла, ни ссылки, ни записей в
 * product_material_files, выдать нечем.
 *
 * Таких в живом каталоге 8 из 378. Раньше их можно было заказать и оплатить, а
 * упёрлось бы всё в подтверждение продавцом — уже после того, как человек
 * заплатил. Проверяем на входе в корзину, а не на выдаче.
 */
export async function productHasFiles(productId: string): Promise<boolean> {
  const s = await db();
  const { data: product } = await s
    .from("products")
    .select("file_path, file_url, file_path_kz, file_url_kz")
    .eq("id", productId)
    .maybeSingle();

  if (product?.file_path || product?.file_url || product?.file_path_kz || product?.file_url_kz) {
    return true;
  }

  const { count } = await s
    .from("product_material_files")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  return (count ?? 0) > 0;
}

/** Добавляет материал в корзину; повторное добавление количество не множит. */
export async function addToCart(
  user: { telegram_id: number; user_key: string },
  productId: string,
): Promise<void> {
  const s = await db();
  const { data: existing } = await s
    .from("cart_items")
    .select("id")
    .eq("telegram_id", user.telegram_id)
    .eq("product_id", productId)
    .maybeSingle();

  // Цифровой материал покупают один раз — второй экземпляр того же файла
  // человеку не нужен, и увеличивать количество было бы ошибкой.
  if (existing) return;

  await s.from("cart_items").insert({
    telegram_id: user.telegram_id,
    user_key: user.user_key,
    product_id: productId,
    quantity: 1,
  });
}

export async function readCart(user: { telegram_id: number }): Promise<CartLine[]> {
  const s = await db();
  const { data } = await s
    .from("cart_items")
    .select("quantity, products(id, name, price, currency, country_prices)")
    .eq("telegram_id", user.telegram_id);

  const lines: CartLine[] = [];
  for (const row of data ?? []) {
    const product = (row as { products?: unknown }).products as CartLine | null;
    if (!product) continue;
    const p = product as unknown as {
      id: string;
      name: string;
      price: number;
      currency: string | null;
      country_prices: Json | null;
    };
    lines.push({
      productId: p.id,
      name: p.name,
      quantity: Number((row as { quantity?: number }).quantity) || 1,
      price: Number(p.price),
      currency: String(p.currency || "KZT"),
      countryPrices: p.country_prices,
    });
  }
  return lines;
}

export async function clearCart(user: { telegram_id: number }): Promise<void> {
  const s = await db();
  await s.from("cart_items").delete().eq("telegram_id", user.telegram_id);
}

/** Итог корзины в валюте выбранной страны. */
export function cartTotal(
  lines: CartLine[],
  countryCode: string,
): { amount: number; currency: string } {
  let amount = 0;
  let currency = "KZT";
  for (const line of lines) {
    const priced = priceForCountry(
      { price: line.price, currency: line.currency, country_prices: line.countryPrices },
      countryCode,
    );
    amount += priced.amount * line.quantity;
    currency = priced.currency;
  }
  return { amount, currency };
}

/** Список корзины для сообщения покупателю. */
export function renderCart(lines: CartLine[], countryCode: string | undefined): string {
  const rows = lines.map((line, index) => `${index + 1}. ${line.name}`);
  if (!countryCode) return rows.join("\n");
  const { amount, currency } = cartTotal(lines, countryCode);
  return `${rows.join("\n")}\n\nИтого: ${amount} ${currency}`;
}

/**
 * Создаёт заказ из корзины — по всем её позициям сразу.
 *
 * Пришло на замену прежней версии, которая умела ровно один товар: тот
 * сценарий не давал купить два материала за раз, хотя корзина в базе была.
 */
export async function createOrderFromCart(params: {
  user: { telegram_id: number; user_key: string; username: string | null; first_name: string | null };
  countryCode: string;
}): Promise<{ id: number; order_no: number | null } | null> {
  const s = await db();
  const lines = await readCart(params.user);
  if (lines.length === 0) return null;

  const { amount, currency } = cartTotal(lines, params.countryCode);

  const { data: order, error } = await s
    .from("orders")
    .insert({
      telegram_id: params.user.telegram_id,
      user_key: params.user.user_key,
      platform: "instagram",
      username: params.user.username,
      display_name: params.user.first_name || params.user.username || "Покупатель из Instagram",
      contact: params.user.username ? `@${params.user.username}` : null,
      total: amount,
      currency,
      status: "awaiting_confirmation",
    })
    .select("id, order_no")
    .single();

  if (error || !order) {
    console.error("[direct] create order from cart failed", error);
    return null;
  }

  // Снимки файлов берём здесь же: заказ должен помнить, что именно продали,
  // даже если товар потом отредактируют или снимут с продажи.
  const { data: products } = await s
    .from("products")
    .select("id, name, file_path, file_name, file_path_kz, file_name_kz, file_url, file_url_kz")
    .in("id", lines.map((line) => line.productId));

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const { error: itemsError } = await s.from("order_items").insert(
    lines.map((line) => {
      const p = byId.get(line.productId);
      const priced = priceForCountry(
        { price: line.price, currency: line.currency, country_prices: line.countryPrices },
        params.countryCode,
      );
      return {
        order_id: order.id,
        product_id: line.productId,
        name_snapshot: line.name,
        price_snapshot: priced.amount,
        quantity: line.quantity,
        file_path_snapshot: p?.file_path ?? null,
        file_name_snapshot: p?.file_name ?? null,
        file_url_snapshot: p?.file_url ?? null,
        file_path_kz_snapshot: p?.file_path_kz ?? null,
        file_name_kz_snapshot: p?.file_name_kz ?? null,
        file_url_kz_snapshot: p?.file_url_kz ?? null,
      };
    }),
  );

  if (itemsError) {
    console.error("[direct] create order items failed", itemsError);
    await s.from("orders").delete().eq("id", order.id);
    return null;
  }

  return order;
}
