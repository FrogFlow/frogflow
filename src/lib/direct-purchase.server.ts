import { createHash } from "node:crypto";
import { sendZernioInboxMessage, type ZernioDmButton } from "./zernio.server";
import {
  matchCountry,
  extractEmail,
  parseRemoveCommand,
  pickCartLineToRemove,
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
  /** Отпечаток последнего отправленного сообщения — чтобы не повторяться. */
  last_reply?: string;
  /** Когда оно ушло: повтор гасим только пока разговор тот же. */
  last_reply_at?: string;
  /** Когда человек пожаловался на оплату — продавца зовём один раз, не на каждое слово. */
  complained_at?: string;
  /**
   * Сколько раз подряд человек ответил не то, что бот ждал на этом шаге.
   *
   * Нужно, чтобы бот вовремя замолчал. На живом заказе покупательница,
   * получив «ждите подтверждения», продолжала нажимать кнопки и писать, а бот
   * отвечал на каждое сообщение — и вместо помощи вышла куча сообщений,
   * которая только запутала и её, и продавца. Два промаха — предел: дальше
   * зовём продавца и уходим с дороги.
   */
  misses?: number;
};

/**
 * Поля шага покупки. Всё остальное в состоянии — память о разговоре.
 *
 * `country_code` сюда намеренно не входит: страна покупателя не меняется от
 * заказа к заказу, и спрашивать её каждый раз — лишний шаг на пути к оплате.
 * Запомненную страну бот называет вслух, чтобы человек мог возразить, а сменить
 * её можно словом «отмена».
 */
