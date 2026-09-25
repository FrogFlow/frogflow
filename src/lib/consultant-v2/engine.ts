/**
 * Консультант v2 — ИИ-менеджер BOVI.
 *
 * Отличие от v1 в том, кто принимает решения. В v1 сообщение сначала
 * проходило десятки правил в коде (страна, опт, фото, покупка, лимит длины
 * диалога, шаблоны без модели), а ответ модели потом чистили 17 фильтров. Здесь
 * код отвечает за данные и безопасность, а решает модель: что спросить, что
 * показать, когда звать человека (инструмент handoff_to_manager с причиной).
 *
 * Код по-прежнему делает то, что модели делать нельзя или незачем:
 * - прайс, база знаний, курс и товары публикации приходят данными;
 * - попытка взломать промпт и команда сброса обрабатываются до модели;
 * - в ответе вырезается разметка, эмодзи и «!» (просьба магазина), пересказ
 *   служебных пометок и написанные за покупателя реплики;
 * - цены сверяются с прайсом — пока в журнал, без правки ответа.
 *
 * Общее с v1 (защита от дублей, пауза при менеджере в чате, отправка, журнал,
 * задачи и уведомления) живёт в handle-message и не дублируется.
 */
import type { ConsultantReply } from "@/lib/consultant/handle-message";
import type { ConsultantState } from "@/lib/consultant/state";
import type { ConsultantProduct } from "@/lib/consultant/catalog";
import type { StoredVtbRate } from "@/lib/consultant/rate";
import type { SmartSearchTokenUsage } from "@/lib/smart-search-cost";
import {
  V2_TOOLS,
  formatProfile,
  isHandoffReason,
  mergeProfile,
  type V2HandoffReason,
  type V2Profile,
} from "./tools";
import { buildV2SystemPrompt, categoryOf, formatAssortmentMapForV2, V2_PROMPT_VERSION } from "./prompt";
import { tengeToRubles, wantsRubles } from "./currency";
import { draftFixNote, draftProblems } from "./draft-check";
import { correctQuery, latinModelsIn, latinModelsNote } from "./typos";
import { knowledgeAboutModels } from "./knowledge";
import { alertModelFailure } from "./model-alert";

const V2_TIMEOUT_MS = 30_000;
const V2_MAX_ROUNDS = 4;
const V2_MAX_TOKENS = 800;

/**
 * Модели, на которых v2 проверяют. Настройка бота consultant_model выбирает
 * из них без передеплоя: так один и тот же сценарий прогоняют на разных
 * моделях. Чего нет в списке — берётся модель из ENV деплоя.
 */
export const V2_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-5"] as const;

async function v2Model(): Promise<string> {
  const { consultantModel } = await import("@/lib/consultant/config");
  try {
    const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "consultant_model")
      .maybeSingle();
    const chosen = typeof data?.value === "string" ? data.value.trim() : "";
    if ((V2_MODELS as readonly string[]).includes(chosen)) return chosen;
  } catch (err) {
    console.warn("[consultant-v2] настройка модели не прочиталась", err);
  }
  return consultantModel();
}

/** Сумма в рублях в тексте модели: «8 960 ₽», «8960 руб.», «9 000 рублей»; не «2 рубашки». */
const RUBLE_AMOUNT_RE = /\d(?:[\d \u00a0\u202f.,]*\d)?[ \u00a0\u202f]?(?:₽|руб(?![а-км-яё]))/i;

/**
 * Модель сама посчитала рубли. 25.09, тест v2: на «сколько в рублях?» Haiku
 * вместо тенге написала рубли по своему курсу — все четыре суммы на 5 % ниже
 * магазинных, с «примерно» и «точный расчёт уточнит менеджер». Рублям модели
 * верить нельзя; ответ переспрашивается один раз с ценами в тенге, а в рубли
 * их переводит код.
 */
export function writesRubles(text: string): boolean {
  return RUBLE_AMOUNT_RE.test(text);
}

const RUBLES_RETRY_NOTE =
  "[В ответе суммы в рублях. Напишите тот же ответ, но цены — в тенге, как в выдаче поиска. О замене на рубли покупателю не пишите.]";

/**
 * Напоминание о рублях — без слов, которые модель повторит покупателю. В
 * первой редакции было «система переведёт каждую сумму в рубли», и 25.09
 * прогон набора получил в семи ответах «Систему сама переведёт в рубли по
 * курсу магазина» прямо покупателю.
 */
