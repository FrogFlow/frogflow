import { containsForbiddenPhrase } from "./intent";
import type { ConsultantProduct } from "./catalog";
import { foldText } from "./synonyms";

const PRICE_TOKEN_RE = /\d[\d\s]{2,}/g;

const SHIPPING_QUOTE_RE =
  /стоимост[ьи]\s+доставк\w*\s*[:—\-–]?\s*\d|доставк\w{0,8}\s*[:—\-–]?\s*\d|доставка\s+(?:стоит|обойд|составит|будет\s+\d)/i;

const COLOR_STEMS = [
  "бел",
  "сер",
  "черн",
  "чёрн",
  "бежев",
  "син",
  "голуб",
  "розов",
  "красн",
  "зелен",
  "зелён",
  "коричнев",
  "желт",
  "жёлт",
  "оранж",
  "фиолет",
  "золот",
  "серебрян",
  "молочн",
  "кремов",
  "хаки",
  "бордо",
  "графит",
  "песочн",
  "мятн",
  "пудров",
  "лаванд",
] as const;

const COLOR_CLAIM_RE = /в наличии|есть в|доступен|можем предложить|есть цвет|цвет/i;

function hasColorStem(text: string, stem: string): boolean {
  return new RegExp(`(^|[^a-zа-яё])${stem}[а-яё]*`, "i").test(text);
}

export function collectKnownFacts(
  products: ConsultantProduct[],
  extraNumbers: number[] = [],
): Set<string> {
  const facts = new Set<string>();
  for (const n of extraNumbers) {
    facts.add(String(n));
    facts.add(n.toLocaleString("ru-RU"));
  }
  const prices: number[] = [];
  for (const p of products) {
    facts.add(String(p.price_kzt));
    facts.add(p.price_kzt.toLocaleString("ru-RU"));
    prices.push(p.price_kzt);
    if (p.stock_qty != null) facts.add(String(p.stock_qty));
    facts.add(p.size);
    for (const c of p.colors) facts.add(c.toLowerCase());
    facts.add(p.name.toLowerCase());
    facts.add(foldText(p.name));
  }
  // Allow pairwise and 3-item sums for basket sets / kits
  for (let i = 0; i < prices.length; i++) {
    for (let j = i; j < prices.length; j++) {
      const sum2 = prices[i] + prices[j];
      facts.add(String(sum2));
      facts.add(sum2.toLocaleString("ru-RU"));
      for (let k = j; k < prices.length && k < i + 4; k++) {
        const sum3 = sum2 + prices[k];
        facts.add(String(sum3));
        facts.add(sum3.toLocaleString("ru-RU"));
      }
    }
  }
  return facts;
}

export function replyUsesUnknownPrice(text: string, known: Set<string>): boolean {
  // Strip phone numbers like +7 701 123 45 67, 8 (701) 123-45-67, etc.
  const withoutPhones = text.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}/g, " ");
  // Strip 4-digit years like 2024, 2025, 2026
  const withoutYears = withoutPhones.replace(/\b202[0-9]\b/g, " ");
  const tokens = withoutYears.match(PRICE_TOKEN_RE) ?? [];
  for (const raw of tokens) {
    const compact = raw.replace(/\s/g, "");
    const n = Number(compact);
    if (!Number.isFinite(n)) continue;
    if (n < 1000) continue;
    if (known.has(compact) || known.has(raw.trim()) || known.has(n.toLocaleString("ru-RU"))) {
      continue;
    }
    return true;
  }
  return false;
}

export function replyQuotesShippingCost(text: string): boolean {
  if (/по\s+тарифам|тарифам\s+сдэк|оплачивается\s+при\s+получении|рассчитывается\s+курьер/i.test(text)) {
    return false;
  }
  return SHIPPING_QUOTE_RE.test(text);
}

