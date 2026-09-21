import type { ZernioPlatform } from "@/lib/zernio-platform";
import type { ZernioWebhookMessagePayload } from "@/lib/zernio.server";
import { sendDirectReply } from "@/lib/direct-purchase.server";
import { runConsultantClaude } from "./claude";
import {
  getConsultantShopUrl,
  loadConsultantCatalog,
  getProduct,
  type ConsultantProduct,
  categoryQuery,
  priceFloorInScope,
  isCategoryWithoutSize,
  packBasket,
  queryHasCatalogSignal,
  relatedVariants,
  searchProducts,
  searchTokens,
  sizeOptions,
  suggestForBudget,
} from "./catalog";
import {
  copyForBucket,
  formatBasketReply,
  formatBudgetReply,
  formatMissingColorReply,
  formatProductReply,
  formatSizeOptionsReply,
  formatStoreLocationReply,
  formatThanksReply,
  formatVariantsReply,
  looksLikeConsultantBotReply,
  stripMarkdownFormatting,
  type ConsultantCopyPack,
  COUNTRY_BUTTONS,
} from "./copy";
import { looksLikePromptInjection } from "./injection";
import {
  extractBudgetKzt,
  isAffirmativeInterest,
  isConsultantGreeting,
  isConsultantThanks,
  isDeclineResponse,
  isResetIntent,
  isStoreLocationOrPickupIntent,
  looksLikeProductQuery,
  looksLikeVagueHelp,
  matchAdviceIntent,
  matchBasketIntent,
  matchCatalogIntent,
  matchCountry,
  STORY_REPLY_COUNTRY,
  matchCountryPostback,
  matchDeliveryIntent,
  matchMoreVariantsIntent,
  matchOtherCategoriesIntent,
  matchPriceOnlyIntent,
  matchPurchaseIntent,
} from "./intent";
import { consultantApiKey } from "./config";
import { consultantRequestId, logConsultantEvent } from "./log";
import { getFreshVtbRate, priceRub, isOffHoursInAlmaty } from "./rate";
import {
  alreadyAnsweredIncoming,
  appendRecent,
  claimIncomingMessage,
  isAutomationPaused,
  isBotEcho,
  isFalseManagerPause,
  loadConsultantState,
  patchConsultantState,
  pauseConsultant,
  registerBotOutgoingText,
  resetConsultantState,
  resumeConsultant,
  type ConsultantState,
} from "./state";
import { consultantModel } from "./config";
import {
  loadManagerPauseMs,
  managerPauseExpired,
  managerSpokeInConversation,
} from "./manager-guard";
import { fileConsultantQuestion } from "./tasks";
import { recordConsultantRun } from "./runs";
import {
  cleanCatalogExcuses,
  cleanDemoMentions,
  asksForProductPhoto,
  cleanDiscontinuedMattressOffers,
  promisesManagerFollowUp,
  cleanForbiddenPhrases,
  cleanScriptHallucinations,
  DISCONTINUED_MEDIUM_MATTRESS_REPLY,
  validateConsultantReply,
} from "./validate";
import { bucketForUser, getForcedAbBucket } from "./ab";
import { recordConsultantEvent } from "./analytics";
import { addConsultantTask } from "./tasks";
import { notifyConsultantHandoff } from "./notify";
import { foldText, haystackOf } from "./synonyms";
import { stripExclamationsAndEmoji } from "./style";

export type ConsultantReply = {
  text: string;
  patch: Partial<ConsultantState>;
  buttons?: { type: "postback"; title: string; payload: string }[];
  kind:
    | "country"
    | "product"
    | "oos"
    | "purchase"
    | "handoff"
    | "catalog"
    | "clarify"
    | "error"
    | "injection";
  /** Что модель вызвала за ход — нужно страховке «обещал и не сделал». */
  toolsUsed?: string[];
};

const activeUserLocks = new Map<string, Promise<unknown>>();

async function withUserLock<T>(userKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = activeUserLocks.get(userKey) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  activeUserLocks.set(
    userKey,
    prev.then(
      () => current,
      () => current,
    ),
  );

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (activeUserLocks.get(userKey) === current) {
      activeUserLocks.delete(userKey);
    }
  }
}

export async function handleConsultantZernioEvent(params: {
  payload: ZernioWebhookMessagePayload;
  conversationId: string;
  accountId: string;
  userKey: string;
  text: string;
  platform: ZernioPlatform;
  postback?: string | null;
  source?: "webhook" | "poll";
  storyId?: string | null;
  storyMediaUrl?: string | null;
}): Promise<void> {
  return withUserLock(params.userKey, () => handleConsultantZernioEventInternal(params));
}

