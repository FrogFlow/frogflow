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
/** Граница предложения. Без флагов — значит без общего состояния между вызовами. */
const SENTENCE_SPLIT_RE = /(?<=[.!?\u2026])\s+/;

function dropSentences(
  text: string,
  drop: (sentence: string, index: number, parts: string[]) => boolean,
): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(SENTENCE_SPLIT_RE);
    const keptParts = parts.filter((part, i) => !drop(part, i, parts));
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

/**
 * Такая же заглушка вместо присланной картинки.
 *
 * Раньше она несла для модели инструкцию «поблагодарите за фото и уточните,
 * какой товар интересует», и в живом диалоге 22.09 получилось вот что:
 * покупательница из Москвы прислала снимок полотенец с птичками, а в ответ —
 * «Спасибо за фото. К сожалению, я не вижу изображение в чате. Напишите,
 * пожалуйста, текстом…» и список из четырёх пунктов. Человек показал ровно
 * то, что хотел, и получил анкету.
 *
 * Правило продавца тут прямое: «если хотят фото, картинок, пишут сообщение
 * голосом — сразу на менеджера переключать и сообщать об этом». Присланное
 * фото — тот же случай, что голосовое: консультант его не видит, а менеджер
 * видит.
 */
export function isIncomingPhotoPlaceholder(text: string): boolean {
  return /^\[Клиент прислал фото/i.test((text ?? "").trim());
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
const UPSELL_VERB = "(?:возьм[еёи]те|возьм[её]шь|берите|бер[её]те|беру|бер[её]м|брать|взять)";
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
  return (asksForProductPhoto(text) && !hasAnswerableQuestion(text)) || asksToSendWithoutObject(text);
}

/**
 * «Вы можете мне скинуть» — просьба прислать, в которой нечего прислать,
 * кроме изображения.
 *
 * 23.09, живая покупательница посреди разговора о полотенцах PIP. Слова
 * «фото» нет, детектор промолчал, модель поняла правильно — и сама
 * пообещала: «Фотографии товара может прислать менеджер — он свяжется с
 * вами». Задача при этом не завелась, менеджер не узнал.
 *
 * Считаем такой просьбой только глагол «прислать» без дополнения: «скиньте»,
 * «можете мне скинуть», «пришлите пожалуйста». «Пришлите реквизиты» или
 * «скиньте номер карты» сюда не попадают — там есть что прислать.
 */
const SEND_WITHOUT_OBJECT_RE =
  /^(?:а\s+)?(?:вы\s+)?(?:можете|можно|могли\s+бы|не\s+могли\s+бы)?\s*(?:мне\s+)?(?:скин(?:уть|ьте|ешь)|присл(?:ать|ите)|пришлите|пришли|отправ(?:ить|ьте)|покаж(?:ите|и)|показать)(?:\s+(?:мне|пожалуйста|плиз|пжл|их|его|её|ее|сюда|тоже))*[\s?.!…)]*$/i;

export function asksToSendWithoutObject(text: string): boolean {
  return SEND_WITHOUT_OBJECT_RE.test((text ?? "").trim());
}

/**
 * Модель сама пообещала фото от менеджера — значит это передача, и менеджер
 * должен о ней знать. Ловим оба порядка слов: «фото пришлёт менеджер» и
 * «менеджер может прислать фотографии».
 */
const PHOTO_PROMISE_RE =
  /(?:фото|фотограф|снимк|картинк|изображени)[^.?!]{0,50}(?:пришл|присл|присыл|отправ|скин)[^.?!]{0,30}менеджер|менеджер[^.?!]{0,40}(?:пришл|присл|присыл|отправ|скин)[^.?!]{0,30}(?:фото|фотограф|снимк|картинк|изображени)/i;