export function replyUsesUnknownColor(text: string, known: Set<string>): boolean {
  if (!COLOR_CLAIM_RE.test(text)) return false;
  const lower = text.toLowerCase();
  const knownJoined = [...known].join(" ").toLowerCase();
  for (const stem of COLOR_STEMS) {
    if (!hasColorStem(lower, stem)) continue;
    if (hasColorStem(knownJoined, stem)) continue;
    // Check if the color is actually being negated or marked as unavailable (e.g. "бежевого цвета нет", "закончился")
    const negatedColorRe = new RegExp(
      `(?:нет|закончил|не\\s+осталось|не\\s+(?:доступен|в\\s+наличии|представлен)|кроме)[^.!?\\n]*?${stem}`,
      "i",
    );
    const colorAfterNegatedRe = new RegExp(
      `${stem}[а-яё]*\\s+[^.!?\\n]*?(?:нет|закончил|не\\s+(?:доступен|в\\s+наличии))`,
      "i",
    );
    if (negatedColorRe.test(lower) || colorAfterNegatedRe.test(lower)) {
      continue;
    }
    return true;
  }
  return false;
}

export function cleanScriptHallucinations(text: string): string {
  if (!text) return "";
  const scriptIdx = text.search(/(?:^|\n)\s*(?:customer|client|user|клиент|покупатель|пользователь|assistant|ассистент)\s*:/i);
  if (scriptIdx !== -1) {
    return text.slice(0, scriptIdx).trim();
  }
  return text;
}

export function cleanForbiddenPhrases(text: string): string {
  let res = text;
  const clichés = [
    "прекрасный выбор",
    "отличный выбор",
    "замечательный выбор",
    "будем рады помочь",
    "буду рад помочь",
    "передаю ваш диалог менеджеру",
    "передаю менеджеру",
  ];
  for (const phrase of clichés) {
    const re = new RegExp(`(^|[.!?]\\s*)${phrase}[.!?…]*\\s*`, "gi");
    res = res.replace(re, "$1");
  }
  res = res.replace(/^(?:отлично|прекрасно|замечательно)[!.,\s]*/i, "");
  res = res.trim();
  if (res.length > 0) {
    res = res.charAt(0).toUpperCase() + res.slice(1);
  }
  return res;
}

/**
 * Матрасы средней жёсткости сняты с производства — продавец просил не
 * упоминать их вовсе. Из каталога они вычищены (catalog.ts,
 * isDiscontinuedProduct), но те же линейки описаны в PDF базы знаний, а она
 * целиком уходит в промпт: модель может назвать MEDIUM, ничего не искав.
 * Поэтому запрет не только правилом в промпте, но и механически — здесь.
 *
 * Вырезается предложение, где матрас предлагается в средней жёсткости.
 * Честный отказ («матрасов средней жёсткости сейчас нет») остаётся: это
 * ровно то, что нужно ответить, когда клиент спросил про неё сам.
 */
const MATTRESS_WORD_RE = /(?<![а-яё])матрас|mattress/i;

/**
 * Линейки матрасов из ассортимента магазина. Слово «матрас» модель в
 * предложении часто опускает — пишет «Могу предложить TRESOR R2 MEDIUM», и
 * проверка только по слову «матрас» такую фразу пропускала. Топперы
 * (MOUSSE, GREEM, RE:ACTIVE) и наматрасники Traumina в список не входят
 * намеренно: их средняя жёсткость с производства не снята.
 */
const MATTRESS_LINE_RE =
  /(?<![a-zа-яё])(?:former|levant|tresor|sfera|epic|frankenstolz)(?![a-zа-яё])/i;

function mentionsMattress(sentence: string): boolean {
  return MATTRESS_WORD_RE.test(sentence) || MATTRESS_LINE_RE.test(sentence);
}

// \w в JavaScript — только латиница: «средн\w*» на слове «средней» не
// срабатывает. Поэтому окончания перечислены кириллическим классом.
const MEDIUM_HARDNESS_RE =
  /(?<![a-zа-яё])medium(?![a-zа-яё])|средн[а-яё]*\s+(?:по\s+)?(?:жёстк|жестк)[а-яё]*|(?:жёстк|жестк)[а-яё]*\s+средн[а-яё]*/i;

const HARDNESS_DENIAL_RE =
  /(?<![а-яё])нет(?![а-яё])|не\s+прода|сн[ня]т[а-яё]*\s+с\s+производств|не\s+выпуска|закончил|не\s+остал|больше\s+не|отсутству/i;