async function handleConsultantZernioEventInternal(params: {
  payload: ZernioWebhookMessagePayload;
  conversationId: string;
  accountId: string;
  userKey: string;
  text: string;
  platform: ZernioPlatform;
  postback?: string | null;
  source?: "webhook" | "poll";
  storyId?: string | null;
  storyMediaUrl?: string | null;
}): Promise<void> {
  const requestId = consultantRequestId();
  const started = Date.now();
  const direction = params.payload.message?.direction;
  const { consultant } = await loadConsultantState(params.userKey);

  const { isConsultantBotGloballyEnabled } = await import("./state");
  if (!(await isConsultantBotGloballyEnabled())) {
    logConsultantEvent(requestId, "skipped_globally_disabled", { userKey: params.userKey });
    return;
  }

  if (direction === "outgoing") {
    if (isBotEcho(consultant, params.text) || looksLikeConsultantBotReply(params.text)) return;
    if (params.text.trim()) {
      await pauseConsultant(params.userKey, "manager_intervention");
      logConsultantEvent(requestId, "paused", {
        userKey: params.userKey,
        reason: "manager_intervention",
      });
    }
    return;
  }

  const rawIncoming = params.text.trim() || params.postback?.trim() || "";

  if (isResetIntent(rawIncoming)) {
    // Guard against duplicate delivery (webhook + poll both fire /start)
    const source = params.source ?? "webhook";
    if (alreadyAnsweredIncoming(consultant, rawIncoming, Date.now(), source)) {
      logConsultantEvent(requestId, "skipped_duplicate", {
        userKey: params.userKey,
        reason: "reset_dedup",
      });
      return;
    }
    const claimed = await claimIncomingMessage(params.userKey, rawIncoming, source);
    if (!claimed) {
      logConsultantEvent(requestId, "skipped_duplicate", {
        userKey: params.userKey,
        reason: "reset_claim_lost",
      });
      return;
    }

    await resetConsultantState(params.userKey);
    const bucket = consultant.ab_bucket ?? "a";
    const pack = copyForBucket(bucket);
    const welcomeText = stripMarkdownFormatting(pack.askCountry);

    await sendDirectReply({
      conversationId: params.conversationId,
      accountId: params.accountId,
      userKey: params.userKey,
      text: welcomeText,
      buttons: COUNTRY_BUTTONS,
      platform: params.platform,
      force: true,
    });
    registerBotOutgoingText(welcomeText);
    await patchConsultantState(params.userKey, {
      last_bot_reply: welcomeText,
      last_bot_reply_at: new Date().toISOString(),
      last_customer_text: rawIncoming,
      conversation_state: "awaiting_country",
      automation_paused: false,
      pause_reason: undefined,
      country: undefined,
      customer_contact: undefined,
      last_product_ids: [],
      recent: [],
    });
    logConsultantEvent(requestId, "reset", { userKey: params.userKey });
    return;
  }


  if (isAutomationPaused(consultant)) {
    let lastOutgoing = "";
    let lastOutgoingAt = "";
    try {
      const { listZernioConversationMessages } = await import("@/lib/zernio.server");
      const messages = await listZernioConversationMessages(
        params.accountId,
        params.conversationId,
      );
      const last = [...messages]
        .reverse()
        .find((m) => m.direction === "outgoing" && m.message?.trim());
      lastOutgoing = last?.message ?? "";
      lastOutgoingAt = last?.createdAt ?? "";
    } catch {
      lastOutgoing = "";
      lastOutgoingAt = "";
    }
    const rawIncoming = params.text.trim() || params.postback?.trim() || "";
    const canGreetingResume =
      consultant.pause_reason !== "manager_intervention" && isConsultantGreeting(rawIncoming);
    // Окно паузы менеджера истекло. Раньше это правило жило только в опросе
    // инбокса, и покупатель, вернувшийся на следующий день, ждал ответа до
    // минуты — пока не отработает минутный крон. Проверка здесь отвечает ему
    // сразу; опрос остаётся второй линией для диалогов без вебхука.
    const pauseExpired =
      consultant.pause_reason === "manager_intervention" &&
      managerPauseExpired(lastOutgoingAt, await loadManagerPauseMs());
    if (isFalseManagerPause(consultant, lastOutgoing) || canGreetingResume || pauseExpired) {
      await resumeConsultant(params.userKey);
    } else {
      logConsultantEvent(requestId, "skipped_paused", {
        userKey: params.userKey,
        reason: consultant.pause_reason,
      });
      return;
    }
  }

  let text = params.text.trim() || params.postback?.trim() || "";
  if (!text && !params.postback && !params.storyId && !params.storyMediaUrl) {
    const attachments = params.payload.message?.attachments;
    if (attachments && attachments.length > 0) {
      const isVoice = attachments.some((a) => a.type === "audio");
      text = isVoice
        ? "[Клиент отправил голосовое сообщение. Попросите написать текстом, так как бот принимает только текстовые сообщения]"
        : "[Клиент прислал фото/картинку без текста. Поблагодарите за фото и уточните, какой именно товар, размер или цвет интересует]";
    } else {
      return;
    }
  }

  if (isBotEcho(consultant, text)) {
    logConsultantEvent(requestId, "skipped_echo", { userKey: params.userKey });
    return;
  }

  const source = params.source ?? "webhook";
  if (alreadyAnsweredIncoming(consultant, text, Date.now(), source)) {
    logConsultantEvent(requestId, "skipped_duplicate", { userKey: params.userKey });
    return;
  }

  const claimed = await claimIncomingMessage(params.userKey, text, source);
  if (!claimed) {
    logConsultantEvent(requestId, "skipped_duplicate", {
      userKey: params.userKey,
      reason: "claim_lost",
    });
    return;
  }

  // В чате уже отвечает менеджер? Тогда бот молчит. Проверяем перед каждым
  // ответом: событий об исходящих Zernio не шлёт, а опрос раз в пятнадцать
  // минут ловит только случай, когда сообщение менеджера последнее.
  const managerCheck = await managerSpokeInConversation({
    accountId: params.accountId,
    conversationId: params.conversationId,
    userKey: params.userKey,
    state: consultant,
  });
  if (managerCheck.status === "found") {
    await pauseConsultant(params.userKey, "manager_intervention");
    logConsultantEvent(requestId, "paused", {
      userKey: params.userKey,
      reason: "manager_intervention",
      source: "pre_reply_check",
    });
    // Пауза тоже попадает в журнал: иначе «бот промолчал» неотличимо от
    // «бот не получил сообщение».
    void recordConsultantRun({
      messageId: params.payload.message?.id || params.payload.id || requestId,
      conversationId: params.conversationId,
      accountId: params.accountId,
      userKey: params.userKey,
      source,
      incomingText: text,
      replyKind: "paused_manager",
      status: "cancelled",
      managerCheck,
    });
    return;
  }

  let runUsage: import("@/lib/smart-search-cost").SmartSearchTokenUsage | null = null;
  let runModel: string | null = null;
  const reply = await decideConsultantReply(text, consultant, {
    userKey: params.userKey,
    postback: params.postback,
    requestId,
    storyId: params.storyId,
    storyMediaUrl: params.storyMediaUrl,
    onUsage: (usage, model) => {
      runUsage = usage;
      runModel = model;
    },
  });
  if (!reply) return;
  // Единственная точка выхода наружу: через неё проходят и ответы модели, и
  // локальные шаблоны, поэтому запрет на восклицательные знаки и эмодзи
  // применяется здесь, а не в каждом месте, где собирается текст.
  const beforeDiscontinuedGuard = reply.text;
  reply.text = stripExclamationsAndEmoji(
    stripMarkdownFormatting(cleanCatalogExcuses(cleanDemoMentions(cleanDiscontinuedMattressOffers(reply.text)))),
  );
  // Ответ состоял только из предложения снятых матрасов — молчать нельзя,
  // отвечаем честно про среднюю жёсткость.
  if (!reply.text.trim() && beforeDiscontinuedGuard.trim()) {
    reply.text = DISCONTINUED_MEDIUM_MATTRESS_REPLY;
  }

  // Просьба о фото. Фотографий у консультанта нет вовсе, поэтому ответить на
  // такую просьбу может только человек. Ловим по сообщению покупателя, а не по
  // ответу бота: отказ он может сформулировать как угодно, а просьба — вот она.
  if (asksForProductPhoto(text) && reply.kind !== "purchase" && reply.kind !== "handoff") {
    void fileConsultantQuestion({
      userKey: params.userKey,
      question: text.trim(),
      promise: reply.text,
      reason: "photo",
    }).catch((err: unknown) => {
      console.warn("[consultant] не удалось передать просьбу о фото", err);
    });
    logConsultantEvent(requestId, "photo_requested", {
      userKey: params.userKey,
      question: text.trim().slice(0, 160),
    });
  }

  // Бот пообещал уточнить у менеджера, но инструмент не вызвал. На живом
  // диалоге про плотность полотенец так и вышло: пообещал дважды, в списке
  // задач не появилось ничего, покупатель остался ждать. Фиксируем по тексту
  // обещания, а не по доброй воле модели.
  if (
    promisesManagerFollowUp(reply.text) &&
    !(reply.toolsUsed ?? []).includes("ask_manager")
  ) {
    void fileConsultantQuestion({
      userKey: params.userKey,
      // Менеджеру нужен вопрос покупателя, а не пересказ бота.
      question: text.trim() || reply.text,
      promise: reply.text,
    }).catch((err: unknown) => {
      console.warn("[consultant] не удалось зафиксировать обещанный вопрос", err);
    });
    logConsultantEvent(requestId, "question_filed", {
      userKey: params.userKey,
      question: (text.trim() || reply.text).slice(0, 160),
    });
  }

  const { consultant: latest } = await loadConsultantState(params.userKey);
  const lastReplyAt = Date.parse(latest.last_bot_reply_at ?? "");
  const repliedRecently = Number.isFinite(lastReplyAt) && Date.now() - lastReplyAt < 45_000;
  if (
    latest.last_bot_reply?.trim() === reply.text.trim() &&
    (source === "poll" || repliedRecently || alreadyAnsweredIncoming(latest, text, Date.now(), source))
  ) {
    logConsultantEvent(requestId, "skipped_duplicate", {
      userKey: params.userKey,
      reason: "already_sent",
    });
    return;
  }

  const replyTime = new Date().toISOString();
  registerBotOutgoingText(reply.text);
  await patchConsultantState(params.userKey, {
    last_customer_text: text,
    last_bot_reply: reply.text,
    last_bot_reply_at: replyTime,
  });

  const send = (buttons: ConsultantReply["buttons"] | undefined) =>
    sendDirectReply({
      conversationId: params.conversationId,
      accountId: params.accountId,
      userKey: params.userKey,
      text: reply.text,
      buttons,
      platform: params.platform,
      force: true,
    });
  let sent = await send(reply.buttons);
  if (!sent && reply.buttons?.length) sent = await send(undefined);
  if (!sent) {
    logConsultantEvent(requestId, "send_failed", { userKey: params.userKey, kind: reply.kind });
    await patchConsultantState(params.userKey, {
      last_bot_reply_at: undefined,
    });
    return;
  }

  await patchConsultantState(params.userKey, {
    ...reply.patch,
    last_customer_text: text,
    last_bot_reply: reply.text,
    last_bot_reply_at: replyTime,
    recent: appendRecent(consultant, text, reply.text),
  });

  logConsultantEvent(requestId, "replied", {
    userKey: params.userKey,
    kind: reply.kind,
    latencyMs: Date.now() - started,
    tools: reply.patch.last_product_ids?.length ?? 0,
  });

  // Строка журнала на сообщение: из неё считается цена одного ответа и доля
  // кеша. Ответ покупателю уже ушёл, поэтому ошибка записи ничего не ломает.
  void recordConsultantRun({
    messageId: params.payload.message?.id || params.payload.id || requestId,
    conversationId: params.conversationId,
    accountId: params.accountId,
    userKey: params.userKey,
    source,
    incomingText: text,
    replyText: reply.text,
    replyKind: reply.kind,
    model: runModel,
    usage: runUsage,
    managerCheck,
  });
}