const FLOW_KEYS = [
  "mode",
  "product_id",
  "pending_order_id",
  "email_optional",
  "misses",
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

/**
 * Отправка в Direct с одним правилом: два раза подряд одно и то же не уходит.
 *
 * Взято из живой переписки. Покупательница написала о неполученном материале —
 * бот ответил «Корзина пуста. Напишите номер материала»; она нажала кнопку
 * «Оформить заказ» — и получила ровно тот же текст второй раз. Дальше дважды
 * подряд «Передал ваш вопрос продавцу». Повтор — это худшее, что бот может
 * сделать в такой момент: человек и так уже понял, что его не слышат, а
 * дословное повторение доказывает ему, что на другом конце автомат.
 *
 * Гасим только дословный повтор и только в пределах десяти минут: если человек
 * вернулся через час и снова спросил корзину, ответить надо.
 *
 * Отпечаток храним в том же `bot_users.state`, что и шаг сценария, и читаем его
 * из базы заново — за одно событие бот успевает записать состояние несколько
 * раз, и объект `user`, пришедший в обработчик, к этому моменту уже устарел.
 */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;

function fingerprint(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export async function sendDirectReply(params: {
  conversationId: string;
  accountId: string;
  userKey: string;
  text: string;
  buttons?: ZernioDmButton[];
}): Promise<boolean> {
  const s = await db();
  const { data: existing } = await s
    .from("bot_users")
    .select("state")
    .eq("user_key", params.userKey)
    .maybeSingle();

  const state = readDirectState(existing?.state);
  const mark = fingerprint(params.text);
  const fresh =
    Boolean(state.last_reply_at) && Date.now() - Date.parse(state.last_reply_at!) < REPEAT_WINDOW_MS;

  if (state.last_reply === mark && fresh) {
    console.log(`[direct] повтор подавлен для ${params.userKey}: «${params.text.slice(0, 60)}…»`);
    return false;
  }

  await sendZernioInboxMessage(
    params.conversationId,
    params.accountId,
    params.text,
    undefined,
    undefined,
    params.buttons,
  );
  await setDirectState(params.userKey, {
    last_reply: mark,
    last_reply_at: new Date().toISOString(),
  });
  return true;
}

/**
 * Разговор передан живому человеку — бот в него больше не лезет.
 *
 * Сказав «больше отвечать не буду, чтобы не мешать», бот обязан это выполнить.
 * Иначе получается хуже, чем до починки: он и обещание не сдержал, и продолжил
 * отвечать заготовками там, где человек ждёт продавца.
 *
 * Шесть часов — с запасом на то, чтобы продавец успел прочитать уведомление и
 * ответить сам, но не настолько долго, чтобы бот замолчал навсегда.
 */
export function handedToHuman(state: DirectState): boolean {
  return (
    Boolean(state.complained_at) &&
    Date.now() - Date.parse(state.complained_at!) < 6 * 60 * 60 * 1000
  );
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
 *
 * Считать покрытие и коллизии надо в границах одного арендатора. Номера у
 * клиентов пересекаются между собой — «0018 Состав числа» у одного и
 * «018. Набор» у другого дают один и тот же 18, — но деплой ходит ключом
 * арендатора, и RLS отдаёт ему только свои товары. Проверка через service_role
 * покажет ложные двойники: она видит все каталоги сразу.
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
    .filter("name", "imatch", `^0*${number}([.)|]|\\s)`)
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
): Promise<{ path: string; bytes: Uint8Array; mime: string } | null> {
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
    // Байты возвращаем вместе с путём: их сразу же проверяет распознавание чека,
    // и качать файл обратно из хранилища ради этого было бы лишней работой.
    return { path: key, bytes, mime: contentType };
  } catch (e) {
    console.error("[direct] storeReceipt failed", e);
    return null;
  }
}

/**
 * Проверка чека распознаванием — то же, что делает Telegram-бот.
 *
 * Смысл именно в этом шаге: без него продавцу приходится глазами сверять каждый
 * чек с суммой заказа, и вся экономия времени от бота теряется. Сходится сумма
 * — материалы уходят сами, и человек получает их через минуту, а не через
 * несколько часов.
 *
 * Молча ничего не выдаём: не сошлось, не распознали, модуль выключен или нет
 * ключа Vision — заказ уходит продавцу на ручную проверку с причиной. Ошибка в
 * сторону «пусть посмотрит человек» здесь единственно верная: выдать материалы
 * по чужому или поддельному чеку хуже, чем задержать выдачу на пару часов.
 */
export async function verifyDirectReceipt(params: {
  bytes: Uint8Array;
  mime: string;
  expectedAmount: number;
  currency: string;
}): Promise<{ autoDeliver: boolean; note: string }> {
  const { hasModule } = await import("./modules/modules.server");
  if (!(await hasModule("receipt_ocr"))) {
    return { autoDeliver: false, note: "распознавание чека не подключено" };
  }

  const { verifyPaymentReceipt } = await import("./receipt-verify.server");
  const result = await verifyPaymentReceipt({
    bytes: params.bytes,
    mime: params.mime,
    expectedAmount: params.expectedAmount,
    currency: params.currency,
  });

  if (result.ok) {
    return { autoDeliver: true, note: `чек распознан, сумма ${result.matchedAmount} сходится` };
  }
  return { autoDeliver: false, note: result.detail };
}

/** Создаёт заказ из выбранного товара — по одному товару за раз, как в сценарии. */
/**
 * Сообщение продавцу о новом заказе.
 *
 * С составом и суммой, а не одним номером: продавец читает это с телефона и
 * первым делом сверяет чек с суммой заказа. Раньше в сообщении был только номер,
 * и за каждой проверкой приходилось идти в админку — даже чтобы понять, сколько
 * человек должен был заплатить.
 */
export async function notifyAdminAboutDirectOrder(
  orderId: number,
  displayNo: number | string,
  options?: {
    /** Что сказало распознавание чека — попадает в сообщение как есть. */
    verdict?: string;
    /**
     * Нужно ли действие продавца. Кнопки показываем только тогда: на заказ,
     * который бот уже выдал сам, они бы только сбивали с толку.
     */
    needsAction?: boolean;
  },
) {
  const s = await db();
  const { data: setting } = await s
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId())
    .eq("key", "admin_chat_id")
    .maybeSingle();

  const raw = setting?.value?.trim();
  if (!raw) return;

  const { data: order } = await s
    .from("orders")
    .select("total, currency, username, display_name, order_items(name_snapshot, price_snapshot)")
    .eq("id", orderId)
    .maybeSingle();

  const items = ((order?.order_items ?? []) as Array<{ name_snapshot: string }>)
    .map((item) => `• ${item.name_snapshot}`)
    .join("\n");
  const who = order?.username ? `@${order.username}` : order?.display_name || "покупатель";

  const { tg } = await import("./telegram.server");
  for (const chatId of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    try {
      const needsAction = options?.needsAction !== false;
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          `📸 <b>Заказ №${displayNo} из Instagram</b>\n\n` +
          `От: ${who}\n` +
          `Сумма: <b>${order?.total ?? "?"} ${order?.currency ?? ""}</b>\n\n` +
          `${items || "(состав недоступен)"}\n\n` +
          (options?.verdict ? `Чек: ${options.verdict}\n\n` : "") +
          (needsAction
            ? "Сверьте чек и нажмите кнопку ниже — материалы уйдут покупателю на почту."
            : "Материалы уже отправлены покупателю на почту — делать ничего не нужно."),
        parse_mode: "HTML",
        /**
         * Кнопки прямо здесь, а не «зайдите в админку».
         *
         * Это главное возражение продавца: чтобы подтвердить заказ из Direct,
         * ей приходилось открывать панель, искать там человека по нику и
         * подтверждать — тогда как ответить в Instagram она может с телефона за
         * пару секунд. Механизм подтверждения кнопкой в Telegram уже был для
         * заказов из Telegram (см. handleUpdate: confirm:/reject:), и он не
         * зависит от площадки — выдача сама выбирает письмо для Instagram.
         * Не хватало ровно этих двух кнопок.
         *
         * На выданный заказ кнопок нет: нажатие всё равно ответило бы «уже
         * выдан», а сомнение у продавца осталось бы.
         */
        ...(needsAction
          ? {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "✅ Подтвердить и выдать", callback_data: `confirm:${orderId}` },
                    { text: "❌ Отклонить", callback_data: `reject:${orderId}` },
                  ],
                ],
              },
            }
          : {}),
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

