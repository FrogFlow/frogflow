import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Checkbox } from "@/components-ui/checkbox";
import { Textarea } from "@/components-ui/textarea";
import {
  getSettings,
  saveSetting,
  getShopUrl,
  getMiniAppUrl,
  getInstructionVideoUploadUrl,
  commitInstructionVideoFn,
  clearInstructionVideoFn,
} from "@/lib/settings.functions";
import { resetAllData } from "@/lib/reset.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import { t, type Locale } from "@/lib/i18n";
import { useModules } from "@/lib/modules/use-modules";
import { useVertical } from "@/lib/verticals/use-vertical";
import { VERTICALS } from "@/lib/verticals/registry";
import {
  DEFAULT_USD_PER_REQUEST,
  SMART_SEARCH_DAILY_LIMIT,
  formatUsd,
  parseDailyCount,
} from "@/lib/smart-search-cost";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

const copy: Record<
  Locale,
  {
    roles: { id: string; label: string }[];
    title: string;
    recipientsLabel: string;
    idsPlaceholder: string;
    recipientsHint: string;
    contactLabel: string;
    contactPlaceholder: string;
    contactHint: (btn: string) => string;
    save: string;
    savedLabel: string;
    deliveryLangTimingTitle: string;
    deliveryLangTimingHint: string;
    deliveryLangTimingBefore: string;
    deliveryLangTimingAfter: string;
    paymentModeTitle: string;
    paymentModeHint: string;
    /** Блок 11, находка 11.1 — способы получения физического заказа. */
    fulfillmentOptionsTitle: string;
    fulfillmentOptionsHint: string;
    fulfillmentOptionsPickup: string;
    fulfillmentOptionsDelivery: string;
    fulfillmentOptionsBothOffError: string;
    paymentModeFull: string;
    paymentModeDeposit: string;
    paymentModeOnReceipt: string;
    depositPercentLabel: string;
    depositPercentInvalid: string;
    referralTitle: string;
    referralHint: string;
    referralPercentLabel: string;
    loyaltyTitle: string;
    loyaltyHint: string;
    loyaltyEarnPercentLabel: string;
    cartReminderTitle: string;
    cartReminderHint: string;
    cartReminderHoursLabel: string;
    smartSearchTitle: string;
    smartSearchHint: string;
    smartSearchEnableLabel: string;
    smartSearchLastError: (detail: string) => string;
    smartSearchUsage: (used: number, limit: number) => string;
    smartSearchUsageHint: string;
    smartSearchRateSpend: (rate: string, usd: string) => string;
    webStorefrontTitle: string;
    webStorefrontHint: string;
    webStorefrontOpenBtn: string;
    webStorefrontCopyBtn: string;
    webStorefrontCopied: (link: string) => string;
    webStorefrontCopyPrompt: string;
    webStorefrontNoUrl: string;
    miniAppTitle: string;
    miniAppHint: string;
    miniAppOpenBtn: string;
    miniAppCopyBtn: string;
    miniAppCopied: (link: string) => string;
    miniAppCopyPrompt: string;
    miniAppNoUrl: string;
    instructionTitle: string;
    instructionHint: string;
    uploading: string;
    videoLabel: string;
    deleteVideoBtn: string;
    captionLabel: string;
    captionPlaceholder: string;
    captionPlaceholderPhysical: string;
    saveInstructionBtn: string;
    accessTitle: string;
    accessCreds: string;
    accessChangeHint: string;
    dangerTitle: string;
    dangerHint: string;
    resetBtn: string;
    resetting: string;
    resetDone: string;
    saveError: (msg: string) => string;
    uploadFailed: (name: string) => string;
    uploadError: string;
    confirmDeleteVideo: string;
    videoTooBig: string;
    resetConfirm1: string;
    resetConfirm2: string;
    unknownError: string;
  }