export async function decideConsultantReply(
  text: string,
  state: ConsultantState,
  ctx: {
    userKey?: string;
    postback?: string | null;
    requestId?: string;
    catalog?: import("./catalog").ConsultantProduct[];
    rate?: number | null;
    storyId?: string | null;
    storyMediaUrl?: string | null;
    /** Сколько токенов стоил ответ модели — журналу сообщений и панели. */
    onUsage?: (usage: import("@/lib/smart-search-cost").SmartSearchTokenUsage, model: string) => void;
  } = {},
): Promise<ConsultantReply | null> {
  let bucket = state.ab_bucket ?? "a";
  if (ctx.userKey && !state.ab_bucket) {
    try {
      const forced = await getForcedAbBucket();
      bucket = bucketForUser(ctx.userKey, forced);
    } catch {
      bucket = "a";
    }
  }
  const pack = copyForBucket(bucket);

  if (looksLikePromptInjection(text)) {
    void track(ctx.userKey, "injection", text, bucket);
    return handoffReply(pack, state, bucket, "injection", text, ctx.userKey);
  }

  if (isResetIntent(text)) {
    const cleanPatch: Partial<ConsultantState> = {
      customer_contact: undefined,
      last_product_ids: [],
      recent: [],
      ab_bucket: bucket,
      automation_paused: false,
      country: undefined,
      conversation_state: "awaiting_country",
      pending_product_query: undefined,
      pending_story_id: undefined,
      pending_story_url: undefined,
    };
    return {
      text: stripMarkdownFormatting(pack.askCountry),
      patch: cleanPatch,
      buttons: COUNTRY_BUTTONS,
      kind: "country",
    };
  }

  const canClaude = Boolean(consultantApiKey());

  if (!canClaude && isConsultantThanks(text)) {
    return { text: formatThanksReply(), patch: { ab_bucket: bucket }, kind: "clarify" };
  }

  if (state.conversation_state === "handed_off") {
    // Сброс контекста предыдущего завершённого заказа/хендоффа
    state = {
      ...state,
      customer_contact: undefined,
      last_product_ids: [],
      recent: [],
      conversation_state: state.country ? "consulting" : "awaiting_country",
    };
  }

  const country =
    matchCountryPostback(ctx.postback) ?? matchCountry(text) ?? state.country ?? undefined;

  if (isConsultantGreeting(text)) {
    if (!country) {
      const cleanPatch: Partial<ConsultantState> = {
        customer_contact: undefined,
        last_product_ids: [],
        recent: [],
        ab_bucket: bucket,
        automation_paused: false,
      };
      return {
        text: stripMarkdownFormatting(pack.askCountry),
        patch: {
          ...cleanPatch,
          conversation_state: "awaiting_country",
          pending_product_query: undefined,
          pending_story_id: undefined,
          pending_story_url: undefined,
        },
        buttons: COUNTRY_BUTTONS,
        kind: "country",
      };
    }
    // If the customer already selected a country and is in an ongoing consultation, let Claude respond naturally without wiping memory!
    if (canClaude && state.conversation_state === "consulting" && (state.recent?.length ?? 0) > 0) {
      /* proceed to Claude with existing history intact */
    } else {
      const cleanPatch: Partial<ConsultantState> = {
        customer_contact: undefined,
        last_product_ids: [],
        recent: [],
        ab_bucket: bucket,
        automation_paused: false,
      };
      return {
        text: stripMarkdownFormatting(pack.askProduct),
        patch: { ...cleanPatch, country, conversation_state: "awaiting_product" },
        kind: "clarify",
      };
    }
  }

  const hasStoryContext = Boolean(ctx.storyId || ctx.storyMediaUrl);

  // Из сторис и рилса страну не спрашиваем. Человек ответил на конкретную
  // вещь, которую только что увидел, и спрашивает цену — анкета вместо цены
  // разговор гасит. Считаем тенге (прайс в них), рубли назовём тому, кто
  // попросит. В обычной переписке выбор страны остаётся первым шагом.
  if (!country && !hasStoryContext) {
    const isProduct =
      (looksLikeProductQuery(text) ||
        matchPurchaseIntent(text) ||
        matchCatalogIntent(text) ||
        matchAdviceIntent(text) ||
        text.trim().length >= 2) &&
      !isConsultantGreeting(text);
    return {
      text: stripMarkdownFormatting(pack.askCountry),
      patch: {
        conversation_state: "awaiting_country",
        ab_bucket: bucket,
        pending_product_query: isProduct ? text || undefined : undefined,
        pending_story_id: ctx.storyId || undefined,
        pending_story_url: ctx.storyMediaUrl || undefined,
      },
      buttons: COUNTRY_BUTTONS,
      kind: "country",
    };
  }

  const countryPatch: Partial<ConsultantState> = {
    country: country ?? STORY_REPLY_COUNTRY,
    ab_bucket: bucket,
    conversation_state: "consulting",
    pending_product_query: undefined,
    pending_story_id: undefined,
    pending_story_url: undefined,
  };

  const hasPhone = /\+?[0-9\s\-()]{10,}/.test(text) && /\d{7,}/.test(text.replace(/\D/g, ""));

  if (state.conversation_state === "awaiting_contact" && hasPhone) {
    void track(ctx.userKey, "purchase", text, bucket);
    const catalog = ctx.catalog ?? (await loadConsultantCatalog());
    return handoffReply(
      pack,
      { ...state, ...countryPatch, customer_contact: text },
      bucket,
      "purchase",
      text,
      ctx.userKey,
      pack.purchase,
      text,
      catalog,
    );
  }

  const justCountry =
    Boolean(matchCountryPostback(ctx.postback) ?? matchCountry(text)) &&
    !looksLikeProductQuery(text) &&
    !matchCatalogIntent(text) &&
    !matchOtherCategoriesIntent(text) &&
    !matchAdviceIntent(text) &&
    !isAffirmativeInterest(text) &&
    !isDeclineResponse(text);

  if (justCountry) {
    void track(ctx.userKey, "country", text, bucket);
    const pendingStoryId = state.pending_story_id;
    const pendingStoryUrl = state.pending_story_url;
    const hasPendingStory = Boolean(pendingStoryId || pendingStoryUrl);

    if (state.pending_product_query || hasPendingStory) {
      const rawPendingText = state.pending_product_query ?? "";
      const pendingText = rawPendingText === "[story]" ? "" : rawPendingText;
      return decideConsultantReply(
        pendingText,
        {
          ...state,
          ...countryPatch,
          pending_product_query: undefined,
          pending_story_id: undefined,
          pending_story_url: undefined,
          conversation_state: "consulting",
        },
        {
          ...ctx,
          postback: undefined,
          storyId: pendingStoryId || ctx.storyId,
          storyMediaUrl: pendingStoryUrl || ctx.storyMediaUrl,
        },
      );
    }
    return {
      text: pack.askProduct,
      patch: {
        ...countryPatch,
        conversation_state: "awaiting_product",
        pending_product_query: undefined,
        pending_story_id: undefined,
        pending_story_url: undefined,
      },
      kind: "clarify",
    };
  }

  const catalog = ctx.catalog ?? (await loadConsultantCatalog());
  const rateRow =
    ctx.catalog != null || ctx.rate !== undefined
      ? ctx.rate != null
        ? { rate: ctx.rate, updatedAt: "test", source: "test" }
        : null
      : await getFreshVtbRate();
  let storyTag: any = null;
  // К истории может быть привязано несколько товаров: в одной сторис лежат и
  // простыня, и пододеяльник, и наволочки. Первый нужен отдельно — вокруг него
  // строится ответ, если товар в истории один.
  let storyProducts: ConsultantProduct[] = [];
  if (ctx.storyId || ctx.storyMediaUrl) {
    try {
      const { findStoryTag } = await import("./story-tags.functions");
      const { storyProductsOf } = await import("./story-products");
      storyTag = await findStoryTag(ctx.storyId, ctx.storyMediaUrl);
      for (const tagged of storyProductsOf(storyTag)) {
        let resolved: ConsultantProduct | null = null;
        if (tagged.id) {
          resolved = await getProduct(tagged.id, catalog);
        }
        if (!resolved) {
          const matched = matchProductsInText(tagged.name, catalog);
          if (matched[0]) {
            resolved = {
              ...matched[0],
              name: tagged.name,
              price_kzt: tagged.price_kzt || matched[0].price_kzt,
            };
          }
        }
        if (!resolved) {
          resolved = {
            id: tagged.id || `story_${storyTag?.story_id}_${storyProducts.length}`,
            name: tagged.name,
            category: "текстиль",
            size: "",
            colors: [],
            price_kzt: tagged.price_kzt || 0,
            stock: true,
          };
        }
        storyProducts.push(resolved);
      }
    } catch (err) {
      console.warn("[consultant] findStoryTag error:", err);
    }
  }
  const storyProduct: ConsultantProduct | null = storyProducts[0] ?? null;

  const effectiveCatalog = storyProducts.length
    ? [...catalog, ...storyProducts.filter((sp) => !catalog.some((p) => p.id === sp.id))]
    : catalog;

  if (effectiveCatalog.length === 0) {
    void track(ctx.userKey, "error", "catalog_empty", bucket);
    return handoffReply(pack, { ...state, ...countryPatch }, bucket, "other", text, ctx.userKey);
  }

  if (canClaude) {
    try {
      let claudeText = text;
      if (storyProducts.length > 0) {
        const priceOf = (p: ConsultantProduct) => {
          const rub = rateRow?.rate ? priceRub(p.price_kzt, rateRow.rate) : null;
          return country === "RU"
            ? `${rub ? `${rub} ₽` : "уточняется"}`
            : `${p.price_kzt.toLocaleString("ru-RU")} ₸`;
        };
        const userPrompt = text.trim() || "Здравствуйте! Подскажите подробнее про этот товар";
        const many = storyProducts.length > 1;
        const list = storyProducts
          .map((p) => `• «${p.name}» (категория: ${p.category}, цена: ${priceOf(p)}, в наличии)`)
          .join("\n");
        const names = storyProducts.map((p) => `«${p.name}»`).join(", ");

        claudeText = `[КОНТЕКСТ INSTAGRAM: Клиент ответил на Story или Reel (ID: ${storyTag?.story_id || ctx.storyId}).
В этой публикации представлен${many ? "ы товары" : " товар"} нашего бренда BOVI:
${list}
Запрос клиента: "${userPrompt}".
ИНСТРУКЦИИ ДЛЯ ОТВЕТА:
1. Подтвердите, что в публикации ${many ? `представлены ${storyProducts.length} позиции: ${names}` : `представлен товар ${names}`}.
2. Назовите актуальную цену ${many ? "по каждой позиции" : "товара"} и подтвердите наличие.
3. Опишите качество и характеристики (натуральные премиальные материалы, фирменный стандарт BOVI).
4. ${many ? "Спросите, какая из позиций интересует, либо предложите комплект целиком." : "Задайте вопрос по размеру или расцветке, либо предложите оформить заказ."}
Категорически запрещено писать "я не понимаю, на что вы ссылаетесь" или спрашивать о каком товаре речь — вы точно знаете, что это ${names}.]`;
      } else if (ctx.storyId || ctx.storyMediaUrl) {
        console.log("[consultant] story context detected without pre-fetched tag:", { storyId: ctx.storyId, storyMediaUrl: ctx.storyMediaUrl?.slice(0, 80) });
        const userPrompt = text.trim() || "Здравствуйте! Подскажите цену и наличие этого товара";
        claudeText = `[Customer replied to an Instagram story or reel with ID "${ctx.storyId || ""}". Call get_story_product with story_id="${ctx.storyId || ""}" or attachment_url="${ctx.storyMediaUrl || ""}" to see what product is shown. If the customer asks about price or availability, answer with the tagged product's price and details. If no product is found, politely ask which home textile item from the story they liked]\n\n${userPrompt}`;
      }

      const ai = await runConsultantClaude({
        text: claudeText,
        state: { ...state, ...countryPatch },
        catalog: effectiveCatalog,
        rate: rateRow?.rate ?? null,
        shopUrl: await getShopUrlSafe(),
        forceTools: Boolean(!storyProduct && (ctx.storyId || ctx.storyMediaUrl)),
        composeAfterTools: true,
        userKey: ctx.userKey,
      });
      if (ai.usage) {
        void import("@/lib/ai-usage.server").then((m) => m.recordConsultantLifetime(ai.usage!));
        ctx.onUsage?.(ai.usage, consultantModel());
      }
      if (ai.error) {
        // Any AI error (API 500/529, timeout, network error, no key) -> fall through to local catalog without triggering handoff!
        console.warn("[consultant] Claude error, falling back to local catalog:", ai.error);
      } else if (ai.handoff) {
        void track(ctx.userKey, "handoff", text, bucket);
        const contactFromTool = ai.handoffData?.customer_phone;
        const customerContact = contactFromTool || (hasPhone ? text : state.customer_contact);
        const matched = resolveHandoffProductIds(state, text, effectiveCatalog);
        const productIds = ai.products.length > 0
          ? ai.products.map((p) => p.id)
          : matched.length > 0
          ? matched
          : (state.last_product_ids ?? []).slice(0, 1);
        let handoffText = cleanScriptHallucinations(cleanForbiddenPhrases(stripMarkdownFormatting(ai.text)));
        if (!customerContact) {
          const isOffHours = isOffHoursInAlmaty();
          const askContactText = isOffHours
            ? "Спасибо! Уточните, пожалуйста, ваш номер телефона и город доставки — сейчас нерабочие часы магазина, наш менеджер свяжется с вами утром для оформления заказа 📲"
            : (handoffText.trim()
                ? handoffText
                : "Спасибо! Уточните, пожалуйста, ваш номер телефона и город доставки, чтобы менеджер связался с вами для оформления заказа 📲");
          return {
            text: askContactText,
            patch: {
              ...countryPatch,
              last_product_ids: productIds,
              conversation_state: "awaiting_contact",
            },
            kind: "clarify",
          };
        }
        return handoffReply(
          pack,
          {
            ...state,
            ...countryPatch,
            last_product_ids: productIds,
            customer_contact: customerContact,
          },
          bucket,
          "purchase",
          text,
          ctx.userKey,
          handoffText.trim() ? handoffText : pack.purchase,
          customerContact,
          effectiveCatalog,
        );
      } else if (!ai.error) {
        let cleanAiText = cleanScriptHallucinations(cleanForbiddenPhrases(stripMarkdownFormatting(ai.text)));

        const inStock = ai.products.filter((p) => p.stock);
        const historyProducts = (state.last_product_ids ?? [])
          .map((id) => effectiveCatalog.find((p) => p.id === id))
          .filter((p): p is import("./catalog").ConsultantProduct => Boolean(p));
        const allKnownProducts = [...effectiveCatalog, ...historyProducts];
        const rublePrices = country === "RU" && rateRow?.rate
          ? allKnownProducts.map((p) => priceRub(p.price_kzt, rateRow.rate))
          : [];
        const check = validateConsultantReply(cleanAiText, allKnownProducts, [...ai.extraNumbers, ...rublePrices]);
        if (!check.ok) {
          console.warn("[consultant] Claude reply validator note:", check.reason, {
            aiText: ai.text,
            cleanAiText,
            knownCount: allKnownProducts.length,
          });
        }
        if (cleanAiText.trim()) {
          const mentionedProducts = matchProductsInText(cleanAiText, effectiveCatalog);
          const newIds = mentionedProducts.length > 0
            ? mentionedProducts.map((p) => p.id)
            : (storyProduct ? [storyProduct.id] : (state.last_product_ids ?? []));
          return {
            text: cleanAiText.trim(),
            patch: {
              ...countryPatch,
              last_product_ids: newIds,
              conversation_state: "consulting",
            },
            kind: (mentionedProducts.length || storyProduct) ? "product" : "clarify",
            toolsUsed: ai.toolsUsed,
          };
        }
        if (inStock.length > 0) {
          const composed = composeBudgetOrBasketReply(
            text,
            catalog,
            inStock,
            country,
            countryPatch,
            pack,
            state,
            rateRow?.rate ?? null,
          );
          if (composed) return composed;
          const variants = replyMoreVariants(text, catalog, inStock, country, countryPatch, state, rateRow?.rate ?? null);
          if (variants) return variants;
          const matched = matchProductsInText(text, inStock);
          const tokens = searchTokens(text);
          const targetProduct =
            matched[0] ??
            inStock.find((p) => {
              const hay = haystackOf([p.name, p.size, ...p.colors]);
              return tokens.some((t) => hay.includes(t));
            });
          if (!targetProduct) {
            return {
              text: pack.otherCategories,
              patch: countryPatch,
              kind: "clarify",
            };
          }
          const requestedColor = [
            "бежевый",
            "серый",
            "белый",
            "графит",
            "черный",
            "розовый",
            "голубой",
            "синий",
            "зеленый",
            "молочный",
          ].find((c) => new RegExp(c.slice(0, 4), "i").test(text));
          const includeCdek = country === "RU" && !state.ru_cdek_sent;
          const rub =
            country === "RU" && rateRow?.rate ? priceRub(targetProduct.price_kzt, rateRow.rate) : null;
          return {
            text: formatProductReply(targetProduct, country, rub, {
              includeCdek,
              pack,
              selectedColor: requestedColor,
            }),
            patch: {
              ...countryPatch,
              last_product_ids: appendIds(state.last_product_ids, inStock.map((p) => p.id)),
              ru_cdek_sent: state.ru_cdek_sent || includeCdek,
            },
            kind: "product",
          };
        }
      }
    } catch (e: unknown) {
      console.error("Consultant run error:", e);
    }
  }

  // ================= FALLBACK DETERMINISTIC LOGIC (when Claude is unavailable or fails) =================
  if (storyProduct || ctx.storyId || ctx.storyMediaUrl) {
    // Чтение привязки не должно ронять ответ целиком: выше, в основной
    // ветке, оно обёрнуто, а здесь — нет, и сбой базы превращал ответ на
    // сторис в исключение вместо честного «уточните, какой товар».
    const tag =
      storyTag ??
      ((ctx.storyId || ctx.storyMediaUrl)
        ? await (await import("./story-tags.functions"))
            .findStoryTag(ctx.storyId, ctx.storyMediaUrl)
            .catch((err: unknown) => {
              console.warn("[consultant] findStoryTag (fallback) error:", err);
              return null;
            })
        : null);
    const targetProduct = storyProduct ?? (tag ? (tag.product_id ? await getProduct(tag.product_id, catalog) : null) ?? {
      id: tag.product_id || `story_${tag.story_id}`,
      name: tag.product_name,
      category: "текстиль",
      size: "",
      colors: [],
      price_kzt: tag.product_price_kzt || 0,
      stock: true,
    } : null);

    if (targetProduct) {
      const includeCdek = country === "RU" && !state.ru_cdek_sent;
      const rub =
        country === "RU" && rateRow?.rate ? priceRub(targetProduct.price_kzt, rateRow.rate) : null;
      return {
        text: formatProductReply(targetProduct, country, rub, {
          includeCdek,
          pack,
        }),
        patch: {
          ...countryPatch,
          last_product_ids: appendIds(state.last_product_ids, [targetProduct.id]),
          ru_cdek_sent: state.ru_cdek_sent || includeCdek,
        },
        kind: "product",
      };
    }
  }

  const budgetKzt = extractBudgetKzt(text);
  const wantsBasket = matchBasketIntent(text);
  const wantsAdvice =
    looksLikeVagueHelp(text) ||
    matchAdviceIntent(text) ||
    matchOtherCategoriesIntent(text) ||
    Boolean(budgetKzt) ||
    wantsBasket;

  if (matchCatalogIntent(text)) {
    void track(ctx.userKey, "catalog", text, bucket);
    return {
      text: pack.catalogLink(await getShopUrlSafe()),
      patch: countryPatch,
      kind: "catalog",
    };
  }

  if (matchPurchaseIntent(text)) {
    void track(ctx.userKey, "purchase", text, bucket);
    const matched = resolveHandoffProductIds(state, text, catalog);
    const productIds = matched.length > 0 ? matched : (state.last_product_ids ?? []).slice(0, 1);
    if (!state.customer_contact && !hasPhone) {
      const askContactText = isOffHoursInAlmaty()
        ? "Спасибо! Уточните, пожалуйста, ваш номер телефона и город доставки — сейчас нерабочие часы магазина, наш менеджер свяжется с вами утром для оформления заказа 📲"
        : "Спасибо! Уточните, пожалуйста, ваш номер телефона и город доставки, чтобы менеджер связался с вами для оформления заказа 📲";
      return {
        text: askContactText,
        patch: {
          ...countryPatch,
          last_product_ids: productIds,
          conversation_state: "awaiting_contact",
        },
        kind: "clarify",
      };
    }
    return handoffReply(
      pack,
      {
        ...state,
        ...countryPatch,
        last_product_ids: productIds,
        customer_contact: hasPhone ? text : state.customer_contact,
      },
      bucket,
      "purchase",
      text,
      ctx.userKey,
      pack.purchase,
      hasPhone ? text : state.customer_contact,
      catalog,
    );
  }

  if (isStoreLocationOrPickupIntent(text)) {
    void track(ctx.userKey, "clarify", text, bucket);
    const { getConsultantStoreInfo } = await import("./store-info");
    const storeInfo = await getConsultantStoreInfo();
    return {
      text: formatStoreLocationReply(storeInfo),
      patch: { ...countryPatch, conversation_state: "consulting" },
      kind: "clarify",
    };
  }

  if (isDeclineResponse(text)) {
    void track(ctx.userKey, "clarify", text, bucket);
    return {
      text: stripMarkdownFormatting(pack.declineReply),
      patch: { ...countryPatch, conversation_state: "consulting" },
      kind: "clarify",
    };
  }

  if (isAffirmativeInterest(text)) {
    void track(ctx.userKey, "clarify", text, bucket);
    return {
      text: stripMarkdownFormatting(pack.affirmativeInterest),
      patch: { ...countryPatch, conversation_state: "awaiting_product" },
      kind: "clarify",
    };
  }

  if (wantsAdvice && !budgetKzt && !wantsBasket) {
    let namedProduct = false;
    try {
      namedProduct = queryHasCatalogSignal(text, catalog);
    } catch {
      namedProduct = false;
    }
    if (!namedProduct) {
      return { text: pack.otherCategories, patch: countryPatch, kind: "clarify" };
    }
  }

  if (!looksLikeProductQuery(text) && !justCountry && !wantsAdvice) {
    return {
      text: pack.askProduct,
      patch: { ...countryPatch, conversation_state: "awaiting_product" },
      kind: "clarify",
    };
  }

  const local = await replyFromLocalCatalog(
    text,
    catalog,
    country,
    countryPatch,
    pack,
    state,
    rateRow?.rate ?? null,
  );
  if (local) {
    void track(ctx.userKey, local.kind === "oos" ? "oos" : "query", text, bucket);
    return local;
  }

  const hasSig = queryHasCatalogSignal(text, catalog);
  void track(ctx.userKey, "query", text, bucket);

  return handoffReply(pack, { ...state, ...countryPatch }, bucket, "other", text, ctx.userKey, undefined, undefined, catalog);
}