/**
 * Жалоба на оплату — отдельным срочным сообщением и сразу с фактами.
 *
 * Обычное «вопрос в Direct» здесь не годится. Человек уже заплатил, и первое,
 * что нужно продавцу, — понять, есть ли его заказ в базе и в каком он
 * состоянии: подтверждения ждёт, отклонён или вовсе не создавался. Раньше за
 * этим приходилось идти в админку и искать покупателя по нику — а покупатель в
 * это время ждал и писал снова.
 *
 * Поэтому в сообщение сразу попадают последние заказы этого человека со
 * статусом, суммой и пометкой, приложен ли чек. Ответить он всё равно должен
 * сам — бот в такой разговор больше не лезет.
 */
export async function notifyAdminAboutComplaint(params: {
  text: string;
  senderName: string;
  senderUsername: string;
  telegramId: number;
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

  const { data: orders } = await s
    .from("orders")
    .select("id, order_no, total, currency, status, payment_proof_path, customer_email, created_at")
    .eq("telegram_id", params.telegramId)
    .order("created_at", { ascending: false })
    .limit(3);

  const history = (orders ?? []).length
    ? (orders ?? [])
        .map((order) => {
          const when = order.created_at
            ? new Date(order.created_at).toLocaleDateString("ru-RU")
            : "";
          return (
            `• №${order.order_no ?? order.id} — ${order.total} ${order.currency} — ` +
            `${order.status}${order.payment_proof_path ? ", чек есть" : ", чека нет"}` +
            `${order.customer_email ? `, почта ${order.customer_email}` : ", почты нет"}` +
            `${when ? ` (${when})` : ""}`
          );
        })
        .join("\n")
    : "заказов в базе нет — оплата прошла мимо бота";

  const who = params.senderUsername ? `@${params.senderUsername}` : params.senderName;
  const { tg } = await import("./telegram.server");
  for (const chatId of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    try {
      await tg("sendMessage", {
        chat_id: chatId,
        text:
          `‼️ <b>Вопрос по оплате в Instagram</b>\n\n` +
          `От: ${who}\n\n` +
          `«${params.text.slice(0, 500)}»\n\n` +
          `<b>Заказы покупателя:</b>\n${history}\n\n` +
          `Бот на это отвечать не будет — ответьте, пожалуйста, сами в Instagram.`,
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("[direct] notify admin about complaint failed", e);
    }
  }
}

export {
  matchCountry,
  extractEmail,
  parseRemoveCommand,
  pickCartLineToRemove,
  sendZernioInboxMessage,
};

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

/** Убирает одну позицию — «убрать 018», когда номер набрали не тот. */
export async function removeFromCart(
  user: { telegram_id: number },
  productId: string,
): Promise<void> {
  const s = await db();
  await s
    .from("cart_items")
    .delete()
    .eq("telegram_id", user.telegram_id)
    .eq("product_id", productId);
}

export async function clearCart(user: { telegram_id: number }): Promise<void> {
  const s = await db();
  await s.from("cart_items").delete().eq("telegram_id", user.telegram_id);
}

/** Итог корзины в валюте выбранной страны. */
export function cartTotal(
  lines: CartLine[],
  countryCode: string,
): { amount: number; currency: string; mixedCurrency: boolean } {
  let amount = 0;
  const currencies = new Set<string>();
  for (const line of lines) {
    const priced = priceForCountry(
      { price: line.price, currency: line.currency, country_prices: line.countryPrices },
      countryCode,
    );
    amount += priced.amount * line.quantity;
    currencies.add(priced.currency);
  }
  /**
   * Валюты в корзине могут разойтись, и складывать их нельзя.
   *
   * Прежняя версия молча брала валюту последней позиции и выдавала сумму,
   * которая не значит ничего: 700 KZT плюс 500 RUB превратились бы в «1200 RUB».
   * Старый путь оформления это как раз проверял и отказывался — при переходе на
   * корзину проверка потерялась. Сегодня у всех клиентов товары в одной валюте,
   * так что это не всплывало, но модуль мультивалютности включён, и ошибка в
   * деньгах — последнее, что стоит оставлять на «авось».
   */
  return {
    amount,
    currency: currencies.values().next().value ?? "KZT",
    mixedCurrency: currencies.size > 1,
  };
}

/** Список корзины для сообщения покупателю. */
export function renderCart(lines: CartLine[], countryCode: string | undefined): string {
  /**
   * С ценой у каждой позиции, но без итога.
   *
   * Покупатель должен видеть, из чего складывается сумма: иначе итог выглядит
   * взятым с потолка, и человек идёт спрашивать — то есть ровно та работа,
   * которую бот должен был снять с продавца. Сам итог печатает вызывающий: в
   * реквизитах это «К оплате», в просмотре корзины — «Итого», и дублировать
   * его здесь значило бы показать сумму дважды подряд.
   *
   * Страны может ещё не быть (её спрашивают позже) — тогда считаем по цене
   * товара как есть: у этого каталога цены по странам заданы только для
   * Казахстана, и базовая цена для почти всех и есть настоящая.
   */
  return lines
    .map((line, index) => {
      const priced = priceForCountry(
        { price: line.price, currency: line.currency, country_prices: line.countryPrices },
        countryCode ?? "",
      );
      const sum = priced.amount * line.quantity;
      return `${index + 1}. ${line.name} — ${sum} ${priced.currency}`;
    })
    .join("\n");
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

/** Предел непонятых ответов на одном шаге, после которого зовём продавца. */
export const MAX_STEP_MISSES = 2;

/**
 * Человек отвечает не то, что бот ждёт. Решает, подсказать ещё раз или уйти.
 *
 * Появилось после разбора живого заказа: покупательнице сказали «ждите
 * подтверждения», а она продолжала нажимать кнопки и писать — бот отвечал на
 * каждое сообщение, и вышла та самая «куча сообщений», которая запутала всех.
 *
 * Логика простая и намеренно короткая: один раз подсказываем, второй раз
 * извиняемся, зовём продавца и замолкаем. Живой человек разберётся быстрее, чем
 * бот на третьей попытке, а непрочитанное в Instagram снова станет видно
 * продавцу — бот перестанет отвечать и помечать переписку прочитанной.
 */
export async function handleStepMiss(params: {
  user: { user_key: string; first_name: string | null; username: string | null };
  state: DirectState;
  text: string;
  hint: string;
  say: (message: string) => Promise<unknown>;
}): Promise<void> {
  const misses = (params.state.misses ?? 0) + 1;

  if (misses < MAX_STEP_MISSES) {
    await setDirectState(params.user.user_key, { ...params.state, misses });
    await params.say(params.hint);
    return;
  }

  await clearDirectFlow(params.user.user_key);
  await params.say(
    "Похоже, я не понимаю — не буду мешать. Продавец увидит вашу переписку и ответит сам.",
  );
  await notifyAdminAboutQuestion({
    question: `Не смог довести до конца оформление. Последнее сообщение: «${params.text}»`,
    senderName: params.user.first_name || "покупатель",
    senderUsername: params.user.username || "",
  });
}