export function promisesPhotoFromManager(text: string): boolean {
  return PHOTO_PROMISE_RE.test(text ?? "");
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
 *
 * Отдельно ловим дежурную фразу передачи («передам ваш вопрос менеджеру») и
 * обещание пересчёта («сумму подтвердит менеджер»): их модель пишет вместо
 * вызова инструмента чаще всего. А вот «свяжется менеджер» здесь намеренно
 * нет — этими словами закрывается оформление заказа (pack.purchase, oos,
 * нерабочие часы), и задача по нему уже заведена.
 */
const MANAGER_PROMISE_RE =
  /уточн[а-яё]*\s+(?:[а-яё]+\s+){0,3}у\s+менеджера|узна[а-яё]*\s+(?:[а-яё]+\s+){0,3}у\s+менеджера|спрош[а-яё]*\s+(?:[а-яё]+\s+){0,3}у\s+менеджера|верн[уеё][а-яё]*\s+с\s+ответом|свяж[а-яё]+\s+с\s+вами\s+с\s+ответом|провер[юяить][а-яё]*\s+информацию|переда[мдю][а-яё]*\s+(?:[а-яё]+\s+){0,3}менеджеру|(?:подтвердит|уточнит|назов[её]т|рассчитает|посчитает)\s+менеджер|менеджер[а-яё]*\s+(?:[а-яё]+\s+){0,2}(?:подтвердит|уточнит|назов[её]т|рассчитает|посчитает)/i;

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

/**
 * Отговорка про курс рубля.
 *
 * Курс тянется с finkaz.kz по крону раз в пятнадцать минут; когда источник
 * молчит, цену в рублях называть нельзя — назовём позапрошлую. Но покупателю
 * об этом знать неоткуда и незачем: «сейчас курс недоступен» он читает как
 * «магазин не может посчитать», и это последнее, что он слышит перед уходом.
 * Внутреннюю поломку вырезаем, обещание менеджера рядом остаётся — оно и есть
 * ответ.
 */
const RATE_EXCUSE_RE =
  /курс[а-яё]*\s+(?:[а-яё]+\s+){0,2}(?:недоступен|не\s+доступен|отсутствует|неизвестен|не\s+загру[жз])|нет\s+(?:[а-яё]+\s+){0,2}курса|не\s+мог[а-яё]*\s+(?:пересчитать|перевести|посчитать|рассчитать)[^.]{0,40}рубл/i;

export function mentionsRateOutage(sentence: string): boolean {
  return RATE_EXCUSE_RE.test(sentence);
}

export function cleanRateExcuses(text: string): string {
  const cleaned = dropSentences(text, mentionsRateOutage);
  return cleaned.trim() ? cleaned : text;
}

/**
 * «Точную сумму в рублях подтвердит менеджер» рядом с уже названной ценой в
 * рублях.
 *
 * Рубли считает формула по курсу, их знает сам бот. Оговорка ничего не
 * добавляет, а по тексту обещания менеджеру заводится задача: живой случай
 * 24.09, покупатель написал «В рублях», получил обе цены и эту строку, и в
 * списке задач появилась пустая «В рублях». Режем только при названной
 * сумме в рублях: без неё менеджер и правда единственный ответ.
 */
const RUBLE_AMOUNT_RE = /\d[\d\s]*\s?₽/;
const RUBLE_HEDGE_RE =
  /(?=.*менеджер)(?=.*(?:сумм|стоимост|цен|курс|рубл))(?=.*(?:подтверд|уточн|назов|рассчита|посчита|сверит))/i;

export function cleanRubleHedge(text: string): string {
  if (!RUBLE_AMOUNT_RE.test(text)) return text;
  const cleaned = dropSentences(text, (sentence) => RUBLE_HEDGE_RE.test(sentence));
  return cleaned.trim() ? cleaned : text;
}

/** Дежурная фраза передачи — ровно та, которую продиктовал продавец. */
const HANDOFF_SENTENCE_RE = /переда[мю]\s+ваш\s+вопрос\s+менеджеру/i;
const MANAGER_MENTION_RE = /менеджер/i;
const BARE_THANKS_RE = /^спасибо\s*[.!\u2026]*$/i;

/**
 * Две фразы про менеджера в одном ответе.
 *
 * В промпте это два разных правила: «скажите, что сумму подтвердит менеджер»
 * для недоступного курса и «ответьте ровно одной фразой» для вопроса без
 * ответа. Модель в живом диалоге выполнила оба сразу и написала подряд
 * «Точную сумму в рублях подтвердит менеджер» и «Спасибо. Я передам ваш
 * вопрос менеджеру». Покупатель читает это как сбой.
 *
 * Когда в ответе уже сказано, что именно сделает менеджер, дежурная фраза
 * лишняя — она ничего не добавляет. Когда её нет, остаётся она одна.
 */
export function collapseManagerPromises(text: string): string {
  if (!text || !HANDOFF_SENTENCE_RE.test(text)) return text;
  const saysMore = text
    .split("\n")
    .flatMap((line) => line.split(SENTENCE_SPLIT_RE))
    .some((part) => MANAGER_MENTION_RE.test(part) && !HANDOFF_SENTENCE_RE.test(part));
  if (!saysMore) return text;
  const cleaned = dropSentences(
    text,
    (part, i, parts) =>
      HANDOFF_SENTENCE_RE.test(part) ||
      // «Спасибо.» держалось только на этой фразе — уходит вместе с ней.
      (BARE_THANKS_RE.test(part) && HANDOFF_SENTENCE_RE.test(parts[i + 1] ?? "")),
  );
  return cleaned.trim() ? cleaned : text;
}

/**
 * «Извините, я не совсем понял».
 *
 * Живой диалог 22.09: на «Мне голландские с птичками понравились» бот начал с
 * этой фразы — и тут же сам назвал и страну, и бренд: «В нашем каталоге есть
 * голландский бренд PIP». То есть понял он прекрасно, а покупатель прочитал
 * первым делом, что его не понимают. Извинение вырезаем, ответ по существу
 * остаётся.
 */
const NOT_UNDERSTOOD_RE =
  /(?:извините|простите)[^.!?]{0,20}(?:не\s+совсем\s+)?(?:понял|поняла|поняли)|я\s+не\s+совсем\s+пон[ял]|не\s+совсем\s+вас\s+пон/i;

export function apologizesForNotUnderstanding(sentence: string): boolean {
  return NOT_UNDERSTOOD_RE.test(sentence);
}

export function cleanNotUnderstoodApology(text: string): string {
  const cleaned = dropSentences(text, apologizesForNotUnderstanding);
  // Если больше в ответе ничего не было, бот правда не понял — тогда пусть
  // фраза останется, молчание хуже.
  return cleaned.trim() ? cleaned : text;
}

/**
 * Пустая похвала и дежурное «обращайтесь».
 *
 * Продавец 22.09, голосовым и следом текстом: «надо как то совсем просто —
 * вопрос-ответ, без лишних слов и информации». Повод — вот такой ответ на
 * «какие расцветки есть в наличии? какая стоимость»:
 *
 *   …• 35x50 см — 27 000 ₸ • 50x80 см — 52 000 ₸ Это премиальные махровые
 *   полотенца японского бренда Uchino. Изготовлены из натурального хлопка
 *   высокого качества, отличаются мягкостью, впитываемостью и
 *   долговечностью. Соответствуют международным стандартам комфорта и
 *   качества. Какой размер вас интересует…
 *
 * Спросили про цвет и цену — три предложения из четырёх не про это. То же с
 * хвостом «я с удовольствием помогу»: он не несёт ничего и стоит в каждом
 * втором ответе.
 *
 * Режем только предложения без единого факта: ни числа, ни латинского
 * названия марки. «Полотенце Uchino Merveille 50x80 — 52 000 ₸» останется,
 * «соответствуют международным стандартам» — нет.
 */
const EMPTY_PRAISE_RE =
  /соответству[а-яё]*\s+(?:международн|мировым|высоким|строгим)[а-яё]*\s+стандарт|отлича[а-яё]*ся\s+(?:особой\s+|высокой\s+)?(?:мягкость|впитываемость|долговечность|прочность|износостойкость|комфорт)|(?:высочайшег|высоког|превосходног|отличног|безупречног|непревзойд[её]нног)[а-яё]*\s+качества|премиальн[а-яё]*\s+качеств/i;

const EMPTY_HELP_OFFER_RE =
  /(?:с\s+удовольствием|буду\s+рад[а]?|рад[а]?\s+буду|всегда\s+готов[а]?|охотно)\s+(?:вам\s+)?(?:помо(?:гу|чь)|подскаж|отвеч|проконсультир)/i;

/**
 * Болтовня вокруг цены и разговор ни о чём.
 *
 * Продавец 23.09, прочитав живой диалог: «Давайте уберем возможность бота
 * пространно обсуждать и вести праздные беседы с клиентом. Только по сути».
 * В том диалоге бот утешал («я вас понимаю, совсем не обидно»), оправдывал
 * цены («это действительно серьёзная сумма, и не каждому по карману»,
 * «качество там мировое», «в тенге цены звучат внушительно, но это другой
 * масштаб валюты»), рассказывал о себе («я работаю с ценами в рублях для
 * России») и предлагал то, о чём не спрашивали. Ни одно из этих предложений
 * не отвечает на вопрос, а каждое — повод сказать что-нибудь не то.
 *
 * Эти режутся целиком, даже если в них есть число: «55 тысяч рублей за
 * коврик — это действительно серьёзная сумма» — ровно тот случай, где число
 * к тому же было в неверной валюте.
 */
const CHATTER_RE = new RegExp(
  [
    "я\\s+вас\\s+понимаю",
    "совсем\\s+не\\s+обидно",
    "спасибо\\s+за\\s+понимание",
    "^\\s*ха[,.!\\s]",
    "серь[её]зн[а-яё]*\\s+сумм",
    "не\\s+каждому\\s+по\\s+карману",
    "стоят?\\s+действительно\\s+дорого",
    "лучше\\s+не\\s+брать",
    "жалеть\\s+о\\s+потраченн",
    "качество\\s+там\\s+мировое",
    "цены\\s+соответствующие",
    "звучат\\s+внушительно",
    "масштаб\\s+валют",
    "разумн[а-яё]*\\s+(?:цен|диапазон)",
    "я\\s+работаю\\s+с\\s+ценами",
    "(?:может\\s+быть|возможно)[,\\s]+(?:вас\\s+)?интересует\\s+что-?\\s?то",
    "могу\\s+помочь\\s+с\\s+чем-?\\s?то",
    "интересуют\\s+ли\\s+вас\\s+эти",
    "там\\s+цены\\s+(?:совсем\\s+другие|поменьше)",
  ].join("|"),
  "i",
);

export function isChatter(sentence: string): boolean {
  return CHATTER_RE.test(sentence) || INSTRUCTION_ECHO_RE.test(sentence);
}

/**
 * Пересказ служебных пометок покупателю.
 *
 * 23.09, первый ответ живой покупательнице: «Понял. Цены буду называть в
 * тенге, страну не спрашиваю. Если в ответе будут цены, добавлю строку про
 * расчёт в рублях». Это была наша пометка для модели, приклеенная к
 * сообщению покупателя. Пометку оттуда убрали; это вторая линия — на случай,
 * если модель перескажет что-нибудь ещё из подсказок.
 *
 * Голое «Понял.» в начале режется заодно: покупатель ничего не поручал.
 */
const INSTRUCTION_ECHO_RE = new RegExp(
  [
    "страну\\s+не\\s+спрашива",
    "цены\\s+(?:буду\\s+)?называ[а-яё]*\\s+в\\s+тенге",
    "добавлю\\s+строку",
    "по\\s+(?:вашей\\s+|этой\\s+)?инструкци",
    "согласно\\s+инструкци",
    "системн[а-яё]*\\s+(?:промпт|инструкц|сообщени)",
    "справочн[а-яё]*\\s+данн",
    "^\\s*понял[а]?\\s*[.!]?\\s*$",
  ].join("|"),
  "i",
);

/**
 * Реплика без вопроса и без запроса: оценка, эмоция, согласие.
 *
 * По таким репликам бот понимает, что разговор ушёл от покупки. Отдельно от
 * длины разговора: 23.09 ограничение «восемь ответов — и к менеджеру»
 * отрезало покупательницу, которая как раз выбирала — «лицевые и банные,
 * светлые тона, кроме 30/50», — а накануне болтовня «дорого», «фуууув,
 * инфаркт», «55 т — это уже слишком» шла ровно до ошибки в ценах. Считать
 * надо не ходы, а пустые ходы.
 *
 * Вопрос или размер делают реплику содержательной, даже если в ней «дорого».
 */
const EVALUATIVE_RE =
  /дорог|дёшев|дешев|слишком|красив|ужас|инфаркт|обидеть|с\s+ума|фу{2,}|ха-?ха|переплюн|я\s+думал|жаль|жалко|спасибо|хорошо|понятно|ясно|ладно|класс|супер|окей|(?:^|[^а-яё])ок(?:[^а-яё]|$)|(?:^|[^а-яё])угу(?:[^а-яё]|$)|(?:^|[^а-яё])ага(?:[^а-яё]|$)/i;

export function isIdleRemark(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.startsWith("[")) return false;
  if (t.includes("?")) return false;
  if (/\d+\s*(?:[xх×*\/]|на)\s*\d+/i.test(t)) return false;
  if (/^[\p{Extended_Pictographic}\p{P}\s]+$/u.test(t)) return true;
  return EVALUATIVE_RE.test(t);
}