function appendIds(existing: string[] | undefined, next: string[]): string[] {
  const set = new Set([...next, ...(existing ?? [])]);
  return Array.from(set).slice(0, 20);
}

function replyMoreVariants(
  text: string,
  catalog: import("./catalog").ConsultantProduct[],
  fallback: import("./catalog").ConsultantProduct[],
  country: import("./intent").ConsultantCountry | undefined,
  countryPatch: Partial<ConsultantState>,
  state: ConsultantState,
  rate: number | null,
): ConsultantReply | null {
  if (!matchMoreVariantsIntent(text)) return null;
  const lastIds = state.last_product_ids ?? [];
  const fromSearch = fallback.filter((p) => p.stock && !lastIds.includes(p.id));
  const picks =
    fromSearch.length > 0 ? fromSearch.slice(0, 2) : relatedVariants(catalog, lastIds);
  if (picks.length === 0) {
    return {
      text: "Других размеров и цветов в этой категории сейчас нет. Давайте покажу что-то еще.",
      patch: countryPatch,
      kind: "clarify",
    };
  }
  return {
    text: formatVariantsReply(picks, country, rate),
    patch: { ...countryPatch, last_product_ids: appendIds(state.last_product_ids, picks.map((p) => p.id)) },
    kind: "product",
  };
}

