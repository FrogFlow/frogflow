/**
 * Разбор реплик покупателя в Instagram Direct — без побочных действий, чтобы
 * можно было проверить тестом.
 *
 * Здесь живут решения, на которых держится весь сценарий продажи: что считать
 * кодом товара, что выбором страны, что почтой и что просто вопросом. Ошибка в
 * любом из них выглядит одинаково — бот «тупит», — но чинится в разных местах,
 * поэтому логика вынесена сюда целиком.
 */

/** Шаг, на котором сейчас находится диалог. */
export type DirectMode = "awaiting_country" | "awaiting_proof" | "awaiting_email" | null;

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

/** Тот же номер, но извлечённый из строки ключевых слов или названия товара. */
export function productNumberFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,5})\b/);
  if (!match) return null;
  const normalized = match[1].replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
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
  "да", "да!", "ага", "угу", "хочу", "хочу!", "интересно", "интересует",
  "давайте", "давай", "+", "ок", "окей", "ok", "yes", "нужно", "надо",
]);

export function isAffirmative(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/, "");
  return AFFIRMATIVES.has(normalized) || AFFIRMATIVES.has(`${normalized}!`);
}

export type IncomingKind =
  | { kind: "product_number"; number: string }
  | { kind: "affirmative" }
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
  if (isAffirmative(text)) return { kind: "affirmative" };
  return { kind: "question", text: text.trim() };
}