export function offersDiscontinuedMattress(sentence: string): boolean {
  if (!mentionsMattress(sentence)) return false;
  if (!MEDIUM_HARDNESS_RE.test(sentence)) return false;
  return !HARDNESS_DENIAL_RE.test(sentence);
}

/** Ответ на случай, когда от текста после вырезания ничего не осталось. */
export const DISCONTINUED_MEDIUM_MATTRESS_REPLY =
  "Матрасов средней жёсткости сейчас нет — эту линейку сняли с производства. Есть комфортные (Soft) и упругие (Firm), показать варианты?";

/** Убирает из текста предложения, на которые сработало условие. */
function dropSentences(text: string, drop: (sentence: string) => boolean): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(/(?<=[.!?…])\s+/);
    const keptParts = parts.filter((part) => !drop(part));
    const joined = keptParts.join(" ").trim();
    // Строка ушла целиком — убираем её вместе с переводом строки, чтобы в
    // ответе не осталось дырки из пустых абзацев.
    if (keptParts.length !== parts.length && !joined) continue;
    kept.push(joined);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function cleanDiscontinuedMattressOffers(text: string): string {
  return dropSentences(text, offersDiscontinuedMattress);
}

/**
 * Просьба прислать фото товара.
 *
 * Фотографий у консультанта нет вовсе: в каталоге только название, размер,
 * цвет, состав и цена. Поэтому на «можете отправить фото» бот честно отвечал,
 * что не может, и звал в бутик — а покупатель из Алматы спрашивал про размер
 * полотенца 34х40 и в бутик ехать не собирался. Продавец попросил: просят
 * фото — пусть менеджер получит сообщение.
 *
 * Считается просьбой только связка «слово про изображение» плюс просьба:
 * «спасибо за фото» и «на фото у вас были синие» просьбой не являются.
 * Системные строки в квадратных скобках, которыми мы сами описываем вложение
 * покупателя, исключены: «[Клиент прислал фото/картинку без текста]» — это
 * присланное фото, а не просьба прислать.
 */
const PHOTO_WORD_RE = /фото|фотк|фотограф|картинк|изображени|снимок|снимки|видео/i;
const PHOTO_REQUEST_RE =
  /отправ|пришл|присыл|скин|сброс|покаж|скинь|можете|можно|есть\s+ли|дайте|поделит/i;

/**
 * Наша же строка-заглушка вместо голосового: Zernio присылает вложение без
 * текста, и мы подставляем описание для модели. Узнаём её, чтобы передать
 * диалог менеджеру, а не просить написать текстом.
 */
export function isVoiceMessagePlaceholder(text: string): boolean {
  return /^\[Клиент отправил голосовое/i.test((text ?? "").trim());
}

export function asksForProductPhoto(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.startsWith("[")) return false;
  if (!PHOTO_WORD_RE.test(t)) return false;
  /**
   * Глагола просьбы может не быть вовсе. Живое «какие есть коврики в ванную
   * фото, размеры и цены, пожалуйста» — это перечисление того, что хотят
   * получить, и фото стоит там наравне с размерами; прежнее правило такую
   * фразу просьбой не считало и менеджер отвечал руками.
   *
   * Поэтому просьбой считается слово про изображение либо с глаголом, либо в
   * вопросе — своём («Есть фото в интерьере?») или товарном («…фото, размеры
   * и цены»). «Спасибо за фото» и «на фото у вас были синие» не подходят ни
   * под одно из трёх.
   */
  return PHOTO_REQUEST_RE.test(t) || hasAnswerableQuestion(t) || t.includes("?");
}

/**
 * Дожим покупателя.
 *
 * Живой ответ: «Какой размер вас больше интересует, или возьмёте оба?» —
 * продавец обвёл это красным: «вот так тут давить на клиента нельзя, прямо
 * ему запретите». Человек спросил про один товар, а ему предлагают купить два.
 *
 * Чистится не предложение целиком, а только навязчивый хвост: вопрос «какой
 * размер вас интересует» сам по себе нормальный и нужный, уйти должно лишь
 * «или возьмёте оба». Если же дожим составляет всё предложение целиком —
 * «Рекомендую взять оба размера» — оно убирается полностью.
 */