function composeBudgetOrBasketReply(
  text: string,
  catalog: import("./catalog").ConsultantProduct[],
  fallback: import("./catalog").ConsultantProduct[],
  country: import("./intent").ConsultantCountry | undefined,
  countryPatch: Partial<ConsultantState>,
  _pack: ConsultantCopyPack,
  _state: ConsultantState,
  rate: number | null,
): ConsultantReply | null {
  const budget = extractBudgetKzt(text);
  const basket = matchBasketIntent(text);
  if (!budget && !basket) return null;
  if (basket && !budget) {
    return {
      text: "На какую сумму собрать набор? Напишите бюджет — подберу 2–3 позиции из наличия.",
      patch: countryPatch,
      kind: "clarify",
    };
  }
  if (!budget) return null;
  const pool = catalog.length > 0 ? catalog : fallback;
  if (basket) {
    const { items, total } = packBasket(pool, budget);
    return {
      text: formatBasketReply(items, total, budget, country, rate),
      patch: {
        ...countryPatch,
        last_product_ids: appendIds(_state.last_product_ids, items.map((p) => p.id)),
      },
      kind: items.length ? "product" : "oos",
    };
  }
  // Категория из фразы клиента не даёт подбору уехать в соседнюю: на
  // «одеяло за 100 000» иначе приходит подушка.
  const askedCategory = categoryQuery(text) ?? undefined;
  const picks = suggestForBudget(pool, budget, 2, askedCategory);
  if (picks.length === 0) {
    const floor = priceFloorInScope(
      { ...(askedCategory ? { category: askedCategory } : {}) },
      pool,
    );
    if (floor) {
      return {
        text:
          `В бюджет ${budget.toLocaleString("ru-RU")} ₸ таких позиций нет. ` +
          `Самая доступная — ${floor.cheapest.name} за ${floor.cheapest.price_kzt.toLocaleString("ru-RU")} ₸. Показать?`,
        patch: { ...countryPatch, last_product_ids: [floor.cheapest.id] },
        kind: "oos",
      };
    }
    return {
      text: `В бюджет ${budget.toLocaleString("ru-RU")} ₸ сейчас нет позиций в наличии. Могу показать соседние категории — напишите, что ближе.`,
      patch: { ...countryPatch, last_product_ids: [] },
      kind: "oos",
    };
  }
  return {
    text: formatBudgetReply(picks, budget, country, rate),
    patch: {
      ...countryPatch,
      last_product_ids: appendIds(_state.last_product_ids, picks.map((p) => p.id)),
    },
    kind: "product",
  };
}

