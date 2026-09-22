import {
  consultantApiKey,
  consultantModel,
  CONSULTANT_AI_TIMEOUT_MS,
  CONSULTANT_MAX_TOOL_ROUNDS,
} from "./config";
import { CONSULTANT_TOOLS, executeConsultantTool } from "./tools";
import type { ConsultantProduct } from "./catalog";
import type { ConsultantCountry } from "./intent";
import type { ConsultantState, ConsultantTurn } from "./state";
import {
  CONSULTANT_CACHE_TTL,
  addTokenUsage,
  extractAnthropicUsage,
  type SmartSearchTokenUsage,
} from "@/lib/smart-search-cost";
import { logger } from "@/lib/logger.server";
import { stripMarkdownFormatting } from "./copy";
import { cleanForbiddenPhrases, cleanScriptHallucinations } from "./validate";
import { brandVocabulary, fixBrandSpelling } from "./style";

import { priceRub, getFreshVtbRate } from "./rate";

/**
 * Каталог для системного промпта.
 *
 * Формат компактный намеренно. Каталог — это 73% промпта, а промпт уходит в
 * каждый вызов; подписи «Размер:», «Категория:», «Цена:», «Доступные
 * расцветки:» и хвост «| В наличии» повторялись на каждой из 877 строк и
 * стоили 13 500 токенов на вызов, не неся ни байта сведений. Порядок полей
 * объявлен один раз в заголовке, единицы (₸, ₽) и метки «цв:», «сост:»
 * оставлены, чтобы поля не путались между собой, когда какое-то пустое.
 */
export function formatCatalogForPrompt(catalog: ConsultantProduct[], rate: number | null): string {
  if (!catalog || catalog.length === 0) return "АКТУАЛЬНЫЙ АССОРТИМЕНТ МАГАЗИНА: данных нет.";
  const inStock = catalog.filter((p) => p.stock);
  if (inStock.length === 0) return "АКТУАЛЬНЫЙ АССОРТИМЕНТ МАГАЗИНА: все позиции временно распроданы.";
  const lines: string[] = [
    "АКТУАЛЬНЫЙ АССОРТИМЕНТ И НАЛИЧИЕ НА СКЛАДЕ МАГАЗИНА.",
    "Всё перечисленное ниже есть в наличии. Формат строки:",
    "• название | размер | категория | цена в тенге ₸ | цена в рублях ₽ | цв: расцветки | сост: состав",
    "Поля размера, расцветок и состава могут отсутствовать, если их нет в прайсе.",
  ];
  for (const p of inStock) {
    const parts: string[] = [p.name];
    if (p.size) parts.push(p.size);
    if (p.category) parts.push(p.category);
    parts.push(`${p.price_kzt.toLocaleString("ru-RU")} ₸`);
    parts.push(rate ? `${priceRub(p.price_kzt, rate).toLocaleString("ru-RU")} ₽` : "₽ по курсу");
    if (p.colors.length > 0) parts.push(`цв: ${p.colors.join(", ")}`);
    if (p.material) parts.push(`сост: ${p.material}`);
    lines.push(`• ${parts.join(" | ")}`);
  }
  return lines.join("\n");
}

/**
 * Брейкпоинт кеша на хвосте переписки.
 *
 * История диалога, контекст сессии и результаты инструментов идут после
 * системного промпта и меняются каждое сообщение, поэтому оплачивались по
 * полной цене — на боевых данных это 3 180 токенов на сообщение. Пометка на
 * последнем блоке делает уже отправленную часть переписки кешируемой:
 * следующий раунд того же сообщения и следующая реплика того же клиента
 * читают её из кеша вместо того, чтобы слать заново.
 *
 * TTL здесь короткий, в отличие от системного промпта. Системный промпт
 * общий для всех покупателей и ждёт следующего часами — ему нужен часовой.
 * Хвост живёт внутри одного диалога, где раунды идут секундами, а реплики
 * минутами: пятиминутный кеш до них доживает, а его запись стоит 1,25 против
 * 2 у часового.
 */
function withTailCacheBreakpoint(
  messages: Array<{ role: "user" | "assistant"; content: unknown }>,
): Array<{ role: "user" | "assistant"; content: unknown }> {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const mark = { type: "ephemeral" as const };

  if (typeof last.content === "string") {
    out[out.length - 1] = {
      role: last.role,
      content: [{ type: "text", text: last.content, cache_control: mark }],
    };
    return out;
  }
  if (Array.isArray(last.content) && last.content.length > 0) {
    const blocks = last.content.slice();
    const tail = blocks[blocks.length - 1];
    if (tail && typeof tail === "object") {
      blocks[blocks.length - 1] = { ...(tail as Record<string, unknown>), cache_control: mark };
      out[out.length - 1] = { role: last.role, content: blocks };
    }
  }
  return out;
}

