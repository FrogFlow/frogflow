export type ConsultantCountry = "KZ" | "RU";

/**
 * Страна для ответа на сторис и рилс, пока покупатель не сказал иного.
 *
 * Выбор страны остаётся обычным первым шагом в Direct. Но человек, ответивший
 * на сторис словами «сколько стоит», спрашивает про конкретную вещь, которую
 * только что увидел, — и получать в ответ анкету вместо цены он не должен:
 * на этом разговор затухал. Продавец: пусть называет цену в тенге, а если
 * человек из России, он попросит в рублях, и тогда переведём.
 *
 * Магазин в Алматы и прайс в тенге — отсюда KZ. Слова «Россия», «в рублях» и
 * российские города переключают страну в любой момент разговора: matchCountry
 * смотрит текущее сообщение раньше сохранённого состояния.
 */
export const STORY_REPLY_COUNTRY: ConsultantCountry = "KZ";

/** `\b` в JS не граница для кириллицы — без него «Казахстан» не матчится. */
const PURCHASE_RE =
  /оформляем|оформить|оформление|беру|возьму|покупаю|оплатить|оплата|куда\s+платить|давайте\s+оформ|менеджер|свяжите|хочу\s+заказать/i;

const KZ_RE =
  /казахстан|қазақстан|(^|[^a-zа-яё])kz([^a-zа-яё]|$)|🇰🇿|алматы|астана|шымкент|караганда|актобе|павлодар|атау|уральск|костанай/i;
const RU_RE =
  /росси[яиию]|рф|russia|(^|[^a-zа-яё])ru([^a-zа-яё]|$)|🇷🇺|москва|питер|спб|дагестан|хасавюрт|махачкала|казань|екатеринбург|новосибирск|краснодар|сочи|ростов|самара|уфа|пермь|воронеж|челябинск|омск|татарстан|башкортостан/i;

export function matchPurchaseIntent(text: string): boolean {
  const t = text.trim();
  if (/посовет|что\s+(взять|выбрать|купить)|бюджет|только\s+\d/i.test(t)) {
    if (!/оформ|оплат|менеджер|свяжите|куда\s+платить/i.test(t)) return false;
  }
  /** Живой Direct: «как заказать?» → страна, не сразу касса. */
  if (/как\s+(заказать|оформить|купить)/i.test(t)) {
    if (!/оплат|куда\s+платить|менеджер|свяжите/i.test(t)) return false;
  }
  if (PURCHASE_RE.test(t)) return true;
  if (/^давайте[.!?…]*$/i.test(t)) return true;
  return /давайте\s+(оформ|заказ|куп|плат)/i.test(t);
}

/**
 * Покупатель назвал страну, в которую мы не возим.
 *
 * Живой диалог 22.09: «Делаете доставку в Израиль?» → бот спросил страну →
 * «Израиль» → бот спросил ровно то же самое второй раз. Продавец: «почему то
 * два раза тут спросил про страну, хотя потом видно, что понял».
 *
 * Узкое место — это ответ на наш закрытый вопрос, а не рассуждение о товаре.
 * Поэтому условий три: спрашивали страну прямо сейчас, ответ короткий (три
 * слова максимум) и в нём стоит название страны существительным. Иначе сюда
 * попало бы «мне голландские с птичками понравились»: в каталоге половина
 * марок европейские, и покупатели зовут их по стране постоянно.
 */
const OTHER_COUNTRY_RE =
  /(?:^|[^а-яё])(израил|герман|сша|америк|турци|узбекистан|кыргыз|киргиз|украин|беларус|белорус|оаэ|эмират|дубай|грузи|армени|азербайджан|польш|великобритан|англи|франци|итали|испани|кита|коре|япони|канад|австрали|нидерланд|голланди|чехи|литв|латви|эстони|молдов|таджикистан|туркмени|монголи|швейцари|португали|финлянди|швеци|норвеги|дани|австри|бельги|греци|серби|хорвати|болгари|румыни|венгри|словаки|словени)[а-яё]*/i;

export function matchUnsupportedCountry(text: string): boolean {
  const t = (text ?? "").replace(/[^\p{L}\s]/gu, " ").trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 3) return false;
  if (KZ_RE.test(t) || RU_RE.test(t)) return false;
  return OTHER_COUNTRY_RE.test(t);
}

export function matchCountry(text: string): ConsultantCountry | null {
  const t = text.trim();
  if (/^(?:1|1\.|1\)|1\s*[-—–]\s*к[а-я]*)$/i.test(t)) return "KZ";
  if (/^(?:2|2\.|2\)|2\s*[-—–]\s*р[а-я]*)$/i.test(t)) return "RU";
  const kz = KZ_RE.test(t);
  const ru = RU_RE.test(t);
  if (kz && !ru) return "KZ";
  if (ru && !kz) return "RU";
  return null;
}

