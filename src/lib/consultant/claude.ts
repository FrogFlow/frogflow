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
  extractAnthropicUsage,
  type SmartSearchTokenUsage,
} from "@/lib/smart-search-cost";
import { logger } from "@/lib/logger.server";
import { stripMarkdownFormatting } from "./copy";
import { cleanForbiddenPhrases, cleanScriptHallucinations } from "./validate";

import { priceRub, getStoredVtbRate } from "./rate";

export function formatCatalogForPrompt(catalog: ConsultantProduct[], rate: number | null): string {
  if (!catalog || catalog.length === 0) return "АКТУАЛЬНЫЙ АССОРТИМЕНТ МАГАЗИНА: данных нет.";
  const inStock = catalog.filter((p) => p.stock);
  if (inStock.length === 0) return "АКТУАЛЬНЫЙ АССОРТИМЕНТ МАГАЗИНА: все позиции временно распроданы.";
  const lines: string[] = ["АКТУАЛЬНЫЙ АССОРТИМЕНТ И НАЛИЧИЕ НА СКЛАДЕ МАГАЗИНА:"];
  for (const p of inStock) {
    const rub = rate ? `${priceRub(p.price_kzt, rate).toLocaleString("ru-RU")} ₽` : "по курсу";
    const kzt = `${p.price_kzt.toLocaleString("ru-RU")} ₸`;
    const size = p.size ? ` | Размер: ${p.size}` : "";
    const colors = p.colors.length > 0 ? ` | Доступные расцветки: ${p.colors.join(", ")}` : "";
    const mat = p.material ? ` | Ткань/состав: ${p.material}` : "";
    lines.push(`• ${p.name}${size} | Категория: ${p.category} | Цена: ${kzt} (${rub})${colors}${mat} | В наличии`);
  }
  return lines.join("\n");
}