export async function replyFromLocalCatalog(
  text: string,
  catalog: import("./catalog").ConsultantProduct[],
  country: import("./intent").ConsultantCountry | undefined,
  countryPatch: Partial<ConsultantState>,
  pack: ConsultantCopyPack,
  state: ConsultantState,
  rate: number | null,
): Promise<ConsultantReply | null> {
  const composed = composeBudgetOrBasketReply(
    text,
    catalog,
    [],
    country,
    countryPatch,
    pack,
    state,
    rate,
  );
  if (composed) return composed;

  const variants = replyMoreVariants(text, catalog, [], country, countryPatch, state, rate);
  if (variants) return variants;

  if (matchPriceOnlyIntent(text)) {
    const last = (state.last_product_ids ?? [])
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is import("./catalog").ConsultantProduct => Boolean(p));
    if (last[0]) {
      const includeCdek = country === "RU" && !state.ru_cdek_sent;
      const rub = country === "RU" && rate ? priceRub(last[0].price_kzt, rate) : null;
      return {
        text: formatProductReply(last[0], country, rub, { includeCdek, pack }),
        patch: { ...countryPatch, last_product_ids: appendIds(state.last_product_ids, [last[0].id]) },
        kind: "product",
      };
    }
    return {
      text: "Напишите, что на фото — полотенце, одеяло или бельё — сверю цену по прайсу.",
      patch: countryPatch,
      kind: "clarify",
    };
  }

  if (searchTokens(text).includes("молочный")) {
    const milk = catalog.filter(
      (p) => p.stock && p.colors.some((c) => /молочн/i.test(c)),
    );
    if (milk.length === 0) {
      return {
        text: formatMissingColorReply("Молочного", ["белый", "бежевый"]),
        patch: countryPatch,
        kind: "oos",
      };
    }
  }

  if (/\bне\s+банн/i.test(text)) {
    return {
      text: "В наличии сейчас только банные полотенца (размеры 50x90, 70x140 и 100x150 см). Полотенец для лица, рук или кухни сейчас нет в наличии.",
      patch: countryPatch,
      kind: "oos",
    };
  }

  if (isCategoryWithoutSize(text)) {
    const opts = sizeOptions(catalog, text, 5);
    if (opts.length > 0) {
      return {
        text: formatSizeOptionsReply(opts, country, rate, {
          includeCdek: country === "RU" && !state.ru_cdek_sent,
        }),
        patch: { ...countryPatch, last_product_ids: appendIds(state.last_product_ids, opts.map((p) => p.id)) },
        kind: "product",
      };
    }
  }

  if (matchDeliveryIntent(text) && country === "RU" && !queryHasCatalogSignal(text, catalog)) {
    return {
      text: `Доставка в Россию есть, ${pack.cdek}`,
      patch: { ...countryPatch, ru_cdek_sent: true },
      kind: "clarify",
    };
  }

  const found = await searchProducts({ query: text }, catalog);
  const hit = found.find((p) => p.stock);
  if (hit) {
    const requestedColor = [
      "бежевый",
      "серый",
      "белый",
      "графит",
      "черный",
      "розовый",
      "голубой",
      "синий",
      "зеленый",
      "молочный",
    ].find((c) => new RegExp(c.slice(0, 4), "i").test(text));
    const includeCdek = country === "RU" && !state.ru_cdek_sent;
    const rub = country === "RU" && rate ? priceRub(hit.price_kzt, rate) : null;
    return {
      text: formatProductReply(hit, country, rub, {
        includeCdek,
        pack,
        selectedColor: requestedColor,
      }),
      patch: {
        ...countryPatch,
        last_product_ids: appendIds(state.last_product_ids, [hit.id]),
        ru_cdek_sent: state.ru_cdek_sent || includeCdek,
      },
      kind: "product",
    };
  }
  const cat = categoryQuery(text);
  if (found.length === 0 && cat) {
    const opts = sizeOptions(catalog, cat, 5);
    if (opts.length > 0) {
      return {
        text: formatSizeOptionsReply(opts, country, rate, {
          includeCdek: country === "RU" && !state.ru_cdek_sent,
        }),
        patch: { ...countryPatch, last_product_ids: appendIds(state.last_product_ids, opts.map((p) => p.id)) },
        kind: "product",
      };
    }
  }

  if (found.length > 0 || queryHasCatalogSignal(text, catalog)) {
    return { text: pack.oos, patch: { ...countryPatch, last_product_ids: [] }, kind: "oos" };
  }
  return null;
}

