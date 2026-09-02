import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { Checkbox } from "@/components-ui/checkbox";
import {
  getInstagramConnectUrlFn,
  getInstagramAccountsFn,
  getInstagramAccountHealthFn,
  getInstagramDirectBotSettingsFn,
  saveInstagramDirectBotSettingsFn,
  getInstagramDirectBotScriptFn,
  saveInstagramDirectBotScriptFn,
  getInstagramDirectBotFeaturesFn,
  saveInstagramDirectBotFeaturesFn,
  getInstagramConversationsFn,
  getInstagramConversationMessagesFn,
  sendInstagramConversationMessageFn,
  getInstagramDashboardFn,
  registerInstagramWebhookFn,
  getAutomationsFn,
  saveAutomationFn,
  deleteAutomationFn,
  toggleAutomationFn,
  getInstagramLogsFn,
  getZernioPostsFn,
  syncZernioPostByUrlFn,
  disconnectInstagramAccountFn,
  createInstagramPostFn,
  cancelInstagramPostFn,
  retryInstagramPostFn,
  getInstagramContactProfilesFn,
  getInstagramDirectBotScopeFn,
  saveInstagramDirectBotScopeFn,
  getInstagramDirectBotTriggersFn,
  saveInstagramDirectBotTriggersFn,
} from "@/lib/instagram.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components-ui/select";
import {
  ImageIcon,
  Link2,
  CheckCircle2,
  XCircle,
  X,
  Settings2,
  MessageSquare,
  Zap,
  Plus,
  RefreshCcw,
  Trash2,
  Play,
  Pause,
  ExternalLink,
  History,
  Eye,
  Info,
  CalendarClock,
  BarChart3,
  Bot,
  Inbox,
  UserCircle2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components-ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components-ui/card";
import { Badge } from "@/components-ui/badge";
import type { ZernioDmButton, ZernioCommentAutomation } from "@/lib/zernio.server";
import type { Json } from "@/integrations-supabase/types";
import { useAdminLocale } from "@/lib/admin-locale";
import { useVertical } from "@/lib/verticals/use-vertical";
import type { Locale } from "@/lib/i18n";

/** Безопасно достать строковое поле из Json-объекта (payload лога — Json, а не типизированная форма). */
function jsonString(payload: Json, key: string): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

const dateLocales: Record<Locale, string> = {
  ru: "ru-RU",
  kk: "kk-KZ",
  en: "en-US",
  uz: "uz-UZ",
};

const FEATURE_KEYS: Array<"catalog" | "search" | "cart" | "checkout"> = [
  "catalog",
  "search",
  "cart",
  "checkout",
];

const copy: Record<
  Locale,
  {
    featureLabels: Record<"catalog" | "search" | "cart" | "checkout", string>;
    heading: string;
    headingSubtitle: string;
    updateWebhookBtn: string;
    connectAccountBtn: string;
    tabDirectBot: string;
    tabAutomations: string;
    tabPublish: string;
    tabLogs: string;
    tabInbox: string;
    tabAnalytics: string;
    tabAccounts: string;
    directBotTitle: string;
    directBotDesc: string;
    statusStopped: string;
    statusEnabled: string;
    enableToggleHint: string;
    enableLabel: string;
    scopeLabel: string;
    scopePurchasesTitle: string;
    scopePurchasesDesc: string;
    scopeAllTitle: string;
    scopeAllDesc: string;
    scopeSelected: string;
    triggersLabel: string;
    triggersHint: string;
    triggersPlaceholder: string;
    save: string;
    triggersDefaultHint: string;
    scriptLabel: string;
    scriptPlaceholder: string;
    scriptHint: string;
    saveTextBtn: string;
    scenariosLabel: string;
    scenariosHint: string;
    ruleEditTitle: string;
    ruleNewTitle: string;
    ruleSubtitle: string;
    autoTitleLabel: string;
    autoTitlePlaceholder: string;
    triggerLabel: string;
    triggerComment: string;
    triggerStory: string;
    keywordsLabel: string;
    keywordsAllPlaceholder: string;
    keywordsPlaceholder: string;
    replyToAllLabel: string;
    replyToAllHint: string;
    targetStoryLabel: string;
    targetPostLabel: string;
    occupiedBy: (name: string) => string;
    refreshListBtn: string;
    selectObjectPlaceholder: string;
    anyStory: string;
    anyPost: string;
    noDate: string;
    storyNoText: string;
    noText: string;
    publicReplyLabel: string;
    publicReplyPlaceholder: string;
    variationsLabel: string;
    variationsPlaceholder: string;
    dmLabel: string;
    dmPlaceholder: string;
    dmPlaceholderPhysical: string;
    dmButtonsLabel: (n: number) => string;
    addBtn: string;
    buttonTextPlaceholder: string;
    buttonUrlType: string;
    buttonCmdType: string;
    buttonUrlPlaceholder: string;
    buttonCmdPlaceholder: string;
    linkTrackingLabel: string;
    activeLabel: string;
    saving: string;
    saveChangesBtn: string;
    createRuleBtn: string;
    cancelBtn: string;
    activeRulesTitle: (n: number) => string;
    noActiveRules: string;
    noActiveRulesHint: string;
    pausedBadge: string;
    storyBadge: string;
    clicksSuffix: string;
    replyAllBadge: string;
    keysLabel: string;
    keysAny: string;
    targetLabel: string;
    publishTitle: string;
    publishDesc: string;
    accountLabel: string;
    connectAccountHint: string;
    formatLabel: string;
    formatFeed: string;
    formatStory: string;
    mediaLabel: string;
    mediaImage: string;
    mediaVideo: string;
    mediaLinksLabel: string;
    mediaLinksHintVideo: string;
    mediaLinksHint: string;
    captionLabel: string;
    captionPlaceholder: string;
    scheduledForLabel: string;
    scheduledForHint: string;
    collaboratorsLabel: string;
    collaboratorsHint: string;
    firstCommentLabel: string;
    firstCommentPlaceholder: string;
    shareToFeedLabel: string;
    aiGeneratedLabel: string;
    publishingBtn: string;
    scheduleBtn: string;
    publishNowBtn: string;
    queueTitle: string;
    queueDesc: string;
    refreshBtn: string;
    loadingPosts: string;
    noPostsYet: string;
    noCaption: string;
    cancelPostBtn: string;
    retryPostBtn: string;
    directTitle: string;
    directDesc: string;
    noMessages: string;
    follower: string;
    notFollower: string;
    verified: string;
    followersSuffix: string;
    noConversationsYet: string;
    selectConversationHint: string;
    attachment: string;
    loadingShort: string;
    replyPlaceholder: string;
    sendBtn: string;
    analyticsTitle: string;
    analyticsSubtitle: string;
    calculating: string;
    statTriggered: string;
    statDmsSent: string;
    statLinkClicks: string;
    statIncomingDirect: string;
    statInstagramOrders: string;
    statPaidDelivered: string;
    statRevenue: string;
    statErrors: string;
    rulesTitle: string;
    activeRulesCount: (n: number) => string;
    analyticsHint: string;
    logsTitle: string;
    logsSubtitle: string;
    colTime: string;
    colEvent: string;
    colStatus: string;
    colAction: string;
    noLogsYet: string;
    accountRequiresReconnect: string;
    accountActive: string;
    accountIdLabel: string;
    platformLabel: string;
    integrationProfileLabel: string;
    readinessLabel: string;
    checking: string;
    noData: string;
    postsAvailable: string;
    postsUnavailable: string;
    analyticsAvailable: string;
    analyticsUnavailable: string;
    publicationsColon: string;
    analyticsColon: string;
    disconnecting: string;
    disconnectBtn: string;
    noAccountsConnected: string;
    dialogFallback: string;
    sendErrorFallback: string;
    directBotEnabledMsg: string;
    directBotDisabledMsg: string;
    directBotSettingsError: (msg: string) => string;
    directBotScriptSaved: string;
    directBotScriptSaveError: (msg: string) => string;
    scopePurchasesMsg: string;
    scopeAllMsg: string;
    scopeSaveError: (msg: string) => string;
    triggersSaved: (words: string) => string;
    triggersSaveError: (msg: string) => string;
    postCancelConfirm: string;
    postActionError: string;
    postCancelledMsg: string;
    postRetriedMsg: string;
    postActionErrorMsg: (msg: string) => string;
    disconnectConfirm: (name: string) => string;
    accountDisconnected: string;
    accountDisconnectFailed: string;
    accountDisconnectError: (msg: string) => string;
    connectAuthUrlOpened: string;
    connectAuthUrlError: string;
    connectError: (msg: string) => string;
    webhookUpdated: string;
    webhookError: (err: string) => string;
    webhookErrorFallback: string;
    webhookGenericError: (msg: string) => string;
    noAccountsFirst: string;
    addMediaLink: string;
    saveAutomationError: (msg: string) => string;
    duplicateAutomationError: string;
    genericAutomationError: string;
    deleteAutomationConfirm: string;
    deleteAutomationError: (msg: string) => string;
    toggleAutomationError: (msg: string) => string;
    buyBtnDefault: string;
    scheduledForMsg: (when: string) => string;
    sentForPublishingMsg: string;
    publicationMsg: (timing: string) => string;
    publishErrorMsg: (msg: string) => string;
  }
> = {
  ru: {
    featureLabels: {
      catalog: "Каталог",
      search: "Поиск товаров",
      cart: "Корзина",
      checkout: "Оформление заказа",
    },
    heading: "Instagram",
    headingSubtitle: "Автоответы на комментарии, продажи в Direct и публикации",
    updateWebhookBtn: "Обновить Webhook",
    connectAccountBtn: "Подключить аккаунт",
    tabDirectBot: "Автоответчик",
    tabAutomations: "Автоматизации",
    tabPublish: "Публикации",
    tabLogs: "Журнал",
    tabInbox: "Direct",
    tabAnalytics: "Аналитика",
    tabAccounts: "Аккаунты",
    directBotTitle: "Автоответчик в Direct",
    directBotDesc:
      "Отвечает на входящие сообщения: показывает каталог, ищет товары, ведёт корзину и оформление заказа. От правил «Комментарий → Direct» не зависит.",
    statusStopped: "Остановлен",
    statusEnabled: "Включён",
    enableToggleHint:
      "Выключение прекращает новые автоматические ответы, но не отключает ручную переписку и правила комментариев.",
    enableLabel: "Включить",
    scopeLabel: "На что отвечать",
    scopePurchasesTitle: "Только по заказам",
    scopePurchasesDesc:
      "Бот вступает, когда человек написал номер товара, и ведёт его до оплаты. Обычную переписку не трогает — вы отвечаете сами в Instagram, и непрочитанные остаются непрочитанными.",
    scopeAllTitle: "На все сообщения",
    scopeAllDesc:
      "Бот отвечает и на обычные вопросы, а вам присылает уведомление. Учтите: отвечая, он помечает переписку прочитанной — в Instagram вы больше не увидите, что вам написали.",
    scopeSelected: "выбрано",
    triggersLabel: "Команды, которыми покупатель зовёт бота",
    triggersHint:
      "Через запятую. Сравнение идёт с сообщением целиком: «Каталог» бота позовёт, а «а каталог у вас есть?» — нет, это вопрос к вам. Такое слово удобно писать в публикации: «напишите КАТАЛОГ в директ». Номер товара работает всегда, отдельной команды для него не нужно.",
    triggersPlaceholder: "заказать, купить, магазин, каталог",
    save: "Сохранить",
    triggersDefaultHint: "Сейчас используются значения по умолчанию.",
    scriptLabel: "Ответ на короткое или непонятное сообщение",
    scriptPlaceholder: "Оставьте пустым, чтобы использовать стандартное приветствие и каталог.",
    scriptHint: "Этот текст не заменяет поиск товаров, корзину и оформление заказа.",
    saveTextBtn: "Сохранить текст",
    scenariosLabel: "Сценарии",
    scenariosHint:
      "Товары берутся из активного каталога этого клиента: название, описание и ключевые слова.",
    ruleEditTitle: "Редактировать правило",
    ruleNewTitle: "Новая автоматизация",
    ruleSubtitle: "Что должно сработать и что ответить в Direct",
    autoTitleLabel: "Название",
    autoTitlePlaceholder: "Например: рассылка чек-листа",
    triggerLabel: "Триггер",
    triggerComment: "💬 Комментарий",
    triggerStory: "📱 Ответ на Story",
    keywordsLabel: "Ключевые слова",
    keywordsAllPlaceholder: "Отвечает на все",
    keywordsPlaceholder: "хочу, инфо, +",
    replyToAllLabel: "Отвечать на все комментарии (без ключевых слов)",
    replyToAllHint: "Доступно только при выборе конкретного поста",
    targetStoryLabel: "Целевая Story",
    targetPostLabel: "Целевой пост",
    occupiedBy: (name) => `⚠️ Занят: "${name}"`,
    refreshListBtn: "Обновить список",
    selectObjectPlaceholder: "Выберите объект",
    anyStory: "✨ Любая Story",
    anyPost: "✨ Любой пост",
    noDate: "Нет даты",
    storyNoText: "Story без текста",
    noText: "Без текста",
    publicReplyLabel: "Публичный ответ",
    publicReplyPlaceholder: "Ответили вам в Директ! 📩",
    variationsLabel: "Вариации против однотипных ответов:",
    variationsPlaceholder: "Одна вариация на строку",
    dmLabel: "Личное сообщение (DM)",
    dmPlaceholder: "Привет! Вот ссылка на материал...",
    dmPlaceholderPhysical: "Привет! Каталог тортов в боте — напишите, какую дату и вкус хотите.",
    dmButtonsLabel: (n) => `Кнопки в DM (${n}/3)`,
    addBtn: "+ Добавить",
    buttonTextPlaceholder: "Текст",
    buttonUrlType: "🔗 URL",
    buttonCmdType: "🤖 CMD",
    buttonUrlPlaceholder: "https://...",
    buttonCmdPlaceholder: "Команда, например BUY_NOW",
    linkTrackingLabel: "Трекинг ссылок",
    activeLabel: "Активно",
    saving: "Сохранение...",
    saveChangesBtn: "Сохранить изменения",
    createRuleBtn: "Создать автоматизацию",
    cancelBtn: "Отмена",
    activeRulesTitle: (n) => `Активные правила (${n})`,
    noActiveRules: "Нет активных автоматизаций",
    noActiveRulesHint: "Создайте свое первое правило в панели слева",
    pausedBadge: "Пауза",
    storyBadge: "Story",
    clicksSuffix: "кликов",
    replyAllBadge: "Отвечать всем",
    keysLabel: "Ключи:",
    keysAny: "Любые",
    targetLabel: "Target:",
    publishTitle: "Публикация и планировщик",
    publishDesc:
      "Feed, Reels, Stories и карусели входят в Instagram-автоматизацию. Для публикации нужны прямые публичные ссылки на файлы.",
    accountLabel: "Аккаунт",
    connectAccountHint: "Подключите Instagram-аккаунт во вкладке «Аккаунты»",
    formatLabel: "Формат",
    formatFeed: "Feed / Reel / карусель",
    formatStory: "Story",
    mediaLabel: "Медиа",
    mediaImage: "Изображение",
    mediaVideo: "Видео (публикуется как Reel)",
    mediaLinksLabel: "Прямые ссылки на медиа",
    mediaLinksHintVideo: "https://cdn.example.com/reel.mp4",
    mediaLinksHint: "https://cdn.example.com/photo-1.jpg\nhttps://cdn.example.com/photo-2.jpg",
    captionLabel: "Подпись",
    captionPlaceholder: "Текст публикации и хэштеги",
    scheduledForLabel: "Время публикации",
    scheduledForHint: "Оставьте пустым, чтобы опубликовать сейчас.",
    collaboratorsLabel: "Соавторы",
    collaboratorsHint: "До трёх публичных Business/Creator аккаунтов.",
    firstCommentLabel: "Первый комментарий",
    firstCommentPlaceholder: "Ссылка или дополнительная информация",
    shareToFeedLabel: "Показывать Reel и в основной ленте",
    aiGeneratedLabel: "Контент создан ИИ",
    publishingBtn: "Отправляем…",
    scheduleBtn: "Запланировать публикацию",
    publishNowBtn: "Опубликовать сейчас",
    queueTitle: "Очередь публикаций",
    queueDesc: "Запланированные, опубликованные и неудачные посты.",
    refreshBtn: "Обновить",
    loadingPosts: "Загружаем публикации…",
    noPostsYet: "Публикаций пока нет.",
    noCaption: "Публикация без подписи",
    cancelPostBtn: "Отменить",
    retryPostBtn: "Повторить",
    directTitle: "Instagram Direct",
    directDesc: "Диалоги подключённого аккаунта.",
    noMessages: "Нет сообщений",
    follower: "Подписчик",
    notFollower: "Не подписан",
    verified: "Верифицирован",
    followersSuffix: "подписчиков",
    noConversationsYet: "Диалогов пока нет.",
    selectConversationHint: "Выберите диалог слева.",
    attachment: "Вложение",
    loadingShort: "Загрузка…",
    replyPlaceholder: "Напишите ответ…",
    sendBtn: "Отправить",
    analyticsTitle: "Instagram за 30 дней",
    analyticsSubtitle: "Автоматизации, Direct и оплаченные заказы.",
    calculating: "Считаем показатели…",
    statTriggered: "Срабатывания",
    statDmsSent: "Отправлено DM",
    statLinkClicks: "Клики по ссылкам",
    statIncomingDirect: "Входящие Direct",
    statInstagramOrders: "Instagram-заказы",
    statPaidDelivered: "Оплачено / выдано",
    statRevenue: "Выручка",
    statErrors: "Ошибки обработки",
    rulesTitle: "Правила автоматизации",
    activeRulesCount: (n) => `Активных правил: ${n}`,
    analyticsHint:
      "Показатели считаются по данным Instagram; продажи — по заказам, созданным из Instagram Direct.",
    logsTitle: "Журнал событий",
    logsSubtitle: "Последние действия автоматизации",
    colTime: "Время",
    colEvent: "Событие",
    colStatus: "Статус",
    colAction: "Действие",
    noLogsYet: "Логов пока нет",
    accountRequiresReconnect: "Требуется переподключение",
    accountActive: "Активен",
    accountIdLabel: "ID:",
    platformLabel: "Платформа",
    integrationProfileLabel: "Профиль интеграции",
    readinessLabel: "Готовность подключения",
    checking: "Проверяем…",
    noData: "нет данных",
    postsAvailable: "доступны",
    postsUnavailable: "недоступны",
    analyticsAvailable: "доступна",
    analyticsUnavailable: "недоступна",
    publicationsColon: "Публикации:",
    analyticsColon: "аналитика:",
    disconnecting: "Отключение...",
    disconnectBtn: "🔓 Отключить аккаунт",
    noAccountsConnected: "Нет подключенных аккаунтов",
    dialogFallback: "Диалог",
    sendErrorFallback: "Не удалось отправить сообщение. Повторите попытку.",
    directBotEnabledMsg: "✅ Автоответчик Direct включён.",
    directBotDisabledMsg: "✅ Автоответчик Direct остановлен.",
    directBotSettingsError: (msg) => `Ошибка настройки автоответчика: ${msg}`,
    directBotScriptSaved: "✅ Текст автоответчика сохранён.",
    directBotScriptSaveError: (msg) => `Ошибка сохранения: ${msg}`,
    scopePurchasesMsg:
      "✅ Бот теперь отвечает только по заказам. Обычную переписку он не трогает — непрочитанные остаются непрочитанными в Instagram.",
    scopeAllMsg:
      "✅ Бот отвечает и на обычные вопросы. Учтите: отвечая, он помечает переписку прочитанной в Instagram.",
    scopeSaveError: (msg) => `Ошибка настройки: ${msg}`,
    triggersSaved: (words) => `✅ Команды сохранены: ${words}`,
    triggersSaveError: (msg) => `Ошибка сохранения команд: ${msg}`,
    postCancelConfirm: "Отменить эту запланированную публикацию?",
    postActionError: "Сервис публикаций не выполнил действие.",
    postCancelledMsg: "✅ Публикация отменена.",
    postRetriedMsg: "✅ Повторная публикация поставлена в очередь.",
    postActionErrorMsg: (msg) => `Ошибка: ${msg}`,
    disconnectConfirm: (name) =>
      `Отключить аккаунт "${name}"? Все автоматизации для этого аккаунта перестанут работать.`,
    accountDisconnected: "✅ Аккаунт успешно отключён.",
    accountDisconnectFailed: "❌ Не удалось отключить аккаунт.",
    accountDisconnectError: (msg) => `Ошибка отключения: ${msg}`,
    connectAuthUrlOpened: "Ссылка авторизации открыта в новой вкладке.",
    connectAuthUrlError: "Ошибка: не удалось получить ссылку авторизации.",
    connectError: (msg) => `Ошибка подключения: ${msg}`,
    webhookUpdated: "✅ Соединение успешно обновлено!",
    webhookError: (err) => `❌ Ошибка при обновлении соединения: ${err}`,
    webhookErrorFallback: "Не удалось сохранить настройки webhook.",
    webhookGenericError: (msg) => `Ошибка: ${msg}`,
    noAccountsFirst: "Сначала подключите аккаунт Instagram.",
    addMediaLink: "Добавьте хотя бы одну прямую ссылку на изображение или видео.",
    saveAutomationError: (msg) => `Ошибка сохранения: ${msg}`,
    duplicateAutomationError:
      "Для этого поста уже есть активная автоматизация. Отредактируйте существующую или удалите её перед созданием новой.",
    genericAutomationError: "Сервис автоматизации отклонил создание правила.",
    deleteAutomationConfirm: "Удалить эту автоматизацию?",
    deleteAutomationError: (msg) => `Ошибка удаления: ${msg}`,
    toggleAutomationError: (msg) => `Ошибка переключения: ${msg}`,
    buyBtnDefault: "Купить",
    scheduledForMsg: (when) => ` запланирована на ${when}`,
    sentForPublishingMsg: " отправлена на публикацию",
    publicationMsg: (timing) => `✅ Публикация${timing}.`,
    publishErrorMsg: (msg) => `Ошибка публикации: ${msg}`,
  },
  kk: {
    featureLabels: {
      catalog: "Каталог",
      search: "Тауарларды іздеу",
      cart: "Себет",
      checkout: "Тапсырысты рәсімдеу",
    },
    heading: "Instagram",
    headingSubtitle: "Пікірлерге автожауап, Direct-те сату және жариялау",
    updateWebhookBtn: "Webhook жаңарту",
    connectAccountBtn: "Аккаунт қосу",
    tabDirectBot: "Автожауап беруші",
    tabAutomations: "Автоматизациялар",
    tabPublish: "Жарияланымдар",
    tabLogs: "Журнал",
    tabInbox: "Direct",
    tabAnalytics: "Аналитика",
    tabAccounts: "Аккаунттар",
    directBotTitle: "Direct-тегі автожауап беруші",
    directBotDesc:
      "Кіріс хабарламаларға жауап береді: каталогты көрсетеді, тауарларды іздейді, себет пен тапсырысты рәсімдеуді жүргізеді. «Пікір → Direct» ережелеріне тәуелді емес.",
    statusStopped: "Тоқтатылды",
    statusEnabled: "Қосулы",
    enableToggleHint:
      "Өшіру жаңа автоматты жауаптарды тоқтатады, бірақ қолмен хат алмасу мен пікір ережелерін өшірмейді.",
    enableLabel: "Қосу",
    scopeLabel: "Неге жауап беру керек",
    scopePurchasesTitle: "Тек тапсырыстар бойынша",
    scopePurchasesDesc:
      "Адам тауар нөмірін жазғанда бот араласады және оны төлемге дейін жеткізеді. Әдеттегі хат алмасуды бот тимейді — сіз Instagram-да өзіңіз жауап бересіз, оқылмағандар оқылмаған күйінде қалады.",
    scopeAllTitle: "Барлық хабарламаларға",
    scopeAllDesc:
      "Бот әдеттегі сұрақтарға да жауап береді, ал сізге хабарлама жібереді. Ескеріңіз: жауап бере отырып, ол хат алмасуды оқылған деп белгілейді — Instagram-да сізге не жазылғанын енді көрмейсіз.",
    scopeSelected: "таңдалды",
    triggersLabel: "Сатып алушы ботты шақыратын командалар",
    triggersHint:
      "Үтірмен бөлінеді. Салыстыру хабарламаның бүтінімен жүреді: «Каталог» ботты шақырады, ал «каталогыңыз бар ма?» — жоқ, бұл сізге қойылған сұрақ. Мұндай сөзді жарияланымда жазу ыңғайлы: «директке КАТАЛОГ деп жазыңыз». Тауар нөмірі әрқашан жұмыс істейді, оған бөлек команда керек емес.",
    triggersPlaceholder: "тапсырыс беру, сатып алу, дүкен, каталог",
    save: "Сақтау",
    triggersDefaultHint: "Қазір әдепкі мәндер қолданылуда.",
    scriptLabel: "Қысқа немесе түсініксіз хабарламаға жауап",
    scriptPlaceholder: "Стандартты сәлемдесу мен каталогты пайдалану үшін бос қалдырыңыз.",
    scriptHint: "Бұл мәтін тауарларды іздеуді, себетті және тапсырысты рәсімдеуді алмастырмайды.",
    saveTextBtn: "Мәтінді сақтау",
    scenariosLabel: "Сценарийлер",
    scenariosHint:
      "Тауарлар осы клиенттің белсенді каталогынан алынады: атауы, сипаттамасы және кілт сөздер.",
    ruleEditTitle: "Ережені өңдеу",
    ruleNewTitle: "Жаңа автоматизация",
    ruleSubtitle: "Не іске қосылу керек және Direct-те не жауап беру керек",
    autoTitleLabel: "Атауы",
    autoTitlePlaceholder: "Мысалы: чек-лист таратылымы",
    triggerLabel: "Триггер",
    triggerComment: "💬 Пікір",
    triggerStory: "📱 Story-ге жауап",
    keywordsLabel: "Кілт сөздер",
    keywordsAllPlaceholder: "Барлығына жауап береді",
    keywordsPlaceholder: "керек, ақпарат, +",
    replyToAllLabel: "Барлық пікірлерге жауап беру (кілт сөздерсіз)",
    replyToAllHint: "Тек нақты постты таңдаған кезде қолжетімді",
    targetStoryLabel: "Мақсатты Story",
    targetPostLabel: "Мақсатты пост",
    occupiedBy: (name) => `⚠️ Бос емес: "${name}"`,
    refreshListBtn: "Тізімді жаңарту",
    selectObjectPlaceholder: "Объектіні таңдаңыз",
    anyStory: "✨ Кез келген Story",
    anyPost: "✨ Кез келген пост",
    noDate: "Күні жоқ",
    storyNoText: "Мәтінсіз Story",
    noText: "Мәтінсіз",
    publicReplyLabel: "Жария жауап",
    publicReplyPlaceholder: "Сізге Директте жауап берілді! 📩",
    variationsLabel: "Бір тектес жауаптарға қарсы вариациялар:",
    variationsPlaceholder: "Жолға бір вариация",
    dmLabel: "Жеке хабарлама (DM)",
    dmPlaceholder: "Сәлем! Материалға сілтеме мына жерде...",
    dmPlaceholderPhysical: "Сәлем! Торт каталогы ботта — күн мен дәмін жазыңыз.",
    dmButtonsLabel: (n) => `DM-дегі түймелер (${n}/3)`,
    addBtn: "+ Қосу",
    buttonTextPlaceholder: "Мәтін",
    buttonUrlType: "🔗 URL",
    buttonCmdType: "🤖 CMD",
    buttonUrlPlaceholder: "https://...",
    buttonCmdPlaceholder: "Команда, мысалы BUY_NOW",
    linkTrackingLabel: "Сілтемелерді бақылау",
    activeLabel: "Белсенді",
    saving: "Сақталуда...",
    saveChangesBtn: "Өзгерістерді сақтау",
    createRuleBtn: "Автоматизация құру",
    cancelBtn: "Бас тарту",
    activeRulesTitle: (n) => `Белсенді ережелер (${n})`,
    noActiveRules: "Белсенді автоматизациялар жоқ",
    noActiveRulesHint: "Сол жақтағы панельде алғашқы ережеңізді жасаңыз",
    pausedBadge: "Кідірту",
    storyBadge: "Story",
    clicksSuffix: "клик",
    replyAllBadge: "Барлығына жауап беру",
    keysLabel: "Кілттер:",
    keysAny: "Кез келген",
    targetLabel: "Мақсат:",
    publishTitle: "Жариялау және жоспарлаушы",
    publishDesc:
      "Feed, Reels, Stories және каруселдер Instagram автоматизациясына кіреді. Жариялау үшін файлдарға тікелей жария сілтемелер қажет.",
    accountLabel: "Аккаунт",
    connectAccountHint: "«Аккаунттар» бөлімінде Instagram аккаунтын қосыңыз",
    formatLabel: "Формат",
    formatFeed: "Feed / Reel / карусель",
    formatStory: "Story",
    mediaLabel: "Медиа",
    mediaImage: "Сурет",
    mediaVideo: "Видео (Reel ретінде жарияланады)",
    mediaLinksLabel: "Медиаға тікелей сілтемелер",
    mediaLinksHintVideo: "https://cdn.example.com/reel.mp4",
    mediaLinksHint: "https://cdn.example.com/photo-1.jpg\nhttps://cdn.example.com/photo-2.jpg",
    captionLabel: "Қолтаңба",
    captionPlaceholder: "Жарияланым мәтіні мен хэштегтер",
    scheduledForLabel: "Жариялау уақыты",
    scheduledForHint: "Қазір жариялау үшін бос қалдырыңыз.",
    collaboratorsLabel: "Тең авторлар",
    collaboratorsHint: "Үш жария Business/Creator аккаунтқа дейін.",
    firstCommentLabel: "Бірінші пікір",
    firstCommentPlaceholder: "Сілтеме немесе қосымша ақпарат",
    shareToFeedLabel: "Reel-ді негізгі лентада да көрсету",
    aiGeneratedLabel: "Контент ЖИ-мен жасалған",
    publishingBtn: "Жіберілуде…",
    scheduleBtn: "Жариялауды жоспарлау",
    publishNowBtn: "Қазір жариялау",
    queueTitle: "Жариялау кезегі",
    queueDesc: "Жоспарланған, жарияланған және сәтсіз посттар.",
    refreshBtn: "Жаңарту",
    loadingPosts: "Жарияланымдар жүктелуде…",
    noPostsYet: "Жарияланымдар әзірге жоқ.",
    noCaption: "Қолтаңбасыз жарияланым",
    cancelPostBtn: "Болдырмау",
    retryPostBtn: "Қайталау",
    directTitle: "Instagram Direct",
    directDesc: "Қосылған аккаунттың диалогтары.",
    noMessages: "Хабарламалар жоқ",
    follower: "Жазылушы",
    notFollower: "Жазылмаған",
    verified: "Верификацияланған",
    followersSuffix: "жазылушы",
    noConversationsYet: "Диалогтар әзірге жоқ.",
    selectConversationHint: "Сол жақтан диалог таңдаңыз.",
    attachment: "Тіркеме",
    loadingShort: "Жүктелуде…",
    replyPlaceholder: "Жауап жазыңыз…",
    sendBtn: "Жіберу",
    analyticsTitle: "30 күндегі Instagram",
    analyticsSubtitle: "Автоматизациялар, Direct және төленген тапсырыстар.",
    calculating: "Көрсеткіштер есептелуде…",
    statTriggered: "Іске қосылулар",
    statDmsSent: "DM жіберілді",
    statLinkClicks: "Сілтемелер бойынша кликтер",
    statIncomingDirect: "Кіріс Direct",
    statInstagramOrders: "Instagram тапсырыстары",
    statPaidDelivered: "Төленді / берілді",
    statRevenue: "Табыс",
    statErrors: "Өңдеу қателері",
    rulesTitle: "Автоматизация ережелері",
    activeRulesCount: (n) => `Белсенді ережелер: ${n}`,
    analyticsHint:
      "Көрсеткіштер Instagram деректері бойынша есептеледі; сатылымдар — Instagram Direct-тен жасалған тапсырыстар бойынша.",
    logsTitle: "Оқиғалар журналы",
    logsSubtitle: "Автоматизацияның соңғы әрекеттері",
    colTime: "Уақыты",
    colEvent: "Оқиға",
    colStatus: "Мәртебесі",
    colAction: "Әрекет",
    noLogsYet: "Логтар әзірге жоқ",
    accountRequiresReconnect: "Қайта қосу қажет",
    accountActive: "Белсенді",
    accountIdLabel: "ID:",
    platformLabel: "Платформа",
    integrationProfileLabel: "Интеграция профилі",
    readinessLabel: "Қосылу дайындығы",
    checking: "Тексерілуде…",
    noData: "деректер жоқ",
    postsAvailable: "қолжетімді",
    postsUnavailable: "қолжетімсіз",
    analyticsAvailable: "қолжетімді",
    analyticsUnavailable: "қолжетімсіз",
    publicationsColon: "Жарияланымдар:",
    analyticsColon: "аналитика:",
    disconnecting: "Ажыратылуда...",
    disconnectBtn: "🔓 Аккаунтты ажырату",
    noAccountsConnected: "Қосылған аккаунттар жоқ",
    dialogFallback: "Диалог",
    sendErrorFallback: "Хабарлама жіберілмеді. Қайта көріңіз.",
    directBotEnabledMsg: "✅ Direct автожауап беруші қосылды.",
    directBotDisabledMsg: "✅ Direct автожауап беруші тоқтатылды.",
    directBotSettingsError: (msg) => `Автожауап берушіні баптау қатесі: ${msg}`,
    directBotScriptSaved: "✅ Автожауап беруші мәтіні сақталды.",
    directBotScriptSaveError: (msg) => `Сақтау қатесі: ${msg}`,
    scopePurchasesMsg:
      "✅ Бот енді тек тапсырыстар бойынша жауап береді. Әдеттегі хат алмасуды тимейді — Instagram-да оқылмағандар оқылмаған күйінде қалады.",
    scopeAllMsg:
      "✅ Бот әдеттегі сұрақтарға да жауап береді. Ескеріңіз: жауап бере отырып, ол Instagram-да хат алмасуды оқылған деп белгілейді.",
    scopeSaveError: (msg) => `Баптау қатесі: ${msg}`,
    triggersSaved: (words) => `✅ Командалар сақталды: ${words}`,
    triggersSaveError: (msg) => `Командаларды сақтау қатесі: ${msg}`,
    postCancelConfirm: "Бұл жоспарланған жарияланымды болдырмау керек пе?",
    postActionError: "Жариялау қызметі әрекетті орындамады.",
    postCancelledMsg: "✅ Жарияланым болдырылмады.",
    postRetriedMsg: "✅ Қайта жариялау кезекке қойылды.",
    postActionErrorMsg: (msg) => `Қате: ${msg}`,
    disconnectConfirm: (name) =>
      `"${name}" аккаунтын ажырату керек пе? Осы аккаунттың барлық автоматизациялары жұмыс істемей қалады.`,
    accountDisconnected: "✅ Аккаунт сәтті ажыратылды.",
    accountDisconnectFailed: "❌ Аккаунтты ажырату мүмкін болмады.",
    accountDisconnectError: (msg) => `Ажырату қатесі: ${msg}`,
    connectAuthUrlOpened: "Авторизация сілтемесі жаңа қойындыда ашылды.",
    connectAuthUrlError: "Қате: авторизация сілтемесін алу мүмкін болмады.",
    connectError: (msg) => `Қосылу қатесі: ${msg}`,
    webhookUpdated: "✅ Байланыс сәтті жаңартылды!",
    webhookError: (err) => `❌ Байланысты жаңарту кезінде қате: ${err}`,
    webhookErrorFallback: "Webhook баптауларын сақтау мүмкін болмады.",
    webhookGenericError: (msg) => `Қате: ${msg}`,
    noAccountsFirst: "Алдымен Instagram аккаунтын қосыңыз.",
    addMediaLink: "Кемінде бір сурет немесе видеоға тікелей сілтеме қосыңыз.",
    saveAutomationError: (msg) => `Сақтау қатесі: ${msg}`,
    duplicateAutomationError:
      "Бұл пост үшін белсенді автоматизация бұрыннан бар. Жаңасын жасамас бұрын барды өңдеңіз немесе жойыңыз.",
    genericAutomationError: "Автоматизация қызметі ереже құруды қабылдамады.",
    deleteAutomationConfirm: "Бұл автоматизацияны жою керек пе?",
    deleteAutomationError: (msg) => `Жою қатесі: ${msg}`,
    toggleAutomationError: (msg) => `Ауыстыру қатесі: ${msg}`,
    buyBtnDefault: "Сатып алу",
    scheduledForMsg: (when) => ` ${when} жоспарланды`,
    sentForPublishingMsg: " жариялауға жіберілді",
    publicationMsg: (timing) => `✅ Жарияланым${timing}.`,
    publishErrorMsg: (msg) => `Жариялау қатесі: ${msg}`,
  },
  en: {
    featureLabels: {
      catalog: "Catalog",
      search: "Product search",
      cart: "Cart",
      checkout: "Checkout",
    },
    heading: "Instagram",
    headingSubtitle: "Auto-replies to comments, Direct sales, and publishing",
    updateWebhookBtn: "Update webhook",
    connectAccountBtn: "Connect account",
    tabDirectBot: "Auto-reply",
    tabAutomations: "Automations",
    tabPublish: "Publishing",
    tabLogs: "Log",
    tabInbox: "Direct",
    tabAnalytics: "Analytics",
    tabAccounts: "Accounts",
    directBotTitle: "Direct auto-reply",
    directBotDesc:
      'Replies to incoming messages: shows the catalog, searches products, drives the cart and checkout. Independent of the "Comment → Direct" rules.',
    statusStopped: "Stopped",
    statusEnabled: "Enabled",
    enableToggleHint:
      "Turning it off stops new automatic replies, but doesn't disable manual conversations or comment rules.",
    enableLabel: "Enable",
    scopeLabel: "What it replies to",
    scopePurchasesTitle: "Orders only",
    scopePurchasesDesc:
      "The bot steps in once a person writes a product number and carries them through to payment. It leaves regular conversations alone — you reply yourself in Instagram, and unread stays unread.",
    scopeAllTitle: "All messages",
    scopeAllDesc:
      "The bot also replies to regular questions and notifies you. Note: by replying it marks the conversation read — you'll no longer see in Instagram that you were messaged.",
    scopeSelected: "selected",
    triggersLabel: "Commands buyers use to call the bot",
    triggersHint:
      'Comma-separated. Matched against the whole message: "Catalog" calls the bot, but "do you have a catalog?" doesn\'t — that\'s a question for you. Handy to mention in posts: "send CATALOG to Direct". A product number always works, no separate command needed.',
    triggersPlaceholder: "order, buy, shop, catalog",
    save: "Save",
    triggersDefaultHint: "The default values are currently in use.",
    scriptLabel: "Reply to a short or unclear message",
    scriptPlaceholder: "Leave empty to use the standard greeting and catalog.",
    scriptHint: "This text doesn't replace product search, the cart, or checkout.",
    saveTextBtn: "Save text",
    scenariosLabel: "Scenarios",
    scenariosHint:
      "Products are pulled from this client's active catalog: name, description, and keywords.",
    ruleEditTitle: "Edit rule",
    ruleNewTitle: "New automation",
    ruleSubtitle: "What triggers it and what to reply in Direct",
    autoTitleLabel: "Name",
    autoTitlePlaceholder: "e.g. checklist giveaway",
    triggerLabel: "Trigger",
    triggerComment: "💬 Comment",
    triggerStory: "📱 Story reply",
    keywordsLabel: "Keywords",
    keywordsAllPlaceholder: "Replies to all",
    keywordsPlaceholder: "want, info, +",
    replyToAllLabel: "Reply to all comments (no keywords)",
    replyToAllHint: "Only available when a specific post is selected",
    targetStoryLabel: "Target story",
    targetPostLabel: "Target post",
    occupiedBy: (name) => `⚠️ Taken: "${name}"`,
    refreshListBtn: "Refresh list",
    selectObjectPlaceholder: "Choose an item",
    anyStory: "✨ Any story",
    anyPost: "✨ Any post",
    noDate: "No date",
    storyNoText: "Story with no text",
    noText: "No text",
    publicReplyLabel: "Public reply",
    publicReplyPlaceholder: "We replied to you in Direct! 📩",
    variationsLabel: "Variations to avoid repetitive replies:",
    variationsPlaceholder: "One variation per line",
    dmLabel: "Direct message (DM)",
    dmPlaceholder: "Hi! Here's the link to the material...",
    dmPlaceholderPhysical:
      "Hi! Cake catalog is in the bot — tell us the date and flavour you want.",
    dmButtonsLabel: (n) => `Buttons in DM (${n}/3)`,
    addBtn: "+ Add",
    buttonTextPlaceholder: "Text",
    buttonUrlType: "🔗 URL",
    buttonCmdType: "🤖 CMD",
    buttonUrlPlaceholder: "https://...",
    buttonCmdPlaceholder: "Command, e.g. BUY_NOW",
    linkTrackingLabel: "Link tracking",
    activeLabel: "Active",
    saving: "Saving...",
    saveChangesBtn: "Save changes",
    createRuleBtn: "Create automation",
    cancelBtn: "Cancel",
    activeRulesTitle: (n) => `Active rules (${n})`,
    noActiveRules: "No active automations",
    noActiveRulesHint: "Create your first rule on the panel to the left",
    pausedBadge: "Paused",
    storyBadge: "Story",
    clicksSuffix: "clicks",
    replyAllBadge: "Reply to everyone",
    keysLabel: "Keys:",
    keysAny: "Any",
    targetLabel: "Target:",
    publishTitle: "Publishing and scheduler",
    publishDesc:
      "Feed, Reels, Stories, and carousels are part of Instagram automation. Publishing needs direct public links to the files.",
    accountLabel: "Account",
    connectAccountHint: 'Connect an Instagram account in the "Accounts" tab',
    formatLabel: "Format",
    formatFeed: "Feed / Reel / carousel",
    formatStory: "Story",
    mediaLabel: "Media",
    mediaImage: "Image",
    mediaVideo: "Video (published as a Reel)",
    mediaLinksLabel: "Direct media links",
    mediaLinksHintVideo: "https://cdn.example.com/reel.mp4",
    mediaLinksHint: "https://cdn.example.com/photo-1.jpg\nhttps://cdn.example.com/photo-2.jpg",
    captionLabel: "Caption",
    captionPlaceholder: "Post text and hashtags",
    scheduledForLabel: "Publish time",
    scheduledForHint: "Leave empty to publish now.",
    collaboratorsLabel: "Collaborators",
    collaboratorsHint: "Up to three public Business/Creator accounts.",
    firstCommentLabel: "First comment",
    firstCommentPlaceholder: "A link or extra information",
    shareToFeedLabel: "Also show the Reel in the main feed",
    aiGeneratedLabel: "AI-generated content",
    publishingBtn: "Sending…",
    scheduleBtn: "Schedule publication",
    publishNowBtn: "Publish now",
    queueTitle: "Publishing queue",
    queueDesc: "Scheduled, published, and failed posts.",
    refreshBtn: "Refresh",
    loadingPosts: "Loading posts…",
    noPostsYet: "No posts yet.",
    noCaption: "Post with no caption",
    cancelPostBtn: "Cancel",
    retryPostBtn: "Retry",
    directTitle: "Instagram Direct",
    directDesc: "Conversations for the connected account.",
    noMessages: "No messages",
    follower: "Follower",
    notFollower: "Not a follower",
    verified: "Verified",
    followersSuffix: "followers",
    noConversationsYet: "No conversations yet.",
    selectConversationHint: "Select a conversation on the left.",
    attachment: "Attachment",
    loadingShort: "Loading…",
    replyPlaceholder: "Write a reply…",
    sendBtn: "Send",
    analyticsTitle: "Instagram over 30 days",
    analyticsSubtitle: "Automations, Direct, and paid orders.",
    calculating: "Crunching the numbers…",
    statTriggered: "Triggered",
    statDmsSent: "DMs sent",
    statLinkClicks: "Link clicks",
    statIncomingDirect: "Incoming Direct",
    statInstagramOrders: "Instagram orders",
    statPaidDelivered: "Paid / delivered",
    statRevenue: "Revenue",
    statErrors: "Processing errors",
    rulesTitle: "Automation rules",
    activeRulesCount: (n) => `Active rules: ${n}`,
    analyticsHint:
      "Metrics are computed from Instagram data; sales are based on orders created via Instagram Direct.",
    logsTitle: "Event log",
    logsSubtitle: "Recent automation activity",
    colTime: "Time",
    colEvent: "Event",
    colStatus: "Status",
    colAction: "Action",
    noLogsYet: "No log entries yet",
    accountRequiresReconnect: "Reconnection required",
    accountActive: "Active",
    accountIdLabel: "ID:",
    platformLabel: "Platform",
    integrationProfileLabel: "Integration profile",
    readinessLabel: "Connection readiness",
    checking: "Checking…",
    noData: "no data",
    postsAvailable: "available",
    postsUnavailable: "unavailable",
    analyticsAvailable: "available",
    analyticsUnavailable: "unavailable",
    publicationsColon: "Posting:",
    analyticsColon: "analytics:",
    disconnecting: "Disconnecting...",
    disconnectBtn: "🔓 Disconnect account",
    noAccountsConnected: "No accounts connected",
    dialogFallback: "Conversation",
    sendErrorFallback: "Failed to send the message. Try again.",
    directBotEnabledMsg: "✅ Direct auto-reply enabled.",
    directBotDisabledMsg: "✅ Direct auto-reply stopped.",
    directBotSettingsError: (msg) => `Auto-reply settings error: ${msg}`,
    directBotScriptSaved: "✅ Auto-reply text saved.",
    directBotScriptSaveError: (msg) => `Save error: ${msg}`,
    scopePurchasesMsg:
      "✅ The bot now replies to orders only. It leaves regular conversations alone — unread stays unread in Instagram.",
    scopeAllMsg:
      "✅ The bot also replies to regular questions. Note: by replying it marks the conversation read in Instagram.",
    scopeSaveError: (msg) => `Settings error: ${msg}`,
    triggersSaved: (words) => `✅ Commands saved: ${words}`,
    triggersSaveError: (msg) => `Failed to save commands: ${msg}`,
    postCancelConfirm: "Cancel this scheduled post?",
    postActionError: "The publishing service didn't perform the action.",
    postCancelledMsg: "✅ Post cancelled.",
    postRetriedMsg: "✅ Retry queued.",
    postActionErrorMsg: (msg) => `Error: ${msg}`,
    disconnectConfirm: (name) =>
      `Disconnect account "${name}"? All automations for this account will stop working.`,
    accountDisconnected: "✅ Account disconnected successfully.",
    accountDisconnectFailed: "❌ Failed to disconnect the account.",
    accountDisconnectError: (msg) => `Disconnect error: ${msg}`,
    connectAuthUrlOpened: "The authorization link opened in a new tab.",
    connectAuthUrlError: "Error: failed to get the authorization link.",
    connectError: (msg) => `Connection error: ${msg}`,
    webhookUpdated: "✅ Connection updated successfully!",
    webhookError: (err) => `❌ Error updating the connection: ${err}`,
    webhookErrorFallback: "Failed to save the webhook settings.",
    webhookGenericError: (msg) => `Error: ${msg}`,
    noAccountsFirst: "Connect an Instagram account first.",
    addMediaLink: "Add at least one direct link to an image or video.",
    saveAutomationError: (msg) => `Save error: ${msg}`,
    duplicateAutomationError:
      "This post already has an active automation. Edit the existing one or delete it before creating a new one.",
    genericAutomationError: "The automation service rejected creating the rule.",
    deleteAutomationConfirm: "Delete this automation?",
    deleteAutomationError: (msg) => `Delete error: ${msg}`,
    toggleAutomationError: (msg) => `Toggle error: ${msg}`,
    buyBtnDefault: "Buy",
    scheduledForMsg: (when) => ` scheduled for ${when}`,
    sentForPublishingMsg: " sent for publishing",
    publicationMsg: (timing) => `✅ Post${timing}.`,
    publishErrorMsg: (msg) => `Publishing error: ${msg}`,
  },
  uz: {
    featureLabels: {
      catalog: "Katalog",
      search: "Mahsulot qidiruvi",
      cart: "Savat",
      checkout: "Buyurtmani rasmiylashtirish",
    },
    heading: "Instagram",
    headingSubtitle: "Izohlarga avtojavob, Direct’da sotuv va nashr qilish",
    updateWebhookBtn: "Webhook’ni yangilash",
    connectAccountBtn: "Akkaunt ulash",
    tabDirectBot: "Avtojavob beruvchi",
    tabAutomations: "Avtomatlashtirishlar",
    tabPublish: "Nashrlar",
    tabLogs: "Jurnal",
    tabInbox: "Direct",
    tabAnalytics: "Analitika",
    tabAccounts: "Akkauntlar",
    directBotTitle: "Direct’dagi avtojavob beruvchi",
    directBotDesc:
      "Kiruvchi xabarlarga javob beradi: katalogni ko‘rsatadi, mahsulot qidiradi, savat va buyurtmani rasmiylashtirishni yuritadi. «Izoh → Direct» qoidalariga bog‘liq emas.",
    statusStopped: "To‘xtatilgan",
    statusEnabled: "Yoqilgan",
    enableToggleHint:
      "O‘chirish yangi avtomatik javoblarni to‘xtatadi, lekin qo‘lda yozishmalar va izoh qoidalarini o‘chirmaydi.",
    enableLabel: "Yoqish",
    scopeLabel: "Nimaga javob berish kerak",
    scopePurchasesTitle: "Faqat buyurtmalar bo‘yicha",
    scopePurchasesDesc:
      "Odam mahsulot raqamini yozganda bot ishga tushadi va uni to‘lovgacha olib boradi. Oddiy yozishmani tegmaydi — siz Instagram’da o‘zingiz javob berasiz, o‘qilmaganlar o‘qilmagan holicha qoladi.",
    scopeAllTitle: "Barcha xabarlarga",
    scopeAllDesc:
      "Bot oddiy savollarga ham javob beradi va sizga xabarnoma yuboradi. E’tibor bering: javob berayotganda u yozishmani o‘qilgan deb belgilaydi — Instagram’da sizga yozilganini endi ko‘rmaysiz.",
    scopeSelected: "tanlandi",
    triggersLabel: "Xaridor botni chaqiradigan buyruqlar",
    triggersHint:
      "Vergul bilan. Solishtirish butun xabar bilan boradi: «Katalog» botni chaqiradi, lekin «katalogingiz bormi?» — yo‘q, bu sizga savol. Bunday so‘zni postda yozish qulay: «direktga KATALOG deb yozing». Mahsulot raqami har doim ishlaydi, u uchun alohida buyruq kerak emas.",
    triggersPlaceholder: "buyurtma berish, sotib olish, do‘kon, katalog",
    save: "Saqlash",
    triggersDefaultHint: "Hozir standart qiymatlar ishlatilmoqda.",
    scriptLabel: "Qisqa yoki tushunarsiz xabarga javob",
    scriptPlaceholder: "Standart salomlashuv va katalogdan foydalanish uchun bo‘sh qoldiring.",
    scriptHint: "Bu matn mahsulot qidiruvi, savat va buyurtmani rasmiylashtirishni almashtirmaydi.",
    saveTextBtn: "Matnni saqlash",
    scenariosLabel: "Ssenariylar",
    scenariosHint:
      "Mahsulotlar shu mijozning faol katalogidan olinadi: nomi, tavsifi va kalit so‘zlar.",
    ruleEditTitle: "Qoidani tahrirlash",
    ruleNewTitle: "Yangi avtomatlashtirish",
    ruleSubtitle: "Nima ishga tushishi va Direct’da nima javob berish kerak",
    autoTitleLabel: "Nomi",
    autoTitlePlaceholder: "Masalan: chek-list tarqatish",
    triggerLabel: "Trigger",
    triggerComment: "💬 Izoh",
    triggerStory: "📱 Story’ga javob",
    keywordsLabel: "Kalit so‘zlar",
    keywordsAllPlaceholder: "Barchasiga javob beradi",
    keywordsPlaceholder: "xohlayman, ma’lumot, +",
    replyToAllLabel: "Barcha izohlarga javob berish (kalit so‘zlarsiz)",
    replyToAllHint: "Faqat aniq post tanlangandagina mavjud",
    targetStoryLabel: "Maqsadli Story",
    targetPostLabel: "Maqsadli post",
    occupiedBy: (name) => `⚠️ Band: "${name}"`,
    refreshListBtn: "Ro‘yxatni yangilash",
    selectObjectPlaceholder: "Ob’ektni tanlang",
    anyStory: "✨ Har qanday Story",
    anyPost: "✨ Har qanday post",
    noDate: "Sana yo‘q",
    storyNoText: "Matnsiz Story",
    noText: "Matnsiz",
    publicReplyLabel: "Ochiq javob",
    publicReplyPlaceholder: "Sizga Direct’da javob berdik! 📩",
    variationsLabel: "Bir xil javoblarga qarshi variantlar:",
    variationsPlaceholder: "Har qatorga bitta variant",
    dmLabel: "Shaxsiy xabar (DM)",
    dmPlaceholder: "Salom! Material havolasi mana...",
    dmPlaceholderPhysical: "Salom! Tort katalogi botda — sana va ta’mni yozing.",
    dmButtonsLabel: (n) => `DM’dagi tugmalar (${n}/3)`,
    addBtn: "+ Qo‘shish",
    buttonTextPlaceholder: "Matn",
    buttonUrlType: "🔗 URL",
    buttonCmdType: "🤖 CMD",
    buttonUrlPlaceholder: "https://...",
    buttonCmdPlaceholder: "Buyruq, masalan BUY_NOW",
    linkTrackingLabel: "Havolalarni kuzatish",
    activeLabel: "Faol",
    saving: "Saqlanmoqda...",
    saveChangesBtn: "O‘zgarishlarni saqlash",
    createRuleBtn: "Avtomatlashtirish yaratish",
    cancelBtn: "Bekor qilish",
    activeRulesTitle: (n) => `Faol qoidalar (${n})`,
    noActiveRules: "Faol avtomatlashtirishlar yo‘q",
    noActiveRulesHint: "Chapdagi panelda birinchi qoidangizni yarating",
    pausedBadge: "Pauza",
    storyBadge: "Story",
    clicksSuffix: "klik",
    replyAllBadge: "Hammaga javob berish",
    keysLabel: "Kalitlar:",
    keysAny: "Har qanday",
    targetLabel: "Maqsad:",
    publishTitle: "Nashr va rejalashtiruvchi",
    publishDesc:
      "Feed, Reels, Stories va karusellar Instagram avtomatlashtirishiga kiradi. Nashr qilish uchun fayllarga to‘g‘ridan-to‘g‘ri ochiq havolalar kerak.",
    accountLabel: "Akkaunt",
    connectAccountHint: "«Akkauntlar» bo‘limida Instagram akkauntini ulang",
    formatLabel: "Format",
    formatFeed: "Feed / Reel / karusel",
    formatStory: "Story",
    mediaLabel: "Media",
    mediaImage: "Rasm",
    mediaVideo: "Video (Reel sifatida nashr qilinadi)",
    mediaLinksLabel: "Mediaga to‘g‘ridan-to‘g‘ri havolalar",
    mediaLinksHintVideo: "https://cdn.example.com/reel.mp4",
    mediaLinksHint: "https://cdn.example.com/photo-1.jpg\nhttps://cdn.example.com/photo-2.jpg",
    captionLabel: "Sarlavha",
    captionPlaceholder: "Post matni va xeshteglar",
    scheduledForLabel: "Nashr vaqti",
    scheduledForHint: "Hozir nashr qilish uchun bo‘sh qoldiring.",
    collaboratorsLabel: "Hammualliflar",
    collaboratorsHint: "Uchtagacha ochiq Business/Creator akkaunt.",
    firstCommentLabel: "Birinchi izoh",
    firstCommentPlaceholder: "Havola yoki qo‘shimcha ma’lumot",
    shareToFeedLabel: "Reel’ni asosiy lentada ham ko‘rsatish",
    aiGeneratedLabel: "Kontent AI tomonidan yaratilgan",
    publishingBtn: "Yuborilmoqda…",
    scheduleBtn: "Nashrni rejalashtirish",
    publishNowBtn: "Hozir nashr qilish",
    queueTitle: "Nashr navbati",
    queueDesc: "Rejalashtirilgan, nashr qilingan va muvaffaqiyatsiz postlar.",
    refreshBtn: "Yangilash",
    loadingPosts: "Postlar yuklanmoqda…",
    noPostsYet: "Hozircha postlar yo‘q.",
    noCaption: "Sarlavhasiz post",
    cancelPostBtn: "Bekor qilish",
    retryPostBtn: "Qayta urinish",
    directTitle: "Instagram Direct",
    directDesc: "Ulangan akkaunt suhbatlari.",
    noMessages: "Xabarlar yo‘q",
    follower: "Obunachi",
    notFollower: "Obuna bo‘lmagan",
    verified: "Tasdiqlangan",
    followersSuffix: "obunachi",
    noConversationsYet: "Hozircha suhbatlar yo‘q.",
    selectConversationHint: "Chapdan suhbatni tanlang.",
    attachment: "Biriktirma",
    loadingShort: "Yuklanmoqda…",
    replyPlaceholder: "Javob yozing…",
    sendBtn: "Yuborish",
    analyticsTitle: "30 kunlik Instagram",
    analyticsSubtitle: "Avtomatlashtirishlar, Direct va to‘langan buyurtmalar.",
    calculating: "Ko‘rsatkichlar hisoblanmoqda…",
    statTriggered: "Ishga tushishlar",
    statDmsSent: "DM yuborildi",
    statLinkClicks: "Havola bosishlari",
    statIncomingDirect: "Kiruvchi Direct",
    statInstagramOrders: "Instagram buyurtmalari",
    statPaidDelivered: "To‘landi / berildi",
    statRevenue: "Daromad",
    statErrors: "Qayta ishlash xatolari",
    rulesTitle: "Avtomatlashtirish qoidalari",
    activeRulesCount: (n) => `Faol qoidalar: ${n}`,
    analyticsHint:
      "Ko‘rsatkichlar Instagram ma’lumotlari bo‘yicha hisoblanadi; sotuvlar — Instagram Direct’dan yaratilgan buyurtmalar bo‘yicha.",
    logsTitle: "Voqealar jurnali",
    logsSubtitle: "Avtomatlashtirishning so‘nggi harakatlari",
    colTime: "Vaqt",
    colEvent: "Voqea",
    colStatus: "Holat",
    colAction: "Amal",
    noLogsYet: "Hozircha loglar yo‘q",
    accountRequiresReconnect: "Qayta ulash talab qilinadi",
    accountActive: "Faol",
    accountIdLabel: "ID:",
    platformLabel: "Platforma",
    integrationProfileLabel: "Integratsiya profili",
    readinessLabel: "Ulanish tayyorligi",
    checking: "Tekshirilmoqda…",
    noData: "ma’lumot yo‘q",
    postsAvailable: "mavjud",
    postsUnavailable: "mavjud emas",
    analyticsAvailable: "mavjud",
    analyticsUnavailable: "mavjud emas",
    publicationsColon: "Nashrlar:",
    analyticsColon: "analitika:",
    disconnecting: "Uzilmoqda...",
    disconnectBtn: "🔓 Akkauntni uzish",
    noAccountsConnected: "Ulangan akkauntlar yo‘q",
    dialogFallback: "Suhbat",
    sendErrorFallback: "Xabarni yuborib bo‘lmadi. Qayta urinib ko‘ring.",
    directBotEnabledMsg: "✅ Direct avtojavob beruvchi yoqildi.",
    directBotDisabledMsg: "✅ Direct avtojavob beruvchi to‘xtatildi.",
    directBotSettingsError: (msg) => `Avtojavob sozlash xatosi: ${msg}`,
    directBotScriptSaved: "✅ Avtojavob matni saqlandi.",
    directBotScriptSaveError: (msg) => `Saqlash xatosi: ${msg}`,
    scopePurchasesMsg:
      "✅ Bot endi faqat buyurtmalar bo‘yicha javob beradi. Oddiy yozishmani tegmaydi — Instagram’da o‘qilmaganlar o‘qilmagan holicha qoladi.",
    scopeAllMsg:
      "✅ Bot oddiy savollarga ham javob beradi. E’tibor bering: javob berayotganda u Instagram’da yozishmani o‘qilgan deb belgilaydi.",
    scopeSaveError: (msg) => `Sozlash xatosi: ${msg}`,
    triggersSaved: (words) => `✅ Buyruqlar saqlandi: ${words}`,
    triggersSaveError: (msg) => `Buyruqlarni saqlashda xato: ${msg}`,
    postCancelConfirm: "Ushbu rejalashtirilgan postni bekor qilasizmi?",
    postActionError: "Nashr xizmati amalni bajarmadi.",
    postCancelledMsg: "✅ Post bekor qilindi.",
    postRetriedMsg: "✅ Qayta nashr navbatga qo‘yildi.",
    postActionErrorMsg: (msg) => `Xato: ${msg}`,
    disconnectConfirm: (name) =>
      `"${name}" akkauntini uzasizmi? Ushbu akkaunt uchun barcha avtomatlashtirishlar ishlamay qoladi.`,
    accountDisconnected: "✅ Akkaunt muvaffaqiyatli uzildi.",
    accountDisconnectFailed: "❌ Akkauntni uzib bo‘lmadi.",
    accountDisconnectError: (msg) => `Uzish xatosi: ${msg}`,
    connectAuthUrlOpened: "Avtorizatsiya havolasi yangi bo‘limda ochildi.",
    connectAuthUrlError: "Xato: avtorizatsiya havolasini olib bo‘lmadi.",
    connectError: (msg) => `Ulanish xatosi: ${msg}`,
    webhookUpdated: "✅ Ulanish muvaffaqiyatli yangilandi!",
    webhookError: (err) => `❌ Ulanishni yangilashda xato: ${err}`,
    webhookErrorFallback: "Webhook sozlamalarini saqlab bo‘lmadi.",
    webhookGenericError: (msg) => `Xato: ${msg}`,
    noAccountsFirst: "Avval Instagram akkauntini ulang.",
    addMediaLink: "Kamida bitta rasm yoki videoga to‘g‘ridan-to‘g‘ri havola qo‘shing.",
    saveAutomationError: (msg) => `Saqlash xatosi: ${msg}`,
    duplicateAutomationError:
      "Bu post uchun allaqachon faol avtomatlashtirish bor. Yangisini yaratishdan oldin mavjudini tahrirlang yoki o‘chiring.",
    genericAutomationError: "Avtomatlashtirish xizmati qoida yaratishni rad etdi.",
    deleteAutomationConfirm: "Ushbu avtomatlashtirishni o‘chirasizmi?",
    deleteAutomationError: (msg) => `O‘chirish xatosi: ${msg}`,
    toggleAutomationError: (msg) => `Almashtirish xatosi: ${msg}`,
    buyBtnDefault: "Sotib olish",
    scheduledForMsg: (when) => ` ${when} ga rejalashtirildi`,
    sentForPublishingMsg: " nashrga yuborildi",
    publicationMsg: (timing) => `✅ Post${timing}.`,
    publishErrorMsg: (msg) => `Nashr xatosi: ${msg}`,
  },
};

export const Route = createFileRoute("/admin/instagram")({
  beforeLoad: ({ context }) => {
    if (!context.modules.instagram) throw redirect({ to: "/admin" });
  },
  head: () => ({ meta: [{ title: "Instagram" }] }),
  component: AdminInstagramPage,
});

function AdminInstagramPage() {
  const { locale } = useAdminLocale();
  const { isPhysicalShop } = useVertical();
  const tr = copy[locale];
  const qc = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ["ig_accounts"],
    queryFn: () => getInstagramAccountsFn(),
  });
  const automationsQuery = useQuery({
    queryKey: ["ig_automations"],
    queryFn: () => getAutomationsFn(),
  });
  const logsQuery = useQuery({ queryKey: ["ig_logs"], queryFn: () => getInstagramLogsFn() });

  const accounts = accountsQuery.data?.accounts || [];
  const acc = accounts[0];
  // p._date can be either a ms timestamp or an ISO string (Zernio's
  // publishedAt) — Number() on the latter is NaN, so this must go through
  // `new Date()` directly rather than forcing it to a number first.
  const formatPostDate = (value: unknown): string => {
    if (typeof value !== "number" && typeof value !== "string") return "Нет даты";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Нет даты" : d.toLocaleDateString("ru-RU");
  };
  const displayProfile = (profile: string | { _id: string; name?: string } | undefined) => {
    if (!profile) return "default";
    if (typeof profile === "string") return profile;
    return profile.name || profile._id || "default";
  };

  const postsQuery = useQuery({
    queryKey: ["ig_posts", acc?._id],
    queryFn: () => getZernioPostsFn({ data: { accountId: acc?._id } }),
    enabled: !!acc?._id,
  });
  const accountHealthQuery = useQuery({
    queryKey: ["ig_account_health", acc?._id],
    queryFn: () => getInstagramAccountHealthFn({ data: { accountId: acc?._id } }),
    enabled: !!acc?._id,
  });
  const conversationsQuery = useQuery({
    queryKey: ["ig_conversations", acc?._id],
    queryFn: () => getInstagramConversationsFn({ data: { accountId: acc?._id } }),
    enabled: !!acc?._id,
  });
  const dashboardQuery = useQuery({
    queryKey: ["ig_dashboard"],
    queryFn: () => getInstagramDashboardFn(),
  });
  const directBotSettingsQuery = useQuery({
    queryKey: ["ig_direct_bot_settings"],
    queryFn: () => getInstagramDirectBotSettingsFn(),
  });
  const directBotScriptQuery = useQuery({
    queryKey: ["ig_direct_bot_script"],
    queryFn: () => getInstagramDirectBotScriptFn(),
  });
  const directBotFeaturesQuery = useQuery({
    queryKey: ["ig_direct_bot_features"],
    queryFn: () => getInstagramDirectBotFeaturesFn(),
  });
  const directBotScopeQuery = useQuery({
    queryKey: ["ig_direct_bot_scope"],
    queryFn: () => getInstagramDirectBotScopeFn(),
  });
  const directBotTriggersQuery = useQuery({
    queryKey: ["ig_direct_bot_triggers"],
    queryFn: () => getInstagramDirectBotTriggersFn(),
  });

  const [connecting, setConnecting] = useState(false);
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [directBotScript, setDirectBotScript] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishContent, setPublishContent] = useState("");
  const [mediaUrlsText, setMediaUrlsText] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [publishType, setPublishType] = useState<"feed" | "story">("feed");
  const [scheduledFor, setScheduledFor] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [collaboratorsText, setCollaboratorsText] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  useEffect(() => {
    if (directBotScriptQuery.data) setDirectBotScript(directBotScriptQuery.data.text);
  }, [directBotScriptQuery.data]);
  const [postActionId, setPostActionId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [inboxReply, setInboxReply] = useState("");
  const messagesQuery = useQuery({
    queryKey: ["ig_conversation_messages", acc?._id, selectedConversationId],
    queryFn: () =>
      getInstagramConversationMessagesFn({
        data: { accountId: acc?._id, conversationId: selectedConversationId! },
      }),
    enabled: !!acc?._id && !!selectedConversationId,
  });

  // Что мы знаем о собеседниках: подписчик или нет, сколько у него подписчиков.
  // Диалоги приходят из Instagram, а профиль лежит у нас в bot_users, поэтому
  // это отдельный запрос, привязанный к составу списка диалогов.
  const conversationParticipantIds = (conversationsQuery.data?.conversations || [])
    .map((conversation) => conversation.participantId)
    .filter(Boolean)
    .slice(0, 100);
  const contactProfilesQuery = useQuery({
    queryKey: ["ig_contact_profiles", conversationParticipantIds.join(",")],
    queryFn: () =>
      getInstagramContactProfilesFn({ data: { participantIds: conversationParticipantIds } }),
    enabled: conversationParticipantIds.length > 0,
  });

  const handleInboxReply = async () => {
    if (!acc?._id || !selectedConversationId || !inboxReply.trim()) return;
    try {
      const result = await sendInstagramConversationMessageFn({
        data: { accountId: acc._id, conversationId: selectedConversationId, message: inboxReply },
      });
      if (!result.ok) throw new Error(result.error || tr.sendErrorFallback);
      setInboxReply("");
      qc.invalidateQueries({
        queryKey: ["ig_conversation_messages", acc._id, selectedConversationId],
      });
      qc.invalidateQueries({ queryKey: ["ig_conversations", acc._id] });
    } catch (e: unknown) {
      setStatusMsg(tr.postActionErrorMsg(errorMessage(e)));
    }
  };

  const handleDirectBotToggle = async (enabled: boolean) => {
    try {
      await saveInstagramDirectBotSettingsFn({ data: { enabled } });
      qc.invalidateQueries({ queryKey: ["ig_direct_bot_settings"] });
      setStatusMsg(enabled ? tr.directBotEnabledMsg : tr.directBotDisabledMsg);
    } catch (e: unknown) {
      setStatusMsg(tr.directBotSettingsError(errorMessage(e)));
    }
  };

  const handleSaveDirectBotScript = async () => {
    try {
      await saveInstagramDirectBotScriptFn({ data: { text: directBotScript } });
      qc.invalidateQueries({ queryKey: ["ig_direct_bot_script"] });
      setStatusMsg(tr.directBotScriptSaved);
    } catch (e: unknown) {
      setStatusMsg(tr.directBotScriptSaveError(errorMessage(e)));
    }
  };

  const handleScopeChange = async (scope: "purchases" | "all") => {
    try {
      await saveInstagramDirectBotScopeFn({ data: { scope } });
      qc.invalidateQueries({ queryKey: ["ig_direct_bot_scope"] });
      setStatusMsg(scope === "purchases" ? tr.scopePurchasesMsg : tr.scopeAllMsg);
    } catch (e: unknown) {
      setStatusMsg(tr.scopeSaveError(errorMessage(e)));
    }
  };

  const [triggerWords, setTriggerWords] = useState("");
  useEffect(() => {
    if (directBotTriggersQuery.data) setTriggerWords(directBotTriggersQuery.data.words.join(", "));
  }, [directBotTriggersQuery.data]);

  const handleSaveTriggers = async () => {
    try {
      const result = await saveInstagramDirectBotTriggersFn({ data: { words: triggerWords } });
      qc.invalidateQueries({ queryKey: ["ig_direct_bot_triggers"] });
      setStatusMsg(tr.triggersSaved(result.words.join(", ")));
    } catch (e: unknown) {
      setStatusMsg(tr.triggersSaveError(errorMessage(e)));
    }
  };

  const handleFeatureToggle = async (
    key: "catalog" | "search" | "cart" | "checkout",
    value: boolean,
  ) => {
    const current = directBotFeaturesQuery.data || {
      catalog: true,
      search: true,
      cart: true,
      checkout: true,
    };
    try {
      await saveInstagramDirectBotFeaturesFn({ data: { ...current, [key]: value } });
      qc.invalidateQueries({ queryKey: ["ig_direct_bot_features"] });
    } catch (e: unknown) {
      // Раньше сбой сохранения был не видно вовсе — чекбокс просто откатывался
      // на следующей перерисовке без единого объяснения (Блок C.10).
      toast.error(errorMessage(e));
    }
  };

  const handlePostAction = async (postId: string, action: "cancel" | "retry") => {
    if (action === "cancel" && !(await confirmToast(tr.postCancelConfirm))) return;
    setPostActionId(postId);
    setStatusMsg(null);
    try {
      const result =
        action === "cancel"
          ? await cancelInstagramPostFn({ data: { postId } })
          : await retryInstagramPostFn({ data: { postId } });
      if (!result.ok) throw new Error(result.error || tr.postActionError);
      setStatusMsg(action === "cancel" ? tr.postCancelledMsg : tr.postRetriedMsg);
      qc.invalidateQueries({ queryKey: ["ig_posts"] });
    } catch (e: unknown) {
      setStatusMsg(tr.postActionErrorMsg(errorMessage(e)));
    } finally {
      setPostActionId(null);
    }
  };

  const handleDisconnectAccount = async (accountId: string, accountName: string) => {
    if (!(await confirmToast(tr.disconnectConfirm(accountName)))) return;
    setDisconnecting(accountId);
    setStatusMsg(null);
    try {
      const res = await disconnectInstagramAccountFn({ data: { accountId } });
      if (res?.ok) {
        setStatusMsg(tr.accountDisconnected);
        qc.invalidateQueries({ queryKey: ["ig_accounts"] });
        qc.invalidateQueries({ queryKey: ["ig_posts"] });
      } else {
        setStatusMsg(tr.accountDisconnectFailed);
      }
    } catch (e: unknown) {
      setStatusMsg(tr.accountDisconnectError(errorMessage(e)));
    } finally {
      setDisconnecting(null);
    }
  };

  // Form state
  const [title, setTitle] = useState("");
  const [keywordsStr, setKeywordsStr] = useState("");
  const [replyToAll, setReplyToAll] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [dmText, setDmText] = useState("");
  const [postId, setPostId] = useState("ALL_POSTS");
  const [isActive, setIsActive] = useState(true);
  const [trigger, setTrigger] = useState<"comment" | "story_reply">("comment");
  const [buttons, setButtons] = useState<ZernioDmButton[]>([]);
  const [dmVariations, setDmVariations] = useState<string[]>([]);
  const [replyVariations, setReplyVariations] = useState<string[]>([]);
  const [linkTracking, setLinkTracking] = useState(true);
  const [clickTag, setClickTag] = useState("");
  const [savingAuto, setSavingAuto] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [originalPlatformPostId, setOriginalPlatformPostId] = useState<string | null>(null);
  const [originalTrigger, setOriginalTrigger] = useState<"comment" | "story_reply">("comment");
  const [syncUrlOpen, setSyncUrlOpen] = useState(false);
  const [syncUrlValue, setSyncUrlValue] = useState("");
  const [syncingUrl, setSyncingUrl] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    ok: boolean;
    message: string;
    caption?: string;
    thumbnail?: string;
  } | null>(null);

  const handleRefreshPosts = () => {
    qc.invalidateQueries({ queryKey: ["ig_posts"] });
  };

  /**
   * «Обновить список» тянет то, что Zernio уже успел засинхронить сам —
   * фоновый sync внешних (опубликованных не через Zernio) постов ходит раз
   * в ~90 минут на аккаунт. Для «только что выложил, а в списке пока нет»
   * у Zernio есть отдельный документированный путь: POST /posts/sync-external
   * с конкретной ссылкой ищет ровно этот пост и подтягивает его сразу, а не
   * ждёт следующего фонового прохода.
   */
  const handleSyncPostByUrl = async () => {
    if (!acc?._id || !syncUrlValue.trim()) return;
    setSyncingUrl(true);
    setSyncResult(null);
    try {
      const res = await syncZernioPostByUrlFn({
        data: { accountId: acc._id, url: syncUrlValue.trim() },
      });
      if (res.found) {
        const caption = res.post ? String(res.post.caption || res.post.content || "") : "";
        const thumbnail = res.post?._thumbnail ? String(res.post._thumbnail) : undefined;
        setSyncResult({
          ok: true,
          message: "Пост найден и добавлен в список",
          caption: caption || undefined,
          thumbnail,
        });
        qc.invalidateQueries({ queryKey: ["ig_posts"] });
      } else {
        setSyncResult({
          ok: false,
          message:
            "Zernio не нашёл пост по этой ссылке. Проверьте, что ссылка ведёт на пост именно этого аккаунта.",
        });
      }
    } catch (e: unknown) {
      setSyncResult({ ok: false, message: errorMessage(e) });
    } finally {
      setSyncingUrl(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setStatusMsg(null);
    try {
      const res = await getInstagramConnectUrlFn();
      if (res?.authUrl) {
        window.open(res.authUrl, "_blank");
        setStatusMsg(tr.connectAuthUrlOpened);
      } else {
        setStatusMsg(tr.connectAuthUrlError);
      }
    } catch (e: unknown) {
      setStatusMsg(tr.connectError(errorMessage(e)));
    } finally {
      setConnecting(false);
    }
  };

  const handleRegisterWebhook = async () => {
    setRegisteringWebhook(true);
    setStatusMsg(null);
    try {
      const res = await registerInstagramWebhookFn();
      if (res?.ok) {
        setStatusMsg(tr.webhookUpdated);
      } else {
        setStatusMsg(tr.webhookError(res?.error || tr.webhookErrorFallback));
      }
    } catch (e: unknown) {
      setStatusMsg(tr.webhookGenericError(errorMessage(e)));
    } finally {
      setRegisteringWebhook(false);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acc?._id) {
      setStatusMsg(tr.noAccountsFirst);
      return;
    }
    const mediaUrls = mediaUrlsText
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean);
    if (!mediaUrls.length) {
      setStatusMsg(tr.addMediaLink);
      return;
    }
    setPublishing(true);
    setStatusMsg(null);
    try {
      const result = await createInstagramPostFn({
        data: {
          accountId: acc._id,
          content: publishContent,
          mediaUrls,
          mediaType,
          contentType: publishType,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
          firstComment: firstComment || undefined,
          collaborators: collaboratorsText
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
          shareToFeed,
          isAiGenerated,
        },
      });
      if (!result?.ok) throw new Error(result?.error || tr.postActionError);
      const timing = result.scheduledFor
        ? tr.scheduledForMsg(new Date(result.scheduledFor).toLocaleString(dateLocales[locale]))
        : tr.sentForPublishingMsg;
      setStatusMsg(tr.publicationMsg(timing));
      setPublishContent("");
      setMediaUrlsText("");
      setScheduledFor("");
      setFirstComment("");
      setCollaboratorsText("");
      setIsAiGenerated(false);
      qc.invalidateQueries({ queryKey: ["ig_posts"] });
    } catch (e: unknown) {
      setStatusMsg(tr.publishErrorMsg(errorMessage(e)));
    } finally {
      setPublishing(false);
    }
  };

  const handleSaveAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (!accountsQuery.data?.accounts || accountsQuery.data.accounts.length === 0) {
      toast.warning(tr.noAccountsConnected);
      return;
    }
    const acc = accountsQuery.data.accounts[0];

    setSavingAuto(true);
    try {
      const keywords = keywordsStr
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      const posts = postsQuery.data?.posts || [];
      const selectedPost = posts.find((p) => (p.platformPostId || p._id || p.id) === postId);

      const automationData = {
        id: editingId || undefined,
        originalPlatformPostId,
        originalTrigger,
        accountId: acc._id,
        profileId: typeof acc.profileId === "string" ? acc.profileId : acc.profileId?._id || "",
        name: title,
        trigger,
        keywords,
        replyToAll,
        matchMode: "contains" as const,
        dmMessage: dmText,
        commentReply: replyText,
        platformPostId:
          postId && postId !== "ALL_POSTS"
            ? selectedPost?.platformPostId || postId.trim()
            : undefined,
        postId:
          postId && postId !== "ALL_POSTS"
            ? selectedPost?._zernioPostId || selectedPost?._id || selectedPost?.id || undefined
            : undefined,
        postTitle: selectedPost
          ? String(selectedPost.caption || selectedPost.content || "").slice(0, 500)
          : undefined,
        buttons:
          buttons.length > 0
            ? buttons.map((b) => ({
                ...b,
                url:
                  b.url && b.type === "url"
                    ? b.url.startsWith("http")
                      ? b.url
                      : `https://${b.url}`
                    : b.url,
              }))
            : undefined,
        dmMessageVariations: dmVariations.filter(Boolean),
        commentReplyVariations: replyVariations.filter(Boolean),
        linkTracking,
        clickTag: clickTag || undefined,
        isActive,
      };

      const result = await saveAutomationFn({ data: automationData });
      if (!result?.ok) {
        let errMsg = result?.error || tr.genericAutomationError;
        if (errMsg.includes("409")) {
          errMsg = tr.duplicateAutomationError;
        }
        throw new Error(errMsg);
      }

      handleResetForm();
      qc.invalidateQueries({ queryKey: ["ig_automations"] });
    } catch (e: unknown) {
      toast.error(tr.saveAutomationError(errorMessage(e)));
    } finally {
      setSavingAuto(false);
    }
  };

  const handleResetForm = () => {
    setTitle("");
    setKeywordsStr("");
    setReplyToAll(false);
    setReplyText("");
    setDmText("");
    setPostId("ALL_POSTS");
    setIsActive(true);
    setTrigger("comment");
    setButtons([]);
    setDmVariations([]);
    setReplyVariations([]);
    setLinkTracking(true);
    setClickTag("");
    setEditingId(null);
    setOriginalPlatformPostId(null);
    setOriginalTrigger("comment");
  };

  const handleEditAutomation = (auto: ZernioCommentAutomation) => {
    setEditingId(auto.id || null);
    setOriginalPlatformPostId(auto.platformPostId || null);
    setOriginalTrigger(auto.trigger || "comment");
    setTitle(auto.name || "");
    setKeywordsStr(auto.keywords?.join(", ") || "");
    setReplyToAll(!!auto.replyToAll);
    setReplyText(auto.commentReply || "");
    setDmText(auto.dmMessage || "");
    setPostId(auto.platformPostId || auto.postId || "ALL_POSTS");
    setIsActive(auto.isActive ?? true);
    setTrigger(auto.trigger || "comment");
    setButtons(auto.buttons || []);
    setDmVariations(auto.dmMessageVariations || []);
    setReplyVariations(auto.commentReplyVariations || []);
    setLinkTracking(auto.linkTracking !== false);
    setClickTag(auto.clickTag || "");

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleAddButton = () => {
    if (buttons.length >= 3) return;
    setButtons([...buttons, { type: "url", title: tr.buyBtnDefault, url: "" }]);
  };

  const handleRemoveButton = (index: number) => {
    setButtons(buttons.filter((_, i) => i !== index));
  };

  const handleUpdateButton = (index: number, field: string, value: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], [field]: value };
    setButtons(newButtons);
  };

  const handleToggleAutomation = async (id: string, currentIsActive: boolean) => {
    try {
      await toggleAutomationFn({ data: { id, isActive: !currentIsActive } });
      qc.invalidateQueries({ queryKey: ["ig_automations"] });
    } catch (e: unknown) {
      toast.error(tr.toggleAutomationError(errorMessage(e)));
    }
  };

  const handleDeleteAutomation = async (id: string) => {
    if (!(await confirmToast(tr.deleteAutomationConfirm))) return;
    try {
      await deleteAutomationFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["ig_automations"] });
    } catch (e: unknown) {
      toast.error(tr.deleteAutomationError(errorMessage(e)));
    }
  };

  const automations = automationsQuery.data?.automations || [];
  const logs = logsQuery.data?.logs || [];
  const posts = postsQuery.data?.posts || [];

  const existingAutoForPost =
    postId !== "ALL_POSTS"
      ? automations.find((a) => a.platformPostId === postId && a.id !== editingId)
      : null;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
        <div className="space-y-1">
          {/* Заголовок по-русски, как на остальных экранах админки. Бейдж с
              названием сервиса-посредника убран: клиенту он ничего не
              объясняет, а нам незачем показывать, чьими руками это сделано. */}
          <h1 className="text-3xl font-extrabold tracking-tight">{tr.heading}</h1>
          <p className="text-muted-foreground">{tr.headingSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRegisterWebhook}
            disabled={registeringWebhook}
            size="sm"
          >
            {registeringWebhook ? (
              <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            {tr.updateWebhookBtn}
          </Button>
          <Button onClick={handleConnect} disabled={connecting} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {tr.connectAccountBtn}
          </Button>
        </div>
      </header>

      {statusMsg && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm flex items-center gap-3">
          <Info className="w-5 h-5 shrink-0" />
          {statusMsg}
        </div>
      )}

      <Tabs defaultValue="automations" className="space-y-6">
        {/*
          Семь вкладок в один ряд на узком экране превращались в нечитаемую
          полосу, а иконка MessageSquare стояла сразу у трёх из них
          («Автоответчик», «Direct», «Аккаунты») — глазу не за что зацепиться.
          Теперь ряд переносится, и у каждой вкладки свой знак. Подписи скрыты
          только на самых узких экранах, где иначе не помещается ничего.
        */}
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="direct-bot" className="gap-2">
            <Bot className="w-4 h-4" /> <span className="hidden sm:inline">{tr.tabDirectBot}</span>
          </TabsTrigger>
          <TabsTrigger value="automations" className="gap-2">
            <Settings2 className="w-4 h-4" />{" "}
            <span className="hidden sm:inline">{tr.tabAutomations}</span>
          </TabsTrigger>
          <TabsTrigger value="publish" className="gap-2">
            <CalendarClock className="w-4 h-4" />{" "}
            <span className="hidden sm:inline">{tr.tabPublish}</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <History className="w-4 h-4" /> <span className="hidden sm:inline">{tr.tabLogs}</span>
          </TabsTrigger>
          <TabsTrigger value="inbox" className="gap-2">
            <Inbox className="w-4 h-4" /> <span className="hidden sm:inline">{tr.tabInbox}</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" />{" "}
            <span className="hidden sm:inline">{tr.tabAnalytics}</span>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <UserCircle2 className="w-4 h-4" />{" "}
            <span className="hidden sm:inline">{tr.tabAccounts}</span>
          </TabsTrigger>
        </TabsList>

        {/*
          Автоответчик живёт ровно в одной вкладке. Раньше эта карточка стояла
          и здесь, и вверху «Автоматизаций» — два набора одних и тех же
          переключателей поверх одних и тех же настроек, так что оператор не
          мог понять, где из них «настоящий».
        */}
        <TabsContent value="direct-bot" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{tr.directBotTitle}</CardTitle>
              <CardDescription>{tr.directBotDesc}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">
                  {directBotSettingsQuery.data?.enabled === false
                    ? tr.statusStopped
                    : tr.statusEnabled}
                </p>
                <p className="text-sm text-muted-foreground">{tr.enableToggleHint}</p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="instagram-direct-bot-enabled"
                  checked={directBotSettingsQuery.data?.enabled !== false}
                  disabled={directBotSettingsQuery.isLoading}
                  onCheckedChange={(value) => handleDirectBotToggle(value === true)}
                />
                <Label htmlFor="instagram-direct-bot-enabled">{tr.enableLabel}</Label>
              </div>
            </CardContent>
            <CardContent className="space-y-3 pt-0">
              <Label>{tr.scopeLabel}</Label>
              <div className="space-y-2">
                {(
                  [
                    ["purchases", tr.scopePurchasesTitle, tr.scopePurchasesDesc],
                    ["all", tr.scopeAllTitle, tr.scopeAllDesc],
                  ] as const
                ).map(([value, title, description]) => {
                  const active = (directBotScopeQuery.data?.scope ?? "purchases") === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleScopeChange(value)}
                      className={`w-full rounded-md border p-3 text-left ${
                        active ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <p className="text-sm font-medium">
                        {title}
                        {active && (
                          <span className="ml-2 text-xs text-primary">{tr.scopeSelected}</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
            <CardContent className="space-y-2 pt-0">
              <Label htmlFor="direct-bot-triggers">Команды, которыми покупатель зовёт бота</Label>
              <p className="text-xs text-muted-foreground">
                Через запятую. Сравнение идёт с сообщением целиком: «Каталог» бота позовёт, а «а
                каталог у вас есть?» — нет, это вопрос к вам. Такое слово удобно писать в
                публикации: «напишите КАТАЛОГ в директ». Номер товара работает всегда, отдельной
                команды для него не нужно.
              </p>
              <div className="flex gap-2">
                <Input
                  id="direct-bot-triggers"
                  value={triggerWords}
                  onChange={(e) => setTriggerWords(e.target.value)}
                  placeholder="заказать, купить, магазин, каталог"
                />
                <Button size="sm" onClick={handleSaveTriggers}>
                  Сохранить
                </Button>
              </div>
              {directBotTriggersQuery.data?.isDefault && (
                <p className="text-xs text-muted-foreground">
                  Сейчас используются значения по умолчанию.
                </p>
              )}
            </CardContent>
            <CardContent className="space-y-2 pt-0">
              <Label htmlFor="direct-bot-script">Ответ на короткое или непонятное сообщение</Label>
              <Textarea
                id="direct-bot-script"
                value={directBotScript}
                onChange={(event) => setDirectBotScript(event.target.value)}
                placeholder="Оставьте пустым, чтобы использовать стандартное приветствие и каталог."
                rows={4}
                maxLength={1500}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Этот текст не заменяет поиск товаров, корзину и оформление заказа.
                </p>
                <Button size="sm" onClick={handleSaveDirectBotScript}>
                  Сохранить текст
                </Button>
              </div>
            </CardContent>
            <CardContent className="space-y-2 pt-0">
              <Label>Сценарии</Label>
              <p className="text-xs text-muted-foreground">
                Товары берутся из активного каталога этого клиента: название, описание и ключевые
                слова.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {FEATURE_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={directBotFeaturesQuery.data?.[key] !== false}
                      onCheckedChange={(value) => handleFeatureToggle(key, value === true)}
                    />
                    {tr.featureLabels[key]}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUTOMATIONS TAB */}
        <TabsContent value="automations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Editor Side */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="shadow-sm border-primary/10">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-2">
                    {editingId ? (
                      <Settings2 className="w-5 h-5 text-primary" />
                    ) : (
                      <Plus className="w-5 h-5 text-primary" />
                    )}
                    {editingId ? "Редактировать правило" : "Новая автоматизация"}
                  </CardTitle>
                  <CardDescription>Что должно сработать и что ответить в Direct</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveAutomation} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="auto_title">Название</Label>
                      <Input
                        id="auto_title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Например: рассылка чек-листа"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Триггер</Label>
                        <Select
                          value={trigger}
                          onValueChange={(v: string) => {
                            setTrigger(v as "comment" | "story_reply");
                            setPostId("ALL_POSTS");
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="comment">💬 Комментарий</SelectItem>
                            <SelectItem value="story_reply">📱 Ответ на Story</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Ключевые слова</Label>
                        <Input
                          value={keywordsStr}
                          onChange={(e) => setKeywordsStr(e.target.value)}
                          placeholder={replyToAll ? "Отвечает на все" : "хочу, инфо, +"}
                          disabled={replyToAll}
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 py-1">
                      <Checkbox
                        id="reply_to_all"
                        checked={replyToAll}
                        disabled={!postId || postId === "ALL_POSTS"}
                        onCheckedChange={(v: boolean) => setReplyToAll(v)}
                      />
                      <Label
                        htmlFor="reply_to_all"
                        className={`text-sm font-medium leading-none cursor-pointer ${!postId || postId === "ALL_POSTS" ? "opacity-50" : ""}`}
                      >
                        Отвечать на все комментарии (без ключевых слов)
                        {(!postId || postId === "ALL_POSTS") && (
                          <span className="block text-[10px] text-muted-foreground font-normal mt-1">
                            Доступно только при выборе конкретного поста
                          </span>
                        )}
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          {trigger === "story_reply" ? "Целевая Story" : "Целевой пост"}
                          {existingAutoForPost && (
                            <Badge
                              variant="outline"
                              className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 animate-pulse"
                            >
                              ⚠️ Занят: "{existingAutoForPost.name}"
                            </Badge>
                          )}
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleRefreshPosts}
                          className="h-6 text-[10px] px-2"
                        >
                          <RefreshCcw className="w-3 h-3 mr-1" /> Обновить список
                        </Button>
                      </div>
                      <Select value={postId} onValueChange={setPostId}>
                        <SelectTrigger className="h-auto py-2">
                          <SelectValue placeholder="Выберите объект" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="ALL_POSTS">
                            {trigger === "story_reply" ? "✨ Любая Story" : "✨ Любой пост"}
                          </SelectItem>
                          {posts
                            .filter((p) => (trigger === "story_reply" ? p._isStory : !p._isStory))
                            .map((p) => (
                              <SelectItem
                                key={String(p.platformPostId || p._id || p.id)}
                                value={String(p.platformPostId || p._id || p.id)}
                              >
                                <div className="flex items-center gap-3 py-1 max-w-[300px]">
                                  {p._thumbnail ? (
                                    <img
                                      src={String(p._thumbnail)}
                                      className="w-8 h-8 object-cover rounded shrink-0 bg-muted"
                                      alt=""
                                    />
                                  ) : (
                                    <div className="w-8 h-8 bg-muted rounded flex items-center justify-center shrink-0">
                                      <ImageIcon className="w-4 h-4 opacity-40" />
                                    </div>
                                  )}
                                  <div className="flex flex-col min-w-0 text-left">
                                    <span className="text-[9px] text-muted-foreground font-bold uppercase">
                                      {formatPostDate(p._date)}
                                    </span>
                                    <span className="text-xs truncate font-medium">
                                      {String(
                                        p.caption ||
                                          p.content ||
                                          (p._isStory ? "Story без текста" : "Без текста"),
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {syncUrlOpen ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Input
                              value={syncUrlValue}
                              onChange={(e) => {
                                setSyncUrlValue(e.target.value);
                                setSyncResult(null);
                              }}
                              placeholder="Ссылка на пост из Instagram…"
                              className="h-7 text-xs"
                              disabled={syncingUrl}
                            />
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-[10px] px-2 shrink-0"
                              onClick={handleSyncPostByUrl}
                              disabled={syncingUrl || !syncUrlValue.trim()}
                            >
                              {syncingUrl ? "Ищу…" : "Найти"}
                            </Button>
                            <button
                              type="button"
                              onClick={() => {
                                setSyncUrlOpen(false);
                                setSyncUrlValue("");
                                setSyncResult(null);
                              }}
                              className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 px-1"
                            >
                              Скрыть
                            </button>
                          </div>
                          {syncResult ? (
                            <div
                              className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${
                                syncResult.ok
                                  ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                                  : "border-destructive/30 bg-destructive/10 text-destructive"
                              }`}
                            >
                              {syncResult.ok ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="font-medium">{syncResult.message}</div>
                                {syncResult.ok && syncResult.caption ? (
                                  <div className="truncate text-muted-foreground mt-0.5">
                                    {syncResult.caption}
                                  </div>
                                ) : null}
                              </div>
                              {syncResult.ok && syncResult.thumbnail ? (
                                <img
                                  src={syncResult.thumbnail}
                                  className="w-8 h-8 object-cover rounded shrink-0 bg-muted"
                                  alt=""
                                />
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSyncUrlOpen(true);
                            setSyncResult(null);
                          }}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          <Link2 className="w-3 h-3" /> Не нашли только что опубликованный пост?
                          Вставить ссылку
                        </button>
                      )}
                    </div>

                    <div className="space-y-4 border-t pt-4">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-primary" /> Публичный ответ
                        </Label>
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Ответили вам в Директ! 📩"
                          rows={2}
                        />
                        <div className="bg-muted/30 p-2 rounded text-[10px] space-y-1">
                          <span className="text-muted-foreground font-semibold uppercase">
                            Вариации против однотипных ответов:
                          </span>
                          <Textarea
                            className="text-[11px] min-h-[40px] bg-transparent border-none focus-visible:ring-0 p-0"
                            placeholder="Одна вариация на строку"
                            value={replyVariations.join("\n")}
                            onChange={(e) => setReplyVariations(e.target.value.split("\n"))}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-primary" /> Личное сообщение (DM)
                        </Label>
                        <Textarea
                          value={dmText}
                          onChange={(e) => setDmText(e.target.value)}
                          placeholder={isPhysicalShop ? tr.dmPlaceholderPhysical : tr.dmPlaceholder}
                          rows={3}
                        />

                        {/* Buttons inside DM */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground">
                              Кнопки в DM ({buttons.length}/3)
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleAddButton}
                              disabled={buttons.length >= 3}
                              className="h-7 text-[10px]"
                            >
                              + Добавить
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {buttons.map((btn, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-2 p-2 border rounded-md bg-muted/20 relative group"
                              >
                                <div className="flex-1 grid grid-cols-2 gap-2">
                                  <Input
                                    value={btn.title}
                                    onChange={(e) => handleUpdateButton(i, "title", e.target.value)}
                                    placeholder="Текст"
                                    className="h-7 text-[11px]"
                                  />
                                  <Select
                                    value={btn.type}
                                    onValueChange={(v) => handleUpdateButton(i, "type", v)}
                                  >
                                    <SelectTrigger className="h-7 text-[11px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="url">🔗 URL</SelectItem>
                                      <SelectItem value="postback">🤖 CMD</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {btn.type === "url" ? (
                                    <Input
                                      value={btn.url}
                                      onChange={(e) => handleUpdateButton(i, "url", e.target.value)}
                                      placeholder="https://..."
                                      className="h-7 text-[11px] col-span-2"
                                    />
                                  ) : (
                                    <Input
                                      value={btn.payload}
                                      onChange={(e) =>
                                        handleUpdateButton(i, "payload", e.target.value)
                                      }
                                      placeholder="Команда, например BUY_NOW"
                                      className="h-7 text-[11px] col-span-2"
                                    />
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveButton(i)}
                                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t space-y-4">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="trk"
                            checked={linkTracking}
                            onCheckedChange={(v) => setLinkTracking(!!v)}
                          />
                          <Label htmlFor="trk" className="cursor-pointer">
                            Трекинг ссылок
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="act"
                            checked={isActive}
                            onCheckedChange={(v) => setIsActive(!!v)}
                          />
                          <Label htmlFor="act" className="cursor-pointer">
                            Активно
                          </Label>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" className="flex-1" disabled={savingAuto}>
                          {savingAuto
                            ? "Сохранение..."
                            : editingId
                              ? "Сохранить изменения"
                              : "Создать автоматизацию"}
                        </Button>
                        {editingId && (
                          <Button variant="ghost" onClick={handleResetForm}>
                            Отмена
                          </Button>
                        )}
                      </div>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* List Side */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Активные правила ({automations.length})</h3>
              </div>

              {automationsQuery.isLoading ? (
                <div className="border-2 border-dashed rounded-xl p-12 text-center text-sm text-muted-foreground bg-muted/10">
                  Загрузка…
                </div>
              ) : automationsQuery.isError ? (
                <div className="border-2 border-dashed rounded-xl p-12 text-center text-sm text-destructive bg-muted/10">
                  Не удалось загрузить автоматизации: {errorMessage(automationsQuery.error)}
                </div>
              ) : automations.length === 0 ? (
                <div className="border-2 border-dashed rounded-xl p-12 text-center space-y-3 bg-muted/10">
                  <div className="bg-muted w-12 h-12 rounded-full flex items-center justify-center mx-auto">
                    <Zap className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div className="text-sm font-medium">Нет активных автоматизаций</div>
                  <p className="text-xs text-muted-foreground max-w-[200px] mx-auto">
                    Создайте свое первое правило в панели слева
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {automations.map((auto: ZernioCommentAutomation) => (
                    <Card
                      key={auto.id}
                      className={`transition-all ${auto.isActive ? "border-l-4 border-l-primary" : "opacity-70"}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold truncate">{auto.name}</span>
                              {!auto.isActive && (
                                <Badge variant="secondary" className="text-[9px] h-4">
                                  Пауза
                                </Badge>
                              )}
                              {auto.trigger === "story_reply" && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] h-4 bg-purple-50 text-purple-600 border-purple-200"
                                >
                                  Story
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3" /> {auto.stats?.triggered || 0}
                              </span>
                              {(auto.stats?.linkClicks || 0) > 0 && (
                                <span className="flex items-center gap-1 text-blue-600 font-medium">
                                  <ExternalLink className="w-3 h-3" /> {auto.stats?.linkClicks}{" "}
                                  кликов
                                </span>
                              )}
                              <span className="truncate flex items-center gap-1">
                                •{" "}
                                {auto.replyToAll ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] h-4 bg-primary/5 text-primary border-primary/20"
                                  >
                                    Отвечать всем
                                  </Badge>
                                ) : (
                                  <>
                                    Ключи:{" "}
                                    {auto.keywords?.length ? auto.keywords.join(", ") : "Любые"}
                                  </>
                                )}
                              </span>
                            </div>
                            {auto.platformPostId && (
                              <div className="text-[10px] bg-muted/50 px-2 py-1 rounded inline-block mt-1 truncate max-w-full">
                                Target: {auto.platformPostId}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEditAutomation(auto)}
                            >
                              <Settings2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                auto.id && handleToggleAutomation(auto.id, !!auto.isActive)
                              }
                            >
                              {auto.isActive ? (
                                <Pause className="w-4 h-4" />
                              ) : (
                                <Play className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => auto.id && handleDeleteAutomation(auto.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* PUBLISH TAB */}
        <TabsContent value="publish" className="space-y-6">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-primary" /> Публикация и планировщик
              </CardTitle>
              <CardDescription>
                Feed, Reels, Stories и карусели входят в Instagram-автоматизацию. Для публикации
                нужны прямые публичные ссылки на файлы.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleCreatePost}>
                <div className="space-y-2">
                  <Label>Аккаунт</Label>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {acc
                      ? acc.name || acc.username || acc._id
                      : "Подключите Instagram-аккаунт во вкладке «Аккаунты»"}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Формат</Label>
                    <Select
                      value={publishType}
                      onValueChange={(value) => setPublishType(value as "feed" | "story")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="feed">Feed / Reel / карусель</SelectItem>
                        <SelectItem value="story">Story</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Медиа</Label>
                    <Select
                      value={mediaType}
                      onValueChange={(value) => setMediaType(value as "image" | "video")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="image">Изображение</SelectItem>
                        <SelectItem value="video">Видео (публикуется как Reel)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publish-media">Прямые ссылки на медиа</Label>
                  <Textarea
                    id="publish-media"
                    value={mediaUrlsText}
                    onChange={(e) => setMediaUrlsText(e.target.value)}
                    rows={4}
                    placeholder={
                      mediaType === "video"
                        ? "https://cdn.example.com/reel.mp4"
                        : "https://cdn.example.com/photo-1.jpg\nhttps://cdn.example.com/photo-2.jpg"
                    }
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Одна ссылка на строку. Story и Reel: один файл; карусель: до 10 изображений.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publish-caption">Подпись</Label>
                  <Textarea
                    id="publish-caption"
                    value={publishContent}
                    onChange={(e) => setPublishContent(e.target.value)}
                    maxLength={2200}
                    rows={5}
                    placeholder="Текст публикации и хэштеги"
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {publishContent.length}/2200
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="scheduled-for">Время публикации</Label>
                    <Input
                      id="scheduled-for"
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Оставьте пустым, чтобы опубликовать сейчас.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="collaborators">Соавторы</Label>
                    <Input
                      id="collaborators"
                      value={collaboratorsText}
                      onChange={(e) => setCollaboratorsText(e.target.value)}
                      placeholder="brand_one, brand_two"
                    />
                    <p className="text-xs text-muted-foreground">
                      До трёх публичных Business/Creator аккаунтов.
                    </p>
                  </div>
                </div>
                {publishType === "feed" && mediaType === "image" && (
                  <div className="space-y-2">
                    <Label htmlFor="first-comment">Первый комментарий</Label>
                    <Textarea
                      id="first-comment"
                      value={firstComment}
                      onChange={(e) => setFirstComment(e.target.value)}
                      rows={2}
                      placeholder="Ссылка или дополнительная информация"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                  {mediaType === "video" ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="share-to-feed"
                        checked={shareToFeed}
                        onCheckedChange={(checked) => setShareToFeed(checked === true)}
                      />
                      <Label htmlFor="share-to-feed">Показывать Reel и в основной ленте</Label>
                    </div>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ai-generated"
                      checked={isAiGenerated}
                      onCheckedChange={(checked) => setIsAiGenerated(checked === true)}
                    />
                    <Label htmlFor="ai-generated">Контент создан ИИ</Label>
                  </div>
                </div>
                <Button type="submit" disabled={publishing || !acc} className="w-full">
                  {publishing
                    ? "Отправляем…"
                    : scheduledFor
                      ? "Запланировать публикацию"
                      : "Опубликовать сейчас"}
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Очередь публикаций</CardTitle>
                <CardDescription>
                  Запланированные, опубликованные и неудачные посты.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshPosts}
                disabled={postsQuery.isFetching}
              >
                <RefreshCcw className="w-4 h-4 mr-2" /> Обновить
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {postsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Загружаем публикации…</p>
              ) : posts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Публикаций пока нет.</p>
              ) : (
                posts
                  .filter((post) => post._zernioPostId)
                  .map((post) => {
                    const postId = String(post._zernioPostId);
                    const status = String(post.status || "published").toLowerCase();
                    const canCancel = ["scheduled", "draft", "pending", "queued"].includes(status);
                    const canRetry = ["failed", "partial", "cancelled"].includes(status);
                    const when = post.scheduledFor || post.publishedAt || post._date;
                    return (
                      <div key={postId} className="flex gap-3 rounded-md border p-3">
                        {post._thumbnail ? (
                          <img
                            src={String(post._thumbnail)}
                            alt=""
                            className="h-12 w-12 rounded object-cover bg-muted"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                            <ImageIcon className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">
                              {String(post.caption || post.content || "Публикация без подписи")}
                            </span>
                            <Badge variant="outline">{status}</Badge>
                          </div>
                          {when && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {new Date(String(when)).toLocaleString("ru-RU")}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {canCancel && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={postActionId === postId}
                              onClick={() => handlePostAction(postId, "cancel")}
                            >
                              Отменить
                            </Button>
                          )}
                          {canRetry && (
                            <Button
                              size="sm"
                              disabled={postActionId === postId}
                              onClick={() => handlePostAction(postId, "retry")}
                            >
                              Повторить
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LOGS TAB */}
        <TabsContent value="inbox" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Instagram Direct</CardTitle>
                <CardDescription>Диалоги подключённого аккаунта.</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => qc.invalidateQueries({ queryKey: ["ig_conversations"] })}
              >
                <RefreshCcw className="w-4 h-4 mr-2" /> Обновить
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="max-h-[520px] space-y-2 overflow-y-auto border-r pr-3">
                {(conversationsQuery.data?.conversations || []).map((conversation) => {
                  // Профиль есть только у тех, кто писал после того, как его
                  // начали собирать. Для остальных не показываем ничего —
                  // «неизвестно» и «не подписан» это разные вещи.
                  const profile = conversation.participantId
                    ? contactProfilesQuery.data?.profiles?.[conversation.participantId]
                    : undefined;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={`w-full rounded-md border p-3 text-left ${selectedConversationId === conversation.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium truncate">
                          {conversation.participantName ||
                            conversation.participantUsername ||
                            "Диалог"}
                        </span>
                        {conversation.unreadCount ? (
                          <Badge>{conversation.unreadCount}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {conversation.lastMessage || "Нет сообщений"}
                      </p>
                      {profile && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {profile.isFollower !== undefined && (
                            <Badge
                              variant={profile.isFollower ? "secondary" : "outline"}
                              className="text-[10px]"
                            >
                              {profile.isFollower ? "Подписчик" : "Не подписан"}
                            </Badge>
                          )}
                          {profile.isVerified && (
                            <Badge variant="outline" className="text-[10px]">
                              Верифицирован
                            </Badge>
                          )}
                          {profile.followerCount !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              {profile.followerCount.toLocaleString("ru-RU")} подписчиков
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
                {!conversationsQuery.isLoading &&
                  !(conversationsQuery.data?.conversations || []).length && (
                    <p className="text-sm text-muted-foreground">Диалогов пока нет.</p>
                  )}
              </div>
              <div className="flex min-h-[440px] flex-col gap-3">
                {!selectedConversationId ? (
                  <p className="m-auto text-sm text-muted-foreground">Выберите диалог слева.</p>
                ) : (
                  <>
                    <div className="flex-1 space-y-2 overflow-y-auto rounded-md bg-muted/30 p-3">
                      {(messagesQuery.data?.messages || []).map((message) => (
                        <div
                          key={message.id}
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${message.direction === "outgoing" ? "ml-auto bg-primary text-primary-foreground" : "bg-background border"}`}
                        >
                          <p>{message.message || "Вложение"}</p>
                          <p className="mt-1 text-[10px] opacity-70">
                            {message.createdAt
                              ? new Date(message.createdAt).toLocaleString("ru-RU")
                              : ""}
                          </p>
                        </div>
                      ))}
                      {messagesQuery.isLoading && (
                        <p className="text-sm text-muted-foreground">Загрузка…</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        value={inboxReply}
                        onChange={(event) => setInboxReply(event.target.value)}
                        placeholder="Напишите ответ…"
                        rows={2}
                      />
                      <Button onClick={handleInboxReply} disabled={!inboxReply.trim()}>
                        Отправить
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Instagram за 30 дней</h2>
              <p className="text-sm text-muted-foreground">
                Автоматизации, Direct и оплаченные заказы.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["ig_dashboard"] })}
            >
              <RefreshCcw className="w-4 h-4 mr-2" /> Обновить
            </Button>
          </div>
          {dashboardQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Считаем показатели…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Срабатывания", dashboardQuery.data?.automation.triggered || 0],
                ["Отправлено DM", dashboardQuery.data?.automation.dms || 0],
                ["Клики по ссылкам", dashboardQuery.data?.automation.clicks || 0],
                ["Входящие Direct", dashboardQuery.data?.direct.incoming || 0],
                ["Instagram-заказы", dashboardQuery.data?.orders.total || 0],
                ["Оплачено / выдано", dashboardQuery.data?.orders.paid || 0],
                ["Выручка", `${dashboardQuery.data?.orders.revenue || 0} KZT`],
                ["Ошибки обработки", dashboardQuery.data?.direct.errors || 0],
              ].map(([label, value]) => (
                <Card key={String(label)}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-bold">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Правила автоматизации</CardTitle>
              <CardDescription>
                Активных правил: {dashboardQuery.data?.automation.rules || 0}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Показатели считаются по данным Instagram; продажи — по заказам, созданным из Instagram
              Direct.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Журнал событий</CardTitle>
                <CardDescription>Последние действия автоматизации</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ["ig_logs"] })}
              >
                <RefreshCcw className="w-4 h-4 mr-2" /> Обновить
              </Button>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="p-3 text-left font-medium">Время</th>
                      <th className="p-3 text-left font-medium">Событие</th>
                      <th className="p-3 text-left font-medium">Статус</th>
                      <th className="p-3 text-right font-medium">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {logsQuery.isLoading ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-muted-foreground">
                          Загрузка…
                        </td>
                      </tr>
                    ) : logsQuery.isError ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-destructive">
                          Не удалось загрузить логи: {errorMessage(logsQuery.error)}
                        </td>
                      </tr>
                    ) : logs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-muted-foreground">
                          Логов пока нет
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                          <td className="p-3 text-xs whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString("ru-RU", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span className="font-mono text-[11px] uppercase">
                                {log.event_type}
                              </span>
                              {jsonString(log.payload, "senderUsername") && (
                                <span className="text-[10px] text-primary">
                                  @{jsonString(log.payload, "senderUsername")}
                                </span>
                              )}
                              {jsonString(log.payload, "commentText") && (
                                <span className="text-[10px] italic text-muted-foreground truncate max-w-[200px]">
                                  "{jsonString(log.payload, "commentText")}"
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className="bg-green-50 text-green-700 border-green-200 text-[10px]"
                            >
                              {log.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              // Просмотр сырого payload — не уведомление, а
                              // инспектор данных; toast для этого не годится
                              // (может быть длиннее, чем помещается в тост).
                              onClick={() => window.alert(JSON.stringify(log.payload, null, 2))}
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACCOUNTS TAB */}
        <TabsContent value="accounts">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {accountsQuery.isLoading ? (
              <div className="col-span-2 text-center py-12 border-2 border-dashed rounded-xl bg-muted/10">
                <p className="text-muted-foreground">Загрузка…</p>
              </div>
            ) : accountsQuery.isError ? (
              <div className="col-span-2 text-center py-12 border-2 border-dashed rounded-xl bg-muted/10">
                <p className="text-destructive">
                  Не удалось загрузить аккаунты: {errorMessage(accountsQuery.error)}
                </p>
              </div>
            ) : Array.isArray(accounts) && accounts.length > 0 ? (
              accounts.map((account) => (
                <Card key={account._id || Math.random().toString()}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {account.name || account.username || "Instagram Account"}
                      </CardTitle>
                      <Badge
                        className={
                          account.isExpired
                            ? "bg-amber-600 text-white border-none"
                            : "bg-green-600 text-white border-none"
                        }
                      >
                        {account.isExpired ? "Требуется переподключение" : "Активен"}
                      </Badge>
                    </div>
                    <CardDescription>ID: {account._id || "N/A"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-muted-foreground mb-1">Платформа</div>
                        <div className="font-bold uppercase">{account.platform || "instagram"}</div>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-muted-foreground mb-1">Профиль интеграции</div>
                        <div className="font-bold truncate">
                          {displayProfile(account.profileId)}
                        </div>
                      </div>
                    </div>
                    {account._id === acc?._id && (
                      <div className="rounded-lg border p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Готовность подключения</span>
                          <Badge
                            variant="outline"
                            className={
                              accountHealthQuery.data?.health?.status === "healthy"
                                ? "text-green-700 border-green-200 bg-green-50"
                                : "text-amber-700 border-amber-200 bg-amber-50"
                            }
                          >
                            {accountHealthQuery.isLoading
                              ? "Проверяем…"
                              : accountHealthQuery.data?.health?.status || "нет данных"}
                          </Badge>
                        </div>
                        {accountHealthQuery.data?.health && (
                          <>
                            <p>
                              Публикации:{" "}
                              {accountHealthQuery.data.health.permissions?.canPost
                                ? "доступны"
                                : "недоступны"}
                              ; аналитика:{" "}
                              {accountHealthQuery.data.health.permissions?.canFetchAnalytics
                                ? "доступна"
                                : "недоступна"}
                              .
                            </p>
                            {accountHealthQuery.data.health.issues
                              ?.slice(0, 2)
                              .map((issue: string) => (
                                <p key={issue} className="text-amber-700">
                                  {issue}
                                </p>
                              ))}
                            {accountHealthQuery.data.health.recommendations
                              ?.slice(0, 1)
                              .map((recommendation: string) => (
                                <p key={recommendation} className="text-muted-foreground">
                                  {recommendation}
                                </p>
                              ))}
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      disabled={disconnecting === account._id}
                      onClick={() =>
                        handleDisconnectAccount(
                          account._id,
                          account.name || account.username || "Account",
                        )
                      }
                    >
                      {disconnecting === account._id ? "Отключение..." : "🔓 Отключить аккаунт"}
                    </Button>
                  </CardFooter>
                </Card>
              ))
            ) : (
              <div className="col-span-2 text-center py-12 border-2 border-dashed rounded-xl bg-muted/10">
                <p className="text-muted-foreground">Нет подключенных аккаунтов</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