export function buildConsultantSystemPrompt(
  catalog: ConsultantProduct[],
  rate: number | null,
  shopUrl = "https://bovi.kz",
  storeInfo?: { address: string; phone: string; hours: string },
  knowledgeSection?: string,
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
Если в каталоге у товара НЕ указаны материал, состав, описание или технические подробности — вы НЕ ИМЕЕТЕ ПРАВА их додумывать или сочинять. Нельзя говорить «это мягкая подушка с натуральным наполнением» или «без ортопедических пластин», если такой информации нет в каталоге. Вместо этого перечислите то, что известно (название, размер, цена, наличие), и предложите клиенту уточнить детали у менеджера или приехать в бутик посмотреть вживую. Пример правильного ответа: «Dorelan SENSE LOW 40x70x10 — 85 000 ₸. Подробные характеристики (состав, тип наполнителя) уточните у нашего менеджера или приезжайте в бутик — можно протестировать подушку вживую».

ПОЛНОТА ВЫДАЧИ (НИКАКИХ ВЫБОРОЧНЫХ ПОЗИЦИЙ):
Инструмент search_products возвращает поле total_matches — сколько позиций подошло ВСЕГО, и returned — сколько карточек он вам отдал.
1. Если клиент спросил «что есть» по конкретному признаку (жёсткость, размер, цвет, бренд), перечислите ВСЕ отданные позиции, а не первые две-три «для примера».
2. Если total_matches больше returned, обязательно назовите общее число и предложите сузить выбор: «Всего в жёсткости SOFT — 8 позиций, показываю ближайшие 5. Сузим по размеру?». Молча обрывать список запрещено.
3. Не подводите итог, которого не считали: число в ответе должно совпадать с total_matches.

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
2. ЗАПРЕЩЕННЫЕ КЛИШЕ: «Отлично!», «Прекрасный выбор!», «Замечательно!», «Будем рады помочь!», «Может, вас интересует что-нибудь еще?». Не спамьте восклицательными знаками и эмодзи.
3. ЗЕРКАЛИРОВАНИЕ ЯЗЫКА:
   - Если клиент пишет на казахском (например, «Сәлеметсіз бе», «Рахмет», «Бағасы қанша?», «Қандай түстер бар?»), отвечайте вежливо и естественно на чистом казахском языке!
   - Если клиент пишет на русском — отвечайте на русском.
   - На «Спасибо / Рахмет / Благодарю» отвечайте тепло и кратко: «Пожалуйста! Если появятся вопросы или решите оформить заказ — пишите, всегда на связи» (на каз: «Оқасы жоқ! Сұрақтарыңыз болса немесе тапсырыс бергіңіз келсе — жазыңыз, әрқашан байланыстамыз»).
4. НАЗВАНИЯ БРЕНДОВ, МАТЕРИАЛОВ И РАСЦВЕТОК:
   - БРЕНДЫ И КОЛЛЕКЦИИ: Названия европейских и японских марок и коллекций (Aquanova, LONDON, Maks, Graccioza Egoist, Uchino, Blomus SONO, B-Sensible) сохраняйте в оригинале на латинице (как на фабричной упаковке и бирках в бутике).
   - МАТЕРИАЛЫ: Состав и тип ткани всегда пишите понятным русским языком (100% гребенной хлопок, мерсеризованный сатин, лебяжий пух, тенсель/эвкалипт), избегая сырых англоязычных терминов без перевода.
   - РАСЦВЕТКИ (СТРОГО): Всегда называйте цвета на понятном русском языке (например: светло-бежевый, розовый, голубой, серый, белый, слоновая кость), либо указывайте фабричный код в скобках: «розовый (blush)», «светло-бежевый (fog)», «голубой (sea mist)». КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО оставлять список расцветок только на английском языке без перевода (например, писать «(fog, linen, silver, steel)» запрещено).

СТРАНА И ЦЕНЫ
- Казахстан (country=KZ): цены всегда называйте в тенге (₸). Используйте первое число из строки «Цена:» (например, из «Цена: 260 000 ₸ (51 834 ₽)» называйте 260 000 ₸). Стандартная доставка по Казахстану.
- Россия (country=RU): цены ВСЕГДА называйте ИСКЛЮЧИТЕЛЬНО в рублях (₽). Используйте ТОЛЬКО рублёвую цену, указанную в скобках после тенговой. Например, из строки «Цена: 260 000 ₸ (51 834 ₽)» для клиента из РФ называйте именно 51 834 ₽, а НЕ 260 000 ₽. Никогда не подставляйте тенговое число с символом рубля. Доставка в РФ осуществляется курьерской службой СДЭК и оплачивается покупателем при получении по тарифам СДЭК (никогда не называйте фиксированную цену доставки в РФ, только по тарифам СДЭК).
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
   • ДОПУСК ПО РАЗМЕРУ: фабрика выпускает 182х202 вместо 180х200 — расхождение до 3 см по каждой стороне это один и тот же размер, и такие позиции считаются в наличии. Называйте фактический размер с пометкой: «182х202 — это фабричный размер под 180х200». Не отвечайте «в наличии нет», если отличие только в этих сантиметрах.
5. ВЫБОР ЦВЕТА: Когда клиент выбрал товар или размер без указания цвета (например, «Хочу полотенце 70х140» или спрашивает о ковриках), перечислите расцветки из наличия на русском языке (или в формате «русский (factory_code)») и спросите, какой цвет больше нравится. Когда клиент выбрал цвет — подтвердите его.
6. ОБЩИЙ ИНТЕРЕС («Интересует», «Да», «Давайте», «Что у вас есть?»):
   Не предлагайте случайный товар наугад. Напомните основные категории магазина (матрасы, постельное бельё, одеяла, подушки, пледы, полотенца, наматрасники, топперы) или свяжите с тем, о чём клиент говорил ранее в диалоге.
7. БЮДЖЕТ / СБОРКА НАБОРА: Если клиент называет бюджет («до 25 000 тенге» или «соберите набор»), подберите 1–3 товара из каталога, сумма цен которых укладывается в бюджет, и назовите общую сумму.
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

ЕСЛИ ОТВЕТА НЕТ — СПРОСИТЕ МЕНЕДЖЕРА, А НЕ МОЛЧИТЕ
Когда вопрос клиента не закрывается ни каталогом, ни базой знаний (сравнение двух моделей между собой, состав и технология, которых нет в карточке, сроки и гарантии):
1. Вызовите инструмент ask_manager и передайте вопрос клиента.
2. Ответьте честно и коротко: «Уточню этот момент у менеджера и вернусь с ответом. Пока могу помочь с чем-то ещё?».
3. Диалог при этом НЕ ставится на паузу — вы продолжаете отвечать на остальные вопросы.
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вместо этого: придумывать ответ, уходить в общие слова или обрывать разговор без ответа. Незнание — нормальный ответ, молчание — нет.

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
      usage: null,
      error: "no_api_key",
    };
  }

  const rate =
    params.rate !== undefined && params.rate !== null
      ? params.rate
      : (await getStoredVtbRate())?.rate ?? null;
  const catalog = params.catalog ?? [];
  const { getConsultantStoreInfo } = await import("./store-info");
  const storeInfo = await getConsultantStoreInfo().catch(() => undefined);
  const { loadConsultantKnowledge, formatKnowledgeForPrompt } = await import("./knowledge");
  const knowledgeArticles = await loadConsultantKnowledge().catch(() => []);
  const knowledgeSection = formatKnowledgeForPrompt(knowledgeArticles);

  const fullSystemPrompt = buildConsultantSystemPrompt(
    catalog,
    rate,
    params.shopUrl,
    storeInfo,
    knowledgeSection,
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
          messages,
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
        usage,
        error: `anthropic_${res.status}:${body.slice(0, 180)}`,
      };
    }

    const json = (await res.json()) as AnthropicMessage;
    const roundUsage = extractAnthropicUsage(json);
    if (roundUsage) {
      // Складывать надо все четыре счётчика. Раньше здесь пересобирался
      // объект из двух полей, и у сообщения с несколькими раундами токены
      // кеша — то есть почти весь ввод — терялись начиная со второго.
      usage = usage
        ? {
            inputTokens: usage.inputTokens + roundUsage.inputTokens,
            outputTokens: usage.outputTokens + roundUsage.outputTokens,
            cacheCreationTokens:
              (usage.cacheCreationTokens ?? 0) + (roundUsage.cacheCreationTokens ?? 0),
            cacheReadTokens: (usage.cacheReadTokens ?? 0) + (roundUsage.cacheReadTokens ?? 0),
          }
        : roundUsage;
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
      lastText = cleanForbiddenPhrases(cleanScriptHallucinations(rawText));
    }

    if (toolUses.length === 0) {
      logger.info("consultant.claude_usage", {
        model: consultantModel(),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        rounds: round + 1,
        handoff,
      });
      return { text: stripMarkdownFormatting(lastText), products, extraNumbers, handoff, handoffData, usage };
    }

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
      return { text: stripMarkdownFormatting(lastText), products, extraNumbers, handoff, handoffData, usage };
    }
  }

  return { text: stripMarkdownFormatting(lastText), products, extraNumbers, handoff, handoffData, usage, error: "max_rounds" };
}
