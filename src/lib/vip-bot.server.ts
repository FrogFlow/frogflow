import { requireAppOrigin } from "./app-origin.server";
import { errorMessage } from "@/lib/error-message";
import { formatDateTimeRu } from "./datetime";
import { isTelegramAdmin, parseNotifyAdminIds } from "./telegram-webhook.server";
import { assignMemberTariff, getMemberAssignedTariff } from "./vip-member.server";
import { resolveTelegramFileMeta } from "./file-mime";
import { replyIfBlocked } from "./blocked-users.server";
import { isLocale, localeNames, SUPPORTED_LOCALES, type Locale } from "./i18n";
import type { TelegramUser, TelegramUpdate } from "./bot.server";

const TG_API = "https://api.telegram.org";

/** Warn stages stored in vip_subscriptions.admin_note */
export const WARN_STAGE_1 = "warned";
export const WARN_STAGE_2 = "warned2";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** VIP bot @username from env (no legacy fallback). Empty if unset. */
export function resolveVipBotUsername(): string {
  return (process.env.VIP_BOT_USERNAME || "").replace(/^@/, "").trim();
}

function token() {
  const t = process.env.VIP_BOT_TOKEN;
  if (!t) throw new Error("VIP_BOT_TOKEN is not configured");
  return t;
}

async function retryFetch(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error as Error;
    }

    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Retry failed");
}

