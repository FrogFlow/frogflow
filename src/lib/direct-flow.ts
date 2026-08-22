import { isLocale, localeNames, SUPPORTED_LOCALES, type Locale } from "./i18n";

/**
 * Разбор реплик покупателя в Instagram Direct — без побочных действий, чтобы
 * можно было проверить тестом.
 *
 * Здесь живут решения, на которых держится весь сценарий продажи: что считать
 * кодом товара, что выбором страны, что почтой и что просто вопросом. Ошибка в
 * любом из них выглядит одинаково — бот «тупит», — но чинится в разных местах,
 * поэтому логика вынесена сюда целиком.
 */

/**
 * Шаг, на котором сейчас находится диалог.
 *
 * `processing_proof` — техническое состояние, а не шаг разговора: чек уже
 * забрали в обработку (см. claimAwaitingProof в direct-purchase.server.ts),
 * и оно существует ровно на время одного вызова, чтобы второе вложение,
 * пришедшее раньше, чем первое обработалось, не создало второй заказ из той
 * же корзины.
 *
 * `awaiting_locale` — самый первый шаг нового покупателя: у Instagram Direct
 * нет команды `/start`, а значит нет и естественной точки, где предложить
 * выбор языка, как это делает Telegram-бот. Заводим её сами — первым же
 * ответом новому отправителю, до всего остального сценария.
 */
export type DirectMode =
  | "awaiting_locale"
  | "awaiting_country"
  | "awaiting_proof"
  | "processing_proof"
  | "awaiting_email"
  | null;

/**
 * Клиенты нумеруют товары сами: у товара «018. Набор „Пазлы БУКВЫ“» первым
 * ключевым словом стоит «018». Покупатель приходит из поста в Instagram и
 * пишет этот номер — иногда как «018», иногда «18», «№18» или «18.».
 *
 * Возвращаем нормализованный вид без ведущих нулей, чтобы сравнивать по нему.
 * `null` — значит, это не номер, а обычный текст.
 */
export function extractProductNumber(text: string): string | null {
  const cleaned = text.trim().replace(/^[№#]\s*/, "");
  const match = cleaned.match(/^(\d{1,5})\s*[.)]?$/);
  if (!match) return null;
  const normalized = match[1].replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
}

const normalizeNumber = (raw: string) => {
  const normalized = raw.replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
};

/**
 * Номер товара из его названия: «018. Набор …», «236) Пазлы …».
 *
 * Это главный и единственный надёжный источник. Проверено на живом каталоге:
 * номер в названии есть у 285 товаров из 490, и ни один номер не достаётся
 * двум товарам сразу.
 */
export function productNumberFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  /**
   * Разделитель после номера у клиента разный: «018. Набор», «236) Пазлы»,
   * «081 | Дни недели» и просто «165 Календари». Сначала здесь принималась
   * только точка или скобка — и 120 товаров, названных через пробел, по номеру
   * было не найти вовсе.
   *
   * Пробел требует после себя непробельный символ, иначе номером стало бы
   * что угодно с цифрами в начале. Спутать с классом это не может: названий
   * вида «1 класс …» в каталоге нет ни одного — проверено запросом, — а классы
   * живут в ключевых словах, откуда номер берётся по более строгому правилу.
   */
  const match = name.trim().match(/^(\d{1,5})(?:\s*[.)|]|\s+\S)/);
  return match ? normalizeNumber(match[1]) : null;
}

/**
 * Номер из ключевых слов — только когда номер стоит там **целым первым
 * словом**: «018, пазлы, карточки…».
 *
 * Требование про запятую не придирка, а следствие живых данных. Раньше здесь
 * стояло просто «цифры в начале», и у товара «358. Тетрадь для диагностики» с
 * ключевыми словами «1 класс русский язык, …» номером становилась **единица**:
 * бот считал, что товар №1 — это Тетрадь, и на «1» выдавал то её, то
 * «001. Наглядные карточки», как повезёт с порядком строк. Ровно это и
 * случилось при живой проверке.
 *
 * С запятой «1 класс …» больше не проходит (после единицы идёт текст, а не
 * запятая), а «36, пазлы Наурыз» проходит — там номер действительно первый.
 * Такой запас нужен: у части товаров номер есть только в ключевых словах,
 * вместе с названием покрытие вырастает с 285 товаров до 377, и коллизий
 * по-прежнему ноль.
 */
