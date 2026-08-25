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
  getInstructionVideoUploadUrl,
  commitInstructionVideoFn,
  clearInstructionVideoFn,
} from "@/lib/settings.functions";
import { resetAllData } from "@/lib/reset.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

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
    contactHint: string;
    save: string;
    savedLabel: string;
    deliveryLangTimingTitle: string;
    deliveryLangTimingHint: string;
    deliveryLangTimingBefore: string;
    deliveryLangTimingAfter: string;
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
    instructionTitle: string;
    instructionHint: string;
    uploading: string;
    videoLabel: string;
    deleteVideoBtn: string;
    captionLabel: string;
    captionPlaceholder: string;
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
    contactHint:
      "Эта ссылка или текст будет показываться пользователям при нажатии на кнопку «💬 Связаться с автором».",
    save: "Сохранить",
    savedLabel: "Сохранено ✓",
    deliveryLangTimingTitle: "Когда спрашивать язык материалов",
    deliveryLangTimingHint:
      "Актуально, только если у товаров заведено больше одного языка (модуль «Мультиязычность»). «После оплаты» — как раньше: кнопка выбора языка приходит вместе с файлами. «До оформления» — покупатель выбирает язык перед заказом и может выбрать «все языки» (цена ×N по числу языков товара).",
    deliveryLangTimingAfter: "После оплаты (как сейчас)",
    deliveryLangTimingBefore: "До оформления заказа",
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
    instructionTitle: "Инструкция для покупателей",
    instructionHint:
      "Кнопка «📖 Инструкция» в главном меню бота. Видео лучше до 50 МБ (лимит Telegram), формат MP4.",
    uploading: "Загрузка…",
    videoLabel: "Видео",
    deleteVideoBtn: "Удалить видео",
    captionLabel: "Текст под видео (как пользоваться / как оплата)",
    captionPlaceholder: "Кратко: каталог → корзина → оплата → чек…",
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
    contactHint:
      "«💬 Автормен байланысу» түймесін басқанда пайдаланушыларға осы сілтеме немесе мәтін көрсетіледі.",
    save: "Сақтау",
    savedLabel: "Сақталды ✓",
    deliveryLangTimingTitle: "Материал тілін қашан сұрау керек",
    deliveryLangTimingHint:
      "Тек тауарда бірнеше тіл болса маңызды («Көптілділік» модулі). «Төлемнен кейін» — бұрынғыдай: тіл таңдау түймесі файлдармен бірге келеді. «Ресімдеуден бұрын» — сатып алушы тапсырыс алдында тілді таңдайды, «барлық тілдер» опциясы да бар (баға тауар тілдерінің санына ×N).",
    deliveryLangTimingAfter: "Төлемнен кейін (қазіргідей)",
    deliveryLangTimingBefore: "Тапсырысты ресімдеуден бұрын",
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
    instructionTitle: "Сатып алушыларға арналған нұсқаулық",
    instructionHint:
      "Бот мәзіріндегі «📖 Нұсқаулық» түймесі. Видео 50 МБ-тан аспағаны жөн (Telegram шегі), MP4 форматы.",
    uploading: "Жүктелуде…",
    videoLabel: "Видео",
    deleteVideoBtn: "Видеоны жою",
    captionLabel: "Видео астындағы мәтін (қалай пайдалану / қалай төлеу)",
    captionPlaceholder: "Қысқаша: каталог → себет → төлем → чек…",
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
    contactHint: 'This link or text is shown to users when they tap "💬 Contact the author".',
    save: "Save",
    savedLabel: "Saved ✓",
    deliveryLangTimingTitle: "When to ask for material language",
    deliveryLangTimingHint:
      'Only matters if a product has more than one language (Multi-language module). "After payment" — as now: the language-choice button arrives with the files. "Before checkout" — the buyer picks a language before ordering and can choose "all languages" (price ×N by that product\'s language count).',
    deliveryLangTimingAfter: "After payment (current)",
    deliveryLangTimingBefore: "Before placing the order",
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
    instructionTitle: "Buyer instructions",
    instructionHint:
      'The "📖 Guide" button in the bot\'s main menu. Video under 50 MB works best (Telegram limit), MP4 format.',
    uploading: "Uploading…",
    videoLabel: "Video",
    deleteVideoBtn: "Delete video",
    captionLabel: "Text below the video (how to use / how to pay)",
    captionPlaceholder: "Briefly: catalog → cart → payment → receipt…",
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
    contactHint:
      "«💬 Muallif bilan bog‘lanish» tugmasi bosilganda foydalanuvchilarga shu havola yoki matn ko‘rsatiladi.",
    save: "Saqlash",
    savedLabel: "Saqlandi ✓",
    deliveryLangTimingTitle: "Material tilini qachon so‘rash kerak",
    deliveryLangTimingHint:
      'Faqat mahsulotda bir nechta til bo‘lsa dolzarb ("Ko‘p tillilik" moduli). "To‘lovdan keyin" — hozirgidek: til tanlash tugmasi fayllar bilan birga keladi. "Buyurtma berishdan oldin" — xaridor buyurtmadan oldin tilni tanlaydi, "barcha tillar" varianti ham bor (narx mahsulot tillari soniga ×N).',
    deliveryLangTimingAfter: "To‘lovdan keyin (hozirgidek)",
    deliveryLangTimingBefore: "Buyurtma berishdan oldin",
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
    instructionTitle: "Xaridorlar uchun yo‘riqnoma",
    instructionHint:
      "Botning asosiy menyusidagi «📖 Yo‘riqnoma» tugmasi. Video 50 MB dan kichik bo‘lgani ma’qul (Telegram cheklovi), MP4 formatida.",
    uploading: "Yuklanmoqda…",
    videoLabel: "Video",
    deleteVideoBtn: "Videoni o‘chirish",
    captionLabel: "Video ostidagi matn (qanday foydalanish / qanday to‘lash)",
    captionPlaceholder: "Qisqacha: katalog → savat → to‘lov → chek…",
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
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const [adminChatId, setAdminChatId] = useState("");
  const [adminContactLink, setAdminContactLink] = useState("");
  const [saved, setSaved] = useState(false);

  const [deliveryLangTiming, setDeliveryLangTiming] = useState<"before" | "after">("after");
  const [deliveryLangTimingSaving, setDeliveryLangTimingSaving] = useState(false);
  const [deliveryLangTimingSaved, setDeliveryLangTimingSaved] = useState(false);

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
          <p className="text-xs text-muted-foreground">{tr.contactHint}</p>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSave} disabled={settings.isLoading}>
            {tr.save}
          </Button>
          {saved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>

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
        {deliveryLangTimingSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.referralTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.referralHint}</p>
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
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.loyaltyTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.loyaltyHint}</p>
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
          <Button onClick={onSaveLoyaltyEarnPercent} disabled={loyaltySaving || settings.isLoading}>
            {tr.save}
          </Button>
          {loyaltySaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.cartReminderTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.cartReminderHint}</p>
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
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h2 className="text-lg font-semibold">{tr.smartSearchTitle}</h2>
        <p className="text-xs text-muted-foreground">{tr.smartSearchHint}</p>
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
            placeholder={tr.captionPlaceholder}
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