const UPSELL_VERB = "(?:возьм[еёи]те|возьм[её]шь|берите|бер[её]те|брать|взять)";
const UPSELL_OBJECT = "(?:оба|обе|два|две|сразу|комплект(?:ом)?|все)";

/** Навязчивый хвост, приклеенный к нормальному вопросу через запятую или тире. */
const UPSELL_TAIL_RE = new RegExp(
  `\\s*[,;—–-]\\s*(?:а\\s+)?(?:или|может(?:\\s+быть)?|почему\\s+бы\\s+не)?\\s*${UPSELL_VERB}\\s+${UPSELL_OBJECT}[^.?!]*`,
  "gi",
);

/** Предложение, которое целиком состоит из уговора купить больше. */
const UPSELL_SENTENCE_RE = new RegExp(
  `^(?:а\\s+)?(?:может(?:\\s+быть)?|почему\\s+бы\\s+не|рекоменду[юе][а-яё]*|совету[юе][а-яё]*|предлага[юе][а-яё]*|не\\s+хотите)?\\s*${UPSELL_VERB}\\s+${UPSELL_OBJECT}`,
  "i",
);

export function pushesToBuyMore(sentence: string): boolean {
  return UPSELL_SENTENCE_RE.test(sentence.trim());
}

export function cleanUpsellPressure(text: string): string {
  if (!text) return "";
  // Сначала хвосты: «…интересует, или возьмёте оба?» → «…интересует?».
  // Знак вопроса или точку возвращаем на место, иначе фраза оборвётся.
  const withoutTails = text.replace(
    new RegExp(`(${UPSELL_TAIL_RE.source})([.?!]*)`, "gi"),
    (_m, _tail, punctuation: string) => punctuation || "",
  );
  const cleaned = dropSentences(withoutTails, pushesToBuyMore);
  // Если от ответа ничего не осталось, дожим был всем ответом — тогда лучше
  // исходный текст, чем пустое сообщение.
  return cleaned.trim() ? cleaned : text;
}

/**
 * Есть ли в сообщении вопрос, на который бот может ответить сам.
 *
 * Нужно, чтобы отличить «пришлите фото» от «какие есть коврики в ванную —
 * фото, размеры и цены». Продавец про второй случай: «здесь конкретный вопрос
 * с фотографией — можно написать ответ по размерам и цене и сказать, что фото
 * пришлёт менеджер». Молча передавать такое человеку значит терять ответ,
 * который у бота есть.
 */
const ANSWERABLE_RE =
  /цен[аыу]?|цены|стоимост|сколько\s+стоит|поч[её]м|размер|габарит|наличи|в\s+нали|ассортимент|каталог|как(?:ие|ой|ая)\s+есть|что\s+есть|расцветк|цвет|состав|плотност|материал/i;

export function hasAnswerableQuestion(text: string): boolean {
  return ANSWERABLE_RE.test((text ?? "").trim());
}

/**
 * Просьба о фото и больше ничего. Только такую передаём человеку молча —
 * отвечать на неё боту нечем.
 */
export function asksForPhotoOnly(text: string): boolean {
  return asksForProductPhoto(text) && !hasAnswerableQuestion(text);
}

/**
 * Обещание вернуться с ответом от менеджера.
 *
 * У бота есть инструмент ask_manager: он кладёт вопрос в список задач панели.
 * Но вызвать его или просто написать «уточню у менеджера» — выбор модели, и на
 * живом диалоге она выбрала второе: сказала «Уточню этот момент у менеджера и
 * вернусь с ответом», потом «проверю информацию о плотности полотенец Uchino и
 * свяжусь с вами с ответом» — и не вызвала ничего. В списке задач за этот час
 * не появилось ни строки, менеджер не узнал, покупатель ждёт до сих пор.
 *
 * Поэтому обещание ловится по тексту ответа: сказал — значит зафиксировали,
 * независимо от того, догадалась модель вызвать инструмент или нет.
 */
const MANAGER_PROMISE_RE =
  /уточн[а-яё]*\s+(?:[а-яё]+\s+){0,3}у\s+менеджера|узна[а-яё]*\s+(?:[а-яё]+\s+){0,3}у\s+менеджера|спрош[а-яё]*\s+(?:[а-яё]+\s+){0,3}у\s+менеджера|верн[уеё][а-яё]*\s+с\s+ответом|свяж[а-яё]+\s+с\s+вами\s+с\s+ответом|провер[юяить][а-яё]*\s+информацию/i;