export function productNumberFromKeywords(keywords: string | null | undefined): string | null {
  if (!keywords) return null;
  const match = keywords.trim().match(/^(\d{1,5})\s*,/);
  return match ? normalizeNumber(match[1]) : null;
}

/**
 * «Убрать 018» — единственный способ передумать по одной позиции.
 *
 * До этого из корзины можно было только выкинуть всё сразу словом «отмена».
 * Человек, набравший три материала и ошибшийся в одном номере, вынужден был
 * начинать заново — а чаще просто спрашивал продавца, то есть ровно та работа,
 * которую бот должен снимать.
 */
export function parseRemoveCommand(text: string): string | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(?:убрать|убери|удали|удалить|минус|-)\s*[№#]?\s*(\d{1,5})\s*[.)]?$/);
  return match ? normalizeNumber(match[1]) : null;
}

/**
 * Какую позицию корзины убрать. Сначала по номеру материала, потом по месту в
 * списке: покупатель видит «1. 018. Набор…» и может назвать любое из двух.
 */
export function pickCartLineToRemove(number: string, names: string[]): number | null {
  const byNumber = names.findIndex((name) => productNumberFromName(name) === number);
  if (byNumber >= 0) return byNumber;

  const position = Number(number);
  if (Number.isInteger(position) && position >= 1 && position <= names.length) return position - 1;
  return null;
}

/**
 * Понять, какой язык выбрал покупатель на первом шаге разговора.
 *
 * Тот же приём, что и у matchCountry чуть ниже, и по той же причине: кнопок
 * Instagram даёт максимум три на сообщение, а языков у нас четыре. Текстовый
 * список работает везде, включая папку «Запросы сообщений», куда попадает
 * весь трафик от неподписчиков — то есть все новые покупатели из Direct.
 *
 * Принимаем порядковый номер из показанного списка (порядок — SUPPORTED_LOCALES),
 * код языка («ru», «kk», «en», «uz») и родное название языка целиком или его
 * начало («English», «Рус», «Tilni»).
 */
export function matchLocalePick(text: string): Locale | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    return SUPPORTED_LOCALES[index] ?? null;
  }

  const strip = (value: string) => value.toLowerCase().replace(/[^\p{L}]+/gu, "");
  const needle = strip(raw);
  if (!needle) return null;

  if (isLocale(needle)) return needle;

  for (const locale of SUPPORTED_LOCALES) {
    const name = strip(localeNames[locale]);
    if (name === needle) return locale;
    if (needle.length >= 3 && name.startsWith(needle)) return locale;
  }
  return null;
}

export type CountryOption = { code: string; name: string };

/**
 * Понять, какую страну назвал покупатель.
 *
 * Список приходит из payment_methods, поэтому он у каждого клиента свой.
 * Принимаем три способа ответа: порядковый номер из показанного списка,
 * название целиком или его начало, а также код страны. Флаг-эмодзи в начале
 * названия («🇰🇿 Казахстан») при сравнении отбрасывается.
 *
 * Почему не кнопками: у Instagram их максимум три, а стран шесть. Быстрые
 * ответы вмещают тринадцать, но не отображаются в папке «Запросы сообщений» —
 * именно туда попадают письма от неподписчиков, то есть весь трафик из
 * воронки. Текст работает везде.
 */
export function matchCountry(text: string, options: CountryOption[]): CountryOption | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    return options[index] ?? null;
  }

  const strip = (value: string) =>
    value
      .toLowerCase()
      // Флаги — суррогатные пары региональных индикаторов; вычищаем их и знаки.
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();

  const needle = strip(raw);
  if (!needle) return null;

  for (const option of options) {
    if (option.code.toLowerCase() === needle) return option;
    const name = strip(option.name);
    if (!name) continue;
    if (name === needle) return option;
    // «казах» → «казахстан»: покупатели дописывают не всегда.
    if (needle.length >= 4 && name.startsWith(needle)) return option;
  }
  return null;
}