function matchProductsInText(
  targetText: string,
  catalog: import("./catalog").ConsultantProduct[],
): import("./catalog").ConsultantProduct[] {
  if (!targetText) return [];
  const ctx = targetText
    .toLowerCase()
    .replace(/(\d+)\s*[-–—/xх*×]\s*(\d+)/g, "$1x$2");
  const scored: Array<{ product: import("./catalog").ConsultantProduct; score: number }> = [];
  for (const p of catalog) {
    if (!p.stock) continue;
    const nameTokens = foldText(p.name).split(/\s+/).filter((t) => t.length > 3);
    const matchedTokens = nameTokens.filter((t) => ctx.includes(t));
    if (matchedTokens.length === 0) continue;
    if (p.size) {
      const cleanSize = p.size.toLowerCase().replace(/\s*см$/i, "").replace(/[-–—/xх*×]/g, "x").trim();
      if (!ctx.includes(cleanSize)) continue;
    }
    const colorMatch = p.colors.some((c) => ctx.includes(c.toLowerCase()));
    let score = matchedTokens.length / nameTokens.length;
    if (colorMatch) score += 1;
    scored.push({ product: p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.product);
}

export function resolveHandoffProductIds(
  state: ConsultantState,
  text: string,
  catalog?: import("./catalog").ConsultantProduct[],
): string[] {
  if (!catalog || catalog.length === 0) {
    return (state.last_product_ids ?? []).slice(0, 3);
  }

  // 1. If customer explicitly named a product in their current message, that takes absolute priority
  const inCurrentText = matchProductsInText(text, catalog);
  if (inCurrentText.length > 0) {
    return [inCurrentText[0].id];
  }

  // 2. Check immediate context: customer's previous text and bot's previous reply
  const immediateContext = [state.last_customer_text ?? "", state.last_bot_reply ?? ""].join(" ");
  const inImmediate = matchProductsInText(immediateContext, catalog);
  if (inImmediate.length > 0) {
    return [inImmediate[0].id];
  }

  // 3. If state already has last_product_ids (e.g. from awaiting_contact or previous selection), use the top one!
  if (state.last_product_ids && state.last_product_ids.length > 0) {
    return [state.last_product_ids[0]];
  }

  // 4. Search recent history backwards (newest to oldest), skipping catalog overview messages
  const recent = state.recent ?? [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i];
    if (/вот\s+все\s+размеры|в\s+наличии\s+банные\s+полотенца.*•/i.test(r.text)) continue;
    const inTurn = matchProductsInText(r.text, catalog);
    if (inTurn.length > 0) {
      return [inTurn[0].id];
    }
  }

  return [];
}

async function handoffReply(
  pack: ConsultantCopyPack,
  state: ConsultantState,
  bucket: "a" | "b",
  reason: "purchase" | "error" | "other" | "injection",
  text: string,
  userKey?: string,
  message?: string,
  customerContact?: string,
  catalog?: import("./catalog").ConsultantProduct[],
): Promise<ConsultantReply> {
  const pauseReason = reason === "injection" ? "other" : reason === "other" ? "other" : reason;
  const contact = customerContact || state.customer_contact;
  const inCurrentText = catalog ? matchProductsInText(text, catalog) : [];
  const resolvedProducts =
    inCurrentText.length > 0
      ? [inCurrentText[0].id]
      : resolveHandoffProductIds(state, text, catalog);
  if (userKey) {
    await pauseConsultant(userKey, pauseReason === "purchase" ? "purchase" : pauseReason).catch(() => {});
    await addConsultantTask({ userKey, reason, text, contact }).catch(() => {});
    await notifyConsultantHandoff({
      userKey,
      reason,
      text,
      customerContact: contact,
      lastProducts: reason === "purchase" ? resolvedProducts.slice(0, 1) : resolvedProducts.slice(0, 3),
    }).catch(() => {});
  }
  const isOffHours = isOffHoursInAlmaty();
  let defaultReply = pack.unrecognized;
  if (reason === "purchase") {
    defaultReply = isOffHours ? pack.purchaseOffHours : pack.purchase;
  }
  let replyText = message ?? defaultReply;
  if (reason === "purchase" && isOffHours && (!message || message === pack.purchase)) {
    replyText = pack.purchaseOffHours;
  }
  return {
    text: stripMarkdownFormatting(replyText),
    patch: {
      ...state,
      ab_bucket: bucket,
      automation_paused: true,
      pause_reason:
        pauseReason === "purchase" ? "purchase" : pauseReason === "error" ? "error" : "other",
      conversation_state: "handed_off",
      customer_contact: contact,
      last_product_ids: resolvedProducts,
    },
    kind: reason === "purchase" ? "purchase" : reason === "injection" ? "injection" : "handoff",
  };
}

async function getShopUrlSafe(): Promise<string> {
  try {
    return await getConsultantShopUrl();
  } catch {
    return "https://bovi.kz";
  }
}

async function track(
  userKey: string | undefined,
  kind: import("./analytics").ConsultantEventKind,
  text: string,
  bucket: string,
) {
  if (!userKey) return;
  await recordConsultantEvent({ userKey, kind, text, bucket }).catch(() => {});
}