const RUBLES_NOTE =
  "[Покупателю нужны рубли: тенге из вашего ответа заменятся на рубли автоматически. Пишите цены в тенге и не упоминайте ни замену, ни курс.]";

type HandoffReasonV1 = Parameters<typeof import("@/lib/consultant/handle-message").handoffReply>[3];

/** Причина v2 → причина в задачах и уведомлениях менеджеру (общих с v1). */
const REASON_TO_TASK: Record<V2HandoffReason, HandoffReasonV1> = {
  purchase: "purchase",
  wholesale: "wholesale",
  complaint: "other",
  human: "other",
  photo: "photo",
  no_answer: "question",
};

/**
 * Параметры запроса под модель. Модель задаётся переменной CONSULTANT_MODEL
 * деплоя: так v2 сравнивают на разных моделях без правки кода. У Sonnet 5
 * рассуждение по умолчанию включено — для чата оно даёт задержку, а не
 * качество, поэтому выключено; Haiku 4.5 таких параметров не принимает.
 */
export function modelParams(model: string): Record<string, unknown> {
  if (/^claude-sonnet-5/.test(model)) return { thinking: { type: "disabled" } };
  return {};
}

/**
 * Ответ модели перед отправкой: только защита и просьбы магазина, без
 * переписывания смысла. Разметка и эмодзи — магазин просил без них;
 * пересказ служебных пометок и реплики «за покупателя» — утечка и брак.
 */
export async function finalizeV2Text(raw: string, catalog: ConsultantProduct[]): Promise<string> {
  const { stripMarkdownFormatting } = await import("@/lib/consultant/copy");
  const { cleanInstructionEcho, cleanScriptHallucinations } = await import("@/lib/consultant/validate");
  const { brandVocabulary, fixBrandSpelling, humanizePunctuation, stripExclamationsAndEmoji } = await import(
    "@/lib/consultant/style"
  );
  let text = cleanScriptHallucinations(raw ?? "");
  text = cleanInstructionEcho(text);
  text = fixBrandSpelling(text, brandVocabulary(catalog));
  return humanizePunctuation(stripExclamationsAndEmoji(stripMarkdownFormatting(text))).trim();
}

/**
 * Карточки выдачи (search_products — списком, get_product — одна) с разделом
 * без чужой серии: у коврика Maks не «Коврики LONDON», а «Коврики» (categoryOf).
 */