/**
 * Какое вложение можно считать чеком.
 *
 * Типы взяты из живых событий вебхука, а не придуманы: image (1005 событий),
 * template (350), audio (90), video (73), share (44), ephemeral (5), file (2).
 * Чек — только картинка или файл. Раньше бралось первое вложение со ссылкой,
 * и голосовое сообщение или пересланный пост на шаге ожидания чека становились
 * «чеком»: по нему создавался заказ, а продавец получал на проверку аудио.
 *
 * Отсутствующий тип считаем картинкой: так вело себя прежнее правило, и события
 * без типа — это старые записи, где вложение всегда было фотографией чека.
 */
export function pickReceiptAttachment(
  attachments:
    | Array<{ url?: string; type?: string; payload?: { url?: string; mimeType?: string } }>
    | null
    | undefined,
): string | null {
  for (const item of attachments ?? []) {
    const url = item.url || item.payload?.url;
    if (!url) continue;
    const type = item.type?.trim().toLowerCase();
    const mime = item.payload?.mimeType?.trim().toLowerCase();
    if (
      !type ||
      type === "image" ||
      type === "photo" ||
      type === "file" ||
      type === "document" ||
      mime?.startsWith("image/") ||
      mime === "application/pdf"
    ) {
      return url;
    }
  }
  return null;
}

/**
 * На активном платёжном шаге вложение — ожидаемый ответ покупателя. Zernio
 * уже несколько раз менял форму media-объекта между каналами; здесь нельзя
 * потерять оплаченный заказ только из-за нового имени `type`. Берём первый URL,
 * а проверка/распознавание файла дальше всё равно действует fail-safe.
 */
export function pickExpectedReceiptAttachment(
  attachments:
    | Array<{ url?: string; type?: string; payload?: { url?: string; mimeType?: string } }>
    | null
    | undefined,
): string | null {
  for (const item of attachments ?? []) {
    const url = item.url || item.payload?.url;
    if (url) return url;
  }
  return null;
}

/**
 * Проверка почты — намеренно нестрогая.
 *
 * Задача не отсеять экзотические адреса по RFC, а поймать опечатку до того,
 * как продавец подтвердит заказ и письмо уйдёт в никуда. Всё, что похоже на
 * адрес, пропускаем.
 */
export function extractEmail(text: string): string | null {
  const match = text.trim().match(/[^\s<>()[\],;:@"]+@[^\s<>()[\],;:@"]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Короткие согласия вроде «да», «хочу», «интересует».
 *
 * Нужны, чтобы отличить ответ на автоматический DM из воронки от кода товара
 * или вопроса: человек отвечает воронке односложно, и принимать это за
 * поисковый запрос — верный способ показать ему «ничего не найдено».
 */
const AFFIRMATIVES = new Set([
  "да",
  "да!",
  "ага",
  "угу",
  "хочу",
  "хочу!",
  "интересно",
  "интересует",
  "давайте",
  "давай",
  "+",
  "ок",
  "окей",
  "ok",
  "yes",
  "нужно",
  "надо",
]);

export function isAffirmative(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return AFFIRMATIVES.has(normalized) || AFFIRMATIVES.has(`${normalized}!`);
}

/**
 * Реплики, которыми разговор закрывают: «не нужно», «спасибо», «понятно».
 *
 * Без них бот попадал в петлю. На вопрос он отвечал «передам продавцу, а если
 * хотите — можно заказать через меня», человек писал «не нужно» — и получал в
 * ответ полное приветствие с предложением написать номер товара. Дальше по
 * кругу: любая вежливая реплика снова считалась вопросом.
 */
const DISMISSALS = new Set([
  "нет",
  "не",
  "не нужно",
  "ненужно",
  "не надо",
  "ненадо",
  "не хочу",
  "неинтересно",
  "не интересно",
  "спасибо",
  "спс",
  "благодарю",
  "понятно",
  "понял",
  "поняла",
  "хорошо",
  "ясно",
  "всё",
  "все",
  "пока",
  "до свидания",
  "-",
]);

export function isDismissal(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!)»"]+$/g, "")
    .replace(/\s+/g, " ");
  return DISMISSALS.has(normalized);
}

/**
 * Слова выхода из сценария.
 *
 * Заданы прямо, а не через настраиваемый список команд: выход обязан работать
 * всегда и одинаково, даже если продавец переопределил слова вызова. Раньше
 * «отмена» понималась только на шаге ожидания чека, и на выборе страны человек
 * оказывался заперт — «/start» там отвечало «Не понял страну», и так по кругу.
 */
const CANCEL_WORDS = new Set([
  "отмена",
  "отменить",
  "отмени",
  "стоп",
  "сброс",
  "сбросить",
  "заново",
  "начать заново",
  "/start",
  "/stop",
  "хватит",
]);

export function isCancel(text: string): boolean {
  return CANCEL_WORDS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, ""),
  );
}