export const FORBIDDEN_PHRASES = [
  "отлично",
  "прекрасный выбор",
  "прекрасный",
  "замечательно",
  "будем рады помочь",
  "передаю ваш диалог менеджеру",
  "передаю менеджеру",
  "наверное",
  "примерно",
  "скорее всего",
  "думаю есть",
  "бесплатн",
  "скидк",
] as const;

export function containsForbiddenPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.some((p) => lower.includes(p));
}

const GREETING_RE =
  /^(привет|здравствуйте|добрый\s+(день|вечер)|hi|hello|хай|сәлеметсіз\s*бе|сәлем|ассалаумағалейкум|ассаламу\s*алейкум)([.!?…\s]|👋|🙏)*$/i;

export function isConsultantGreeting(text: string): boolean {
  return GREETING_RE.test(text.trim());
}

const RESET_RE =
  /^(?:\/reset|\/start|reset|restart|старт|start|заново|сброс|сбрось|сбросить|очистить|очисти|забудь(?:те)?(?:\s+меня)?|(?:давай(?:те)?|хочу)?\s*(?:нач(?:ни|ать)\s+)?(?:заново|сначала)|(?:сбрось|сбросить|очисти|очистить)\s+(?:диалог|историю|контекст|память))(?:[.!?…\s]|$)/i;

/** Явный сброс диалога клиентом или оператором для повторного тестирования. */
export function isResetIntent(text: string): boolean {
  return RESET_RE.test(text.trim());
}

/** Свободные «чем помочь / мы продаём» — не запрос в прайс и не реплика клиента. */
export function looksLikeVagueHelp(text: string): boolean {
  return /чем\s+(я\s+)?могу\s+помочь|напишите[,\s]+что\s+вас\s+интересует|жду\s+вашего|я\s+здесь[,\s]+чтобы|мы\s+прода[её]м|что\s+вас\s+интересует|я\s+жду\s+вашего/i.test(
    text,
  );
}

const AFFIRMATIVE_RE =
  /^(да|интересует|да\s+интересует|меня\s+интересует|очень\s+интересует|конечно|конечно\s+интересует|давайте|да\s+давайте|ага|хочу|да\s+хочу|покажите|да\s+покажите|расскажите|да\s+расскажите|интересно|что\s+ещ[её]\s+есть|что\s+у\s+вас\s+есть)$/i;

/** Утвердительный ответ на кросс-сейл или общий интерес («Интересует», «Да», «Конечно»). */
export function isAffirmativeInterest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?…,:;()]/g, "").trim();
  return AFFIRMATIVE_RE.test(t);
}

const DECLINE_RE =
  /^(нет|нет\s+спасибо|не\s+нужно|не\s+надо|пока\s+нет|пока\s+вс[её]|ничего|больше\s+ничего|спасибо\s+пока\s+вс[её]|нет\s+не\s+надо|нет\s+не\s+нужно|нет\s+ничего)$/i;

/** Вежливый отказ от дальнейших предложений («Нет», «Нет, спасибо», «Пока всё»). */
export function isDeclineResponse(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?…,:;()]/g, "").trim();
  return DECLINE_RE.test(t);
}

/**
 * После страны почти любой осмысленный текст — про товар.
 * «я из России» / «привет» / «интересует» не считаем запросом в прайс.
 */
export function looksLikeProductQuery(text: string): boolean {
  const t = text.trim();
  if (!t || GREETING_RE.test(t)) return false;
  if (looksLikeVagueHelp(t)) return false;
  if (matchPurchaseIntent(t)) return false;
  if (isAffirmativeInterest(t)) return false;
  if (isDeclineResponse(t)) return false;
  const country = matchCountry(t);
  if (country) {
    const leftover = t
      .replace(KZ_RE, " ")
      .replace(RU_RE, " ")
      .replace(/я\s+из|из|страна|мы\s+из|город[еау]?|пос[её]лк\w*|прожива\w*/gi, " ")
      .replace(/[.!?…,]/g, " ")
      .trim();
    const words = leftover.match(/[a-zа-яё0-9]{2,}/gi) ?? [];
    if (words.length === 0) return false;
  }
  const leftoverHow = t
    .replace(/^(привет|здравствуйте|добрый\s+(день|вечер)|hi|hello|хай)([.!?…\s,]|👋|🙏)*/i, " ")
    .replace(/как\s+(заказать|оформить|купить)\??/gi, " ")
    .replace(/[.!?…,]/g, " ")
    .trim();
  const wordsHow = leftoverHow.match(/[a-zа-яё0-9]{2,}/gi) ?? [];
  if (wordsHow.length === 0) return false;
  return true;
}