/**
 * «Понял.» в начале ответа.
 *
 * Продавец 23.09: «И „понял“ говорит постоянно». Покупатель ничего не
 * поручал — квитанция о получении ему не нужна, нужен ответ. Снимаем
 * подтверждение в самом начале в любом виде — «Понял.», «Понял, …»,
 * «Понимаю.», «Хорошо,» — и поднимаем первую букву того, что осталось.
 * Если, кроме подтверждения, ничего нет, текст не трогаем.
 */
const LEADING_ACK_RE =
  /^\s*(?:понял[а]?|поняли|понимаю|понятно|хорошо|ясно|отлично|конечно|принято)(?:\s*[,.!…:—–-])+\s*/i;

export function stripLeadingAcknowledgement(text: string): string {
  if (!text) return text;
  let out = text;
  // «Понял. Понимаю, …» — снимаем подряд, но не больше двух раз.
  for (let i = 0; i < 2; i++) {
    const next = out.replace(LEADING_ACK_RE, "");
    if (next === out || !next.trim()) break;
    out = next;
  }
  return out === text ? text : out.charAt(0).toUpperCase() + out.slice(1);
}

/** Есть ли в предложении хоть один факт: число или марка латиницей. */
function carriesFact(sentence: string): boolean {
  return /\d/.test(sentence) || /[A-Za-z]{3,}/.test(sentence);
}