export function withModelCategories(result: unknown): unknown {
  const isCard = (x: unknown): x is { name: string; category: string } =>
    Boolean(x) && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" &&
    typeof (x as { category?: unknown }).category === "string";
  const fix = (x: unknown) => (isCard(x) ? { ...x, category: categoryOf(x) } : x);
  if (isCard(result)) return fix(result);
  if (result && typeof result === "object" && Array.isArray((result as { products?: unknown }).products)) {
    const r = result as { products: unknown[] };
    return { ...r, products: r.products.map(fix) };
  }
  return result;
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

/** Товары публикации — пометкой для модели. Покупатель её не видит. Цены — в тенге. */
async function storyNote(
  ctx: V2Context,
  catalog: ConsultantProduct[],
): Promise<{ note: string; products: ConsultantProduct[]; image?: import("./images").V2Image }> {
  if (!ctx.storyId && !ctx.storyMediaUrl && !ctx.storyProductIds) return { note: "", products: [] };
  try {
    const products: ConsultantProduct[] = [];
    if (ctx.storyProductIds) {
      // Эталонный набор: товары публикации заданы сценарием, а не отметкой в базе.
      const ids = new Set(ctx.storyProductIds);
      products.push(...catalog.filter((p) => ids.has(p.id)));
    } else {
      const { findStoryTag } = await import("@/lib/consultant/story-tags.functions");
      const { storyProductsOf } = await import("@/lib/consultant/story-products");
      const { getProduct } = await import("@/lib/consultant/catalog");
      const { matchProductsInText } = await import("@/lib/consultant/handle-message");
      const tag = await findStoryTag(ctx.storyId, ctx.storyMediaUrl);
      for (const tagged of storyProductsOf(tag)) {
        const byId = tagged.id ? await getProduct(tagged.id, catalog) : null;
        const found = byId ?? matchProductsInText(tagged.name, catalog)[0] ?? null;
        if (found) products.push(found);
      }
    }
    if (products.length === 0) {
      // Отметки нет — модель смотрит на саму публикацию: узнаёт товар и ищет
      // похожее. Видео (рилс) и устаревшая ссылка не скачаются — тогда вопрос.
      const { fetchImage } = await import("./images");
      const image = ctx.storyMediaUrl ? await fetchImage(ctx.storyMediaUrl) : null;
      if (image) {
        return {
          note: "[Покупатель пишет из публикации (сторис или рилс); товары к ней не привязаны. Картинка публикации — ниже: поймите, что на ней, и найдите похожее поиском. Не уверены — спросите, что понравилось.]",
          products,
          image,
        };
      }
      return {
        note: "[Покупатель пишет из публикации (сторис или рилс), но товары к ней не привязаны. Спросите, что из неё понравилось.]",
        products,
      };
    }
    const lines = products.map(
      (p) => `• ${p.name}${p.size ? `, ${p.size}` : ""} — ${p.price_kzt.toLocaleString("ru-RU")} ₸`,
    );
    return {
      note: `[Покупатель пишет из публикации (сторис или рилс). Товары в ней:\n${lines.join("\n")}]`,
      products,
    };
  } catch (err) {
    console.warn("[consultant-v2] товары публикации не найдены", err);
    return { note: "", products: [] };
  }
}

export type V2Context = {
  userKey?: string;
  requestId?: string;
  storyId?: string | null;
  storyMediaUrl?: string | null;
  onUsage?: (usage: SmartSearchTokenUsage, model: string) => void;
  onRate?: (rate: StoredVtbRate | null) => void;
  /** Для тестов и эталонного набора: прайс, курс и модель без базы. */
  catalog?: ConsultantProduct[];
  rate?: number | null;
  model?: string;
  /**
   * Прогон эталонного набора: ответ считается как обычно, но без следов —
   * передача менеджеру не ставит паузу, не заводит задачу и не шлёт
   * уведомление, расход не ложится в счёт клиента.
   */
  dryRun?: boolean;
  /** Товары публикации, заданные сценарием набора, — вместо отметки сторис в базе. */
  storyProductIds?: string[];
  /** Каждый вызов инструмента с входом — для разбора прогона. */
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  /** Фото покупателя: ссылки из директа (скачиваются здесь) или уже скачанные (Telegram). */
  imageUrls?: string[];
  images?: import("./images").V2Image[];
  /** Ошибка обращения к модели — для журнала и разбора прогона. */
  onError?: (error: string) => void;
};

export async function decideConsultantReplyV2(
  text: string,
  state: ConsultantState,
  ctx: V2Context = {},
): Promise<ConsultantReply | null> {
  const { copyForBucket, HANDOFF_TO_MANAGER_REPLY } = await import("@/lib/consultant/copy");
  const { handoffReply, knowledgeForQuestion } = await import("@/lib/consultant/handle-message");
  const { looksLikePromptInjection } = await import("@/lib/consultant/injection");
  const { isResetIntent } = await import("@/lib/consultant/intent");
  const { consultantApiKey, consultantModel } = await import("@/lib/consultant/config");
  const { logConsultantEvent } = await import("@/lib/consultant/log");
  const requestId = ctx.requestId ?? "v2";

  const bucket = state.ab_bucket ?? "a";
  const pack = copyForBucket(bucket);
  // Без ключа покупателя handoffReply ничего не пишет: ни паузы, ни задачи, ни уведомления.
  const handoffUserKey = ctx.dryRun ? undefined : ctx.userKey;

  if (looksLikePromptInjection(text)) {
    return handoffReply(pack, state, bucket, "injection", text, handoffUserKey);
  }
  if (isResetIntent(text)) {
    return {
      text: "Начнём заново. Что подсказать?",
      patch: {
        recent: [],
        v2_profile: undefined,
        v2_rub: undefined,
        last_product_ids: [],
        automation_paused: false,
        country: undefined,
        conversation_state: "consulting",
        pending_story_id: undefined,
        pending_story_url: undefined,
      },
      kind: "clarify",
      resetHistory: true,
    };
  }

  const apiKey = consultantApiKey();
  if (!apiKey) {
    ctx.onError?.("no_api_key");
    if (!ctx.dryRun) await alertModelFailure("no_api_key");
    return handoffReply(pack, state, bucket, "error", text, handoffUserKey, HANDOFF_TO_MANAGER_REPLY);
  }
  const model = ctx.catalog != null ? (ctx.model ?? consultantModel()) : await v2Model();

  // ── Данные ────────────────────────────────────────────────────────────
  const { buildAnthropicMessages, withTailCacheBreakpoint } = await import("@/lib/consultant/claude");
  const { loadConsultantCatalog, getConsultantShopUrl } = await import("@/lib/consultant/catalog");
  const { getFreshVtbRate } = await import("@/lib/consultant/rate");
  const catalog = ctx.catalog ?? (await loadConsultantCatalog());
  const rateRow: StoredVtbRate | null =
    ctx.catalog != null
      ? ctx.rate != null
        ? ({ rate: ctx.rate, updatedAt: "test", source: "test" } as StoredVtbRate)
        : null
      : await getFreshVtbRate();
  ctx.onRate?.(rateRow);
  const rate = rateRow?.rate ?? null;
  const shopUrl = await getConsultantShopUrl().catch(() => "https://bovi.kz");
  const { getConsultantStoreInfo } = await import("@/lib/consultant/store-info");
  const store = await getConsultantStoreInfo().catch(() => ({
    address: "г. Алматы, ул. Сатпаева, 3 (бутик-молл COLIBRI, 1-й этаж)",
    phone: "+7 (777) 333 08 08",
    hours: "ежедневно с 10:00 до 22:00",
  }));
  // База знаний — оглавлением: нужная статья подкладывается к вопросу сама
  // (ниже) или берётся search_knowledge. Целиком она была третью промпта.
  const { loadConsultantKnowledge, formatKnowledgeIndexForPrompt } = await import("@/lib/consultant/knowledge");
  const articles = await loadConsultantKnowledge().catch(() => []);
  const knowledgeSection = formatKnowledgeIndexForPrompt(articles);
  const brandsSection = await (async () => {
    try {
      const { loadConsultantSynonyms } = await import("@/lib/consultant/catalog");
      const { parseSynonymGroups, formatSynonymsForPrompt } = await import("@/lib/consultant/synonyms");
      return formatSynonymsForPrompt(parseSynonymGroups(await loadConsultantSynonyms()));
    } catch {
      return "";
    }
  })();
  const system = buildV2SystemPrompt({
    catalogSection: formatAssortmentMapForV2(catalog),
    knowledgeSection,
    brandsSection,
    shopUrl,
    store: { address: store.address, phone: store.phone, hours: store.hours },
  });

  // Всё, что известно к этому сообщению, — пометками перед словами покупателя.
  // Системный промпт общий и в кеше; сюда кладётся то, что меняется.
  const notes: string[] = [];
  const profileNote = formatProfile(state.v2_profile);
  if (profileNote) notes.push(profileNote);
  const story = await storyNote(ctx, catalog);
  if (story.note) notes.push(story.note);
  const known = await knowledgeForQuestion(text, catalog, { evenIfInline: true });
  if (known) notes.push(`[Из базы знаний — покупатель этого не видит:\n${known}]`);
  // «Чем отличаются Макс и Лондон?» — статья о названных моделях (или о
  // моделях последней выдачи): общий подбор ищет только марки.
  const aboutModels = knowledgeAboutModels(text, catalog, articles, {
    recentProductNames: (state.last_product_ids ?? [])
      .slice(0, 4)
      .map((id) => catalog.find((p) => p.id === id)?.name)
      .filter((name): name is string => Boolean(name)),
    attached: known,
  });
  if (aboutModels) notes.push(aboutModels);
  // Покупатель смотрит в рублях — напоминание в самом сообщении: одной строки
  // в системном промпте Haiku не хватило, на «сколько в рублях?» она считала сама.
  if (wantsRubles(text, state, state.v2_profile)) notes.push(RUBLES_NOTE);
  // Марка или модель русскими буквами («акванова Маск») — подсказка, что это
  // в прайсе латиницей: иначе поиск пуст, и модель говорит «таких нет».
  const latinNote = latinModelsNote(text, catalog);
  if (latinNote) notes.push(latinNote);
  // Фото покупателя — модели картинкой рядом с текстом.
  const images = await (async () => {
    const { fetchImage, MAX_IMAGES_PER_TURN } = await import("./images");
    const ready = [...(story.image ? [story.image] : []), ...(ctx.images ?? [])].slice(0, MAX_IMAGES_PER_TURN);
    const fetched = await Promise.all(
      (ctx.imageUrls ?? []).slice(0, MAX_IMAGES_PER_TURN - ready.length).map(fetchImage),
    );
    return [...ready, ...fetched.filter((img): img is NonNullable<typeof img> => img !== null)];
  })();
  const sentPhoto = (ctx.imageUrls?.length ?? 0) + (ctx.images?.length ?? 0) > 0;
  // Картинка публикации идёт со своей пометкой (storyNote); здесь — о фото покупателя.
  const customerPhotos = images.length - (story.image ? 1 : 0);
  if (customerPhotos > 0) {
    notes.push("[Покупатель прислал фото — оно ниже. Поймите, что на нём, и найдите похожее поиском.]");
  } else if (sentPhoto) {
    notes.push("[Покупатель прислал фото, но оно не загрузилось. Попросите написать, что за товар интересует.]");
  }
  const userTurn = [...notes, text.trim() || "Здравствуйте"].join("\n\n");
  const messages = buildAnthropicMessages(state.recent, userTurn);
  if (images.length > 0) {
    const last = messages[messages.length - 1];
    last.content = [
      ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
      { type: "text", text: typeof last.content === "string" ? last.content : userTurn },
    ];
  }

  // ── Модель ────────────────────────────────────────────────────────────
  const { executeConsultantTool } = await import("@/lib/consultant/tools");
  const { CONSULTANT_CACHE_TTL, addTokenUsage, extractAnthropicUsage } = await import(
    "@/lib/smart-search-cost"
  );
  const tools = V2_TOOLS.map((tool, i) =>
    i === V2_TOOLS.length - 1 ? { ...tool, cache_control: { type: "ephemeral", ttl: CONSULTANT_CACHE_TTL } } : tool,
  );

  let profile: V2Profile | undefined = state.v2_profile;
  let handoff: { reason: V2HandoffReason; summary: string; phone?: string } | null = null;
  const products: ConsultantProduct[] = [...story.products];
  // В журнал: сколько фото модель увидела («photo:0» — не скачалось).
  const toolsUsed: string[] = [
    ...(sentPhoto ? [`photo:${customerPhotos}`] : []),
    ...(story.image ? ["story_image"] : []),
    ...(aboutModels ? ["kb_models"] : []),
  ];
  let usage: SmartSearchTokenUsage | null = null;
  let lastText = "";
  let error: string | null = null;

  let maxRounds = V2_MAX_ROUNDS;
  let rublesRetried = false;
  // Фото и видео товара для покупателя (send_product_photo) и фотобаза за ход.
  const attachments: { url: string; kind: "image" | "video" }[] = [];
  let mediaList: import("./media").ProductMedia[] | undefined;
  let draftChecked = false;
  for (let round = 0; round < maxRounds; round++) {
    let json: { content?: AnthropicBlock[]; usage?: unknown };
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: V2_MAX_TOKENS,
          system: [
            { type: "text", text: system, cache_control: { type: "ephemeral", ttl: CONSULTANT_CACHE_TTL } },
          ],
          tools,
          messages: withTailCacheBreakpoint(messages),
          ...modelParams(model),
        }),
        signal: AbortSignal.timeout(V2_TIMEOUT_MS),
      });
      if (!res.ok) {
        error = `anthropic_${res.status}:${(await res.text().catch(() => "")).slice(0, 180)}`;
        break;
      }
      json = (await res.json()) as typeof json;
    } catch (err) {
      error = `network:${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
      break;
    }

    const roundUsage = extractAnthropicUsage(json as never);
    if (roundUsage) usage = addTokenUsage(usage, roundUsage);
    const content = json.content ?? [];
    messages.push({ role: "assistant", content });

    const texts = content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    if (texts.length) lastText = texts.map((b) => b.text).join("\n").trim();
    const calls = content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use",
    );
    if (calls.length === 0) {
      if (!rublesRetried && writesRubles(lastText)) {
        rublesRetried = true;
        maxRounds++;
        toolsUsed.push("fix:rubles_by_model");
        messages.push({ role: "user", content: RUBLES_RETRY_NOTE });
        continue;
      }
      // Черновик сверяется с данными один раз: при расхождении модель
      // переписывает сама (может и поискать заново), покупатель видит новый.
      if (!draftChecked && !handoff && lastText) {
        draftChecked = true;
        const problems = draftProblems(lastText, catalog);
        if (problems.length) {
          maxRounds += 2;
          toolsUsed.push(`fix:draft:${[...new Set(problems.map((p) => p.kind))].join("+")}`);
          messages.push({ role: "user", content: draftFixNote(problems) });
          continue;
        }
      }
      break;
    }

    const results: unknown[] = [];
    for (const call of calls) {
      const input = call.input ?? {};
      // В журнал — и что искали: иначе по журналу не понять, почему поиск был пуст.
      const asked = typeof input.query === "string" ? input.query : typeof input.product_id === "string" ? input.product_id : "";
      toolsUsed.push(asked ? `${call.name} «${asked.slice(0, 60)}»` : call.name);
      ctx.onToolCall?.(call.name, input);
      let result: unknown;
      if (call.name === "remember_customer") {
        profile = mergeProfile(profile, input);
        result = { ok: true };
      } else if (call.name === "send_product_photo") {
        // Фото товара из фотобазы магазина (панель → «Фото товаров»).
        const id = typeof input.product_id === "string" ? input.product_id : "";
        const product = catalog.find((p) => p.id === id) ?? products.find((p) => p.id === id);
        if (!product) {
          result = { found: false, error: "нет позиции с таким product_id — сначала найдите её поиском" };
        } else {
          const { loadProductMedia, mediaForProduct, mediaUrl } = await import("./media");
          const { appOrigin } = await import("@/lib/app-origin.server");
          mediaList ??= await loadProductMedia().catch(() => []);
          const found = mediaForProduct(mediaList, product);
          const origin = appOrigin();
          const fresh = found.filter((m) => !attachments.some((a) => a.url === mediaUrl(origin, m.path)));
          if (origin && fresh.length) {
            attachments.push(...fresh.map((m) => ({ url: mediaUrl(origin, m.path), kind: m.kind })));
            products.push(product);
            result = { found: true, sent: fresh.length, kinds: fresh.map((m) => m.kind) };
          } else {
            result = { found: false, product: product.name };
          }
        }
      } else if (call.name === "handoff_to_manager") {
        handoff = {
          reason: isHandoffReason(input.reason) ? input.reason : "human",
          summary: typeof input.summary === "string" ? input.summary.trim() : "",
          phone: typeof input.customer_phone === "string" ? input.customer_phone.trim() : undefined,
        };
        result = { ok: true, note: "Менеджер подключится. Напишите покупателю одну короткую фразу об этом." };
      } else {
        try {
          // Карточки — в тенге: рубли переводит код после ответа.
          const toolCtx = {
            country: "KZ" as const,
            catalog,
            shopUrl,
            excludeIds: state.last_product_ids,
            userKey: ctx.userKey,
          };
          let executed = await executeConsultantTool(call.name, input, toolCtx);
          // Пустой поиск по слову с опечаткой («палатенца») — повтор по слову
          // из прайса; модель видит, что запрос поправлен.
          let corrected: string | null = null;
          if (call.name === "search_products" && executed.products.length === 0 && typeof input.query === "string") {
            const latin = latinModelsIn(input.query, catalog);
            corrected = correctQuery(input.query, catalog) ?? (latin.length ? latin.join(" ") : null);
            if (corrected) {
              const retry = await executeConsultantTool(call.name, { ...input, query: corrected }, toolCtx);
              if (retry.products.length > 0) {
                executed = retry;
                toolsUsed.push("fix:typo");
              } else {
                corrected = null;
              }
            }
          }
          products.push(...executed.products);
          const cards = withModelCategories(executed.result);
          result =
            corrected && cards && typeof cards === "object"
              ? { ...(cards as Record<string, unknown>), query_corrected_to: corrected }
              : cards;
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: results });
    // Модель уже написала фразу покупателю вместе с передачей — дальше ходить незачем.
    if (handoff && lastText) break;
  }

  if (usage) {
    ctx.onUsage?.(usage, model);
    if (!ctx.dryRun)
      await import("@/lib/ai-usage.server")
      .then((m) => m.recordConsultantLifetime(usage!, model))
      .catch(() => {});
  }

  const rub = wantsRubles(text, state, profile);
  // После повтора рубли всё ещё от модели — в журнал: такой ответ надо видеть.
  if (rublesRetried && writesRubles(lastText)) toolsUsed.push("fix:rubles_by_model_again");
  if (toolsUsed.some((t) => t.startsWith("fix:draft:")) && !handoff) {
    const left = draftProblems(lastText, catalog);
    if (left.length) toolsUsed.push(`fix:draft_again:${[...new Set(left.map((p) => p.kind))].join("+")}`);
  }
  const tengeText = await finalizeV2Text(lastText, catalog);
  const finalText = rub ? tengeToRubles(tengeText, rate) : tengeText;
  if (error) ctx.onError?.(error);
  // Сбой не на минуту (кончились деньги, ключ не принят) — владельцу в
  // Telegram, не чаще раза в три часа. Перегрузку и сеть не шлём.
  if (error && !ctx.dryRun) await alertModelFailure(error);
  logConsultantEvent(requestId, "v2_reply", {
    userKey: ctx.userKey,
    promptVersion: V2_PROMPT_VERSION,
    model,
    tools: toolsUsed,
    handoff: handoff?.reason ?? null,
    error,
  });

  // Цены сверяем с прайсом. Пока только в журнал: править ответ задним
  // числом — ровно та дорожка заплаток, с которой ушли из v1.
  if (finalText) {
    const { validateConsultantReply } = await import("@/lib/consultant/validate");
    const extra: number[] = rate ? [rate] : [];
    if (rate) {
      const { priceRub } = await import("@/lib/consultant/rate");
      for (const p of catalog) extra.push(priceRub(p.price_kzt, rate));
    }
    const verdict = validateConsultantReply(finalText, catalog, extra);
    if (!verdict.ok) {
      logConsultantEvent(requestId, "v2_validation", { userKey: ctx.userKey, reason: verdict.reason });
    }
  }

  const stateWithProfile = { ...state, v2_profile: profile, v2_rub: rub };
  // Товары этого хода — первыми: менеджер видит в карточке то, о чём говорили сейчас.
  const turnIds = [...new Set(products.map((p) => p.id))];

  if (handoff) {
    const { profileForManager } = await import("./tools");
    // Карточка менеджеру: суть от модели и что известно о покупателе — чтобы
    // не перечитывать переписку.
    const note = [handoff.summary, profileForManager(profile)].filter(Boolean).join("\n");
    const reply = await handoffReply(
      pack,
      turnIds.length
        ? { ...stateWithProfile, last_product_ids: [...turnIds, ...(state.last_product_ids ?? [])].slice(0, 12) }
        : stateWithProfile,
      bucket,
      REASON_TO_TASK[handoff.reason],
      text,
      handoffUserKey,
      finalText || HANDOFF_TO_MANAGER_REPLY,
      handoff.phone || profile?.phone,
      catalog,
      note,
    );
    return {
      ...reply,
      patch: { ...reply.patch, v2_profile: profile, v2_rub: rub },
      toolsUsed,
      // Фраза при передаче — тоже в тенге в истории, если покупателю ушли рубли.
      ...(finalText && finalText !== tengeText && reply.text === finalText ? { historyText: tengeText } : {}),
    };
  }

  if (!finalText) {
    // Модель не ответила (сбой сети, пустой ответ). Молчать нельзя — человек
    // ждёт; отдаём менеджеру с причиной «ошибка».
    return handoffReply(pack, stateWithProfile, bucket, "error", text, handoffUserKey, HANDOFF_TO_MANAGER_REPLY);
  }

  const ids = [...new Set(products.map((p) => p.id))];
  return {
    text: finalText,
    // В историю — ответ модели в тенге. Иначе на «в тенге покажите» она
    // видела у себя только рубли и восстанавливала тенге по прайсу — и брала
    // соседнюю строку: Swing Light за 50 000 вместо 55 000, пуховую Soft за
    // 85 000 (цена Medium) вместо 120 000.
    ...(finalText !== tengeText ? { historyText: tengeText } : {}),
    patch: {
      v2_profile: profile,
      v2_rub: rub,
      conversation_state: "consulting",
      ...(ids.length ? { last_product_ids: ids.slice(0, 12) } : {}),
    },
    kind: products.length ? "product" : "clarify",
    toolsUsed,
    ...(attachments.length ? { attachments } : {}),
  };
}