/**
 * Команды бота — те, что человек пишет словами.
 *
 * Сравнение по **целому сообщению**, и это не придирка к стилю. Раньше команды
 * искались вхождением: `lower.includes("оплат")`. В живой переписке покупательница
 * написала «Я оплатила 400тг вам, вы материал мне не отправили» — бот увидел в
 * этом «оплат», принял за команду «оформить заказ» и ответил ей «Корзина пуста».
 * На жалобу о неполученном материале. То же вхождение ловило «заказ» в «а где
 * мой заказ, я оплатила вчера» и «каталог» в любом упоминании каталога.
 *
 * Целое сообщение такой ошибки сделать не может: «оплатить» — это команда,
 * «я оплатила 400тг» — это фраза человека, и путать их нельзя.
 */
export type DirectCommand = "catalog" | "cart" | "checkout" | "orders" | "language";

const COMMANDS: Array<[DirectCommand, string[]]> = [
  [
    "catalog",
    [
      "/start",
      "start",
      "старт",
      "меню",
      "каталог",
      "магазин",
      "товары",
      "материалы",
      "начать",
      "бастау",
      "мәзір",
      "дүкен",
      "тауарлар",
      "материалдар",
      "menu",
      "catalog",
      "store",
      "products",
      "materials",
      "boshlash",
      "menyu",
      "do'kon",
      "do‘kon",
      "tovarlar",
      "materiallar",
    ],
  ],
  [
    "cart",
    [
      "корзина",
      "корзину",
      "моя корзина",
      "что в корзине",
      "что у меня в корзине",
      "себет",
      "себетке",
      "менің себетім",
      "себетімде не бар",
      "cart",
      "my cart",
      "what is in my cart",
      "savat",
      "savatga",
      "mening savatim",
      "savatimda nima bor",
    ],
  ],
  [
    "checkout",
    [
      "оформить",
      "оформить заказ",
      "оформляем",
      "оплатить",
      "оплата",
      "хочу оплатить",
      "как оплатить",
      "к оплате",
      "реквизиты",
      "тапсырысты рәсімдеу",
      "тапсырыс рәсімдеу",
      "төлеу",
      "төлем",
      "қалай төлеуге болады",
      "төлем деректемелері",
      "place order",
      "checkout",
      "pay",
      "payment",
      "how to pay",
      "payment details",
      "buyurtma berish",
      "buyurtmani rasmiylashtirish",
      "rasmiylashtirish",
      "to'lash",
      "to‘lash",
      "to'lov",
      "to‘lov",
      "qanday to'lash",
      "qanday to‘lash",
      "to'lov rekvizitlari",
      "to‘lov rekvizitlari",
    ],
  ],
  [
    "orders",
    [
      "мои заказы",
      "заказы",
      "мой заказ",
      "где мой заказ",
      "статус заказа",
      "менің тапсырыстарым",
      "тапсырыстар",
      "менің тапсырысым",
      "тапсырыс күйі",
      "my orders",
      "my order",
      "order status",
      "buyurtmalarim",
      "buyurtmalar",
      "buyurtmam",
      "buyurtma holati",
    ],
  ],
  /**
   * Повторный вызов выбора языка — на случай, если выбрали не тот язык на
   * первом шаге или разговор хочет продолжить кто-то другой. Слова заданы на
   * всех четырёх поддерживаемых языках и по-английски, каждое — как оно
   * называет само себя.
   */
  ["language", ["язык", "тіл", "til", "language", "/language"]],
];