export function matchCatalogIntent(text: string): boolean {
  return /полн(ый|ым)\s+каталог|весь\s+ассортимент|сайт|bovi\.kz|ссылк\w*\s+на\s+(сайт|каталог)/i.test(
    text,
  );
}

export function matchOtherCategoriesIntent(text: string): boolean {
  return /друг(ие|ие категории|ое)|что ещё|что еще|какие категори|ассортимент(?!\s+полный)/i.test(
    text,
  );
}

/** «Что посоветуете для дома?» — показать категории, не «нет в наличии». */
export function matchAdviceIntent(text: string): boolean {
  return /посовет|порекоменд|что\s+(взять|выбрать|подобрать|можете|купить)|для\s+дома|что\s+есть\b|какие\s+(товар|категор)|покажите\s+(что|ассортимент)|бюджет|только\s+\d|предложи/i.test(
    text,
  );
}

/** «А ещё варианты?» — другие карточки той же категории, не повтор. */
export function matchMoreVariantsIntent(text: string): boolean {
  return /ещё\s+вариант|еще\s+вариант|другие\s+вариант|другой\s+(цвет|размер)|другие\s+(цвет|размер|есть)|а\s+ещё\s*\??$|ещё\s+есть\??$/i.test(
    text.trim(),
  );
}

/** «Соберите корзину / набор на N» — не товар «комплект белья» / «набор полотенец». */
export function matchBasketIntent(text: string): boolean {
  if (/корзин/i.test(text)) return true;
  if (/(собери|соберите).{0,32}(набор|комплект)/i.test(text)) return true;
  if (/(набор|комплект).{0,24}(на\s+\d|бюджет|до\s+\d)/i.test(text)) return true;
  return false;
}

/**
 * Бюджет из живой фразы: «только 15000», «корзину на 20 000».
 * Размер 50×70 и мелкие числа не считаем деньгами.
 */
export function extractBudgetKzt(text: string): number | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (!/(только|бюджет|до|на|около|корзин|набор|комплект|посовет|предложи|подбер)/i.test(t)) {
    return null;
  }
  const tagged =
    t.match(
      /(?:только|бюджет|до|на|около)\s*(\d[\d\s]{2,8})\s*(?:₸|тг|тенге|тыс(?:яч)?|к\b)?/i,
    ) ?? t.match(/(\d[\d\s]{2,8})\s*(?:₸|тг|тенге)/i);
  const raw = tagged?.[1] ?? t.match(/(\d[\d\s]{3,8})/)?.[1];
  if (!raw) return null;
  const n = Number(raw.replace(/\s/g, ""));
  if (!Number.isFinite(n) || n < 1000 || n > 10_000_000) return null;
  return n;
}

export function matchDeliveryIntent(text: string): boolean {
  return /доставк|сдэк|cdek|отправ(ить|ка|ите)/i.test(text);
}

export function isConsultantThanks(text: string): boolean {
  return /^(спасибо|благодар|очень\s+круто.{0,24}спасибо|круто,?\s*спасибо|рахмет|көп\s*рахмет)([.!?…\s❤🌸🙏]*)$/i.test(
    text.trim(),
  );
}

/** Сторис: «цена» / «добрый день цена» — не пустой поиск по слову «цена». */
export function matchPriceOnlyIntent(text: string): boolean {
  return /^(добрый\s+(день|вечер)\s+)?(цена|стоимость|почём|почем)\s*[?!.…]*$/i.test(text.trim());
}

export function matchCountryPostback(payload: string | null | undefined): ConsultantCountry | null {
  if (!payload) return null;
  if (payload === "CONSULTANT_COUNTRY:KZ") return "KZ";
  if (payload === "CONSULTANT_COUNTRY:RU") return "RU";
  return null;
}

/**
 * Вопрос про адрес магазина, физическое посещение («приехать посмотреть вживую», «пощупать») или самовывоз.
 */
export function isStoreLocationOrPickupIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /где\s+(вы\s+)?(находитесь|расположены|ваш\s+магазин|бутик|шоурум)/i.test(t) ||
    /какой\s+(у\s+вас\s+)?адрес/i.test(t) ||
    /адрес\s+(магазина|шоурума|бутика)/i.test(t) ||
    /самовывоз/i.test(t) ||
    /забрать\s+(самому|самостоятельно|из\s+магазина)/i.test(t) ||
    /приехать\s+(к\s+вам|посмотреть|выбрать|пощупать)/i.test(t) ||
    /посмотреть\s+вживую/i.test(t) ||
    /пощупать/i.test(t) ||
    /есть\s+ли\s+(магазин|шоурум|бутик|точка)/i.test(t) ||
    /в\s+каком\s+городе/i.test(t) ||
    /колибри|colibri/i.test(t)
  );
}