export function isEmptyPraise(sentence: string): boolean {
  if (EMPTY_HELP_OFFER_RE.test(sentence)) return true;
  if (CHATTER_RE.test(sentence) || INSTRUCTION_ECHO_RE.test(sentence)) return true;
  if (!EMPTY_PRAISE_RE.test(sentence)) return false;
  return !carriesFact(sentence);
}

export function cleanEmptyPraise(text: string): string {
  const cleaned = dropSentences(text, isEmptyPraise);
  return cleaned.trim() ? cleaned : text;
}

/**
 * Цена в тенге, подписанная рублями.
 *
 * Живой диалог 22.09, покупательница из России спросила про пледы. Ответ:
 * «цены от 140 000 до 320 000 ₽». Это точные цены пледов Eagle в прайсе —
 * в тенге. В рублях это 33 116 и 75 695. Правило в промпте про это есть
 * давно («никогда не подставляйте тенговое число с символом рубля»), и оно
 * не сработало, а проверка цен в ответе только пишет предупреждение в лог.
 *
 * Здесь не угадываем, а сверяем: число со знаком рубля, которое точно
 * совпадает с ценой в тенге из прайса и при этом не является ничьей ценой в
 * рублях, — перепутанная валюта, и его можно пересчитать без догадок.
 * Совпадение с рублёвой ценой любой позиции оставляет число как есть: такое
 * «12 300 ₽» законно, даже если где-то в прайсе есть товар за 12 300 ₸.
 */