export async function tgVip(method: string, payload: unknown) {
  try {
    const res = await retryFetch(`${TG_API}/bot${token()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data && data.ok === false)) {
      console.error(`[vip-bot] ${method} failed`, res.status, data);
    }
    return data as { ok: boolean; result?: unknown; description?: string };
  } catch (error) {
    console.error(`[vip-bot] ${method} retry exhausted`, error);
    return { ok: false, description: "Retry exhausted" };
  }
}

export async function revokeVipInvite(groupId: string, inviteLink: string | null | undefined) {
  if (!groupId || !inviteLink) return;
  await tgVip("revokeChatInviteLink", { chat_id: groupId, invite_link: inviteLink });
}

/** True if user is currently a member/admin of the VIP group. */
export async function isVipGroupMember(groupId: string, telegramId: number): Promise<boolean> {
  const res = await tgVip("getChatMember", { chat_id: groupId, user_id: telegramId });
  if (!res.ok) return false;
  const status = (res.result as { status?: string } | undefined)?.status;
  return (
    status === "member" ||
    status === "administrator" ||
    status === "creator" ||
    status === "restricted"
  );
}

function imageUrl(path: string): string {
  return `${requireAppOrigin()}/api/public/img/${path}`;
}

export async function downloadVipTelegramFile(
  file_id: string,
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  const info = await tgVip("getFile", { file_id });
  // @ts-expect-error dynamic
  const path = info?.result?.file_path as string | undefined;
  if (!path) return null;

  try {
    const res = await retryFetch(`${TG_API}/file/bot${token()}/${path}`, { method: "GET" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const meta = resolveTelegramFileMeta(path, res.headers.get("content-type"));
    return { bytes, mime: meta.mime, ext: meta.ext };
  } catch (error) {
    console.error(`[vip-bot] downloadFile retry exhausted`, error);
    return null;
  }
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
  return supabaseAdmin;
}

async function getVipSettings() {
  const s = await db();
  const { data } = await s.from("app_settings").select("*");
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key as string] = (r.value as string) ?? "";
  return map;
}

/**
 * Explicit UI language for a VIP customer, stored on vip_member_profiles
 * (already the per-(bot_id, telegram_id) VIP customer profile row — see
 * vip-member.server.ts). Never inferred from Telegram's device language.
 * Returns null when the customer hasn't chosen one yet (first contact).
 */
async function getVipLocaleRaw(telegram_id: number): Promise<Locale | null> {
  const s = await db();
  const { data, error } = await s
    .from("vip_member_profiles")
    .select("locale")
    .eq("telegram_id", telegram_id)
    .maybeSingle();
  // PK is (bot_id, telegram_id) — ambiguity isn't reachable here, but a
  // genuine query error would otherwise read the same as "no locale chosen
  // yet" and silently re-ask a customer who already picked one.
  if (error) console.error("[vip-bot] getVipLocaleRaw failed", error);
  return isLocale(data?.locale) ? (data!.locale as Locale) : null;
}

async function setVipLocale(telegram_id: number, user: TelegramUser, locale: Locale) {
  const s = await db();
  const { error } = await s.from("vip_member_profiles").upsert(
    {
      telegram_id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      locale,
    },
    { onConflict: "bot_id,telegram_id" },
  );
  if (error) console.error("[vip-bot] setVipLocale failed", error);
}

/** Fill `{token}` placeholders in a translated string, e.g. `{btn}`, `{price}`. */
function fmt(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}

type VipCopyKey =
  | "btnRenew"
  | "btnStatus"
  | "btnId"
  | "btnHelp"
  | "btnLang"
  | "chooseLanguage"
  | "languageSaved"
  | "statusTitle"
  | "statusActive"
  | "statusTariff"
  | "statusValidUntil"
  | "statusRenewHint"
  | "statusPending"
  | "statusPendingHint"
  | "statusNone"
  | "statusNoneHint"
  | "helpTitle"
  | "helpRenewLine"
  | "helpStatusLine"
  | "helpIdLine"
  | "helpPhotoLine"
  | "helpCommandsLine"
  | "myIdLabel"
  | "myIdUsername"
  | "myIdHint"
  | "tariffsLoadError"
  | "tariffsEmptyRenew"
  | "tariffsEmptyDefault"
  | "tariffsIntroInGroup"
  | "tariffsIntroRenew"
  | "tariffsIntroDefault"
  | "entryTitle"
  | "entryDesc"
  | "entryPriceLabel"
  | "entryAfterPay"
  | "entryFurtherRenew"
  | "entryPayButton"
  | "tariffLinkNotFound"
  | "vipMenuPinned"
  | "startPendingTitle"
  | "startPendingNoNewNeeded"
  | "startPendingSendProof"
  | "startPendingStatusHint"
  | "startRenewInGroup"
  | "startRenewNotInGroup"
  | "startWelcome"
  | "assignedRenewInGroup"
  | "assignedRenewNotInGroup"
  | "assignedAfterPay"
  | "payButton"
  | "otherPublicTariffs"
  | "tariffNotFoundShort"
  | "tariffInactive"
  | "entryOnlyForNew"
  | "defaultPaymentInstructions"
  | "createRequestFailed"
  | "paymentChosenLabel"
  | "paymentDueLabel"
  | "paymentAfterPay"
  | "noPendingTariff"
  | "proofResubmitNotified"
  | "proofResubmitQuiet"
  | "proofReceived"
  | "alreadyPendingPublic"
  | "sendProofIfNotYet"
  | "tempError";

/** All customer-facing VIP bot copy. Admin-only replies stay hardcoded Russian below. */
const vipCopy: Record<Locale, Record<VipCopyKey, string>> = {
  ru: {
    btnRenew: "🔄 Продлить",
    btnStatus: "📋 Мой статус",
    btnId: "🆔 Мой ID",
    btnHelp: "ℹ️ Помощь",
    btnLang: "🌐 Язык",
    chooseLanguage: "Выберите язык",
    languageSaved: "✅ Язык сохранён.",
    statusTitle: "📋 <b>Ваш VIP статус</b>",
    statusActive: "Статус: <b>активен</b>",
    statusTariff: "Тариф:",
    statusValidUntil: "Действует до:",
    statusRenewHint: "Чтобы продлить заранее — нажмите «{btn}».",
    statusPending: "Статус: <b>ожидает подтверждения оплаты</b>",
    statusPendingHint: "Если ещё не отправили чек — пришлите скриншот оплаты в этот чат.",
    statusNone: "Сейчас нет активной подписки.",
    statusNoneHint: "Нажмите «{btn}» или /start, чтобы оформить доступ.",
    helpTitle: "ℹ️ <b>Помощь VIP</b>",
    helpRenewLine: "• <b>{btn}</b> — выбрать тариф / продлить доступ",
    helpStatusLine: "• <b>{btn}</b> — срок подписки и статус оплаты",
    helpIdLine: "• <b>{btn}</b> — ваш Telegram ID (для ручного добавления)",
    helpPhotoLine: "• После оплаты пришлите <b>чек</b> в этот чат — фото или файлом",
    helpCommandsLine: "Команды: /start — меню, /id — ваш ID",
    myIdLabel: "Ваш Telegram ID:",
    myIdUsername: "Username:",
    myIdHint: "Этот ID нужен для ручного добавления в VIP-админке.",
    tariffsLoadError: "Не удалось загрузить тарифы. Попробуйте позже.",
    tempError: "Не удалось выполнить запрос. Попробуйте ещё раз через минуту.",
    tariffsEmptyRenew:
      "Нет публичных тарифов для продления. Используйте вашу персональную ссылку на тариф или напишите администратору.",
    tariffsEmptyDefault: "В данный момент нет доступных тарифов.",
    tariffsIntroInGroup:
      "Продление VIP: выберите тариф. После оплаты срок продлится — вы останетесь в группе, новая ссылка не нужна.",
    tariffsIntroRenew:
      "Выберите тариф. После подтверждения оплаты пришлём одноразовую ссылку для вступления в группу.",
    tariffsIntroDefault: "Выберите тариф для VIP-подписки:",
    entryTitle: "👋 <b>Первый вход в VIP</b>",
    entryDesc: "Разовый вход + доступ на {days} дн.",
    entryPriceLabel: "Стоимость:",
    entryAfterPay: "После оплаты и подтверждения вы получите ссылку в группу.",
    entryFurtherRenew: "Дальнейшее продление — по отдельным тарифам.",
    entryPayButton: "Оплатить вход — {price} {currency}",
    tariffLinkNotFound:
      "Тариф по этой ссылке не найден или выключен. Нажмите /start для общего списка.",
    vipMenuPinned: "Меню VIP закреплено внизу.",
    startPendingTitle: "⏳ У вас уже есть заявка <b>в ожидании подтверждения оплаты</b>.",
    startPendingNoNewNeeded: "Новый тариф оформлять не нужно.",
    startPendingSendProof: "Если чек ещё не отправили — пришлите скриншот оплаты в этот чат.",
    startPendingStatusHint: "Статус можно посмотреть кнопкой «{btn}».",
    startRenewInGroup: "Продление VIP — кнопки меню внизу. Выберите тариф ниже.",
    startRenewNotInGroup:
      "Возврат в VIP — выберите тариф ниже. После оплаты придёт одноразовая ссылка в группу.",
    startWelcome: "Добро пожаловать в VIP-бот. Меню внизу экрана — тарифы ниже.",
    assignedRenewInGroup: "Продление VIP — ваш персональный тариф:",
    assignedRenewNotInGroup: "Ваш персональный тариф VIP:",
    assignedAfterPay: "После оплаты — одноразовая ссылка в группу.",
    payButton: "Оплатить — {price} {currency}",
    otherPublicTariffs: "Другие публичные тарифы",
    tariffNotFoundShort: "Тариф не найден.",
    tariffInactive: "Этот тариф больше не активен. Нажмите /start чтобы выбрать другой.",
    entryOnlyForNew:
      "Тариф «Первый вход» доступен только новым участникам. Выберите тариф продления:",
    defaultPaymentInstructions: "Оплатите по реквизитам и пришлите скриншот.",
    createRequestFailed: "Не удалось создать заявку. Попробуйте позже.",
    paymentChosenLabel: "Вы выбрали тариф:",
    paymentDueLabel: "К оплате:",
    paymentAfterPay:
      "После оплаты отправьте чек прямо в этот чат — фото или файлом (PDF тоже подойдёт).",
    noPendingTariff: "У вас нет ожидающих оплаты тарифов. Нажмите /start чтобы выбрать тариф.",
    proofResubmitNotified:
      "✅ Новый чек получен! Предыдущий заменён. Ожидайте подтверждения администратором.",
    proofResubmitQuiet: "✅ Чек обновлён. Не присылайте чаще раза в минуту — админ уже уведомлён.",
    proofReceived:
      "✅ Чек получен! Ожидайте подтверждения администратором. После проверки вы получите доступ к VIP-группе.",
    alreadyPendingPublic: "⏳ Заявка уже ждёт подтверждения оплаты",
    sendProofIfNotYet: "Пришлите чек, если ещё не отправили.",
  },
  kk: {
    btnRenew: "🔄 Ұзарту",
    btnStatus: "📋 Менің мәртебем",
    btnId: "🆔 Менің ID-м",
    btnHelp: "ℹ️ Көмек",
    btnLang: "🌐 Тіл",
    chooseLanguage: "Тілді таңдаңыз",
    languageSaved: "✅ Тіл сақталды.",
    statusTitle: "📋 <b>Сіздің VIP мәртебеңіз</b>",
    statusActive: "Мәртебе: <b>белсенді</b>",
    statusTariff: "Тариф:",
    statusValidUntil: "Мерзімі дейін:",
    statusRenewHint: "Мерзімінен бұрын ұзарту үшін «{btn}» батырмасын басыңыз.",
    statusPending: "Мәртебе: <b>төлем растауын күтуде</b>",
    statusPendingHint: "Егер чекті әлі жібермеген болсаңыз — төлем скриншотын осы чатқа жіберіңіз.",
    statusNone: "Қазір белсенді жазылым жоқ.",
    statusNoneHint: "Қолжетімділік алу үшін «{btn}» батырмасын немесе /start пәрменін басыңыз.",
    helpTitle: "ℹ️ <b>VIP көмегі</b>",
    helpRenewLine: "• <b>{btn}</b> — тарифті таңдау / қолжетімділікті ұзарту",
    helpStatusLine: "• <b>{btn}</b> — жазылым мерзімі және төлем мәртебесі",
    helpIdLine: "• <b>{btn}</b> — сіздің Telegram ID-іңіз (қолмен қосу үшін)",
    helpPhotoLine: "• Төлегеннен кейін <b>чекті</b> осы чатқа жіберіңіз — фото немесе файл түрінде",
    helpCommandsLine: "Пәрмендер: /start — мәзір, /id — сіздің ID",
    myIdLabel: "Сіздің Telegram ID-іңіз:",
    myIdUsername: "Username:",
    myIdHint: "Бұл ID VIP-әкімшілікте қолмен қосу үшін керек.",
    tariffsLoadError: "Тарифтерді жүктеу мүмкін болмады. Кейінірек қайталап көріңіз.",
    tempError: "Сұранысты орындау мүмкін болмады. Бір минуттан кейін қайталап көріңіз.",
    tariffsEmptyRenew:
      "Ұзарту үшін жария тарифтер жоқ. Жеке тариф сілтемеңізді пайдаланыңыз немесе әкімшіге жазыңыз.",
    tariffsEmptyDefault: "Қазіргі уақытта қолжетімді тарифтер жоқ.",
    tariffsIntroInGroup:
      "VIP ұзарту: тарифті таңдаңыз. Төлегеннен кейін мерзім ұзарады — сіз топта қаласыз, жаңа сілтеме керек емес.",
    tariffsIntroRenew:
      "Тарифті таңдаңыз. Төлем расталғаннан кейін топқа кіру үшін бір реттік сілтеме жібереміз.",
    tariffsIntroDefault: "VIP жазылымы үшін тарифті таңдаңыз:",
    entryTitle: "👋 <b>VIP-ке алғашқы кіру</b>",
    entryDesc: "Бір реттік кіру + {days} күнге қолжетімділік.",
    entryPriceLabel: "Құны:",
    entryAfterPay: "Төлем расталғаннан кейін топқа сілтеме аласыз.",
    entryFurtherRenew: "Келесі ұзартулар — жеке тарифтер бойынша.",
    entryPayButton: "Кіру үшін төлеу — {price} {currency}",
    tariffLinkNotFound:
      "Бұл сілтеме бойынша тариф табылмады немесе өшірілген. Жалпы тізім үшін /start басыңыз.",
    vipMenuPinned: "VIP мәзірі төменде бекітілген.",
    startPendingTitle: "⏳ Сізде <b>төлем растауын күтетін</b> өтінім бұрыннан бар.",
    startPendingNoNewNeeded: "Жаңа тариф рәсімдеудің қажеті жоқ.",
    startPendingSendProof:
      "Егер чекті әлі жібермеген болсаңыз — төлем скриншотын осы чатқа жіберіңіз.",
    startPendingStatusHint: "Мәртебені «{btn}» батырмасынан көруге болады.",
    startRenewInGroup: "VIP ұзарту — мәзір батырмалары төменде. Тарифті төменнен таңдаңыз.",
    startRenewNotInGroup:
      "VIP-ке қайта оралу — тарифті төменнен таңдаңыз. Төлегеннен кейін топқа бір реттік сілтеме келеді.",
    startWelcome: "VIP-ботқа қош келдіңіз. Мәзір экранның төменінде — тарифтер төменде.",
    assignedRenewInGroup: "VIP ұзарту — сіздің жеке тарифіңіз:",
    assignedRenewNotInGroup: "Сіздің жеке VIP тарифіңіз:",
    assignedAfterPay: "Төлегеннен кейін — топқа бір реттік сілтеме.",
    payButton: "Төлеу — {price} {currency}",
    otherPublicTariffs: "Басқа жария тарифтер",
    tariffNotFoundShort: "Тариф табылмады.",
    tariffInactive: "Бұл тариф енді белсенді емес. Басқасын таңдау үшін /start басыңыз.",
    entryOnlyForNew:
      "«Алғашқы кіру» тарифі тек жаңа қатысушыларға қолжетімді. Ұзарту тарифін таңдаңыз:",
    defaultPaymentInstructions: "Реквизиттер бойынша төлеп, скриншот жіберіңіз.",
    createRequestFailed: "Өтінім жасау мүмкін болмады. Кейінірек қайталап көріңіз.",
    paymentChosenLabel: "Сіз таңдаған тариф:",
    paymentDueLabel: "Төлеуге тиіс:",
    paymentAfterPay:
      "Төлегеннен кейін чекті осы чатқа тікелей жіберіңіз — фото немесе файл түрінде (PDF де жарайды).",
    noPendingTariff: "Сізде төлемді күтетін тарифтер жоқ. Тариф таңдау үшін /start басыңыз.",
    proofResubmitNotified: "✅ Жаңа чек алынды! Алдыңғысы ауыстырылды. Әкімші растауын күтіңіз.",
    proofResubmitQuiet:
      "✅ Чек жаңартылды. Минутына бір реттен жиі жібермеңіз — әкімшіге хабарланды.",
    proofReceived:
      "✅ Чек алынды! Әкімші растауын күтіңіз. Тексеруден кейін VIP-топқа қолжетімділік аласыз.",
    alreadyPendingPublic: "⏳ Өтінім төлем растауын күтуде",
    sendProofIfNotYet: "Егер әлі жібермеген болсаңыз — чекті жіберіңіз.",
  },
  en: {
    btnRenew: "🔄 Renew",
    btnStatus: "📋 My status",
    btnId: "🆔 My ID",
    btnHelp: "ℹ️ Help",
    btnLang: "🌐 Language",
    chooseLanguage: "Choose your language",
    languageSaved: "✅ Language saved.",
    statusTitle: "📋 <b>Your VIP status</b>",
    statusActive: "Status: <b>active</b>",
    statusTariff: "Plan:",
    statusValidUntil: "Valid until:",
    statusRenewHint: "To renew early — tap «{btn}».",
    statusPending: "Status: <b>awaiting payment confirmation</b>",
    statusPendingHint:
      "If you haven't sent a receipt yet — send a payment screenshot to this chat.",
    statusNone: "You have no active subscription right now.",
    statusNoneHint: "Tap «{btn}» or /start to get access.",
    helpTitle: "ℹ️ <b>VIP help</b>",
    helpRenewLine: "• <b>{btn}</b> — choose a plan / renew access",
    helpStatusLine: "• <b>{btn}</b> — subscription term and payment status",
    helpIdLine: "• <b>{btn}</b> — your Telegram ID (for manual add)",
    helpPhotoLine: "• After paying, send the <b>receipt</b> to this chat — as a photo or a file",
    helpCommandsLine: "Commands: /start — menu, /id — your ID",
    myIdLabel: "Your Telegram ID:",
    myIdUsername: "Username:",
    myIdHint: "This ID is needed to add you manually in the VIP admin panel.",
    tariffsLoadError: "Couldn't load plans. Please try again later.",
    tempError: "Couldn't complete the request. Please try again in a minute.",
    tariffsEmptyRenew: "No public renewal plans. Use your personal plan link or contact the admin.",
    tariffsEmptyDefault: "No plans are available right now.",
    tariffsIntroInGroup:
      "VIP renewal: choose a plan. After payment your term extends — you stay in the group, no new link needed.",
    tariffsIntroRenew:
      "Choose a plan. After payment is confirmed we'll send a one-time link to join the group.",
    tariffsIntroDefault: "Choose a VIP subscription plan:",
    entryTitle: "👋 <b>First VIP entry</b>",
    entryDesc: "One-time entry + access for {days} days.",
    entryPriceLabel: "Price:",
    entryAfterPay: "After payment is confirmed, you'll get a link to the group.",
    entryFurtherRenew: "Further renewals use separate plans.",
    entryPayButton: "Pay for entry — {price} {currency}",
    tariffLinkNotFound:
      "The plan behind this link was not found or is disabled. Tap /start for the general list.",
    vipMenuPinned: "The VIP menu is pinned below.",
    startPendingTitle: "⏳ You already have a request <b>awaiting payment confirmation</b>.",
    startPendingNoNewNeeded: "No need to place a new plan.",
    startPendingSendProof:
      "If you haven't sent a receipt yet — send a payment screenshot to this chat.",
    startPendingStatusHint: "You can check the status with the «{btn}» button.",
    startRenewInGroup: "VIP renewal — the menu buttons are below. Choose a plan below.",
    startRenewNotInGroup:
      "Returning to VIP — choose a plan below. After payment a one-time link to the group will arrive.",
    startWelcome:
      "Welcome to the VIP bot. The menu is at the bottom of the screen — plans are below.",
    assignedRenewInGroup: "VIP renewal — your personal plan:",
    assignedRenewNotInGroup: "Your personal VIP plan:",
    assignedAfterPay: "After payment — a one-time link to the group.",
    payButton: "Pay — {price} {currency}",
    otherPublicTariffs: "Other public plans",
    tariffNotFoundShort: "Plan not found.",
    tariffInactive: "This plan is no longer active. Tap /start to choose another one.",
    entryOnlyForNew: "The «First entry» plan is only for new members. Choose a renewal plan:",
    defaultPaymentInstructions: "Pay using the details provided and send a screenshot.",
    createRequestFailed: "Couldn't create the request. Please try again later.",
    paymentChosenLabel: "You chose the plan:",
    paymentDueLabel: "Amount due:",
    paymentAfterPay:
      "After paying, send the receipt directly to this chat — as a photo or a file (PDF works too).",
    noPendingTariff: "You have no plans awaiting payment. Tap /start to choose a plan.",
    proofResubmitNotified:
      "✅ New receipt received! The previous one was replaced. Awaiting admin confirmation.",
    proofResubmitQuiet:
      "✅ Receipt updated. Please don't send more than once a minute — the admin has already been notified.",
    proofReceived:
      "✅ Receipt received! Awaiting admin confirmation. You'll get access to the VIP group once it's checked.",
    alreadyPendingPublic: "⏳ Your request is already awaiting payment confirmation",
    sendProofIfNotYet: "Send the receipt if you haven't yet.",
  },
  uz: {
    btnRenew: "🔄 Uzaytirish",
    btnStatus: "📋 Mening holatim",
    btnId: "🆔 Mening ID’im",
    btnHelp: "ℹ️ Yordam",
    btnLang: "🌐 Til",
    chooseLanguage: "Tilni tanlang",
    languageSaved: "✅ Til saqlandi.",
    statusTitle: "📋 <b>Sizning VIP holatingiz</b>",
    statusActive: "Holat: <b>faol</b>",
    statusTariff: "Tarif:",
    statusValidUntil: "Amal qilish muddati:",
    statusRenewHint: "Muddatidan oldin uzaytirish uchun «{btn}» tugmasini bosing.",
    statusPending: "Holat: <b>to‘lov tasdiqlanishini kutmoqda</b>",
    statusPendingHint:
      "Agar chekni hali yubormagan bo‘lsangiz — to‘lov skrinshotini shu chatga yuboring.",
    statusNone: "Hozircha faol obuna yo‘q.",
    statusNoneHint: "Kirish olish uchun «{btn}» tugmasini yoki /start buyrug‘ini bosing.",
    helpTitle: "ℹ️ <b>VIP yordami</b>",
    helpRenewLine: "• <b>{btn}</b> — tarif tanlash / kirishni uzaytirish",
    helpStatusLine: "• <b>{btn}</b> — obuna muddati va to‘lov holati",
    helpIdLine: "• <b>{btn}</b> — Telegram ID’ingiz (qo‘lda qo‘shish uchun)",
    helpPhotoLine: "• To‘lovdan so‘ng <b>chekni</b> shu chatga yuboring — foto yoki fayl sifatida",
    helpCommandsLine: "Buyruqlar: /start — menyu, /id — ID’ingiz",
    myIdLabel: "Sizning Telegram ID’ingiz:",
    myIdUsername: "Username:",
    myIdHint: "Bu ID VIP-adminpanelda qo‘lda qo‘shish uchun kerak.",
    tariffsLoadError: "Tariflarni yuklab bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.",
    tempError: "So‘rovni bajarib bo‘lmadi. Bir daqiqadan so‘ng qayta urinib ko‘ring.",
    tariffsEmptyRenew:
      "Uzaytirish uchun ommaviy tariflar yo‘q. Shaxsiy tarif havolangizdan foydalaning yoki administratorga yozing.",
    tariffsEmptyDefault: "Hozirda mavjud tariflar yo‘q.",
    tariffsIntroInGroup:
      "VIP’ni uzaytirish: tarifni tanlang. To‘lovdan so‘ng muddat uzayadi — siz guruhda qolasiz, yangi havola kerak emas.",
    tariffsIntroRenew:
      "Tarifni tanlang. To‘lov tasdiqlangach, guruhga kirish uchun bir martalik havola yuboramiz.",
    tariffsIntroDefault: "VIP obunasi uchun tarifni tanlang:",
    entryTitle: "👋 <b>VIP’ga birinchi kirish</b>",
    entryDesc: "Bir martalik kirish + {days} kunlik kirish huquqi.",
    entryPriceLabel: "Narxi:",
    entryAfterPay: "To‘lov tasdiqlangach guruhga havola olasiz.",
    entryFurtherRenew: "Keyingi uzaytirishlar alohida tariflar bo‘yicha amalga oshiriladi.",
    entryPayButton: "Kirish uchun to‘lash — {price} {currency}",
    tariffLinkNotFound:
      "Ushbu havoladagi tarif topilmadi yoki o‘chirilgan. Umumiy ro‘yxat uchun /start ni bosing.",
    vipMenuPinned: "VIP menyusi pastda mahkamlangan.",
    startPendingTitle: "⏳ Sizda allaqachon <b>to‘lov tasdiqlanishini kutayotgan</b> so‘rov bor.",
    startPendingNoNewNeeded: "Yangi tarif rasmiylashtirish shart emas.",
    startPendingSendProof:
      "Agar chekni hali yubormagan bo‘lsangiz — to‘lov skrinshotini shu chatga yuboring.",
    startPendingStatusHint: "Holatni «{btn}» tugmasi orqali ko‘rishingiz mumkin.",
    startRenewInGroup: "VIP’ni uzaytirish — menyu tugmalari pastda. Tarifni pastdan tanlang.",
    startRenewNotInGroup:
      "VIP’ga qaytish — tarifni pastdan tanlang. To‘lovdan so‘ng guruhga bir martalik havola keladi.",
    startWelcome: "VIP-botga xush kelibsiz. Menyu ekran pastida — tariflar pastda.",
    assignedRenewInGroup: "VIP’ni uzaytirish — sizning shaxsiy tarifingiz:",
    assignedRenewNotInGroup: "Sizning shaxsiy VIP tarifingiz:",
    assignedAfterPay: "To‘lovdan so‘ng — guruhga bir martalik havola.",
    payButton: "To‘lash — {price} {currency}",
    otherPublicTariffs: "Boshqa ommaviy tariflar",
    tariffNotFoundShort: "Tarif topilmadi.",
    tariffInactive: "Bu tarif endi faol emas. Boshqasini tanlash uchun /start ni bosing.",
    entryOnlyForNew:
      "«Birinchi kirish» tarifi faqat yangi a’zolar uchun. Uzaytirish tarifini tanlang:",
    defaultPaymentInstructions: "Rekvizitlar bo‘yicha to‘lang va skrinshot yuboring.",
    createRequestFailed: "So‘rov yaratib bo‘lmadi. Birozdan so‘ng qayta urinib ko‘ring.",
    paymentChosenLabel: "Siz tanlagan tarif:",
    paymentDueLabel: "To‘lash summasi:",
    paymentAfterPay:
      "To‘lovdan so‘ng chekni to‘g‘ridan-to‘g‘ri shu chatga yuboring — foto yoki fayl sifatida (PDF ham bo‘ladi).",
    noPendingTariff:
      "Sizda to‘lovni kutayotgan tariflar yo‘q. Tarif tanlash uchun /start ni bosing.",
    proofResubmitNotified:
      "✅ Yangi chek qabul qilindi! Avvalgisi almashtirildi. Administrator tasdig‘ini kuting.",
    proofResubmitQuiet:
      "✅ Chek yangilandi. Daqiqasiga bir martadan ko‘p yubormang — administratorga allaqachon xabar berildi.",
    proofReceived:
      "✅ Chek qabul qilindi! Administrator tasdig‘ini kuting. Tekshiruvdan so‘ng VIP guruhiga kirish huquqini olasiz.",
    alreadyPendingPublic: "⏳ So‘rov allaqachon to‘lov tasdiqlanishini kutmoqda",
    sendProofIfNotYet: "Agar hali yubormagan bo‘lsangiz — chekni yuboring.",
  },
};

/** True if `text` is the translated label of `field` in any supported locale. */
function isVipButton(text: string, field: VipCopyKey): boolean {
  return SUPPORTED_LOCALES.some((l) => vipCopy[l][field] === text);
}

function vipLanguageKeyboard() {
  return {
    inline_keyboard: SUPPORTED_LOCALES.map((locale) => [
      { text: localeNames[locale], callback_data: `vip_locale:${locale}` },
    ]),
  };
}

async function askVipLanguage(chat_id: number) {
  await tgVip("sendMessage", {
    chat_id,
    text: vipCopy.ru.chooseLanguage,
    reply_markup: vipLanguageKeyboard(),
  });
}

function mainMenuKeyboard(locale: Locale = "ru") {
  const c = vipCopy[locale];
  return {
    keyboard: [
      [{ text: c.btnRenew }, { text: c.btnStatus }],
      [{ text: c.btnId }, { text: c.btnHelp }],
      [{ text: c.btnLang }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function sendWithMenu(
  chat_id: number,
  text: string,
  locale: Locale = "ru",
  extra?: Record<string, unknown>,
) {
  await tgVip("sendMessage", {
    chat_id,
    text,
    reply_markup: mainMenuKeyboard(locale),
    ...extra,
  });
}

async function showStatus(chat_id: number, telegram_id: number, locale: Locale = "ru") {
  const c = vipCopy[locale];
  const s = await db();
  const now = new Date();
  const { data: active, error: activeError } = await s
    .from("vip_subscriptions")
    .select("expires_at, status, vip_tariffs(name, price, currency)")
    .eq("telegram_id", telegram_id)
    .eq("status", "active")
    .gt("expires_at", now.toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) {
    console.error("[vip-bot] showStatus: active lookup failed", activeError);
    await tgVip("sendMessage", { chat_id, text: c.tempError });
    return;
  }

  if (active) {
    const tariff = active.vip_tariffs as {
      name?: string;
      price?: number;
      currency?: string;
    } | null;
    const until = formatDateTimeRu(active.expires_at as string);
    await sendWithMenu(
      chat_id,
      `${c.statusTitle}\n\n` +
        `${c.statusActive}\n` +
        `${c.statusTariff} ${escapeHtml(String(tariff?.name ?? "—"))}\n` +
        `${c.statusValidUntil} <b>${escapeHtml(until)}</b>\n\n` +
        fmt(c.statusRenewHint, { btn: c.btnRenew }),
      locale,
      { parse_mode: "HTML" },
    );
    return;
  }

  const { data: pending, error: pendingError } = await s
    .from("vip_subscriptions")
    .select("id, vip_tariffs(name, price, currency)")
    .eq("telegram_id", telegram_id)
    .eq("status", "pending_payment")
    .maybeSingle();

  if (pendingError) {
    console.error("[vip-bot] showStatus: pending lookup failed", pendingError);
    await tgVip("sendMessage", { chat_id, text: c.tempError });
    return;
  }

  if (pending) {
    const tariff = pending.vip_tariffs as {
      name?: string;
      price?: number;
      currency?: string;
    } | null;
    await sendWithMenu(
      chat_id,
      `${c.statusTitle}\n\n` +
        `${c.statusPending}\n` +
        `${c.statusTariff} ${escapeHtml(String(tariff?.name ?? "—"))}\n\n` +
        c.statusPendingHint,
      locale,
      { parse_mode: "HTML" },
    );
    return;
  }

  await sendWithMenu(
    chat_id,
    `${c.statusTitle}\n\n${c.statusNone}\n${fmt(c.statusNoneHint, { btn: c.btnRenew })}`,
    locale,
    { parse_mode: "HTML" },
  );
}

async function showHelp(chat_id: number, locale: Locale = "ru") {
  const c = vipCopy[locale];
  await sendWithMenu(
    chat_id,
    `${c.helpTitle}\n\n` +
      `${fmt(c.helpRenewLine, { btn: c.btnRenew })}\n` +
      `${fmt(c.helpStatusLine, { btn: c.btnStatus })}\n` +
      `${fmt(c.helpIdLine, { btn: c.btnId })}\n` +
      `${c.helpPhotoLine}\n\n` +
      c.helpCommandsLine,
    locale,
    { parse_mode: "HTML" },
  );
}

async function showMyId(chat_id: number, from: TelegramUser, locale: Locale = "ru") {
  const c = vipCopy[locale];
  const from_id = from?.id;
  const un = from?.username ? `\n${c.myIdUsername} @${escapeHtml(String(from.username))}` : "";
  await sendWithMenu(
    chat_id,
    `${c.myIdLabel} <code>${from_id}</code>${un}\n\n${c.myIdHint}`,
    locale,
    { parse_mode: "HTML" },
  );
}

/** True if Telegram error means user is already not in the group. */
export function isAlreadyNotInChat(description?: string): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return (
    d.includes("user_not_participant") ||
    d.includes("user not found") ||
    d.includes("chat_not_found") ||
    d.includes("participant_id_invalid") ||
    d.includes("user_id_invalid")
  );
}

async function showTariffs(
  chat_id: number,
  locale: Locale = "ru",
  opts?: { renew?: boolean; inGroup?: boolean },
) {
  const c = vipCopy[locale];
  const s = await db();
  // Renewal list: public active tariffs, but never the first-entry package
  const q = s
    .from("vip_tariffs")
    .select("*")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order");

  const { data: all, error } = await q;
  if (error) {
    console.error("[vip-bot] showTariffs", error);
    await tgVip("sendMessage", { chat_id, text: c.tariffsLoadError });
    return;
  }

  const tariffs = (all ?? []).filter((t) => !t.is_entry);

  if (tariffs.length === 0) {
    await tgVip("sendMessage", {
      chat_id,
      text: opts?.renew ? c.tariffsEmptyRenew : c.tariffsEmptyDefault,
    });
    return;
  }

  const buttons = tariffs.map((t) => [
    { text: `${t.name} — ${t.price} ${t.currency}`, callback_data: `buy_tariff:${t.id}` },
  ]);

  // Copy must match reality: don't promise "stay in group" if user is not a member
  const intro = opts?.inGroup
    ? c.tariffsIntroInGroup
    : opts?.renew
      ? c.tariffsIntroRenew
      : c.tariffsIntroDefault;

  await tgVip("sendMessage", {
    chat_id,
    text: intro,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function userHadPaidAccess(
  s: Awaited<ReturnType<typeof db>>,
  telegram_id: number,
): Promise<boolean> {
  // Real past/present access only (not cancelled / pending)
  const { count } = await s
    .from("vip_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("telegram_id", telegram_id)
    .in("status", ["active", "expired"]);
  return (count ?? 0) > 0;
}

/** Parse /start payload including /start@BotName renew and /start t_uuid */
function parseStartPayload(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed.toLowerCase().startsWith("/start")) return "";
  const parts = trimmed.split(/\s+/);
  return parts.slice(1).join(" ").trim();
}

const TG_CAPTION_MAX = 1024;

async function sendPaymentInstructions(
  chat_id: number,
  paymentText: string,
  qrPath: string | undefined,
) {
  if (qrPath) {
    if (paymentText.length <= TG_CAPTION_MAX) {
      await tgVip("sendPhoto", {
        chat_id,
        photo: imageUrl(qrPath),
        caption: paymentText,
        parse_mode: "HTML",
      });
    } else {
      // Caption limit 1024 — send QR then full text separately
      await tgVip("sendPhoto", { chat_id, photo: imageUrl(qrPath) });
      await tgVip("sendMessage", { chat_id, text: paymentText, parse_mode: "HTML" });
    }
  } else {
    await tgVip("sendMessage", {
      chat_id,
      text: paymentText,
      parse_mode: "HTML",
    });
  }
}

async function showEntryOffer(chat_id: number, from: TelegramUser, locale: Locale = "ru") {
  const c = vipCopy[locale];
  const s = await db();
  const { data: entry, error } = await s
    .from("vip_tariffs")
    .select("*")
    .eq("is_entry", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    // Two concurrently-saved entry tariffs would land here too (the
    // uniqueness is only enforced by a read-modify-write in
    // vip-tariffs.functions.ts, not a DB constraint) — falling back to the
    // renewal list is still a safe, working flow either way.
    console.error("[vip-bot] showEntryOffer: ambiguous or failed entry lookup", error);
  }

  if (!entry) {
    // Entry disabled / missing (or the error case above) — fall back to renewal list
    await showTariffs(chat_id, locale);
    return;
  }

  await tgVip("sendMessage", {
    chat_id,
    text:
      `${c.entryTitle}\n\n` +
      `${fmt(c.entryDesc, { days: String(entry.duration_days) })}\n` +
      `${c.entryPriceLabel} <b>${escapeHtml(String(entry.price))} ${escapeHtml(String(entry.currency))}</b>\n\n` +
      `${c.entryAfterPay}\n` +
      c.entryFurtherRenew,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: fmt(c.entryPayButton, {
              price: String(entry.price),
              currency: String(entry.currency),
            }),
            callback_data: `buy_tariff:${entry.id}`,
          },
        ],
      ],
    },
  });
}

/** Deep-link to a (possibly hidden) tariff: /start t_<uuid> */
async function handleTariffDeepLink(
  chat_id: number,
  from: TelegramUser,
  tariffId: string,
  locale: Locale = "ru",
) {
  const c = vipCopy[locale];
  const s = await db();
  // id is the table's PK — a matching-row ambiguity can't happen here, only
  // a genuine query error, which is worth logging even though the existing
  // "tariff not found" fallback is still a reasonable response to it.
  const { data: tariff, error } = await s
    .from("vip_tariffs")
    .select("*")
    .eq("id", tariffId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) console.error("[vip-bot] handleTariffDeepLink lookup failed", error);

  if (!tariff) {
    await tgVip("sendMessage", { chat_id, text: c.tariffLinkNotFound });
    return;
  }

  // Remember hidden renew tariff (not entry) — next /start uses it
  if (tariff.is_public === false && !tariff.is_entry) {
    await assignMemberTariff(s, from.id, from, tariff.id, "deep_link");
  }

  await handleBuyTariff(chat_id, from.id, from, tariff.id, locale);
}

/** /start or /start renew (кнопка «Продлить») */
async function showStartFlow(
  chat_id: number,
  from: TelegramUser,
  renew?: boolean,
  locale: Locale = "ru",
) {
  const c = vipCopy[locale];
  const s = await db();

  // Уже ждёт подтверждения оплаты — не предлагаем новый тариф / «первый вход»
  const { data: pending, error: pendingError } = await s
    .from("vip_subscriptions")
    .select("id, vip_tariffs(name, price, currency)")
    .eq("telegram_id", from.id)
    .eq("status", "pending_payment")
    .maybeSingle();

  // Falls through to the normal /start flow on error — degraded (a customer
  // with a real pending payment would see the tariff picker instead of
  // their pending status) but not stuck, unlike handlePhoto's equivalent.
  if (pendingError) {
    console.error("[vip-bot] showStartFlow: pending lookup failed", pendingError);
  }

  if (pending) {
    const tariff = pending.vip_tariffs as {
      name?: string;
      price?: number;
      currency?: string;
    } | null;
    await sendWithMenu(
      chat_id,
      `${c.startPendingTitle}\n` +
        `${c.statusTariff} ${escapeHtml(String(tariff?.name ?? "—"))}\n\n` +
        `${c.startPendingNoNewNeeded}\n` +
        `${c.startPendingSendProof}\n` +
        fmt(c.startPendingStatusHint, { btn: c.btnStatus }),
      locale,
      { parse_mode: "HTML" },
    );
    return;
  }

  const hadAccess = await userHadPaidAccess(s, from.id);
  const settings = await getVipSettings();
  const groupId = (settings.vip_group_id || "").trim();
  const inGroup = groupId ? await isVipGroupMember(groupId, from.id) : false;

  // «Продлить» без истории оплаты = первый вход, не текст про «останётесь в группе»
  const wantRenew = !!(renew && hadAccess);

  await sendWithMenu(
    chat_id,
    wantRenew ? (inGroup ? c.startRenewInGroup : c.startRenewNotInGroup) : c.startWelcome,
    locale,
  );

  const assigned = await getMemberAssignedTariff(s, from.id);

  // Personal (legacy/cheap) renew — skip entry fee, but allow switching to public list
  if (assigned && !assigned.is_entry && (wantRenew || hadAccess)) {
    const t = assigned;
    const intro = inGroup
      ? `${c.assignedRenewInGroup}\n<b>${escapeHtml(String(t.name))}</b> — ${escapeHtml(String(t.price))} ${escapeHtml(String(t.currency))}`
      : `${c.assignedRenewNotInGroup}\n<b>${escapeHtml(String(t.name))}</b> — ${escapeHtml(String(t.price))} ${escapeHtml(String(t.currency))}\n\n${c.assignedAfterPay}`;
    await tgVip("sendMessage", {
      chat_id,
      text: intro,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: fmt(c.payButton, { price: String(t.price), currency: String(t.currency) }),
              callback_data: `buy_tariff:${t.id}`,
            },
          ],
          [{ text: c.otherPublicTariffs, callback_data: "buy_renew_public" }],
        ],
      },
    });
    return;
  }

  // Returning member (or renew with history) → renew tariffs
  if (wantRenew || hadAccess) {
    await showTariffs(chat_id, locale, { renew: true, inGroup });
    return;
  }

  // Brand-new user → first entry package
  await showEntryOffer(chat_id, from, locale);
}

async function handleBuyTariff(
  chat_id: number,
  telegram_id: number,
  user: TelegramUser,
  tariff_id: string,
  locale: Locale = "ru",
) {
  const c = vipCopy[locale];
  const s = await db();
  const { data: tariff } = await s.from("vip_tariffs").select("*").eq("id", tariff_id).single();
  if (!tariff) {
    await tgVip("sendMessage", { chat_id, text: c.tariffNotFoundShort });
    return;
  }
  if (!tariff.is_active) {
    await tgVip("sendMessage", { chat_id, text: c.tariffInactive });
    return;
  }

  // Entry package is one-time — returning members must use renew tariffs
  if (tariff.is_entry) {
    const hadAccess = await userHadPaidAccess(s, telegram_id);
    if (hadAccess) {
      const settings = await getVipSettings();
      const groupId = (settings.vip_group_id || "").trim();
      const inGroup = groupId ? await isVipGroupMember(groupId, telegram_id) : false;
      await tgVip("sendMessage", { chat_id, text: c.entryOnlyForNew });
      await showTariffs(chat_id, locale, { renew: true, inGroup });
      return;
    }
  }

  if (tariff.is_public === false && !tariff.is_entry) {
    await assignMemberTariff(s, telegram_id, user, tariff_id, "deep_link");
  }

  const settings = await getVipSettings();
  const instructions = settings.vip_payment_instructions || c.defaultPaymentInstructions;

  const { data: existingPendings } = await s
    .from("vip_subscriptions")
    .select("id, created_at")
    .eq("telegram_id", telegram_id)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false });

  const existingPending = existingPendings?.[0] ?? null;

  if (existingPending) {
    // Changing tariff invalidates previous proof
    await s
      .from("vip_subscriptions")
      .update({
        tariff_id,
        payment_proof_path: null,
        username: user?.username ?? null,
        first_name: user?.first_name ?? null,
        last_name: user?.last_name ?? null,
      })
      .eq("id", existingPending.id);

    // Race: cancel older duplicate pendings if any
    if ((existingPendings?.length ?? 0) > 1) {
      const olderIds = existingPendings!.slice(1).map((p) => p.id);
      await s
        .from("vip_subscriptions")
        .update({ status: "cancelled" })
        .in("id", olderIds)
        .eq("status", "pending_payment");
    }
  } else {
    // Не плодим «Отклонённые»: переиспользуем последнюю cancelled вместо новой строки
    const { data: cancelledRows } = await s
      .from("vip_subscriptions")
      .select("id")
      .eq("telegram_id", telegram_id)
      .eq("status", "cancelled")
      .order("created_at", { ascending: false });

    const reuseId = cancelledRows?.[0]?.id as string | undefined;
    if (reuseId) {
      const { error } = await s
        .from("vip_subscriptions")
        .update({
          tariff_id,
          status: "pending_payment",
          payment_proof_path: null,
          group_invite_link: null,
          admin_note: null,
          username: user?.username ?? null,
          first_name: user?.first_name ?? null,
          last_name: user?.last_name ?? null,
          expires_at: new Date().toISOString(),
        })
        .eq("id", reuseId)
        .eq("status", "cancelled");
      if (error) {
        await tgVip("sendMessage", { chat_id, text: c.createRequestFailed });
        console.error("[vip-bot] reuse cancelled failed", error);
        return;
      }
      const extraIds = (cancelledRows ?? []).slice(1).map((r) => r.id);
      if (extraIds.length > 0) {
        await s.from("vip_subscriptions").delete().in("id", extraIds);
      }
    } else {
      const { error } = await s.from("vip_subscriptions").insert({
        telegram_id,
        username: user?.username ?? null,
        first_name: user?.first_name ?? null,
        last_name: user?.last_name ?? null,
        tariff_id,
        status: "pending_payment",
        expires_at: new Date().toISOString(),
      });
      if (error) {
        await tgVip("sendMessage", { chat_id, text: c.createRequestFailed });
        console.error("[vip-bot] insert pending failed", error);
        return;
      }

      // After insert, collapse concurrent race duplicates — keep newest
      const { data: allPending } = await s
        .from("vip_subscriptions")
        .select("id, created_at")
        .eq("telegram_id", telegram_id)
        .eq("status", "pending_payment")
        .order("created_at", { ascending: false });

      if ((allPending?.length ?? 0) > 1) {
        const keepId = allPending![0].id;
        const olderIds = allPending!.slice(1).map((p) => p.id);
        await s
          .from("vip_subscriptions")
          .update({
            tariff_id,
            payment_proof_path: null,
            username: user?.username ?? null,
            first_name: user?.first_name ?? null,
            last_name: user?.last_name ?? null,
          })
          .eq("id", keepId);
        await s
          .from("vip_subscriptions")
          .update({ status: "cancelled" })
          .in("id", olderIds)
          .eq("status", "pending_payment");
      }
    }
  }

  const paymentText =
    `${c.paymentChosenLabel} <b>${escapeHtml(String(tariff.name))}</b>\n` +
    `${c.paymentDueLabel} <b>${escapeHtml(String(tariff.price))} ${escapeHtml(String(tariff.currency))}</b>\n\n` +
    `${escapeHtml(instructions)}\n\n` +
    c.paymentAfterPay;

  await sendPaymentInstructions(chat_id, paymentText, settings.vip_payment_qr_path || undefined);
}

async function handlePhoto(
  chat_id: number,
  from_id: number,
  fileId: string,
  kind: "photo" | "document",
  locale: Locale = "ru",
) {
  const c = vipCopy[locale];
  const s = await db();
  const { data: pendingSub, error: pendingSubError } = await s
    .from("vip_subscriptions")
    .select(
      "id, tariff_id, payment_proof_path, updated_at, username, first_name, last_name, vip_tariffs(name, price, currency)",
    )
    .eq("telegram_id", from_id)
    .eq("status", "pending_payment")
    .maybeSingle();

  // .maybeSingle() reports PGRST116 (data: null) on more than one matching
  // row, indistinguishable from "no row" unless the error is checked — this
  // is the exact failure mode that used to lose a customer's receipt: they
  // pay, send a screenshot, and silently hear "you have nothing pending".
  if (pendingSubError) {
    console.error("[vip-bot] handlePhoto: ambiguous or failed pending lookup", pendingSubError);
    await tgVip("sendMessage", { chat_id, text: c.tempError });
    return;
  }

  if (!pendingSub) {
    await tgVip("sendMessage", { chat_id, text: c.noPendingTariff });
    return;
  }

  const isResubmit = !!pendingSub.payment_proof_path;
  const lastTouch = pendingSub.updated_at ? new Date(pendingSub.updated_at as string).getTime() : 0;
  const PHOTO_COOLDOWN_MS = 60_000;
  // Повторные чеки чаще 1/мин — сохраняем, но не спамим админов в Telegram
  const notifyAdmins = !isResubmit || Date.now() - lastTouch >= PHOTO_COOLDOWN_MS;

  await tgVip("sendMessage", {
    chat_id,
    text: isResubmit
      ? notifyAdmins
        ? c.proofResubmitNotified
        : c.proofResubmitQuiet
      : c.proofReceived,
  });

  // Admin-facing notification stays Russian — the admin panel/notify chat is Russian-only.
  const tariff = pendingSub.vip_tariffs;
  // Имя/юзернейм уже лежат в самой строке подписки (записаны на шаге выбора
  // тарифа) — админ раньше видел только голый ID и должен был открывать
  // ссылку, чтобы понять, кто заплатил.
  const buyerName =
    [pendingSub.first_name, pendingSub.last_name].filter(Boolean).join(" ").trim() ||
    (pendingSub.username ? `@${pendingSub.username}` : "");
  const buyerLabel = buyerName ? `${escapeHtml(buyerName)} (ID ${from_id})` : `ID ${from_id}`;
  const adminText =
    `🆕 <b>Оплата VIP-подписки${isResubmit ? " (повторный чек)" : ""}</b>\n\n` +
    `Пользователь: <a href="tg://user?id=${from_id}">${buyerLabel}</a>\n` +
    `Тариф: <b>${escapeHtml(String(tariff?.name ?? ""))}</b>\n` +
    `Сумма: <b>${escapeHtml(String(tariff?.price ?? ""))} ${escapeHtml(String(tariff?.currency ?? ""))}</b>\n\n` +
    `Проверьте чек и подтвердите подписку.`;

  const settings = await getVipSettings();
  const adminIds = parseNotifyAdminIds(settings);

  if (adminIds.length === 0) {
    console.error("[vip-bot] No admin_chat_id / owner_chat_id configured — payment notify skipped");
  }

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Подтвердить", callback_data: `vip_confirm:${pendingSub.id}` },
        { text: "❌ Отклонить", callback_data: `vip_reject:${pendingSub.id}` },
      ],
    ],
  };

  const fileInfo = await downloadVipTelegramFile(fileId);
  let proofSaved = false;
  if (fileInfo) {
    // bot_id-префикс — payment-proofs общий на все деплои, см. bot.server.ts.
    const path = `${process.env.BOT_ID?.trim() || "unknown"}/vip-${pendingSub.id}/${Date.now()}.${fileInfo.ext}`;
    const { error } = await s.storage.from("payment-proofs").upload(path, fileInfo.bytes, {
      contentType: fileInfo.mime,
    });
    if (!error) {
      await s
        .from("vip_subscriptions")
        .update({ payment_proof_path: path })
        .eq("id", pendingSub.id);
      proofSaved = true;
    } else {
      console.error("[vip-bot] payment proof upload failed:", error.message);
    }
  } else {
    console.error("[vip-bot] failed to download payment proof from Telegram");
  }

  if (!notifyAdmins) return;

  const caption = proofSaved
    ? adminText
    : `${adminText}\n\n⚠️ Чек не сохранён в Storage — смотрите фото в этом сообщении.`;

  const captionSafe =
    caption.length > TG_CAPTION_MAX ? caption.slice(0, TG_CAPTION_MAX - 20) + "…" : caption;

  for (const adminId of adminIds) {
    // Telegram file_ids are tied to how the file was originally sent — a
    // document's file_id fails with sendPhoto (and vice versa), so the
    // forwarding method must match what the buyer actually sent (see the
    // same split in bot.server.ts's proof-forwarding path).
    if (kind === "document") {
      await tgVip("sendDocument", {
        chat_id: adminId,
        document: fileId,
        caption: captionSafe,
        parse_mode: "HTML",
        reply_markup,
      });
    } else {
      await tgVip("sendPhoto", {
        chat_id: adminId,
        photo: fileId,
        caption: captionSafe,
        parse_mode: "HTML",
        reply_markup,
      });
    }
  }
}

/** Admin-only replies (confirm/reject payment) stay Russian — the operator side is personal-use-only. */
async function requireVipAdmin(from_id: number, chat_id: number): Promise<boolean> {
  const settings = await getVipSettings();
  const adminIds = parseNotifyAdminIds(settings);
  if (adminIds.length === 0) {
    await tgVip("sendMessage", {
      chat_id,
      text: "Ошибка: не настроены admin_chat_id / owner_chat_id. Подтверждение из Telegram отключено.",
    });
    return false;
  }
  if (!isTelegramAdmin(from_id, adminIds)) {
    await tgVip("sendMessage", {
      chat_id,
      text: "⛔ Только администратор может подтверждать/отклонять оплату.",
    });
    return false;
  }
  return true;
}

export async function handleVipUpdate(update: TelegramUpdate) {
  try {
    if (update.message) {
      const msg = update.message;
      const chat_id = msg.chat.id;
      if (!msg.from) return;
      const from_id = msg.from.id;
      const text = msg.text || "";

      // VIP-бот только для лички (тарифы / чеки). В группе он админ и видит все посты —
      // отвечать там нельзя, иначе спам «нет ожидающих оплаты» на каждый файл.
      const chatType = msg.chat.type;
      if (chatType && chatType !== "private") {
        return;
      }

      if (await replyIfBlocked(chat_id, from_id, tgVip)) return;

      // Explicit UI language, chosen once via the /start language picker and
      // read back on every message — never inferred from Telegram's device
      // language. `storedLocale === null` means first contact.
      const storedLocale = await getVipLocaleRaw(from_id);
      const locale = storedLocale ?? "ru";
      const c = vipCopy[locale];

      if (text.startsWith("/start")) {
        const payload = parseStartPayload(text);
        // Hidden / special tariff deep-link: /start t_<uuid>
        if (payload.startsWith("t_")) {
          const tariffId = payload.slice(2);
          if (/^[0-9a-f-]{36}$/i.test(tariffId)) {
            await sendWithMenu(chat_id, c.vipMenuPinned, locale);
            await handleTariffDeepLink(chat_id, msg.from, tariffId, locale);
            if (!storedLocale) await askVipLanguage(chat_id);
            return;
          }
        }
        await showStartFlow(chat_id, msg.from, payload === "renew", locale);
        if (!storedLocale) await askVipLanguage(chat_id);
        return;
      }

      if (isVipButton(text, "btnLang") || text === "/language") {
        await askVipLanguage(chat_id);
        return;
      }

      if (text === "/id" || text.startsWith("/id@") || isVipButton(text, "btnId")) {
        await showMyId(chat_id, msg.from, locale);
        return;
      }

      if (isVipButton(text, "btnRenew") || text === "/renew") {
        await showStartFlow(chat_id, msg.from, true, locale);
        return;
      }

      if (isVipButton(text, "btnStatus") || text === "/status") {
        await showStatus(chat_id, from_id, locale);
        return;
      }

      if (isVipButton(text, "btnHelp") || text === "/help") {
        await showHelp(chat_id, locale);
        return;
      }

      if (msg.photo && msg.photo.length > 0) {
        const bestPhoto = msg.photo[msg.photo.length - 1];
        await handlePhoto(chat_id, from_id, bestPhoto.file_id, "photo", locale);
        return;
      }

      if (msg.document) {
        // Accept any document (PDF receipts included), not just images sent
        // uncompressed — matches bot.server.ts's proof handling, which never
        // rejected documents by mime type.
        await handlePhoto(chat_id, from_id, msg.document.file_id, "document", locale);
        return;
      }
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const chat_id = cq.message?.chat?.id;
      if (!chat_id || !cq.from) return;
      const from_id = cq.from.id;
      const data: string = cq.data || "";
      await tgVip("answerCallbackQuery", { callback_query_id: cq.id });

      const isAdminAction = data.startsWith("vip_confirm:") || data.startsWith("vip_reject:");
      if (!isAdminAction && (await replyIfBlocked(chat_id, from_id, tgVip))) return;

      if (data.startsWith("vip_locale:")) {
        const loc = data.slice("vip_locale:".length);
        if (!isLocale(loc)) return;
        await setVipLocale(from_id, cq.from, loc);
        await sendWithMenu(chat_id, vipCopy[loc].languageSaved, loc);
        return;
      }

      // Admin actions (vip_confirm/vip_reject) reply to the admin's own chat
      // in Russian regardless of the customer's locale — skip the lookup.
      const locale = isAdminAction ? "ru" : ((await getVipLocaleRaw(from_id)) ?? "ru");

      if (data.startsWith("buy_tariff:")) {
        await handleBuyTariff(chat_id, from_id, cq.from, data.slice(11), locale);
        return;
      }

      if (data === "buy_renew") {
        await showStartFlow(chat_id, cq.from, true, locale);
        return;
      }

      if (data === "buy_renew_public") {
        const c = vipCopy[locale];
        const s = await db();
        const { data: pending, error: pendingError } = await s
          .from("vip_subscriptions")
          .select("id, vip_tariffs(name)")
          .eq("telegram_id", from_id)
          .eq("status", "pending_payment")
          .maybeSingle();
        // Falls through to the tariff list on error, same trade-off as
        // showStartFlow's identical query — logged, not silently retried as
        // "successfully confirmed no pending row".
        if (pendingError) {
          console.error("[vip-bot] buy_renew_public: pending lookup failed", pendingError);
        }
        if (pending) {
          const tariff = pending.vip_tariffs as { name?: string } | null;
          await sendWithMenu(
            chat_id,
            `${c.alreadyPendingPublic}` +
              (tariff?.name ? ` (${escapeHtml(String(tariff.name))})` : "") +
              `.\n${c.sendProofIfNotYet}`,
            locale,
            { parse_mode: "HTML" },
          );
          return;
        }
        const settings = await getVipSettings();
        const groupId = (settings.vip_group_id || "").trim();
        const inGroup = groupId ? await isVipGroupMember(groupId, from_id) : false;
        await showTariffs(chat_id, locale, { renew: true, inGroup });
        return;
      }

      if (data.startsWith("vip_confirm:")) {
        if (!(await requireVipAdmin(from_id, chat_id))) return;
        const subId = data.slice(12);
        const { activateVipSubscription } = await import("./vip-subscriptions.functions");
        try {
          const result = await activateVipSubscription(subId);
          await tgVip("sendMessage", {
            chat_id,
            text: result.deliveryFailed
              ? `✅ Подписка подтверждена.\n\n⚠️ Ссылку не удалось отправить пользователю в Telegram (заблокировал бота?). Используйте «Переотправить» в /admin/vip/subscribers.`
              : `✅ Подписка подтверждена.`,
          });
          if (cq.message?.message_id) {
            await tgVip("editMessageReplyMarkup", {
              chat_id,
              message_id: cq.message.message_id,
              reply_markup: { inline_keyboard: [] },
            });
          }
        } catch (e: unknown) {
          await tgVip("sendMessage", { chat_id, text: `Ошибка: ${errorMessage(e)}` });
        }
        return;
      }

      if (data.startsWith("vip_reject:")) {
        if (!(await requireVipAdmin(from_id, chat_id))) return;
        const subId = data.slice(11);
        const { rejectVipSubscriptionCore } = await import("./vip-subscriptions.functions");
        try {
          const result = await rejectVipSubscriptionCore(subId);
          await tgVip("sendMessage", {
            chat_id,
            text: result.alreadyProcessed
              ? "Заявка уже обработана или не найдена."
              : "❌ Подписка отклонена.",
          });
          if (cq.message?.message_id) {
            await tgVip("editMessageReplyMarkup", {
              chat_id,
              message_id: cq.message.message_id,
              reply_markup: { inline_keyboard: [] },
            });
          }
        } catch (e: unknown) {
          await tgVip("sendMessage", { chat_id, text: `Ошибка отклонения: ${errorMessage(e)}` });
        }
        return;
      }
    }
  } catch (err) {
    console.error("[vip-bot] error handling update", err);
  }
}