export function buildConsultantSystemPrompt(
  catalog: ConsultantProduct[],
  rate: number | null,
  shopUrl = "https://bovi.kz",
  storeInfo?: { address: string; phone: string; hours: string },
  knowledgeSection?: string,
  brandsSection?: string,
): string {
  const catalogSection = formatCatalogForPrompt(catalog, rate);
  const storeAddress = storeInfo?.address || "г. Алматы, ул. Сатпаева, 3 (бутик-молл COLIBRI, 1-й этаж)";
  const storePhone = storeInfo?.phone || "+7 (777) 333 08 08";
  const storeHours = storeInfo?.hours || "ежедневно с 10:00 до 22:00";
  const knowledgeBlock = knowledgeSection?.trim() ? `\n\n${knowledgeSection.trim()}` : "";

  return `РОЛЬ
Вы — умный, заботливый, экспертный онлайн-консультант магазина домашнего текстиля BOVI в Instagram Direct.
Сайт магазина: ${shopUrl}

ГЛАВНЫЙ ПРИНЦИП
Вы общаетесь как живой, внимательный человек в чате, а не робот и не сухой скрипт.
Весь ассортимент и склад магазина находятся у вас перед глазами в блоке «АКТУАЛЬНЫЙ АССОРТИМЕНТ». Вы точно знаете все товары, размеры, цены и доступные цвета. Называйте только реальные характеристики из этого списка.

СТРОГИЙ ЗАПРЕТ НА ВЫДУМЫВАНИЕ ХАРАКТЕРИСТИК:
Если в каталоге у товара НЕ указаны материал, состав, описание или технические подробности — вы НЕ ИМЕЕТЕ ПРАВА их додумывать или сочинять. Нельзя говорить «это мягкая подушка с натуральным наполнением» или «без ортопедических пластин», если такой информации нет в каталоге.

Но и отговорка запрещена. Не пишите «в каталоге не указаны детальные характеристики этой модели» — покупателю нет дела до того, как устроена наша база. Порядок такой:
1. Скажите то, что знаете о самом товаре: название, коллекция, размер, цвет, цена, наличие.
2. Добавьте то, что написано о бренде и коллекции в базе знаний. Текстов статей в промпте нет — есть оглавление; нужную статью забирайте инструментом search_knowledge и приводите её формулировками, не пересказом. Вопрос про состав, материал, наполнитель, плотность, уход, стирку или репутацию марки — это всегда повод вызвать search_knowledge, а не отвечать по памяти.
3. Менеджера предлагайте только тогда, когда не хватает конкретной величины, которой нет нигде (точный состав в процентах, вес, сертификат), и нужна она для решения о покупке. Это отдельное короткое предложение в конце, а не весь ответ.

ВОПРОС ПРО ОДНО СВОЙСТВО — ОТВЕТ РОВНО ПРО НЕГО:
Спросили про высоту матраса, состав, наполнитель, вес, плотность или уход — ответьте этим свойством одной-двумя строками и спросите, нужны ли подробности. Перечень моделей с ценами в таком ответе не нужен: спрашивали про высоту, а не про прайс. Правильно: «Матрасы Dorelan LEVANT высотой 27 см. Рассказать про модель подробнее или подобрать размер?». Неправильно: назвать высоту и следом выложить четыре позиции с ценами. Позиции показывайте, только когда о них спросили.

ПОЛНОТА ВЫДАЧИ — ПО ШИРИНЕ ВОПРОСА:
Инструмент search_products возвращает total_matches (сколько подошло всего), returned (сколько карточек отдано) и иногда ask_size_and_color.
1. ШИРОКИЙ ВОПРОС (назван только бренд или только категория, без размера и цвета) — приходит сводка: ask_size_and_color, число позиций, несколько размеров и расцветок (sizes_total и colors_total — сколько их всего) и price_from_kzt, цена самой доступной позиции. Карточек в ней нет, и перечислять НЕЛЬЗЯ. Ответ — не больше трёх строк: есть в наличии и сколько позиций; «цены от <price_from_kzt> ₸»; вопрос, какой размер и цвет интересуют. Размеры и расцветки называйте ТОЛЬКО если их меньше четырёх, иначе скажите «есть разные размеры и расцветки» и спросите. Перечислять десяток расцветок нельзя: покупатель на это не отвечает, он уходит.
2. ВОПРОС С ФИЛЬТРОМ (назван размер, цвет, жёсткость или бюджет) — перечислите ВСЕ отданные позиции, а не первые две-три «для примера».
3. «Покажите все», «весь список», «какие есть варианты» после вашего же предложения сузить — вызовите search_products с show_all: true и перечислите всё, что он вернул.
4. Если total_matches больше returned, назовите общее число и предложите сузить выбор: «Всего в жёсткости SOFT — 8 позиций, показываю ближайшие 5. Сузим по размеру?». Молча обрывать список запрещено.
5. Не подводите итог, которого не считали: число в ответе должно совпадать с total_matches.

ХАРАКТЕРИСТИКИ — СЛОВАМИ ИСТОЧНИКА, А НЕ ПЕРЕСКАЗОМ:
Свойства товара берите из каталога и базы знаний той формулировкой, которая там написана, и не пересказывайте своими словами. Пересказ порождает несуществующие слова: из «дышащие ткани» и «воздухопроницаемость» получилось «дышащесть», которого нет ни в одном загруженном документе. Не уверены в формулировке — приведите её как есть или не упоминайте свойство вовсе.

СТРОГОЕ ПРАВИЛО ОДНОГО ОТВЕТА (ЗАПРЕТ НА СЦЕНАРИИ):
Вы формируете РОВНО ОДИН ответ консультанта на последнее сообщение клиента.
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:
1. Писать за клиента или симулировать его ответы.
2. Генерировать диалоги со сценариями (например: «customer: ... assistant: ...» или «клиент: ...»).
3. Самостоятельно продолжать диалог за обе стороны и додумывать оформление заказа.
Ваш ответ — это исключительно ваша текущая реплика клиенту.

ФОРМАТ СООБЩЕНИЙ ДЛЯ INSTAGRAM DIRECT
1. НИКАКОГО MARKDOWN И ЗВЁЗДОЧЕК: Instagram Direct не поддерживает разметку. Никогда не используйте звёздочки (ни **50x90 см**, ни *текст*). Они отображаются как битые символы.
2. Для списков используйте символ «• » или нумерацию «1. », «2. ».
3. Цены пишите простым текстом: «50x90 см — 8 900 ₸» или «1 768 ₽».

ТОНАЛЬНОСТЬ И ЯЗЫК
1. Сдержанный, вежливый, дружелюбный, экспертный тон. Без дешёвой навязчивости («без цыганщины», не навязывать товары).
2. ЗАПРЕЩЕННЫЕ КЛИШЕ: «Отлично!», «Прекрасный выбор!», «Замечательно!», «Будем рады помочь!», «Мы всегда готовы помочь!», «Может, вас интересует что-нибудь еще?».
   ВОСКЛИЦАТЕЛЬНЫЕ ЗНАКИ И ЭМОДЗИ ЗАПРЕЩЕНЫ ПОЛНОСТЬЮ. Ни одного «!» и ни одного эмодзи в сообщении покупателю — ни в приветствии, ни в прощании, ни рядом с ценой. Тон ровный и деловой: «Добрый день. Чем помочь?», а не «Здравствуйте! Рады видеть 😊».
3. ЗЕРКАЛИРОВАНИЕ ЯЗЫКА:
   - Если клиент пишет на казахском (например, «Сәлеметсіз бе», «Рахмет», «Бағасы қанша?», «Қандай түстер бар?»), отвечайте вежливо и естественно на чистом казахском языке!
   - Если клиент пишет на русском — отвечайте на русском.
   - На «Спасибо / Рахмет / Благодарю» отвечайте тепло и кратко: «Пожалуйста! Если появятся вопросы или решите оформить заказ — пишите, всегда на связи» (на каз: «Оқасы жоқ! Сұрақтарыңыз болса немесе тапсырыс бергіңіз келсе — жазыңыз, әрқашан байланыстамыз»).
4. НАЗВАНИЯ БРЕНДОВ, МАТЕРИАЛОВ И РАСЦВЕТОК:
   - БРЕНДЫ И КОЛЛЕКЦИИ: Названия европейских и японских марок и коллекций (Aquanova, LONDON, Maks, Graccioza Egoist, Uchino, Blomus SONO, B-Sensible, Traumina, Dorelan) пишите ТОЛЬКО латиницей, как на фабричной упаковке и бирках в бутике. Транслитерировать запрещено: «Травмина», «Дорелан», «Учино» — ошибка, даже если рядом в том же сообщении марка написана правильно.
   - МАТЕРИАЛЫ: Состав и тип ткани всегда пишите понятным русским языком (100% гребенной хлопок, мерсеризованный сатин, лебяжий пух, тенсель/эвкалипт), избегая сырых англоязычных терминов без перевода.
   - РАСЦВЕТКИ (СТРОГО): Всегда называйте цвета на понятном русском языке (например: светло-бежевый, розовый, голубой, серый, белый, слоновая кость), либо указывайте фабричный код в скобках: «розовый (blush)», «светло-бежевый (fog)», «голубой (sea mist)». КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО оставлять список расцветок только на английском языке без перевода (например, писать «(fog, linen, silver, steel)» запрещено).

СТРАНА И ЦЕНЫ
- Казахстан (country=KZ): цены всегда называйте в тенге (₸) — это поле со знаком ₸ в строке товара (например, из «… | 260 000 ₸ | 51 834 ₽ | …» называйте 260 000 ₸). Стандартная доставка по Казахстану.
- Если в строке товара вместо рублёвой цены стоит «₽ по курсу», значит курс сегодня недоступен. Тогда рублёвую сумму НЕ называйте и НЕ считайте сами: назовите товар, скажите, что рублёвую сумму подтвердит менеджер по актуальному курсу, и вызовите ask_manager. Пересчитывать тенге в рубли в уме запрещено.
- Россия (country=RU): цены ВСЕГДА называйте ИСКЛЮЧИТЕЛЬНО в рублях (₽). Используйте ТОЛЬКО поле со знаком ₽, которое идёт сразу после тенгового. Например, из строки «… | 260 000 ₸ | 51 834 ₽ | …» для клиента из РФ называйте именно 51 834 ₽, а НЕ 260 000 ₽. Никогда не подставляйте тенговое число с символом рубля. Доставка в РФ осуществляется курьерской службой СДЭК и оплачивается покупателем при получении по тарифам СДЭК (никогда не называйте фиксированную цену доставки в РФ, только по тарифам СДЭК).
- Если страна неизвестна (country=unknown): вежливо спросите, из какой страны обращается клиент (Казахстан или Россия), чтобы показать актуальные цены и условия доставки.

АДРЕС МАГАЗИНА, САМОВЫВОЗ И КОНТАКТЫ
• Физический бутик BOVI: ${storeAddress}
• Режим работы: ${storeHours}
• Телефон для связи: ${storePhone}
• САМОВЫВОЗ: Самовывоз доступен в часы работы магазина.
• ПОСЕЩЕНИЕ И ВЫБОР ВЖИВУЮ: Клиенты всегда могут приехать в бутик, посмотреть ткани и расцветки вживую, пощупать качество и выбрать на месте.
Когда клиент спрашивает «Где вы находитесь?», «Какой адрес?», «Можно приехать посмотреть?» или «Есть ли самовывоз?» — всегда вежливо называйте точный адрес, режим работы и телефон, и приглашайте в магазин!

РЕГЛАМЕНТ КОНСУЛЬТАЦИЙ ПО ТОВАРАМ
1. ПОЛОТЕНЦА: Когда клиент спрашивает о полотенцах в целом («у вас есть полотенца?», «какие размеры есть?»), назовите ВСЕ банные размеры из наличия с ценой и расцветками — обычно это 50х90, 70х140 и 100х150 см, но если в каталоге есть другие, их тоже надо назвать, а не оставлять три «основных».
2. ПОСТЕЛЬНОЕ БЕЛЬЕ: Называйте доступные размеры (полуторный, евро, семейный), ткань (сатин) и расцветки.
3. ПОДУШКИ (ВАЖНО): Когда клиент спрашивает о подушках в целом («какие есть подушки?», «нужна подушка»), ОБЯЗАТЕЛЬНО сначала уточните:
   «Подскажите, вас интересуют подушки для сна или декоративные? У нас есть и те, и другие».
   • Подушки для сна:
     - Ортопедические/анатомические Dorelan (Италия) из латекса / пены с памятью формы: SENSE LOW (высота 10 см) и SENSE MEDIUM (высота 12 см). Они ортопедические, бережно поддерживают шею.
     - Премиальные немецкие Traumina: ортопедические с пластинами (Ergonom Faser), натуральные пуховые (Plume BIO, Elegance, Luxury №1, Trame Daune) и гипоаллергенные из функционального волокна (Swing, Nature & Fresh, kuschelmich).
   • Декоративные подушки: интерьерные подушки и чехлы брендов SANDER и EAGLE.
4. МАТРАСЫ И ТОППЕРЫ:
   В наличии премиальные итальянские матрасы Dorelan (линейки FORMER, LEVANT, TRESOR, SFERA, EPIC) и немецкий матрас Frankenstolz.
   Также есть топперы (наматрасники из пены для смягчения или выравнивания спального места) Dorelan (MOUSSE, GREEM, RE:ACTIVE) и защитные наматрасники Traumina и Dorelan.
   • ЖЁСТКОСТЬ (СТРОГО): если клиент назвал жёсткость (SOFT / MEDIUM / FIRM, мягкий / средний / жёсткий), передавайте её параметром hardness в search_products и показывайте ТОЛЬКО эту жёсткость. Матрас другой жёсткости — это другой товар, а не «похожий вариант»: выдать MEDIUM в ответ на запрос про SOFT запрещено. Если в нужной жёсткости ничего нет, так и скажите и спросите, рассмотрит ли клиент другую.
   • СРЕДНЯЯ ЖЁСТКОСТЬ СНЯТА С ПРОИЗВОДСТВА: матрасов MEDIUM (средней жёсткости) магазин больше не продаёт. Не предлагайте их, не перечисляйте и не упоминайте по своей воле — ни как вариант, ни как «было раньше», ни в перечне линеек, даже если такая модель описана в базе знаний. Если клиент сам спросил про среднюю жёсткость, ответьте прямо: матрасов средней жёсткости сейчас нет, — и предложите SOFT и FIRM. Сроки возврата в продажу не называйте: их никто не подтверждал.
   • КАК НАЗЫВАТЬ ЖЁСТКОСТЬ: в тексте покупателю пишите «комфортный (Soft)» и «упругий (Firm)» — это дословная просьба продавца. Слова «мягкий» и «жёсткий» про матрас не употребляйте. Заводское название модели не трогайте: «Dorelan LEVANT R4 SOFT» пишется так, как стоит в прайсе. Если покупатель сам сказал «комфортный» или «упругий», это и есть Soft и Firm — передавайте их в hardness.
   • ДОПУСК ПО РАЗМЕРУ: фабрика выпускает 182х202 вместо 180х200 — расхождение до 3 см по каждой стороне это один и тот же размер, и такие позиции считаются в наличии. Называйте фактический размер с пометкой: «182х202 — это фабричный размер под 180х200». Не отвечайте «в наличии нет», если отличие только в этих сантиметрах.
5. ВЫБОР ЦВЕТА: Когда клиент выбрал товар или размер без указания цвета (например, «Хочу полотенце 70х140» или спрашивает о ковриках), перечислите расцветки из наличия на русском языке (или в формате «русский (factory_code)») и спросите, какой цвет больше нравится. Когда клиент выбрал цвет — подтвердите его.
6. ОБЩИЙ ИНТЕРЕС («Интересует», «Да», «Давайте», «Что у вас есть?»):
   Не предлагайте случайный товар наугад. Напомните основные категории магазина (матрасы, постельное бельё, одеяла, подушки, пледы, полотенца, наматрасники, топперы) или свяжите с тем, о чём клиент говорил ранее в диалоге.
7. БЮДЖЕТ:
   • САМИ ПРО БЮДЖЕТ НЕ СПРАШИВАЙТЕ. Вопрос «какую сумму готовы потратить» задавать запрещено — он отпугивает покупателя. Работайте с бюджетом, только если клиент назвал его сам.
   • Если клиент назвал бюджет («до 25 000 тенге», «соберите набор»), подберите 1–3 товара из каталога, сумма которых укладывается в бюджет, и назовите общую сумму.
   • Подбирайте строго в той категории, о которой идёт речь. Передавайте category в search_products вместе с max_price_kzt: на вопрос об одеяле за 100 000 ₸ нельзя предлагать подушку за 30 000 только потому, что она дешевле.
   • Если в этой категории в бюджет не попадает ничего — скажите это прямо и назовите самую доступную позицию из поля cheapest_ignoring_price_limit. «Одеял дешевле 170 000 ₸ сейчас нет, самое доступное — …, показать?» честнее, чем «это довольно узкий ценовой сегмент» с подставленным дешёвым товаром из другой категории.
8. НЕТ В НАЛИЧИИ: Если клиент спрашивает товар, которого действительно нет в ассортименте (посуда, шторы), честно скажите, что этой позиции сейчас нет, и предложите подходящую альтернативу из текстиля. Обязательно ищите по ВСЕМ позициям в каталоге — в нашем ассортименте есть матрасы (Dorelan, Frankenstolz), топперы, наматрасники, одеяла, подушки, халаты и многое другое.
9. КАТЕГОРИЯ ДЕРЖИТСЯ ЖЁСТКО: если клиент назвал категорию, всегда передавайте её параметром category в search_products и отвечайте товарами ТОЛЬКО этой категории. На «есть голубые полотенца 50х70?» нельзя показывать голубое постельное бельё или пледы: это выглядит как подмена. Нет голубых полотенец нужного размера — так и скажите, предложите другие размеры или расцветки полотенец, и только если клиент сам согласится — покажите соседнюю категорию.

КАЧЕСТВО ТКАНЕЙ, МАТЕРИАЛЫ И УХОД BOVI:
1. ПОЛОТЕНЦА (МАХРА):
   • Состав: 100% натуральный длинноволокнистый гребенной хлопок высшего сорта (Combed Cotton).
   • Плотность: 550–600 г/м² (премиальный отельный стандарт).
   • Свойства: пушистая двойная крученая петля, безупречно впитывает влагу с первого касания, не становится жестким после стирок.
2. ПОСТЕЛЬНОЕ БЕЛЬЕ (САТИН):
   • Состав: 100% мерсеризованный длинноволокнистый хлопок плотностью 300 TC сатинового переплетения.
   • Свойства: нежная шелковистая текстура с благородным матовым блеском, ткань «дышит» и комфортна в любой сезон (прохлада летом, тепло зимой).
   • Не образует катышков (антипиллинг), не линяет, сохраняет форму годами.
3. ОДЕЯЛА И ПОДУШКИ:
   • Наполнители: ультратонкое гипоаллергенное микроволокно "swan down" (лебяжий пух) и натуральное эвкалиптовое волокно (тенсель).
   • Чехлы: 100% хлопковый тик высокой плотности, не пропускающий наполнитель наружу.
4. ПРАВИЛА СТИРКИ И ДЕЛИКАТНОГО УХОДА:
   • Стирка при 40°C жидкими средствами без хлора и отбеливателей.
   • Для махры рекомендуется сушка в расправленном виде или в сушильной машине на низких оборотах для вспушивания петель.
${knowledgeBlock}

${brandsSection ? `${brandsSection}\n\n` : ""}НЕ ДАВИТЬ НА ПОКУПАТЕЛЯ
Спросили про один товар — предлагайте один. НИКОГДА не уговаривайте взять больше, чем спросили: «или возьмёте оба?», «берите сразу два», «рекомендую взять оба размера», «может, комплектом?» — всё это запрещено. Запрещены и уговоры поторопиться: «успейте», «пока есть», «последний шанс».
Вопрос в конце ответа должен помогать выбрать, а не продавать: «Какой размер вас интересует?» — можно, «Какой размер, или возьмёте оба?» — нельзя.
Если покупатель сам спросит про несколько позиций или про комплект — отвечайте спокойно и по делу, это не дожим.

СТРАНА ПРОИЗВОДСТВА
Страну бренда называйте ТОЛЬКО если она прямо написана в базе знаний или в списке марок выше. Ни по названию марки, ни по звучанию, ни по памяти страну не определяйте: на вопрос про итальянские и голландские товары уже были названы марки, к этим странам отношения не имеющие. Не знаете страну — так и скажите и вызовите ask_manager.

ЕСЛИ ОТВЕТА НЕТ — ПЕРЕДАЙТЕ МЕНЕДЖЕРУ И ЗАМОЛЧИТЕ
Когда вопрос клиента не закрывается ни каталогом, ни базой знаний (сравнение двух моделей между собой, состав и технология, которых нет в карточке, сроки и гарантии):
1. Вызовите инструмент ask_manager и передайте вопрос клиента.
2. Ответьте ровно одной фразой: «Спасибо. Я передам ваш вопрос менеджеру — он скоро с вами свяжется.»
3. И НИЧЕГО БОЛЬШЕ. Не пересказывайте вопрос, не подводите итог, не предлагайте помощь с другим, не спрашивайте «есть ли ещё вопросы». Дальше диалог ведёт человек — вы замолкаете.
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вместо этого: придумывать ответ, уходить в общие слова или обрывать разговор без ответа. Незнание — нормальный ответ, молчание — нет.

ЕСЛИ ПРОСЯТ ФОТО, ВИДЕО ИЛИ ПРИСЛАЛИ ГОЛОСОВОЕ
Фотографий товара у вас нет, голосовые вы не слышите.
• Просят ТОЛЬКО фото, и больше в сообщении ничего — отвечайте той же одной фразой, что и на вопрос без ответа, и ничего не добавляйте.
• В том же сообщении спрашивают размеры, цены, расцветки или наличие — сначала ответьте на это по прайсу, как обычно. Про фото писать не нужно: строку о том, что их пришлёт менеджер, система добавит сама.

ОФОРМЛЕНИЕ ЗАКАЗА И ПЕРЕДАЧА МЕНЕДЖЕРУ
Когда клиент определился с выбором и готов сделать заказ («оформляем», «хочу заказать», «беру», «куда платить?») или просит связать с человеком:
1. Если клиент еще не оставил телефон или город, попросите: «Спасибо! Уточните, пожалуйста, ваш номер телефона и город доставки, чтобы менеджер связался с вами для оформления заказа 📲».
2. Вызовите инструмент handoff_to_manager, передав детали заказа и контактные данные.

${catalogSection}`;
}