export function promisesManagerFollowUp(text: string): boolean {
  return MANAGER_PROMISE_RE.test(text);
}

/**
 * Упоминание демонстрационного образца.
 *
 * Пометку снимают с каталога на загрузке (catalog.ts), и модель её уже не
 * видит. Это вторая линия: пометка может приехать из базы знаний, из прайса 1С
 * или из пересказа прошлой реплики в той же переписке. Продавец попросил прямо:
 * покупателю про демонстрационный образец не говорим.
 *
 * Вырезается предложение целиком, остальной ответ — название, цена, размер —
 * остаётся: «У нас есть матрас EPIC R3 COMFORT 182x202 — 2 700 000 ₸. Это
 * демонстрационная модель в нашем салоне.» теряет только второе предложение.
 */
const DEMO_MENTION_RE = /демонст[а-яё]*/i;

export function mentionsDemoSample(sentence: string): boolean {
  return DEMO_MENTION_RE.test(sentence);
}

export function cleanDemoMentions(text: string): string {
  const cleaned = dropSentences(text, mentionsDemoSample);
  // Если пометка была всем ответом, пустое сообщение хуже исходного.
  return cleaned.trim() ? cleaned : text;
}

/**
 * Отговорка про каталог.
 *
 * Продавец о живом ответе: «спросил про это конкретное полотенце — про
 * качество самой компании сказал хорошо, по тому файлу, а тут нельзя так
 * говорить: не знаю, спросите у менеджера. Сколько есть инфо, пусть даст».
 * Покупателю не объясняют устройство нашей базы — ему отвечают тем, что
 * известно. Предложение с такой отговоркой вырезается, остальной ответ (имя
 * коллекции, цвет, цена, слова о марке из базы знаний) остаётся.
 */
const CATALOG_EXCUSE_RE =
  /в (?:нашем\s+)?каталоге\s+(?:не\s+(?:указан|прописан|содержится|представлен)|нет\s+(?:детальн|подробн|информац)|отсутству)|(?:детальн|подробн)[а-яё]*\s+характеристик[а-яё]*[^.]{0,40}не\s+указан|у\s+меня\s+нет\s+(?:детальн[а-яё]*\s+)?информации\s+о\s+(?:состав|материал)/i;

export function isCatalogExcuse(sentence: string): boolean {
  return CATALOG_EXCUSE_RE.test(sentence);
}

export function cleanCatalogExcuses(text: string): string {
  const cleaned = dropSentences(text, isCatalogExcuse);
  // Если от ответа ничего не осталось, отговорка была всем ответом — тогда
  // лучше исходный текст, чем пустое сообщение.
  return cleaned.trim() ? cleaned : text;
}

export function replyUsesUnknownProductName(_text: string, _products: ConsultantProduct[]): boolean {
  return false;
}

export function replyInventedInStock(text: string, products: ConsultantProduct[]): boolean {
  const stripped = text.replace(/(?:нет|не)\s+в\s+наличии/gi, "");
  if (!/есть в наличии|в наличии/i.test(stripped)) return false;
  if (products.length === 0) return true;
  return products.every((p) => !p.stock);
}

export function validateConsultantReply(
  text: string,
  knownProducts: ConsultantProduct[],
  extraNumbers: number[] = [],
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 1200) return { ok: false, reason: "too_long" };
  if (replyQuotesShippingCost(trimmed)) return { ok: false, reason: "shipping_quote" };
  const known = collectKnownFacts(knownProducts, extraNumbers);
  if (replyUsesUnknownPrice(trimmed, known)) return { ok: false, reason: "unknown_price" };
  if (replyUsesUnknownColor(trimmed, known)) return { ok: false, reason: "unknown_color" };
  if (replyInventedInStock(trimmed, knownProducts)) return { ok: false, reason: "unknown_stock" };
  if (/(?:^|\n)\s*(?:customer|client|user|клиент|покупатель|пользователь|assistant|ассистент)\s*:/i.test(trimmed)) {
    return { ok: false, reason: "script_hallucination" };
  }
  return { ok: true };
}