export function matchDirectCommand(text: string): DirectCommand | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/^[«"]+|[»"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  for (const [command, words] of COMMANDS) {
    if (words.includes(normalized)) return command;
  }
  return null;
}

/**
 * Человек пишет о проблеме с оплатой или требует деньги назад.
 *
 * Появилось из настоящей переписки, и она стоит того, чтобы её пересказать.
 * Покупательница оплатила 400 ₸, материал не получила и написала об этом. Бот
 * ответил «Корзина пуста — напишите номер материала», потом ровно то же во
 * второй раз, а на «верните мои деньги» — дважды «Передал ваш вопрос
 * продавцу». Четыре сообщения, ни одного по делу.
 *
 * Такая реплика — единственный случай, когда бот обязан не отвечать по
 * сценарию, а немедленно позвать живого человека: деньги уже уплачены, и любой
 * заготовленный текст здесь читается как отговорка. Продавцу уходит отдельное
 * срочное уведомление, а бот замолкает.
 */
const PAID_MARKERS =
  /(оплат|заплат|перевел|перевёл|перевод|перечисл|скинул[аи]?\s*(деньги|оплат|чек)?|отправил[аи]?\s*(деньги|оплату|чек))/i;

/**
 * Корни здесь нарочно короткие: «не пришло» и «не пришел» — одна и та же
 * жалоба, а по корню «пришл» второе не находится вовсе. На таких деталях
 * проверка и обманывает: выглядит работающей, а половину живых фраз пропускает.
 */
const MISSING_MARKERS =
  /(не\s*(приш|дош|получ|отправ|присыл|скач|откры|работ|прош|отвеча)|ничего\s*(не|нет)|нет\s*(файл|материал|письм|ссылк)|где\s*(мой|моя|мои|файл|материал|заказ|ссылк|письм))/i;

const SUBJECT_MARKERS = /(материал|файл|заказ|письм|ссылк|доступ|товар)/i;

const REFUND_MARKERS =
  /(верн(и|ите|уть|ёте|ете)[^.!?]{0,24}(деньги|оплату|средства|деньгами)|возврат|обман|мошенн|развод|жалоб|полици|в\s*суд)/i;

export function isPaymentComplaint(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (REFUND_MARKERS.test(value)) return true;
  const missing = MISSING_MARKERS.test(value);
  if (!missing) return false;
  // «Оплатила, а материал не пришёл» и «файл не открывается» — обе жалобы,
  // но «не могу найти реквизиты» жалобой не является: там нет ни оплаты, ни
  // пропавшего материала, и на такой вопрос бот отвечает сам.
  return PAID_MARKERS.test(value) || SUBJECT_MARKERS.test(value);
}

export type IncomingKind =
  | { kind: "product_number"; number: string }
  | { kind: "affirmative" }
  | { kind: "dismissal" }
  | { kind: "question"; text: string };

/**
 * К чему отнести свободную реплику, когда сценарий ещё не начат.
 *
 * Прежняя версия бота отправляла в поиск товаров любой текст длиннее одного
 * символа. Из-за этого «Здравствуйте», «а скидка есть?» и односложный ответ
 * воронке одинаково превращались в поисковый запрос и получали «ничего не
 * нашлось». Теперь поиском занимается только то, что похоже на номер товара,
 * остальное честно считается вопросом.
 */
export function classifyIncoming(text: string): IncomingKind {
  const number = extractProductNumber(text);
  if (number !== null) return { kind: "product_number", number };
  // Отказ проверяется раньше согласия: «нет» и «не надо» иначе рискуют попасть
  // в согласие по частичному совпадению, и разговор пойдёт не туда.
  if (isDismissal(text)) return { kind: "dismissal" };
  if (isAffirmative(text)) return { kind: "affirmative" };
  return { kind: "question", text: text.trim() };
}