export const CONSULTANT_SYSTEM_PROMPT = buildConsultantSystemPrompt([], null);

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type AnthropicMessage = {
  content?: AnthropicContent[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
};

export type ClaudeTurnResult = {
  text: string;
  products: ConsultantProduct[];
  extraNumbers: number[];
  handoff: boolean;
  handoffData?: {
    reason?: string;
    customer_phone?: string;
    delivery_city?: string;
    order_summary?: string;
  };
  /** Инструменты, которые модель вызвала за ход, по порядку вызова. */
  toolsUsed?: string[];
  usage: SmartSearchTokenUsage | null;
  error?: string;
};

export function buildAnthropicMessages(
  recent: ConsultantTurn[] | undefined,
  currentText: string,
): Array<{ role: "user" | "assistant"; content: unknown }> {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const t of recent ?? []) {
    const role = t.role === "customer" ? "user" : "assistant";
    const text = (t.text ?? "").trim();
    if (!text) continue;

    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${text}`;
    } else {
      turns.push({ role, content: text });
    }
  }

  // Anthropic API requirement: conversation must start with a 'user' turn
  while (turns.length > 0 && turns[0].role !== "user") {
    turns.shift();
  }

  const userText = currentText.trim();
  if (turns.length > 0 && turns[turns.length - 1].role === "user") {
    turns[turns.length - 1].content = `${turns[turns.length - 1].content}\n${userText}`;
  } else {
    turns.push({ role: "user", content: userText || "Здравствуйте" });
  }

  return turns;
}

export async function runConsultantClaude(params: {
  text: string;
  state: ConsultantState;
  catalog?: ConsultantProduct[];
  rate?: number | null;
  shopUrl?: string;
  forceTools?: boolean;
  composeAfterTools?: boolean;
  userKey?: string;
}): Promise<ClaudeTurnResult> {
  const apiKey = consultantApiKey();
  if (!apiKey) {
    return {
      text: "",
      products: [],
      extraNumbers: [],
      handoff: false,
      toolsUsed: [],
      usage: null,
      error: "no_api_key",
    };
  }

  const rate =
    params.rate !== undefined && params.rate !== null
      ? params.rate
      : (await getFreshVtbRate())?.rate ?? null;
  const catalog = params.catalog ?? [];
  const { getConsultantStoreInfo } = await import("./store-info");
  const storeInfo = await getConsultantStoreInfo().catch(() => undefined);
  const { loadConsultantKnowledge, formatKnowledgeForPrompt, formatKnowledgeIndexForPrompt, knowledgeFitsInPrompt } =
    await import("./knowledge");
  const knowledgeArticles = await loadConsultantKnowledge().catch(() => []);
  // Большая база знаний в промпт не едет: в неё ходят инструментом
  // search_knowledge. Маленькая остаётся целиком — лишний раунд обращения к
  // модели дороже, чем пара абзацев в промпте.
  const knowledgeSection = knowledgeFitsInPrompt(knowledgeArticles)
    ? formatKnowledgeForPrompt(knowledgeArticles)
    : formatKnowledgeIndexForPrompt(knowledgeArticles);

  // Список марок продавца едет в промпт целиком: он короткий, лежит в
  // кешируемой части и без него модель называет страну по памяти.
  const brandsSection = await (async () => {
    try {
      const { loadConsultantSynonyms } = await import("./catalog");
      const { parseSynonymGroups, formatSynonymsForPrompt } = await import("./synonyms");
      return formatSynonymsForPrompt(parseSynonymGroups(await loadConsultantSynonyms()));
    } catch {
      return "";
    }
  })();

  const fullSystemPrompt = buildConsultantSystemPrompt(
    catalog,
    rate,
    params.shopUrl,
    storeInfo,
    knowledgeSection,
    brandsSection,
  );

  const country: ConsultantCountry | undefined = params.state.country;
  const sessionLines: string[] = ["ДАННЫЕ ТЕКУЩЕЙ СЕССИИ:"];
  sessionLines.push(`• Страна клиента: ${country ?? "не определена (unknown)"}`);
  if (params.state.customer_contact) {
    sessionLines.push(`• Контактный номер клиента: ${params.state.customer_contact}`);
  }
  if (params.shopUrl) {
    sessionLines.push(`• Сайт магазина: ${params.shopUrl}`);
  }
  if (params.state.last_product_ids?.length) {
    sessionLines.push(`• Ранее предложенные товары (ID): ${params.state.last_product_ids.join(", ")}`);
  }
  if (params.state.automation_paused) {
    sessionLines.push("• Внимание: автоматизация была временно на паузе");
  }
  const dynamicSessionContext = sessionLines.join("\n");

  const messages = buildAnthropicMessages(params.state.recent, params.text);

  const products: ConsultantProduct[] = catalog.filter((p) => p.stock);
  const extraNumbers: number[] = [];
  if (rate) extraNumbers.push(rate);
  for (const p of products) {
    extraNumbers.push(p.price_kzt);
    if (rate) extraNumbers.push(priceRub(p.price_kzt, rate));
  }
  let handoff = false;
  // Какие инструменты модель вызвала за все раунды. Нужно, чтобы поймать
  // обещание «уточню у менеджера», сделанное без вызова ask_manager.
  const toolsUsed: string[] = [];
  let handoffData: ClaudeTurnResult["handoffData"] = undefined;
  let usage: SmartSearchTokenUsage | null = null;
  let lastText = "";

  for (let round = 0; round < CONSULTANT_MAX_TOOL_ROUNDS; round++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: consultantModel(),
          max_tokens: 600,
          system: [
            {
              type: "text",
              text: fullSystemPrompt,
              cache_control: { type: "ephemeral", ttl: CONSULTANT_CACHE_TTL },
            },
            {
              type: "text",
              text: dynamicSessionContext,
            },
          ],
          stop_sequences: [
            "\ncustomer:",
            "\nCustomer:",
            "\nклиент:",
            "\nКлиент:",
            "\nпокупатель:",
            "\nПокупатель:",
            "\nuser:",
            "\nUser:",
          ],
          tools: CONSULTANT_TOOLS.map((tool, i) =>
            i === 0
              ? { ...tool, cache_control: { type: "ephemeral", ttl: CONSULTANT_CACHE_TTL } }
              : tool,
          ),
          messages: withTailCacheBreakpoint(messages),
          ...(params.forceTools && round === 0 ? { tool_choice: { type: "any" } } : {}),
        }),
        signal: AbortSignal.timeout(CONSULTANT_AI_TIMEOUT_MS),
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      logger.warn("consultant.claude_fetch_failed", { error: msg });
      return {
        text: "",
        products,
        extraNumbers,
        handoff: false,
        toolsUsed,
        usage,
        error: `network_error:${msg.slice(0, 120)}`,
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("consultant.claude_http", { status: res.status, body: body.slice(0, 180) });
      return {
        text: "",
        products,
        extraNumbers,
        handoff: false,
        toolsUsed,
        usage,
        error: `anthropic_${res.status}:${body.slice(0, 180)}`,
      };
    }

    const json = (await res.json()) as AnthropicMessage;
    const roundUsage = extractAnthropicUsage(json);
    if (roundUsage) {
      // Складывать надо все счётчики целиком. Раньше сложение стояло здесь и
      // собирало объект из двух полей, и у сообщения с несколькими раундами
      // токены кеша — то есть почти весь ввод — терялись начиная со второго.
      usage = addTokenUsage(usage, roundUsage);
    }

    const content = json.content ?? [];
    messages.push({ role: "assistant", content });

    const toolUses = content.filter(
      (b): b is Extract<AnthropicContent, { type: "tool_use" }> => b.type === "tool_use",
    );
    const texts = content.filter(
      (b): b is Extract<AnthropicContent, { type: "text" }> => b.type === "text",
    );
    if (texts.length) {
      const rawText = texts
        .map((t) => t.text)
        .join("\n")
        .trim();
      lastText = fixBrandSpelling(
        cleanForbiddenPhrases(cleanScriptHallucinations(rawText)),
        brandVocabulary(catalog),
      );
    }

    if (toolUses.length === 0) {
      logger.info("consultant.claude_usage", {
        model: consultantModel(),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        rounds: round + 1,
        handoff,
      });
      return { text: stripMarkdownFormatting(lastText), products, extraNumbers, handoff, handoffData, toolsUsed, usage };
    }

    toolsUsed.push(...toolUses.map((call) => call.name));
    const executedAll = await Promise.all(
      toolUses.map((call) =>
        executeConsultantTool(call.name, call.input ?? {}, {
          country,
          catalog: params.catalog,
          shopUrl: params.shopUrl,
          excludeIds: params.state.last_product_ids,
          userKey: params.userKey,
        }),
      ),
    );
    const toolResults: unknown[] = [];
    for (let i = 0; i < toolUses.length; i++) {
      const executed = executedAll[i];
      products.push(...executed.products);
      if (executed.handoff) {
        handoff = true;
        const resObj = executed.result as {
          reason?: string;
          customer_phone?: string;
          delivery_city?: string;
          order_summary?: string;
        } | null;
        if (resObj) {
          handoffData = {
            reason: resObj.reason,
            customer_phone: resObj.customer_phone,
            delivery_city: resObj.delivery_city,
            order_summary: resObj.order_summary,
          };
        }
      }
      const rate = (executed.result as { rate?: number } | null)?.rate;
      if (typeof rate === "number" && rate > 0) extraNumbers.push(rate);
      for (const p of executed.products) extraNumbers.push(p.price_kzt);
      const toolProds = (executed.result as { products?: Array<{ price_rub?: number | null }> })?.products;
      if (Array.isArray(toolProds)) {
        for (const tp of toolProds) {
          if (typeof tp.price_rub === "number" && tp.price_rub > 0) {
            extraNumbers.push(tp.price_rub);
          }
        }
      }
      const singleProd = executed.result as { price_rub?: number | null } | null;
      if (typeof singleProd?.price_rub === "number" && singleProd.price_rub > 0) {
        extraNumbers.push(singleProd.price_rub);
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUses[i].id,
        content: JSON.stringify(executed.result),
      });
    }
    messages.push({ role: "user", content: toolResults });
    if (handoff && (lastText.trim().length > 0 || round === CONSULTANT_MAX_TOOL_ROUNDS - 1)) {
      return { text: stripMarkdownFormatting(lastText), products, extraNumbers, handoff, handoffData, toolsUsed, usage };
    }
  }

  return { text: stripMarkdownFormatting(lastText), products, extraNumbers, handoff, handoffData, toolsUsed, usage, error: "max_rounds" };
}
