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
  getLegalDocUploadUrl,
  commitLegalDocFn,
  clearLegalDocFn,
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
    legalTitle: string;
    legalHint: string;
    offerLabel: string;
    privacyLabel: string;
    requisitesLabel: string;
    aboutLinkLabel: string;
    sellerDetailsLabel: string;
    offerFileLabel: string;
    pdfHint: string;
    uploading: string;
    deleteBtn: string;
    privacyFileLabel: string;
    aboutLabel: string;
    saveDocsBtn: string;
    instructionTitle: string;
    instructionHint: string;
    videoLabel: string;
    deleteVideoBtn: string;
    captionLabel: string;
    captionPlaceholder: string;
    saveInstructionBtn: string;
    robokassaTitle: string;
    robokassaUrlLabel: string;
    robokassaRegionHint: string;
    robokassaEnableLabel: string;
    robokassaEnabledHint: string;
    merchantLoginLabel: string;
    merchantLoginPlaceholder: string;
    pass1Label: string;
    pass2Label: string;
    pass1TestLabel: string;
    pass2TestLabel: string;
    testModeLabel: string;
    saveRobokassaBtn: string;
    accessTitle: string;
    accessCreds: string;
    accessChangeHint: string;
    dangerTitle: string;
    dangerHint: string;
    resetBtn: string;
    resetting: string;
    resetDone: string;
    saveError: (msg: string) => string;
    robokassaSaveError: (msg: string) => string;
    docsSaveError: (msg: string) => string;
    uploadFailed: (name: string) => string;
    uploadError: string;
    confirmDeleteOffer: string;
    confirmDeletePrivacy: string;
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
    legalTitle: "Юридические документы (Robokassa / РК)",
    legalHint: "Нужны для модерации магазина. Ссылки также доступны в боте → «ℹ️ Информация».",
    offerLabel: "Оферта:",
    privacyLabel: "Политика:",
    requisitesLabel: "Реквизиты:",
    aboutLinkLabel: "О продавце:",
    sellerDetailsLabel: "Реквизиты продавца (текст)",
    offerFileLabel: "Договор оферты (файл PDF / DOC / DOCX)",
    pdfHint:
      "Для удобного просмотра в браузере лучше загружать PDF. DOC/DOCX откроются через веб-просмотрщик.",
    uploading: "Загрузка…",
    deleteBtn: "Удалить",
    privacyFileLabel: "Политика конфиденциальности (файл PDF / DOC / DOCX)",
    aboutLabel: "О продавце / авторе (HTML или текст)",
    saveDocsBtn: "Сохранить документы",
    instructionTitle: "Инструкция для покупателей",
    instructionHint:
      "Кнопка «📖 Инструкция» в главном меню бота. Видео лучше до 50 МБ (лимит Telegram), формат MP4.",
    videoLabel: "Видео",
    deleteVideoBtn: "Удалить видео",
    captionLabel: "Текст под видео (как пользоваться / как оплата)",
    captionPlaceholder: "Кратко: каталог → корзина → оплата → чек…",
    saveInstructionBtn: "Сохранить текст инструкции",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "URL для кабинета Robokassa:",
    robokassaRegionHint: "ResultURL: метод POST, алгоритм хеша MD5. Регион: Robokassa.KZ.",
    robokassaEnableLabel: "Включить оплату через Robokassa (автовыдача файлов)",
    robokassaEnabledHint:
      "При включении: RU, BY, OTHER — только чек с автовыдачей; KZ — выбор Robokassa или чек с автовыдачей; остальные страны — только Robokassa. При выключении все страны — чек с ручной проверкой. Автовыдача по чеку требует GOOGLE_VISION_API_KEY (OCR, сумма ±10%); без ключа чек уходит на ручную проверку.",
    merchantLoginLabel: "Идентификатор магазина (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Пароль #1 (боевой)",
    pass2Label: "Пароль #2 (боевой)",
    pass1TestLabel: "Пароль #1 (тестовый)",
    pass2TestLabel: "Пароль #2 (тестовый)",
    testModeLabel: "Тестовый режим (IsTest=1)",
    saveRobokassaBtn: "Сохранить Robokassa",
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
    robokassaSaveError: (msg) => `Ошибка сохранения Robokassa: ${msg}`,
    docsSaveError: (msg) => `Ошибка сохранения документов: ${msg}`,
    uploadFailed: (name) => `Не удалось загрузить ${name}`,
    uploadError: "Ошибка загрузки",
    confirmDeleteOffer: "Удалить файл оферты?",
    confirmDeletePrivacy: "Удалить файл политики?",
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
    legalTitle: "Заңды құжаттар (Robokassa / ҚР)",
    legalHint: "Дүкенді модерациялау үшін керек. Сілтемелер ботта да қолжетімді → «ℹ️ Ақпарат».",
    offerLabel: "Оферта:",
    privacyLabel: "Саясат:",
    requisitesLabel: "Деректемелер:",
    aboutLinkLabel: "Сатушы туралы:",
    sellerDetailsLabel: "Сатушы деректемелері (мәтін)",
    offerFileLabel: "Оферта шарты (PDF / DOC / DOCX файл)",
    pdfHint:
      "Браузерде ыңғайлы қарау үшін PDF жүктеген жөн. DOC/DOCX веб-қарау құралы арқылы ашылады.",
    uploading: "Жүктелуде…",
    deleteBtn: "Жою",
    privacyFileLabel: "Құпиялылық саясаты (PDF / DOC / DOCX файл)",
    aboutLabel: "Сатушы / автор туралы (HTML немесе мәтін)",
    saveDocsBtn: "Құжаттарды сақтау",
    instructionTitle: "Сатып алушыларға арналған нұсқаулық",
    instructionHint:
      "Бот мәзіріндегі «📖 Нұсқаулық» түймесі. Видео 50 МБ-тан аспағаны жөн (Telegram шегі), MP4 форматы.",
    videoLabel: "Видео",
    deleteVideoBtn: "Видеоны жою",
    captionLabel: "Видео астындағы мәтін (қалай пайдалану / қалай төлеу)",
    captionPlaceholder: "Қысқаша: каталог → себет → төлем → чек…",
    saveInstructionBtn: "Нұсқаулық мәтінін сақтау",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "Robokassa кабинеті үшін URL:",
    robokassaRegionHint: "ResultURL: POST әдісі, MD5 хеш алгоритмі. Аймақ: Robokassa.KZ.",
    robokassaEnableLabel: "Robokassa арқылы төлемді қосу (файлдарды автоберу)",
    robokassaEnabledHint:
      "Қосылған кезде: RU, BY, OTHER — тек автобер чегі; KZ — Robokassa немесе автобер чегін таңдау; басқа елдер — тек Robokassa. Өшірулі кезде барлық елдерде — қолмен тексерілетін чек. Чек бойынша автобер GOOGLE_VISION_API_KEY талап етеді (OCR, сома ±10%); кілт болмаса чек қолмен тексеруге жіберіледі.",
    merchantLoginLabel: "Дүкен идентификаторы (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Құпия сөз №1 (боевой)",
    pass2Label: "Құпия сөз №2 (боевой)",
    pass1TestLabel: "Құпия сөз №1 (тест)",
    pass2TestLabel: "Құпия сөз №2 (тест)",
    testModeLabel: "Тест режимі (IsTest=1)",
    saveRobokassaBtn: "Robokassa сақтау",
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
    robokassaSaveError: (msg) => `Robokassa сақтау қатесі: ${msg}`,
    docsSaveError: (msg) => `Құжаттарды сақтау қатесі: ${msg}`,
    uploadFailed: (name) => `${name} жүктелмеді`,
    uploadError: "Жүктеу қатесі",
    confirmDeleteOffer: "Оферта файлын жою керек пе?",
    confirmDeletePrivacy: "Саясат файлын жою керек пе?",
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
    legalTitle: "Legal documents (Robokassa / KZ)",
    legalHint:
      'Needed for shop moderation. Links are also available in the bot → "ℹ️ Information".',
    offerLabel: "Offer:",
    privacyLabel: "Privacy policy:",
    requisitesLabel: "Requisites:",
    aboutLinkLabel: "About the seller:",
    sellerDetailsLabel: "Seller details (text)",
    offerFileLabel: "Offer agreement (PDF / DOC / DOCX file)",
    pdfHint: "For easy in-browser viewing, PDF is best. DOC/DOCX will open in a web viewer.",
    uploading: "Uploading…",
    deleteBtn: "Delete",
    privacyFileLabel: "Privacy policy (PDF / DOC / DOCX file)",
    aboutLabel: "About the seller / author (HTML or text)",
    saveDocsBtn: "Save documents",
    instructionTitle: "Buyer instructions",
    instructionHint:
      'The "📖 Guide" button in the bot\'s main menu. Video under 50 MB works best (Telegram limit), MP4 format.',
    videoLabel: "Video",
    deleteVideoBtn: "Delete video",
    captionLabel: "Text below the video (how to use / how to pay)",
    captionPlaceholder: "Briefly: catalog → cart → payment → receipt…",
    saveInstructionBtn: "Save instruction text",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "URL for the Robokassa dashboard:",
    robokassaRegionHint: "ResultURL: POST method, MD5 hash algorithm. Region: Robokassa.KZ.",
    robokassaEnableLabel: "Enable payment via Robokassa (auto file delivery)",
    robokassaEnabledHint:
      "When enabled: RU, BY, OTHER — receipt with auto-delivery only; KZ — choice of Robokassa or receipt with auto-delivery; other countries — Robokassa only. When disabled, all countries use a manually reviewed receipt. Auto-delivery by receipt requires GOOGLE_VISION_API_KEY (OCR, amount ±10%); without the key, receipts go to manual review.",
    merchantLoginLabel: "Shop identifier (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Password #1 (live)",
    pass2Label: "Password #2 (live)",
    pass1TestLabel: "Password #1 (test)",
    pass2TestLabel: "Password #2 (test)",
    testModeLabel: "Test mode (IsTest=1)",
    saveRobokassaBtn: "Save Robokassa",
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
    robokassaSaveError: (msg) => `Robokassa save error: ${msg}`,
    docsSaveError: (msg) => `Document save error: ${msg}`,
    uploadFailed: (name) => `Failed to upload ${name}`,
    uploadError: "Upload error",
    confirmDeleteOffer: "Delete the offer file?",
    confirmDeletePrivacy: "Delete the privacy policy file?",
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
    legalTitle: "Yuridik hujjatlar (Robokassa / QR)",
    legalHint:
      "Do‘konni moderatsiya qilish uchun kerak. Havolalar botda ham mavjud → «ℹ️ Ma’lumot».",
    offerLabel: "Oferta:",
    privacyLabel: "Siyosat:",
    requisitesLabel: "Rekvizitlar:",
    aboutLinkLabel: "Sotuvchi haqida:",
    sellerDetailsLabel: "Sotuvchi rekvizitlari (matn)",
    offerFileLabel: "Oferta shartnomasi (PDF / DOC / DOCX fayl)",
    pdfHint:
      "Brauzerda qulay ko‘rish uchun PDF yuklash yaxshiroq. DOC/DOCX veb-ko‘ruvchi orqali ochiladi.",
    uploading: "Yuklanmoqda…",
    deleteBtn: "O‘chirish",
    privacyFileLabel: "Maxfiylik siyosati (PDF / DOC / DOCX fayl)",
    aboutLabel: "Sotuvchi / muallif haqida (HTML yoki matn)",
    saveDocsBtn: "Hujjatlarni saqlash",
    instructionTitle: "Xaridorlar uchun yo‘riqnoma",
    instructionHint:
      "Botning asosiy menyusidagi «📖 Yo‘riqnoma» tugmasi. Video 50 MB dan kichik bo‘lgani ma’qul (Telegram cheklovi), MP4 formatida.",
    videoLabel: "Video",
    deleteVideoBtn: "Videoni o‘chirish",
    captionLabel: "Video ostidagi matn (qanday foydalanish / qanday to‘lash)",
    captionPlaceholder: "Qisqacha: katalog → savat → to‘lov → chek…",
    saveInstructionBtn: "Yo‘riqnoma matnini saqlash",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "Robokassa kabineti uchun URL:",
    robokassaRegionHint: "ResultURL: POST usuli, MD5 xesh algoritmi. Hudud: Robokassa.KZ.",
    robokassaEnableLabel: "Robokassa orqali to‘lovni yoqish (fayllarni avtomatik berish)",
    robokassaEnabledHint:
      "Yoqilgan bo‘lsa: RU, BY, OTHER — faqat avtomatik berish cheki; KZ — Robokassa yoki avtomatik berish chekini tanlash; boshqa mamlakatlar — faqat Robokassa. O‘chirilgan bo‘lsa barcha mamlakatlarda — qo‘lda tekshiriladigan chek. Chek bo‘yicha avtomatik berish GOOGLE_VISION_API_KEY talab qiladi (OCR, summa ±10%); kalit bo‘lmasa chek qo‘lda tekshirishga yuboriladi.",
    merchantLoginLabel: "Do‘kon identifikatori (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Parol #1 (jonli)",
    pass2Label: "Parol #2 (jonli)",
    pass1TestLabel: "Parol #1 (test)",
    pass2TestLabel: "Parol #2 (test)",
    testModeLabel: "Test rejimi (IsTest=1)",
    saveRobokassaBtn: "Robokassa’ni saqlash",
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
    robokassaSaveError: (msg) => `Robokassa saqlash xatosi: ${msg}`,
    docsSaveError: (msg) => `Hujjatlarni saqlash xatosi: ${msg}`,
    uploadFailed: (name) => `${name} yuklanmadi`,
    uploadError: "Yuklash xatosi",
    confirmDeleteOffer: "Oferta faylini o‘chirasizmi?",
    confirmDeletePrivacy: "Siyosat faylini o‘chirasizmi?",
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

  const [rkEnabled, setRkEnabled] = useState(false);
  const [rkTestMode, setRkTestMode] = useState(false);
  const [rkLogin, setRkLogin] = useState("");
  const [rkPass1, setRkPass1] = useState("");
  const [rkPass2, setRkPass2] = useState("");
  const [rkPass1Test, setRkPass1Test] = useState("");
  const [rkPass2Test, setRkPass2Test] = useState("");
  const [rkSaved, setRkSaved] = useState(false);

  const [legalSeller, setLegalSeller] = useState("");
  const [legalAbout, setLegalAbout] = useState("");
  const [offerFile, setOfferFile] = useState("");
  const [offerFileName, setOfferFileName] = useState("");
  const [privacyFile, setPrivacyFile] = useState("");
  const [privacyFileName, setPrivacyFileName] = useState("");
  const [legalSaved, setLegalSaved] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"offer" | "privacy" | null>(null);
  const [instructionCaption, setInstructionCaption] = useState("");
  const [instructionVideoPath, setInstructionVideoPath] = useState("");
  const [instructionUploading, setInstructionUploading] = useState(false);
  const [instructionSaved, setInstructionSaved] = useState(false);

  useEffect(() => {
    setAdminChatId(settings.data?.admin_chat_id ?? "");
    setAdminContactLink(settings.data?.admin_contact_link ?? "");
    setRkEnabled(settings.data?.robokassa_enabled === "true");
    setRkTestMode(settings.data?.robokassa_test_mode === "true");
    setRkLogin(settings.data?.robokassa_login ?? "");
    setRkPass1(settings.data?.robokassa_pass1 ?? "");
    setRkPass2(settings.data?.robokassa_pass2 ?? "");
    setRkPass1Test(settings.data?.robokassa_pass1_test ?? "");
    setRkPass2Test(settings.data?.robokassa_pass2_test ?? "");
    setLegalSeller(settings.data?.legal_seller_details ?? "");
    setLegalAbout(settings.data?.legal_about_html ?? "");
    setOfferFile(settings.data?.legal_offer_file ?? "");
    setOfferFileName(settings.data?.legal_offer_filename ?? "");
    setPrivacyFile(settings.data?.legal_privacy_file ?? "");
    setPrivacyFileName(settings.data?.legal_privacy_filename ?? "");
    setInstructionCaption(settings.data?.instruction_caption ?? "");
    setInstructionVideoPath(settings.data?.instruction_video_path ?? "");
  }, [settings.data]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app";

  async function onSave() {
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

  async function onSaveRobokassa() {
    try {
      // Promise.all гарантирует, что все настройки сохранятся атомарно (или ни одна не сохранится)
      await Promise.all([
        saveSetting({ data: { key: "robokassa_enabled", value: rkEnabled ? "true" : "false" } }),
        saveSetting({ data: { key: "robokassa_test_mode", value: rkTestMode ? "true" : "false" } }),
        saveSetting({ data: { key: "robokassa_login", value: rkLogin.trim() } }),
        saveSetting({ data: { key: "robokassa_pass1", value: rkPass1.trim() } }),
        saveSetting({ data: { key: "robokassa_pass2", value: rkPass2.trim() } }),
        saveSetting({ data: { key: "robokassa_pass1_test", value: rkPass1Test.trim() } }),
        saveSetting({ data: { key: "robokassa_pass2_test", value: rkPass2Test.trim() } }),
      ]);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setRkSaved(true);
      setTimeout(() => setRkSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.robokassaSaveError(errorMessage(e) || tr.unknownError));
    }
  }

  async function onSaveLegal() {
    try {
      await Promise.all([
        saveSetting({ data: { key: "legal_seller_details", value: legalSeller } }),
        saveSetting({ data: { key: "legal_about_html", value: legalAbout } }),
      ]);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setLegalSaved(true);
      setTimeout(() => setLegalSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.docsSaveError(errorMessage(e) || tr.unknownError));
    }
  }

  async function onUploadLegal(kind: "offer" | "privacy", file: File | null) {
    if (!file) return;
    setUploadingKind(kind);
    try {
      const { path, signedUrl, filename } = await getLegalDocUploadUrl({
        data: { kind, filename: file.name },
      });
      const res = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/pdf" },
      });
      if (!res.ok) throw new Error(tr.uploadFailed(file.name));
      await commitLegalDocFn({ data: { kind, path, filename } });
      if (kind === "offer") {
        setOfferFile(path);
        setOfferFileName(filename);
      } else {
        setPrivacyFile(path);
        setPrivacyFileName(filename);
      }
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e) || tr.uploadError);
    } finally {
      setUploadingKind(null);
    }
  }

  async function onClearLegal(kind: "offer" | "privacy") {
    if (!(await confirmToast(kind === "offer" ? tr.confirmDeleteOffer : tr.confirmDeletePrivacy)))
      return;
    try {
      await clearLegalDocFn({ data: { kind } });
      if (kind === "offer") {
        setOfferFile("");
        setOfferFileName("");
      } else {
        setPrivacyFile("");
        setPrivacyFileName("");
      }
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  async function onSaveInstruction() {
    await saveSetting({ data: { key: "instruction_caption", value: instructionCaption } });
    qc.invalidateQueries({ queryKey: ["settings"] });
    setInstructionSaved(true);
    setTimeout(() => setInstructionSaved(false), 2000);
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
          <Button onClick={onSave}>{tr.save}</Button>
          {saved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">{tr.legalTitle}</h2>
        <p className="text-sm text-muted-foreground">{tr.legalHint}</p>
        <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1 break-all">
          <div>
            {tr.offerLabel} <code>{origin}/legal/offer</code>
          </div>
          <div>
            {tr.privacyLabel} <code>{origin}/legal/privacy</code>
          </div>
          <div>
            {tr.requisitesLabel} <code>{origin}/legal/requisites</code>
          </div>
          <div>
            {tr.aboutLinkLabel} <code>{origin}/legal/about</code>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{tr.sellerDetailsLabel}</Label>
          <Textarea rows={5} value={legalSeller} onChange={(e) => setLegalSeller(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{tr.offerFileLabel}</Label>
          <p className="text-xs text-muted-foreground">{tr.pdfHint}</p>
          <Input
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={uploadingKind !== null}
            onChange={(e) => onUploadLegal("offer", e.target.files?.[0] ?? null)}
          />
          {uploadingKind === "offer" && (
            <p className="text-sm text-muted-foreground">{tr.uploading}</p>
          )}
          {offerFile && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a
                className="text-primary underline"
                href={`${origin}/legal/offer?v=${encodeURIComponent(offerFile.replace(/[^\w.-]+/g, "").slice(-48) || "1")}`}
                target="_blank"
                rel="noreferrer"
              >
                {offerFileName || offerFile}
              </a>
              <Button type="button" size="sm" variant="ghost" onClick={() => onClearLegal("offer")}>
                {tr.deleteBtn}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>{tr.privacyFileLabel}</Label>
          <p className="text-xs text-muted-foreground">{tr.pdfHint}</p>
          <Input
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={uploadingKind !== null}
            onChange={(e) => onUploadLegal("privacy", e.target.files?.[0] ?? null)}
          />
          {uploadingKind === "privacy" && (
            <p className="text-sm text-muted-foreground">{tr.uploading}</p>
          )}
          {privacyFile && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a
                className="text-primary underline"
                href={`${origin}/legal/privacy?v=${encodeURIComponent(privacyFile.replace(/[^\w.-]+/g, "").slice(-48) || "1")}`}
                target="_blank"
                rel="noreferrer"
              >
                {privacyFileName || privacyFile}
              </a>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onClearLegal("privacy")}
              >
                {tr.deleteBtn}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>{tr.aboutLabel}</Label>
          <Textarea
            rows={5}
            value={legalAbout}
            onChange={(e) => setLegalAbout(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onSaveLegal}>{tr.saveDocsBtn}</Button>
          {legalSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
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

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">{tr.robokassaTitle}</h2>
        <div className="rounded-md bg-muted/50 p-3 text-sm space-y-2">
          <p className="font-medium">{tr.robokassaUrlLabel}</p>
          <code className="block break-all text-xs">{origin}/api/public/robokassa/result</code>
          <code className="block break-all text-xs">{origin}/api/public/robokassa/success</code>
          <code className="block break-all text-xs">{origin}/api/public/robokassa/fail</code>
          <p className="text-muted-foreground text-xs">{tr.robokassaRegionHint}</p>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={rkEnabled} onCheckedChange={(c) => setRkEnabled(!!c)} />
          <span>{tr.robokassaEnableLabel}</span>
        </label>
        {rkEnabled && <p className="text-xs text-muted-foreground">{tr.robokassaEnabledHint}</p>}

        {rkEnabled && (
          <div className="space-y-4 pt-2 border-t border-border/50">
            <div className="space-y-2">
              <Label>{tr.merchantLoginLabel}</Label>
              <Input
                value={rkLogin}
                onChange={(e) => setRkLogin(e.target.value)}
                placeholder={tr.merchantLoginPlaceholder}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tr.pass1Label}</Label>
                <Input
                  type="password"
                  value={rkPass1}
                  onChange={(e) => setRkPass1(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{tr.pass2Label}</Label>
                <Input
                  type="password"
                  value={rkPass2}
                  onChange={(e) => setRkPass2(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{tr.pass1TestLabel}</Label>
                <Input
                  type="password"
                  value={rkPass1Test}
                  onChange={(e) => setRkPass1Test(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{tr.pass2TestLabel}</Label>
                <Input
                  type="password"
                  value={rkPass2Test}
                  onChange={(e) => setRkPass2Test(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={rkTestMode} onCheckedChange={(c) => setRkTestMode(!!c)} />
              <span>{tr.testModeLabel}</span>
            </label>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button onClick={onSaveRobokassa}>{tr.saveRobokassaBtn}</Button>
          {rkSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
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