const MONEY_NUM = "(\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d{4,})";
const RUB_SIGN = "(?:₽|руб(?:\\.|лей|ля|ль)?)";
const RUB_RANGE_RE = new RegExp(
  `(от\\s+)?${MONEY_NUM}(\\s*(?:до|–|—|-)\\s*)${MONEY_NUM}(\\s*)${RUB_SIGN}`,
  "gi",
);
const RUB_SINGLE_RE = new RegExp(`${MONEY_NUM}(\\s*)(${RUB_SIGN})`, "gi");

const moneyValue = (raw: string): number => Number(raw.replace(/\D/g, ""));

export function fixRubleMislabels(
  text: string,
  kztPrices: number[],
  toRub: (kzt: number) => number,
): string {
  if (!text || kztPrices.length === 0) return text;
  const kzt = new Set(kztPrices.filter((p) => p > 0));
  const rub = new Set([...kzt].map(toRub).filter((p) => p > 0));
  const convert = (raw: string): string => {
    const n = moneyValue(raw);
    if (!kzt.has(n) || rub.has(n)) return raw;
    return toRub(n).toLocaleString("ru-RU");
  };
  return text
    .replace(
      RUB_RANGE_RE,
      (_m, from: string | undefined, a: string, mid: string, b: string, gap: string) => {
        const sign = _m.slice(_m.search(new RegExp(`${RUB_SIGN}$`, "i")));
        return `${from ?? ""}${convert(a)}${mid}${convert(b)}${gap}${sign}`;
      },
    )
    .replace(RUB_SINGLE_RE, (_m, n: string, gap: string, sign: string) => `${convert(n)}${gap}${sign}`);
}

/**
 * Ответ модели плюс строка о передаче менеджеру.
 *
 * Живой тест 23.09: «Риволта это бренд какой страны? И расскажите о
 * качестве». Страна есть в списке марок продавца (rivolta — италия), а про
 * технологии производства модель решила спросить менеджера. Ветка передачи
 * выбросила всё, что модель написала, и отправила одну дежурную фразу — на
 * вопрос «какой страны» покупатель не получил ничего, хотя ответ был.
 *
 * Правило продавца для этого случая уже есть (правка №4): можно ответить на
 * то, что известно, и сказать, что остальное пришлёт менеджер. Поэтому текст
 * модели сохраняется, а дежурная фраза добавляется, только если модель сама
 * не пообещала менеджера. Пустой ответ — одна дежурная фраза, как раньше.
 */
export function withManagerHandoff(own: string, handoffLine: string): string {
  const text = (own ?? "").trim();
  if (!text) return handoffLine;
  if (HANDOFF_SENTENCE_RE.test(text) || promisesManagerFollowUp(text)) return text;
  return `${text}\n\n${handoffLine}`;
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