> = {
  ru: {
    roles: [
      { id: "1040879530", label: "Владелец" },
      { id: "7256670713", label: "Разработчик" },
    ],
    title: "Настройки",
    recipientsLabel: "Получатели уведомлений о заказах (Telegram ID)",
    idsPlaceholder: "например, 123456789, 987654321",
    recipientsHint:
      "Выберите роли из списка или впишите ID вручную (через запятую). Уведомления будут приходить всем указанным получателям.",
    contactLabel: "Ваш контакт для связи (кнопка в боте)",
    contactPlaceholder: "например, @my_username или ссылка на WhatsApp",
    contactHint: (btn) =>
      `Эта ссылка или текст будет показываться пользователям при нажатии на кнопку «${btn}».`,
    save: "Сохранить",
    savedLabel: "Сохранено ✓",
    deliveryLangTimingTitle: "Когда спрашивать язык материалов",
    deliveryLangTimingHint:
      "Актуально, только если у товаров заведено больше одного языка (модуль «Мультиязычность»). «После оплаты» — как раньше: кнопка выбора языка приходит вместе с файлами. «До оформления» — покупатель выбирает язык перед заказом и может выбрать «все языки» (цена ×N по числу языков товара).",
    deliveryLangTimingAfter: "После оплаты (как сейчас)",
    deliveryLangTimingBefore: "До оформления заказа",
    paymentModeTitle: "Оплата физических заказов",
    paymentModeHint:
      "Как принимать оплату за торты и десерты на заказ: полностью вперёд, задатком или при получении.",
    fulfillmentOptionsTitle: "Способы получения",
    fulfillmentOptionsHint:
      "Какие способы получения предлагать покупателю физического товара. Выключить можно только один — оба сразу оставили бы чекаут без единого варианта.",
    fulfillmentOptionsPickup: "Самовывоз",
    fulfillmentOptionsDelivery: "Доставка",
    fulfillmentOptionsBothOffError:
      "Нельзя выключить оба способа сразу — тогда получать заказ будет некуда.",
    paymentModeFull: "Полная оплата вперёд",
    paymentModeDeposit: "Задаток, остаток при получении",
    paymentModeOnReceipt: "Оплата при получении",
    depositPercentLabel: "Размер задатка, % от суммы",
    depositPercentInvalid: "Укажите число от 1 до 100.",
    referralTitle: "Реферальная программа",
    referralHint:
      "Покупатель делится персональной ссылкой из раздела «ℹ️ Информация». Новый пользователь по ссылке сразу получает одноразовый промокод; когда он получает первую покупку — такой же промокод получает пригласивший.",
    referralPercentLabel: "Размер скидки в промокоде (%)",
    loyaltyTitle: "Баллы за покупки",
    loyaltyHint:
      "После того как заказ выдан, покупателю начисляются баллы — процент от суммы заказа. 1 балл = 1 единица валюты. В следующей покупке баллы можно списать в счёт оплаты прямо из корзины.",
    loyaltyEarnPercentLabel: "Процент от суммы заказа в баллы (%)",
    cartReminderTitle: "Напоминание о брошенной корзине",
    cartReminderHint:
      "Если покупатель добавил товар в корзину и надолго замолчал, бот сам напомнит ему через указанное число часов, с кнопкой «Открыть корзину». 0 — напоминания выключены.",
    cartReminderHoursLabel: "Через сколько часов напоминать",
    smartSearchTitle: "Умный поиск по каталогу (LLM)",
    smartSearchHint:
      "Если обычный поиск ничего не нашёл, бот пробует понять запрос по смыслу через ИИ (например, «что-то на день рождения пятилетке»). Требует настроенный ANTHROPIC_API_KEY у деплоя — каждый такой запрос стоит денег, поэтому выключено по умолчанию.",
    smartSearchEnableLabel: "Включить умный поиск",
    smartSearchLastError: (detail: string) => `Последняя ошибка умного поиска: ${detail}`,
    smartSearchUsage: (used, limit) => `Сегодня: ${used} из ${limit} умных поисков`,
    smartSearchUsageHint:
      "Считаются запросы, по которым обычный поиск ничего не нашёл — в боте и в Mini App.",
    smartSearchRateSpend: (rate, usd) => `По ставке ${rate} / запрос: ${usd}`,
    webStorefrontTitle: "Публичная веб-витрина каталога",
    webStorefrontHint:
      "Публичная страница каталога — фото, названия, цены и рейтинг товаров, без входа. Купить с неё нельзя: кнопка на странице ведёт покупателя в сам бот. Дайте эту ссылку клиентам в шапке Instagram, рекламе и т.п.",
    webStorefrontOpenBtn: "Открыть витрину",
    webStorefrontCopyBtn: "Скопировать ссылку",
    webStorefrontCopied: (link: string) => `Ссылка скопирована: ${link}`,
    webStorefrontCopyPrompt: "Скопируйте ссылку на витрину:",
    webStorefrontNoUrl:
      "Адрес деплоя не определён (нет PUBLIC_APP_URL) — витрина не откроется, пока это не поправят в переменных окружения.",
    miniAppTitle: "Telegram Mini App",
    miniAppHint:
      "Магазин внутри Telegram: каталог и корзина в Mini App, оплата в чате с ботом. В главном меню бота появится кнопка «Магазин». Корзина общая с чатом.",
    miniAppOpenBtn: "Открыть Mini App",
    miniAppCopyBtn: "Скопировать ссылку",
    miniAppCopied: (link: string) => `Ссылка скопирована: ${link}`,
    miniAppCopyPrompt: "Скопируйте ссылку Mini App:",
    miniAppNoUrl:
      "Адрес деплоя не определён (нет PUBLIC_APP_URL) — Mini App не откроется, пока это не поправят в переменных окружения.",
    instructionTitle: "Инструкция для покупателей",
    instructionHint:
      "Кнопка «📖 Инструкция» в главном меню бота. Видео лучше до 50 МБ (лимит Telegram), формат MP4.",
    uploading: "Загрузка…",
    videoLabel: "Видео",
    deleteVideoBtn: "Удалить видео",
    captionLabel: "Текст под видео (как пользоваться / как оплата)",
    captionPlaceholder: "Кратко: каталог → корзина → оплата → чек…",
    captionPlaceholderPhysical: "Кратко: каталог → корзина → дата получения → оплата…",
    saveInstructionBtn: "Сохранить текст инструкции",
    accessTitle: "Доступ в админ-панель",
    accessCreds: "Логин и пароль:",
    accessChangeHint:
      "Для смены — обратитесь к разработчику или измените секреты ADMIN_USERNAME и ADMIN_PASSWORD в настройках проекта.",
    dangerTitle: "Опасная зона",
    dangerHint:
      "Полный сброс: удалит все товары, категории, изображения, файлы товаров, заказы, корзины пользователей и скриншоты оплаты. Счётчики обнулятся. Настройки и реквизиты оплаты сохранятся.",
    resetBtn: "Сбросить все данные",
    resetting: "Сбрасываю...",
    resetDone: "Готово ✓",
    saveError: (msg) => `Ошибка сохранения: ${msg}`,
    uploadFailed: (name) => `Не удалось загрузить ${name}`,
    uploadError: "Ошибка загрузки",
    confirmDeleteVideo: "Удалить видео инструкции?",
    videoTooBig: "Файл больше 50 МБ — Telegram на Vercel обычно не примет. Сожмите видео.",
    resetConfirm1:
      "Сбросить ВСЕ данные? Будут удалены все товары, категории, заказы и загруженные файлы. Действие необратимо.",
    resetConfirm2: "Точно? Это нельзя отменить.",
    unknownError: "Неизвестная ошибка",
  },
  kk: {
    roles: [
      { id: "1040879530", label: "Иесі" },
      { id: "7256670713", label: "Әзірлеуші" },
    ],
    title: "Баптаулар",
    recipientsLabel: "Тапсырыс хабарламаларын алушылар (Telegram ID)",
    idsPlaceholder: "мысалы, 123456789, 987654321",
    recipientsHint:
      "Тізімнен рөлдерді таңдаңыз немесе ID-ді қолмен енгізіңіз (үтірмен). Хабарламалар барлық көрсетілген алушыларға келеді.",
    contactLabel: "Байланысу үшін контактіңіз (ботта түйме)",
    contactPlaceholder: "мысалы, @my_username немесе WhatsApp сілтемесі",
    contactHint: (btn) =>
      `«${btn}» түймесін басқанда пайдаланушыларға осы сілтеме немесе мәтін көрсетіледі.`,
    save: "Сақтау",
    savedLabel: "Сақталды ✓",
    deliveryLangTimingTitle: "Материал тілін қашан сұрау керек",
    deliveryLangTimingHint:
      "Тек тауарда бірнеше тіл болса маңызды («Көптілділік» модулі). «Төлемнен кейін» — бұрынғыдай: тіл таңдау түймесі файлдармен бірге келеді. «Ресімдеуден бұрын» — сатып алушы тапсырыс алдында тілді таңдайды, «барлық тілдер» опциясы да бар (баға тауар тілдерінің санына ×N).",
    deliveryLangTimingAfter: "Төлемнен кейін (қазіргідей)",
    deliveryLangTimingBefore: "Тапсырысты ресімдеуден бұрын",
    paymentModeTitle: "Физикалық тапсырыстарды төлеу",
    paymentModeHint:
      "Тапсырысқа арнап дайындалатын торт пен десерттер үшін төлем: толық алдын ала, алдын ала төлем немесе алу кезінде.",
    fulfillmentOptionsTitle: "Алу тәсілдері",
    fulfillmentOptionsHint:
      "Физикалық тауарды алу үшін қандай тәсілдерді ұсыну керек. Тек біреуін ғана өшіруге болады — екеуін бірден өшірсе, тапсырысты алудың жолы қалмайды.",
    fulfillmentOptionsPickup: "Өзі алып кету",
    fulfillmentOptionsDelivery: "Жеткізу",
    fulfillmentOptionsBothOffError:
      "Екі тәсілді де бірден өшіруге болмайды — тапсырысты алатын жол қалмайды.",
    paymentModeFull: "Толық төлем алдын ала",
    paymentModeDeposit: "Алдын ала төлем, қалғаны алу кезінде",
    paymentModeOnReceipt: "Алу кезінде төлеу",
    depositPercentLabel: "Алдын ала төлем мөлшері, сомадан %",
    depositPercentInvalid: "1-ден 100-ге дейінгі санды көрсетіңіз.",
    referralTitle: "Реферал бағдарламасы",
    referralHint:
      "Сатып алушы «ℹ️ Ақпарат» бөлімінен жеке сілтемесімен бөліседі. Сілтеме бойынша жаңа пайдаланушы бірден бір реттік промокод алады; ол алғаш рет сатып алғанда — шақырған адам да сондай промокод алады.",
    referralPercentLabel: "Промокодтағы жеңілдік мөлшері (%)",
    loyaltyTitle: "Сатып алу үшін баллдар",
    loyaltyHint:
      "Тапсырыс берілгеннен кейін сатып алушыға баллдар есептеледі — тапсырыс сомасының пайызы. 1 балл = 1 валюта бірлігі. Келесі сатып алуда баллдарды тікелей себеттен төлемге есептеп шығаруға болады.",
    loyaltyEarnPercentLabel: "Тапсырыс сомасынан баллдарға пайыз (%)",
    cartReminderTitle: "Тасталған себет туралы еске салу",
    cartReminderHint:
      "Сатып алушы себетке тауар қосып, ұзақ үнсіз қалса, бот көрсетілген сағат саны өткен соң «Себетті ашу» түймесімен өзі еске салады. 0 — еске салулар өшірулі.",
    cartReminderHoursLabel: "Неше сағаттан кейін еске салу",
    smartSearchTitle: "Каталог бойынша ақылды іздеу (LLM)",
    smartSearchHint:
      "Әдеттегі іздеу ештеңе таппаса, бот сұранысты мағынасы бойынша ЖИ арқылы түсінуге тырысады (мысалы, «бес жасар балаға туған күнге бір нәрсе»). Деплойда ANTHROPIC_API_KEY бапталған болуы керек — әрбір осындай сұраныс ақылы, сондықтан әдепкі бойынша өшірулі.",
    smartSearchEnableLabel: "Ақылды іздеуді қосу",
    smartSearchLastError: (detail: string) => `Ақылды іздеудің соңғы қатесі: ${detail}`,
    smartSearchUsage: (used, limit) => `Бүгін: ${used} / ${limit} ақылды іздеу`,
    smartSearchUsageHint:
      "Қарапайым іздеу ештеңе таппаған сұраулар саналады — ботта және Mini App-та.",
    smartSearchRateSpend: (rate, usd) => `${rate} / сұрау мөлшерлемесімен: ${usd}`,
    webStorefrontTitle: "Каталогтың ашық веб-витринасы",
    webStorefrontHint:
      "Кірусіз қолжетімді каталог беті — фото, атаулар, бағалар және рейтинг. Одан сатып алу мүмкін емес: беттегі түйме сатып алушыны боттың өзіне апарады. Бұл сілтемені Instagram шапкасында, жарнамада және т.б. беріңіз.",
    webStorefrontOpenBtn: "Витринаны ашу",
    webStorefrontCopyBtn: "Сілтемені көшіру",
    webStorefrontCopied: (link: string) => `Сілтеме көшірілді: ${link}`,
    webStorefrontCopyPrompt: "Витринаға сілтемені көшіріңіз:",
    webStorefrontNoUrl:
      "Деплой мекенжайы анықталмаған (PUBLIC_APP_URL жоқ) — бұл айнымалыны түзеткенше витрина ашылмайды.",
    miniAppTitle: "Telegram Mini App",
    miniAppHint:
      "Telegram ішіндегі дүкен: Mini App-та каталог және себет, төлем ботпен чатта. Боттың негізгі мәзірінде «Дүкен» түймесі пайда болады. Себет чатпен бірдей.",
    miniAppOpenBtn: "Mini App ашу",
    miniAppCopyBtn: "Сілтемені көшіру",
    miniAppCopied: (link: string) => `Сілтеме көшірілді: ${link}`,
    miniAppCopyPrompt: "Mini App сілтемесін көшіріңіз:",
    miniAppNoUrl: "Деплой мекенжайы анықталмаған (PUBLIC_APP_URL жоқ) — Mini App ашылмайды.",
    instructionTitle: "Сатып алушыларға арналған нұсқаулық",
    instructionHint:
      "Бот мәзіріндегі «📖 Нұсқаулық» түймесі. Видео 50 МБ-тан аспағаны жөн (Telegram шегі), MP4 форматы.",
    uploading: "Жүктелуде…",
    videoLabel: "Видео",
    deleteVideoBtn: "Видеоны жою",
    captionLabel: "Видео астындағы мәтін (қалай пайдалану / қалай төлеу)",
    captionPlaceholder: "Қысқаша: каталог → себет → төлем → чек…",
    captionPlaceholderPhysical: "Қысқаша: каталог → себет → алу күні → төлем…",
    saveInstructionBtn: "Нұсқаулық мәтінін сақтау",
    accessTitle: "Әкімші панеліне қолжетімділік",
    accessCreds: "Логин мен құпия сөз:",
    accessChangeHint:
      "Ауыстыру үшін — әзірлеушіге хабарласыңыз немесе жоба баптауларында ADMIN_USERNAME және ADMIN_PASSWORD құпияларын өзгертіңіз.",
    dangerTitle: "Қауіпті аймақ",
    dangerHint:
      "Толық ысыру: барлық тауарлар, санаттар, суреттер, тауар файлдары, тапсырыстар, пайдаланушы себеттері мен төлем скриншоттары жойылады. Есептегіштер нөлденеді. Баптаулар мен төлем деректемелері сақталады.",
    resetBtn: "Барлық деректерді ысыру",
    resetting: "Ысырылуда...",
    resetDone: "Дайын ✓",
    saveError: (msg) => `Сақтау қатесі: ${msg}`,
    uploadFailed: (name) => `${name} жүктелмеді`,
    uploadError: "Жүктеу қатесі",
    confirmDeleteVideo: "Нұсқаулық видеосын жою керек пе?",
    videoTooBig:
      "Файл 50 МБ-тан үлкен — Vercel-дегі Telegram әдетте қабылдамайды. Видеоны сығыңыз.",
    resetConfirm1:
      "БАРЛЫҚ деректерді ысыру керек пе? Барлық тауарлар, санаттар, тапсырыстар мен жүктелген файлдар жойылады. Әрекетті қайтару мүмкін емес.",
    resetConfirm2: "Нақты ма? Мұны болдырмауға болмайды.",
    unknownError: "Белгісіз қате",
  },
  en: {
    roles: [
      { id: "1040879530", label: "Owner" },
      { id: "7256670713", label: "Developer" },
    ],
    title: "Settings",
    recipientsLabel: "Order notification recipients (Telegram ID)",
    idsPlaceholder: "e.g. 123456789, 987654321",
    recipientsHint:
      "Pick roles from the list or type IDs manually (comma-separated). Notifications will be sent to every recipient listed.",
    contactLabel: "Your contact (button shown in the bot)",
    contactPlaceholder: "e.g. @my_username or a WhatsApp link",
    contactHint: (btn) => `This link or text is shown to users when they tap "${btn}".`,
    save: "Save",
    savedLabel: "Saved ✓",
    deliveryLangTimingTitle: "When to ask for material language",
    deliveryLangTimingHint:
      'Only matters if a product has more than one language (Multi-language module). "After payment" — as now: the language-choice button arrives with the files. "Before checkout" — the buyer picks a language before ordering and can choose "all languages" (price ×N by that product\'s language count).',
    deliveryLangTimingAfter: "After payment (current)",
    deliveryLangTimingBefore: "Before placing the order",
    paymentModeTitle: "Payment for physical orders",
    paymentModeHint:
      "How to accept payment for cakes and desserts to order: full upfront, a deposit, or on pickup/delivery.",
    fulfillmentOptionsTitle: "Pickup/delivery options",
    fulfillmentOptionsHint:
      "Which fulfillment options to offer buyers of physical items. Only one can be turned off — both off would leave checkout with no way to get the order.",
    fulfillmentOptionsPickup: "Pickup",
    fulfillmentOptionsDelivery: "Delivery",
    fulfillmentOptionsBothOffError:
      "Can't turn off both options at once — there'd be no way to receive the order.",
    paymentModeFull: "Full payment upfront",
    paymentModeDeposit: "Deposit, balance on pickup/delivery",
    paymentModeOnReceipt: "Payment on pickup/delivery",
    depositPercentLabel: "Deposit size, % of total",
    depositPercentInvalid: "Enter a number from 1 to 100.",
    referralTitle: "Referral program",
    referralHint:
      'The buyer shares their personal link from the "ℹ️ Info" section. A new user gets a one-time promo code right away; when they get their first purchase, the referrer gets the same kind of promo code.',
    referralPercentLabel: "Discount in the promo code (%)",
    loyaltyTitle: "Purchase points",
    loyaltyHint:
      "Once an order is delivered, the buyer is credited points — a percentage of the order total. 1 point = 1 currency unit. On the next purchase, points can be redeemed toward payment right from the cart.",
    loyaltyEarnPercentLabel: "Percent of order total credited as points (%)",
    cartReminderTitle: "Abandoned cart reminder",
    cartReminderHint:
      "If a buyer adds items to the cart and goes quiet, the bot reminds them after the configured number of hours, with an Open cart button. 0 disables reminders.",
    cartReminderHoursLabel: "Remind after this many hours",
    smartSearchTitle: "Smart catalog search (LLM)",
    smartSearchHint:
      "If regular search finds nothing, the bot tries to understand the query by meaning via AI (e.g. a birthday gift for a five-year-old). Requires ANTHROPIC_API_KEY configured on the deployment — each such query costs money, so it is off by default.",
    smartSearchEnableLabel: "Enable smart search",
    smartSearchLastError: (detail: string) => `Last smart search error: ${detail}`,
    smartSearchUsage: (used, limit) => `Today: ${used} of ${limit} smart searches`,
    smartSearchUsageHint:
      "Counts queries where regular search found nothing — in the bot and Mini App.",
    smartSearchRateSpend: (rate, usd) => `At ${rate} / request: ${usd}`,
    webStorefrontTitle: "Public catalog storefront",
    webStorefrontHint:
      "A no-login catalog page — photos, names, prices, and ratings. You can't buy from it: the page button sends the buyer into the bot itself. Share this link in your Instagram bio, ads, etc.",
    webStorefrontOpenBtn: "Open storefront",
    webStorefrontCopyBtn: "Copy link",
    webStorefrontCopied: (link: string) => `Link copied: ${link}`,
    webStorefrontCopyPrompt: "Copy the storefront link:",
    webStorefrontNoUrl:
      "Deployment address unknown (no PUBLIC_APP_URL) — the storefront won't open until that env var is fixed.",
    miniAppTitle: "Telegram Mini App",
    miniAppHint:
      "Shop inside Telegram: catalog and cart in the Mini App, payment in the bot chat. A Shop button appears in the bot main menu. Cart is shared with chat.",
    miniAppOpenBtn: "Open Mini App",
    miniAppCopyBtn: "Copy link",
    miniAppCopied: (link: string) => `Link copied: ${link}`,
    miniAppCopyPrompt: "Copy the Mini App link:",
    miniAppNoUrl:
      "Deployment address unknown (no PUBLIC_APP_URL) — Mini App won't open until that env var is fixed.",
    instructionTitle: "Buyer instructions",
    instructionHint:
      'The "📖 Guide" button in the bot\'s main menu. Video under 50 MB works best (Telegram limit), MP4 format.',
    uploading: "Uploading…",
    videoLabel: "Video",
    deleteVideoBtn: "Delete video",
    captionLabel: "Text below the video (how to use / how to pay)",
    captionPlaceholder: "Briefly: catalog → cart → payment → receipt…",
    captionPlaceholderPhysical: "Briefly: catalog → cart → pickup date → payment…",
    saveInstructionBtn: "Save instruction text",
    accessTitle: "Admin panel access",
    accessCreds: "Username and password:",
    accessChangeHint:
      "To change it — contact the developer or update the ADMIN_USERNAME and ADMIN_PASSWORD secrets in the project settings.",
    dangerTitle: "Danger zone",
    dangerHint:
      "Full reset: deletes all products, categories, images, product files, orders, user carts, and payment screenshots. Counters are zeroed. Settings and payment details are kept.",
    resetBtn: "Reset all data",
    resetting: "Resetting...",
    resetDone: "Done ✓",
    saveError: (msg) => `Save error: ${msg}`,
    uploadFailed: (name) => `Failed to upload ${name}`,
    uploadError: "Upload error",
    confirmDeleteVideo: "Delete the instruction video?",
    videoTooBig:
      "The file is over 50 MB — Telegram on Vercel usually won't accept it. Compress the video.",
    resetConfirm1:
      "Reset ALL data? All products, categories, orders, and uploaded files will be deleted. This action is irreversible.",
    resetConfirm2: "Are you sure? This can't be undone.",
    unknownError: "Unknown error",
  },
  uz: {
    roles: [
      { id: "1040879530", label: "Egasi" },
      { id: "7256670713", label: "Dasturchi" },
    ],
    title: "Sozlamalar",
    recipientsLabel: "Buyurtma xabarnomalari qabul qiluvchilari (Telegram ID)",
    idsPlaceholder: "masalan, 123456789, 987654321",
    recipientsHint:
      "Ro‘yxatdan rollarni tanlang yoki ID’larni qo‘lda kiriting (vergul bilan). Xabarnomalar barcha ko‘rsatilgan qabul qiluvchilarga keladi.",
    contactLabel: "Aloqa uchun kontaktingiz (botdagi tugma)",
    contactPlaceholder: "masalan, @my_username yoki WhatsApp havolasi",
    contactHint: (btn) =>
      `«${btn}» tugmasi bosilganda foydalanuvchilarga shu havola yoki matn ko‘rsatiladi.`,
    save: "Saqlash",
    savedLabel: "Saqlandi ✓",
    deliveryLangTimingTitle: "Material tilini qachon so‘rash kerak",
    deliveryLangTimingHint:
      'Faqat mahsulotda bir nechta til bo‘lsa dolzarb ("Ko‘p tillilik" moduli). "To‘lovdan keyin" — hozirgidek: til tanlash tugmasi fayllar bilan birga keladi. "Buyurtma berishdan oldin" — xaridor buyurtmadan oldin tilni tanlaydi, "barcha tillar" varianti ham bor (narx mahsulot tillari soniga ×N).',
    deliveryLangTimingAfter: "To‘lovdan keyin (hozirgidek)",
    deliveryLangTimingBefore: "Buyurtma berishdan oldin",
    paymentModeTitle: "Jismoniy buyurtmalar uchun to‘lov",
    paymentModeHint:
      "Buyurtma bo‘yicha tort va desertlar uchun to‘lov: to‘liq oldindan, oldindan to‘lov yoki olishda.",
    fulfillmentOptionsTitle: "Olish usullari",
    fulfillmentOptionsHint:
      "Jismoniy tovarni olish uchun qaysi usullarni taklif qilish. Faqat bittasini o‘chirish mumkin — ikkalasini birdan o‘chirsangiz, buyurtmani olishning yo‘li qolmaydi.",
    fulfillmentOptionsPickup: "O‘zi olib ketish",
    fulfillmentOptionsDelivery: "Yetkazib berish",
    fulfillmentOptionsBothOffError:
      "Ikkala usulni ham birdan o‘chirib bo‘lmaydi — buyurtmani olishning yo‘li qolmaydi.",
    paymentModeFull: "To‘liq to‘lov oldindan",
    paymentModeDeposit: "Oldindan to‘lov, qolgani olishda",
    paymentModeOnReceipt: "Olishda to‘lash",
    depositPercentLabel: "Oldindan to‘lov miqdori, summadan %",
    depositPercentInvalid: "1 dan 100 gacha son kiriting.",
    referralTitle: "Referal dasturi",
    referralHint:
      "Xaridor «ℹ️ Ma’lumot» bo‘limidan shaxsiy havolasini ulashadi. Havola bo‘yicha yangi foydalanuvchi darhol bir martalik promokod oladi; u birinchi xaridni amalga oshirganda — taklif qilgan kishi ham xuddi shunday promokod oladi.",
    referralPercentLabel: "Promokoddagi chegirma (%)",
    loyaltyTitle: "Xaridlar uchun ballar",
    loyaltyHint:
      "Buyurtma yetkazilgandan so‘ng xaridorga ballar hisoblanadi — buyurtma summasidan foiz. 1 ball = 1 valyuta birligi. Keyingi xaridda ballarni to‘g‘ridan-to‘g‘ri savatdan to‘lovga hisobdan chiqarish mumkin.",
    loyaltyEarnPercentLabel: "Buyurtma summasidan ballarga foiz (%)",
    cartReminderTitle: "Tashlab ketilgan savat haqida eslatma",
    cartReminderHint:
      "Agar xaridor savatga mahsulot qo‘shib, uzoq vaqt jim qolsa, bot ko‘rsatilgan soatdan keyin «Savatni ochish» tugmasi bilan o‘zi eslatadi. 0 — eslatmalar o‘chirilgan.",
    cartReminderHoursLabel: "Necha soatdan keyin eslatish",
    smartSearchTitle: "Katalog bo‘yicha aqlli qidiruv (LLM)",
    smartSearchHint:
      "Agar oddiy qidiruv hech narsa topmasa, bot so‘rovni mazmuni bo‘yicha AI orqali tushunishga harakat qiladi (masalan, «besh yoshli bola uchun tug‘ilgan kunga narsa»). Deployda ANTHROPIC_API_KEY sozlangan bo‘lishi kerak — har bir bunday so‘rov pul talab qiladi, shuning uchun standart bo‘yicha o‘chirilgan.",
    smartSearchEnableLabel: "Aqlli qidiruvni yoqish",
    smartSearchLastError: (detail: string) => `Aqlli qidiruvning oxirgi xatosi: ${detail}`,
    smartSearchUsage: (used, limit) => `Bugun: ${used} / ${limit} aqlli qidiruv`,
    smartSearchUsageHint:
      "Oddiy qidiruv hech narsa topmagan so‘rovlar sanaladi — botda va Mini App’da.",
    smartSearchRateSpend: (rate, usd) => `${rate} / so‘rov stavkasi: ${usd}`,
    webStorefrontTitle: "Katalogning ochiq veb-vitrinasi",
    webStorefrontHint:
      "Kirishsiz ochiladigan katalog sahifasi — fotolar, nomlar, narxlar va reyting. Undan xarid qilib bo‘lmaydi: sahifadagi tugma xaridorni to‘g‘ridan-to‘g‘ri botga yuboradi. Bu havolani Instagram bio, reklama va h.k.da bering.",
    webStorefrontOpenBtn: "Vitrinani ochish",
    webStorefrontCopyBtn: "Havolani nusxalash",
    webStorefrontCopied: (link: string) => `Havola nusxalandi: ${link}`,
    webStorefrontCopyPrompt: "Vitrina havolasini nusxalang:",
    webStorefrontNoUrl:
      "Deploy manzili aniqlanmadi (PUBLIC_APP_URL yo‘q) — bu o‘zgaruvchi tuzatilmaguncha vitrina ochilmaydi.",
    miniAppTitle: "Telegram Mini App",
    miniAppHint:
      "Telegram ichidagi do‘kon: Mini App-da katalog va savat, to‘lov bot chatida. Bot asosiy menyusida «Do‘kon» tugmasi chiqadi. Savat chat bilan bir xil.",
    miniAppOpenBtn: "Mini App ochish",
    miniAppCopyBtn: "Havolani nusxalash",
    miniAppCopied: (link: string) => `Havola nusxalandi: ${link}`,
    miniAppCopyPrompt: "Mini App havolasini nusxalang:",
    miniAppNoUrl: "Deploy manzili aniqlanmadi (PUBLIC_APP_URL yo‘q) — Mini App ochilmaydi.",
    instructionTitle: "Xaridorlar uchun yo‘riqnoma",
    instructionHint:
      "Botning asosiy menyusidagi «📖 Yo‘riqnoma» tugmasi. Video 50 MB dan kichik bo‘lgani ma’qul (Telegram cheklovi), MP4 formatida.",
    uploading: "Yuklanmoqda…",
    videoLabel: "Video",
    deleteVideoBtn: "Videoni o‘chirish",
    captionLabel: "Video ostidagi matn (qanday foydalanish / qanday to‘lash)",
    captionPlaceholder: "Qisqacha: katalog → savat → to‘lov → chek…",
    captionPlaceholderPhysical: "Qisqacha: katalog → savat → olish sanasi → to‘lov…",
    saveInstructionBtn: "Yo‘riqnoma matnini saqlash",
    accessTitle: "Admin paneliga kirish",
    accessCreds: "Login va parol:",
    accessChangeHint:
      "O‘zgartirish uchun — dasturchiga murojaat qiling yoki loyiha sozlamalarida ADMIN_USERNAME va ADMIN_PASSWORD sirlarini o‘zgartiring.",
    dangerTitle: "Xavfli zona",
    dangerHint:
      "To‘liq tozalash: barcha mahsulotlar, kategoriyalar, rasmlar, mahsulot fayllari, buyurtmalar, foydalanuvchi savatlari va to‘lov skrinshotlari o‘chiriladi. Hisoblagichlar nolga tushadi. Sozlamalar va to‘lov rekvizitlari saqlanadi.",
    resetBtn: "Barcha ma’lumotlarni tozalash",
    resetting: "Tozalanmoqda...",
    resetDone: "Tayyor ✓",
    saveError: (msg) => `Saqlash xatosi: ${msg}`,
    uploadFailed: (name) => `${name} yuklanmadi`,
    uploadError: "Yuklash xatosi",
    confirmDeleteVideo: "Yo‘riqnoma videosini o‘chirasizmi?",
    videoTooBig:
      "Fayl 50 MB dan katta — Vercel’dagi Telegram odatda qabul qilmaydi. Videoni siqing.",
    resetConfirm1:
      "BARCHA ma’lumotlar tozalansinmi? Barcha mahsulotlar, kategoriyalar, buyurtmalar va yuklangan fayllar o‘chiriladi. Amalni bekor qilib bo‘lmaydi.",
    resetConfirm2: "Aniqmi? Buni bekor qilib bo‘lmaydi.",
    unknownError: "Noma’lum xato",
  },
};

function SettingsPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const modules = useModules();
  const { vertical, isPhysicalShop } = useVertical();
  const contactBtn = VERTICALS[vertical].locales[locale].contactBtn;
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const shopUrl = useQuery({
    queryKey: ["shop-url"],
    queryFn: () => getShopUrl(),
    enabled: modules.web_storefront,
  });
  const miniAppUrlQuery = useQuery({
    queryKey: ["mini-app-url"],
    queryFn: () => getMiniAppUrl(),
    enabled: modules.telegram_mini_app,
  });
  const [adminChatId, setAdminChatId] = useState("");
  const [adminContactLink, setAdminContactLink] = useState("");
  const [saved, setSaved] = useState(false);

  const [deliveryLangTiming, setDeliveryLangTiming] = useState<"before" | "after">("after");
  const [deliveryLangTimingSaving, setDeliveryLangTimingSaving] = useState(false);
  const [deliveryLangTimingSaved, setDeliveryLangTimingSaved] = useState(false);

  const [paymentMode, setPaymentMode] = useState<"full" | "deposit" | "on_receipt">("full");
  const [paymentModeSaving, setPaymentModeSaving] = useState(false);
  const [paymentModeSaved, setPaymentModeSaved] = useState(false);
  // Блок 11, находка 11.1 — раньше fulfillmentOptionsEnabled()
  // (fulfillment.server.ts) читала эти два ключа, но нигде во всём
  // репозитории не было ни одного места, которое бы их записывало: чисто
  // самовывозный кондитер не мог отключить доставку — настройки, которой
  // не существовало.
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [fulfillmentOptionsSaving, setFulfillmentOptionsSaving] = useState(false);
  const [depositPercent, setDepositPercent] = useState("30");
  const [depositPercentSaving, setDepositPercentSaving] = useState(false);
  const [depositPercentSaved, setDepositPercentSaved] = useState(false);

  const [referralPercent, setReferralPercent] = useState("10");
  const [referralSaving, setReferralSaving] = useState(false);
  const [referralSaved, setReferralSaved] = useState(false);

  const [loyaltyEarnPercent, setLoyaltyEarnPercent] = useState("5");
  const [loyaltySaving, setLoyaltySaving] = useState(false);
  const [loyaltySaved, setLoyaltySaved] = useState(false);

  const [cartReminderHours, setCartReminderHours] = useState("6");
  const [cartReminderSaving, setCartReminderSaving] = useState(false);
  const [cartReminderSaved, setCartReminderSaved] = useState(false);

  const [smartSearchEnabled, setSmartSearchEnabled] = useState(false);
  const [smartSearchSaving, setSmartSearchSaving] = useState(false);
  const [smartSearchSaved, setSmartSearchSaved] = useState(false);

  const [instructionCaption, setInstructionCaption] = useState("");
  const [instructionVideoPath, setInstructionVideoPath] = useState("");
  const [instructionUploading, setInstructionUploading] = useState(false);
  const [instructionSaved, setInstructionSaved] = useState(false);

  useEffect(() => {
    setAdminChatId(settings.data?.admin_chat_id ?? "");
    setAdminContactLink(settings.data?.admin_contact_link ?? "");
    setInstructionCaption(settings.data?.instruction_caption ?? "");
    setInstructionVideoPath(settings.data?.instruction_video_path ?? "");
    setDeliveryLangTiming(settings.data?.delivery_lang_timing === "before" ? "before" : "after");
    const pm = settings.data?.payment_mode;
    setPaymentMode(pm === "deposit" || pm === "on_receipt" ? pm : "full");
    setDepositPercent(settings.data?.deposit_percent ?? "30");
    setPickupEnabled(settings.data?.fulfillment_pickup_enabled !== "false");
    setDeliveryEnabled(settings.data?.fulfillment_delivery_enabled !== "false");
    setReferralPercent(settings.data?.referral_discount_percent ?? "10");
    setLoyaltyEarnPercent(settings.data?.loyalty_earn_percent ?? "5");
    setCartReminderHours(settings.data?.cart_reminder_hours ?? "6");
    setSmartSearchEnabled(settings.data?.smart_search_enabled === "true");
  }, [settings.data]);

  async function onSave() {
    // Значения ещё не пришли из settings.data (useEffect ниже их подставит) —
    // сохранить сейчас значит записать пустые поля поверх настоящих
    // (Блок 4.7: admin_chat_id="" отключал уведомления о заказах).
    if (settings.isLoading) return;
    try {
      await Promise.all([
        saveSetting({ data: { key: "admin_chat_id", value: adminChatId.trim() } }),
        saveSetting({ data: { key: "admin_contact_link", value: adminContactLink.trim() } }),
      ]);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    }
  }

  async function onSaveDeliveryLangTiming(value: "before" | "after") {
    setDeliveryLangTiming(value);
    setDeliveryLangTimingSaving(true);
    try {
      await saveSetting({ data: { key: "delivery_lang_timing", value } });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setDeliveryLangTimingSaved(true);
      setTimeout(() => setDeliveryLangTimingSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setDeliveryLangTimingSaving(false);
    }
  }

  async function onSavePaymentMode(value: "full" | "deposit" | "on_receipt") {
    setPaymentMode(value);
    setPaymentModeSaving(true);
    try {
      await saveSetting({ data: { key: "payment_mode", value } });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setPaymentModeSaved(true);
      setTimeout(() => setPaymentModeSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setPaymentModeSaving(false);
    }
  }

  async function onSaveFulfillmentOption(kind: "pickup" | "delivery", value: boolean) {
    // Оба выключенных разом — тупик: чекаут физического товара не сможет
    // предложить покупателю ни одного способа получения (Блок 12, находка
    // 12.8 упоминает именно этот случай как непокрытый тестами умолчание).
    const nextPickup = kind === "pickup" ? value : pickupEnabled;
    const nextDelivery = kind === "delivery" ? value : deliveryEnabled;
    if (!nextPickup && !nextDelivery) {
      toast.error(tr.fulfillmentOptionsBothOffError);
      return;
    }
    const prevPickup = pickupEnabled;
    const prevDelivery = deliveryEnabled;
    if (kind === "pickup") setPickupEnabled(value);
    else setDeliveryEnabled(value);
    setFulfillmentOptionsSaving(true);
    try {
      await saveSetting({
        data: {
          key: kind === "pickup" ? "fulfillment_pickup_enabled" : "fulfillment_delivery_enabled",
          value: value ? "true" : "false",
        },
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: unknown) {
      setPickupEnabled(prevPickup);
      setDeliveryEnabled(prevDelivery);
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setFulfillmentOptionsSaving(false);
    }
  }

  async function onSaveDepositPercent() {
    if (settings.isLoading) return;
    // amountDueNow() (fulfillment.server.ts) сама зажимает битое значение в
    // 1..100 и откатывается на 30 при NaN/пустой строке (Блок 1, находка
    // 1.7) — но ловить очевидно неверный ввод здесь, до сохранения,
    // дешевле, чем ждать, пока продавец заметит по факту, что бот просит
    // не тот процент.
    const pct = Number(depositPercent.trim());
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      toast.error(tr.depositPercentInvalid);
      return;
    }
    setDepositPercentSaving(true);
    try {
      await saveSetting({ data: { key: "deposit_percent", value: String(pct) } });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setDepositPercentSaved(true);
      setTimeout(() => setDepositPercentSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setDepositPercentSaving(false);
    }
  }

  async function onSaveReferralPercent() {
    if (settings.isLoading) return;
    setReferralSaving(true);
    try {
      await saveSetting({
        data: { key: "referral_discount_percent", value: referralPercent.trim() },
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setReferralSaved(true);
      setTimeout(() => setReferralSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setReferralSaving(false);
    }
  }

  async function onSaveLoyaltyEarnPercent() {
    if (settings.isLoading) return;
    setLoyaltySaving(true);
    try {
      await saveSetting({
        data: { key: "loyalty_earn_percent", value: loyaltyEarnPercent.trim() },
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setLoyaltySaved(true);
      setTimeout(() => setLoyaltySaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setLoyaltySaving(false);
    }
  }

  async function onSaveCartReminderHours() {
    if (settings.isLoading) return;
    setCartReminderSaving(true);
    try {
      await saveSetting({
        data: { key: "cart_reminder_hours", value: cartReminderHours.trim() },
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setCartReminderSaved(true);
      setTimeout(() => setCartReminderSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setCartReminderSaving(false);
    }
  }

  async function onSaveSmartSearchEnabled(value: boolean) {
    setSmartSearchEnabled(value);
    setSmartSearchSaving(true);
    try {
      await saveSetting({ data: { key: "smart_search_enabled", value: value ? "true" : "false" } });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSmartSearchSaved(true);
      setTimeout(() => setSmartSearchSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setSmartSearchSaving(false);
    }
  }

  async function onCopyShopUrl(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(tr.webStorefrontCopied(link));
    } catch {
      prompt(tr.webStorefrontCopyPrompt, link);
    }
  }

  async function onCopyMiniAppUrl(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(tr.miniAppCopied(link));
    } catch {
      prompt(tr.miniAppCopyPrompt, link);
    }
  }

  async function onSaveInstruction() {
    try {
      await saveSetting({ data: { key: "instruction_caption", value: instructionCaption } });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setInstructionSaved(true);
      setTimeout(() => setInstructionSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    }
  }

  async function onUploadInstruction(file: File | null) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.warning(tr.videoTooBig);
      return;
    }
    setInstructionUploading(true);
    try {
      const { path, signedUrl } = await getInstructionVideoUploadUrl({
        data: { filename: file.name },
      });
      const res = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "video/mp4" },
      });
      if (!res.ok) throw new Error(tr.uploadFailed(file.name));
      await commitInstructionVideoFn({ data: { path } });
      setInstructionVideoPath(path);
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e) || tr.uploadError);
    } finally {
      setInstructionUploading(false);
    }
  }

  async function onClearInstruction() {
    if (!(await confirmToast(tr.confirmDeleteVideo))) return;
    try {
      await clearInstructionVideoFn();
      setInstructionVideoPath("");
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  async function onReset() {
    const ok = await confirmToast(tr.resetConfirm1);
    if (!ok) return;
    const ok2 = await confirmToast(tr.resetConfirm2);
    if (!ok2) return;
    setResetting(true);
    try {
      await resetAllData();
      await qc.invalidateQueries();
      setResetDone(true);
      setTimeout(() => setResetDone(false), 3000);
    } catch (e: unknown) {
      // Самое разрушительное действие на этом экране — молчание при сбое
      // маскировало бы то, что данные не тронуты (или тронуты частично).
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">{tr.title}</h1>
      <div className="bg-card border rounded-lg p-4 space-y-3">
        <div className="space-y-2">
          <Label>{tr.recipientsLabel}</Label>
          <div className="flex flex-col gap-3 py-2">
            {tr.roles.map((role) => {
              const ids = adminChatId
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const checked = ids.includes(role.id);
              return (
                <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => {
                      let newIds = [...ids];
                      if (c) {
                        if (!newIds.includes(role.id)) newIds.push(role.id);
                      } else {
                        newIds = newIds.filter((i) => i !== role.id);
                      }
                      setAdminChatId(newIds.join(", "));
                    }}
                  />
                  <span>
                    {role.label} <span className="text-muted-foreground">({role.id})</span>
                  </span>
                </label>
              );
            })}
          </div>
          <Input
            value={adminChatId}
            onChange={(e) => setAdminChatId(e.target.value)}
            placeholder={tr.idsPlaceholder}
          />
          <p className="text-xs text-muted-foreground">{tr.recipientsHint}</p>
        </div>
        <div className="space-y-2 pt-2 border-t border-border/50">
          <Label>{tr.contactLabel}</Label>
          <Input
            value={adminContactLink}
            onChange={(e) => setAdminContactLink(e.target.value)}
            placeholder={tr.contactPlaceholder}
          />
          <p className="text-xs text-muted-foreground">{tr.contactHint(contactBtn)}</p>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSave} disabled={settings.isLoading}>
            {tr.save}
          </Button>
          {saved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>

      {!isPhysicalShop && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold">{tr.deliveryLangTimingTitle}</h2>
          <p className="text-xs text-muted-foreground">{tr.deliveryLangTimingHint}</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="delivery-lang-timing"
                checked={deliveryLangTiming === "after"}
                disabled={deliveryLangTimingSaving}
                onChange={() => onSaveDeliveryLangTiming("after")}
              />
              {tr.deliveryLangTimingAfter}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="delivery-lang-timing"
                checked={deliveryLangTiming === "before"}
                disabled={deliveryLangTimingSaving}
                onChange={() => onSaveDeliveryLangTiming("before")}
              />
              {tr.deliveryLangTimingBefore}
            </label>
          </div>
          {deliveryLangTimingSaved && (
            <span className="text-sm text-green-600">{tr.savedLabel}</span>
          )}
        </div>
      )}

      {isPhysicalShop && (
        <>
          <div className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="text-lg font-semibold">{tr.paymentModeTitle}</h2>
            <p className="text-xs text-muted-foreground">{tr.paymentModeHint}</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="payment-mode"
                  checked={paymentMode === "full"}
                  disabled={paymentModeSaving}
                  onChange={() => onSavePaymentMode("full")}
                />
                {tr.paymentModeFull}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="payment-mode"
                  checked={paymentMode === "deposit"}
                  disabled={paymentModeSaving}
                  onChange={() => onSavePaymentMode("deposit")}
                />
                {tr.paymentModeDeposit}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="payment-mode"
                  checked={paymentMode === "on_receipt"}
                  disabled={paymentModeSaving}
                  onChange={() => onSavePaymentMode("on_receipt")}
                />
                {tr.paymentModeOnReceipt}
              </label>
            </div>
            {paymentModeSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
            {paymentMode === "deposit" && (
              <div className="flex items-end gap-2 pt-2">
                <div className="space-y-2">
                  <Label>{tr.depositPercentLabel}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={depositPercent}
                    onChange={(e) => setDepositPercent(e.target.value)}
                    className="w-32"
                  />
                </div>
                <Button
                  onClick={onSaveDepositPercent}
                  disabled={depositPercentSaving || settings.isLoading}
                >
                  {tr.save}
                </Button>
                {depositPercentSaved && (
                  <span className="text-sm text-green-600">{tr.savedLabel}</span>
                )}
              </div>
            )}
          </div>

          <div className="bg-card border rounded-lg p-4 space-y-3">
            <h2 className="text-lg font-semibold">{tr.fulfillmentOptionsTitle}</h2>
            <p className="text-xs text-muted-foreground">{tr.fulfillmentOptionsHint}</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={pickupEnabled}
                  disabled={fulfillmentOptionsSaving}
                  onChange={(e) => onSaveFulfillmentOption("pickup", e.target.checked)}
                />
                {tr.fulfillmentOptionsPickup}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={deliveryEnabled}
                  disabled={fulfillmentOptionsSaving}
                  onChange={(e) => onSaveFulfillmentOption("delivery", e.target.checked)}
                />
                {tr.fulfillmentOptionsDelivery}
              </label>
            </div>
          </div>
        </>
      )}

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.referralTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.referralHint}</p>
        {modules.referral ? (
          <div className="flex items-end gap-2">
            <div className="space-y-2">
              <Label>{tr.referralPercentLabel}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={referralPercent}
                onChange={(e) => setReferralPercent(e.target.value)}
                className="w-32"
              />
            </div>
            <Button onClick={onSaveReferralPercent} disabled={referralSaving || settings.isLoading}>
              {tr.save}
            </Button>
            {referralSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/80">🔒 {t("moduleLocked", locale)}</p>
        )}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.loyaltyTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.loyaltyHint}</p>
        {modules.loyalty ? (
          <div className="flex items-end gap-2">
            <div className="space-y-2">
              <Label>{tr.loyaltyEarnPercentLabel}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={loyaltyEarnPercent}
                onChange={(e) => setLoyaltyEarnPercent(e.target.value)}
                className="w-32"
              />
            </div>
            <Button
              onClick={onSaveLoyaltyEarnPercent}
              disabled={loyaltySaving || settings.isLoading}
            >
              {tr.save}
            </Button>
            {loyaltySaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/80">🔒 {t("moduleLocked", locale)}</p>
        )}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.webStorefrontTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.webStorefrontHint}</p>
        {modules.web_storefront ? (
          shopUrl.data?.url ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={shopUrl.data.url} className="flex-1 min-w-[16rem]" />
              <Button variant="outline" onClick={() => onCopyShopUrl(shopUrl.data!.url!)}>
                {tr.webStorefrontCopyBtn}
              </Button>
              <a
                href={shopUrl.data.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline text-primary"
              >
                {tr.webStorefrontOpenBtn}
              </a>
            </div>
          ) : shopUrl.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading", locale)}</p>
          ) : (
            <p className="text-sm text-destructive">{tr.webStorefrontNoUrl}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground/80">🔒 {t("moduleLocked", locale)}</p>
        )}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.miniAppTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.miniAppHint}</p>
        {modules.telegram_mini_app ? (
          miniAppUrlQuery.data?.url ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={miniAppUrlQuery.data.url} className="flex-1 min-w-[16rem]" />
              <Button
                variant="outline"
                onClick={() => onCopyMiniAppUrl(miniAppUrlQuery.data!.url!)}
              >
                {tr.miniAppCopyBtn}
              </Button>
              <a
                href={miniAppUrlQuery.data.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline text-primary"
              >
                {tr.miniAppOpenBtn}
              </a>
            </div>
          ) : miniAppUrlQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading", locale)}</p>
          ) : (
            <p className="text-sm text-destructive">{tr.miniAppNoUrl}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground/80">🔒 {t("moduleLocked", locale)}</p>
        )}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.cartReminderTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.cartReminderHint}</p>
        {modules.cart_reminder ? (
          <div className="flex items-end gap-2">
            <div className="space-y-2">
              <Label>{tr.cartReminderHoursLabel}</Label>
              <Input
                type="number"
                min={0}
                max={168}
                value={cartReminderHours}
                onChange={(e) => setCartReminderHours(e.target.value)}
                className="w-32"
              />
            </div>
            <Button
              onClick={onSaveCartReminderHours}
              disabled={cartReminderSaving || settings.isLoading}
            >
              {tr.save}
            </Button>
            {cartReminderSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/80">🔒 {t("moduleLocked", locale)}</p>
        )}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.smartSearchTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.smartSearchHint}</p>
        {modules.smart_search ? (
          <>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={smartSearchEnabled}
                disabled={smartSearchSaving}
                onChange={(e) => onSaveSmartSearchEnabled(e.target.checked)}
              />
              {tr.smartSearchEnableLabel}
            </label>
            {smartSearchSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
            <p className="text-sm">
              {tr.smartSearchUsage(
                parseDailyCount(settings.data?.smart_search_daily_count),
                SMART_SEARCH_DAILY_LIMIT,
              )}
            </p>
            <p className="text-sm">
              {tr.smartSearchRateSpend(
                formatUsd(DEFAULT_USD_PER_REQUEST),
                formatUsd(
                  DEFAULT_USD_PER_REQUEST *
                    parseDailyCount(settings.data?.smart_search_daily_count),
                ),
              )}
            </p>
            <p className="text-xs text-muted-foreground">{tr.smartSearchUsageHint}</p>
            {settings.data?.smart_search_last_error ? (
              <p className="text-xs text-destructive">
                {tr.smartSearchLastError(settings.data.smart_search_last_error)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground/80">🔒 {t("moduleLocked", locale)}</p>
        )}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">{tr.instructionTitle}</h2>
        <p className="text-sm text-muted-foreground">{tr.instructionHint}</p>
        <div className="space-y-2">
          <Label>{tr.videoLabel}</Label>
          <Input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            disabled={instructionUploading}
            onChange={(e) => onUploadInstruction(e.target.files?.[0] ?? null)}
          />
          {instructionUploading && <p className="text-sm text-muted-foreground">{tr.uploading}</p>}
          {instructionVideoPath && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground truncate max-w-md">
                {instructionVideoPath}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={onClearInstruction}>
                {tr.deleteVideoBtn}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>{tr.captionLabel}</Label>
          <Textarea
            rows={8}
            value={instructionCaption}
            onChange={(e) => setInstructionCaption(e.target.value)}
            placeholder={isPhysicalShop ? tr.captionPlaceholderPhysical : tr.captionPlaceholder}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onSaveInstruction}>{tr.saveInstructionBtn}</Button>
          {instructionSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-1 text-sm">
        <h2 className="font-medium mb-2">{tr.accessTitle}</h2>
        <p>
          {tr.accessCreds} <code>admin</code> / <code>admin</code>
        </p>
        <p className="text-muted-foreground">{tr.accessChangeHint}</p>
      </div>

      <div className="bg-card border border-destructive/40 rounded-lg p-4 space-y-3">
        <h2 className="font-medium text-destructive">{tr.dangerTitle}</h2>
        <p className="text-sm text-muted-foreground">{tr.dangerHint}</p>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={onReset} disabled={resetting}>
            {resetting ? tr.resetting : tr.resetBtn}
          </Button>
          {resetDone && <span className="text-sm text-green-600">{tr.resetDone}</span>}
        </div>
      </div>
    </div>
  );
}
