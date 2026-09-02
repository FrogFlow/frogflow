import { createFileRoute, redirect } from "@tanstack/react-router";
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
} from "@/lib/settings.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import { useVertical } from "@/lib/verticals/use-vertical";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/robokassa")({
  beforeLoad: ({ context }) => {
    if (!context.modules.robokassa) throw redirect({ to: "/admin" });
  },
  component: RobokassaPage,
});

const copy: Record<
  Locale,
  {
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
    aboutLabelPhysical: string;
    saveDocsBtn: string;
    savedLabel: string;
    robokassaTitle: string;
    robokassaUrlLabel: string;
    robokassaRegionHint: string;
    robokassaEnableLabel: string;
    robokassaEnableLabelPhysical: string;
    robokassaEnabledHint: string;
    robokassaEnabledHintPhysical: string;
    merchantLoginLabel: string;
    merchantLoginPlaceholder: string;
    pass1Label: string;
    pass2Label: string;
    pass1TestLabel: string;
    pass2TestLabel: string;
    testModeLabel: string;
    saveRobokassaBtn: string;
    robokassaSaveError: (msg: string) => string;
    docsSaveError: (msg: string) => string;
    uploadFailed: (name: string) => string;
    uploadError: string;
    confirmDeleteOffer: string;
    confirmDeletePrivacy: string;
    unknownError: string;
  }
> = {
  ru: {
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
    aboutLabelPhysical: "О продавце / кондитерской (HTML или текст)",
    saveDocsBtn: "Сохранить документы",
    savedLabel: "Сохранено ✓",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "URL для кабинета Robokassa:",
    robokassaRegionHint: "ResultURL: метод POST, алгоритм хеша MD5. Регион: Robokassa.KZ.",
    robokassaEnableLabel: "Включить оплату через Robokassa (автовыдача файлов)",
    robokassaEnableLabelPhysical: "Включить оплату через Robokassa (автоподтверждение оплаты)",
    robokassaEnabledHint:
      "При включении: RU, BY, OTHER — только чек с автовыдачей; KZ — выбор Robokassa или чек с автовыдачей; остальные страны — только Robokassa. При выключении все страны — чек с ручной проверкой. Автовыдача по чеку требует GOOGLE_VISION_API_KEY (OCR, сумма ±10%); без ключа чек уходит на ручную проверку.",
    robokassaEnabledHintPhysical:
      "При включении оплата картой подтверждается автоматически, заказ уходит в работу. При выключении — чек с ручной проверкой, затем «Принять заказ». OCR чека требует GOOGLE_VISION_API_KEY (сумма ±10%); без ключа чек уходит на ручную проверку.",
    merchantLoginLabel: "Идентификатор магазина (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Пароль #1 (боевой)",
    pass2Label: "Пароль #2 (боевой)",
    pass1TestLabel: "Пароль #1 (тестовый)",
    pass2TestLabel: "Пароль #2 (тестовый)",
    testModeLabel: "Тестовый режим (IsTest=1)",
    saveRobokassaBtn: "Сохранить Robokassa",
    robokassaSaveError: (msg) => `Ошибка сохранения Robokassa: ${msg}`,
    docsSaveError: (msg) => `Ошибка сохранения документов: ${msg}`,
    uploadFailed: (name) => `Не удалось загрузить ${name}`,
    uploadError: "Ошибка загрузки",
    confirmDeleteOffer: "Удалить файл оферты?",
    confirmDeletePrivacy: "Удалить файл политики?",
    unknownError: "Неизвестная ошибка",
  },
  kk: {
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
    aboutLabelPhysical: "Сатушы / кондитерлік туралы (HTML немесе мәтін)",
    saveDocsBtn: "Құжаттарды сақтау",
    savedLabel: "Сақталды ✓",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "Robokassa кабинеті үшін URL:",
    robokassaRegionHint: "ResultURL: POST әдісі, MD5 хеш алгоритмі. Аймақ: Robokassa.KZ.",
    robokassaEnableLabel: "Robokassa арқылы төлемді қосу (файлдарды автоберу)",
    robokassaEnableLabelPhysical: "Robokassa арқылы төлемді қосу (төлемді авторастау)",
    robokassaEnabledHint:
      "Қосылған кезде: RU, BY, OTHER — тек автобер чегі; KZ — Robokassa немесе автобер чегін таңдау; басқа елдер — тек Robokassa. Өшірулі кезде барлық елдерде — қолмен тексерілетін чек. Чек бойынша автобер GOOGLE_VISION_API_KEY талап етеді (OCR, сома ±10%); кілт болмаса чек қолмен тексеруге жіберіледі.",
    robokassaEnabledHintPhysical:
      "Қосылғанда картамен төлем автоматты расталады, тапсырыс жұмысқа кетеді. Өшірулі — қолмен тексерілетін чек, сосын «Қабылдау». OCR үшін GOOGLE_VISION_API_KEY (сома ±10%).",
    merchantLoginLabel: "Дүкен идентификаторы (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Құпия сөз №1 (боевой)",
    pass2Label: "Құпия сөз №2 (боевой)",
    pass1TestLabel: "Құпия сөз №1 (тест)",
    pass2TestLabel: "Құпия сөз №2 (тест)",
    testModeLabel: "Тест режимі (IsTest=1)",
    saveRobokassaBtn: "Robokassa сақтау",
    robokassaSaveError: (msg) => `Robokassa сақтау қатесі: ${msg}`,
    docsSaveError: (msg) => `Құжаттарды сақтау қатесі: ${msg}`,
    uploadFailed: (name) => `${name} жүктелмеді`,
    uploadError: "Жүктеу қатесі",
    confirmDeleteOffer: "Оферта файлын жою керек пе?",
    confirmDeletePrivacy: "Саясат файлын жою керек пе?",
    unknownError: "Белгісіз қате",
  },
  en: {
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
    aboutLabelPhysical: "About the seller / bakery (HTML or text)",
    saveDocsBtn: "Save documents",
    savedLabel: "Saved ✓",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "URL for the Robokassa dashboard:",
    robokassaRegionHint: "ResultURL: POST method, MD5 hash algorithm. Region: Robokassa.KZ.",
    robokassaEnableLabel: "Enable payment via Robokassa (auto file delivery)",
    robokassaEnableLabelPhysical: "Enable payment via Robokassa (auto payment confirmation)",
    robokassaEnabledHint:
      "When enabled: RU, BY, OTHER — receipt with auto-delivery only; KZ — choice of Robokassa or receipt with auto-delivery; other countries — Robokassa only. When disabled, all countries use a manually reviewed receipt. Auto-delivery by receipt requires GOOGLE_VISION_API_KEY (OCR, amount ±10%); without the key, receipts go to manual review.",
    robokassaEnabledHintPhysical:
      "When enabled, card payment is confirmed automatically and the order goes into production. When disabled — a manually reviewed receipt, then Accept order. Receipt OCR needs GOOGLE_VISION_API_KEY (amount ±10%).",
    merchantLoginLabel: "Shop identifier (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Password #1 (live)",
    pass2Label: "Password #2 (live)",
    pass1TestLabel: "Password #1 (test)",
    pass2TestLabel: "Password #2 (test)",
    testModeLabel: "Test mode (IsTest=1)",
    saveRobokassaBtn: "Save Robokassa",
    robokassaSaveError: (msg) => `Robokassa save error: ${msg}`,
    docsSaveError: (msg) => `Document save error: ${msg}`,
    uploadFailed: (name) => `Failed to upload ${name}`,
    uploadError: "Upload error",
    confirmDeleteOffer: "Delete the offer file?",
    confirmDeletePrivacy: "Delete the privacy policy file?",
    unknownError: "Unknown error",
  },
  uz: {
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
    aboutLabelPhysical: "Sotuvchi / qandolatxona haqida (HTML yoki matn)",
    saveDocsBtn: "Hujjatlarni saqlash",
    savedLabel: "Saqlandi ✓",
    robokassaTitle: "Robokassa",
    robokassaUrlLabel: "Robokassa kabineti uchun URL:",
    robokassaRegionHint: "ResultURL: POST usuli, MD5 xesh algoritmi. Hudud: Robokassa.KZ.",
    robokassaEnableLabel: "Robokassa orqali to‘lovni yoqish (fayllarni avtomatik berish)",
    robokassaEnableLabelPhysical:
      "Robokassa orqali to‘lovni yoqish (to‘lovni avtomatik tasdiqlash)",
    robokassaEnabledHint:
      "Yoqilgan bo‘lsa: RU, BY, OTHER — faqat avtomatik berish cheki; KZ — Robokassa yoki avtomatik berish chekini tanlash; boshqa mamlakatlar — faqat Robokassa. O‘chirilgan bo‘lsa barcha mamlakatlarda — qo‘lda tekshiriladigan chek. Chek bo‘yicha avtomatik berish GOOGLE_VISION_API_KEY talab qiladi (OCR, summa ±10%); kalit bo‘lmasa chek qo‘lda tekshirishga yuboriladi.",
    robokassaEnabledHintPhysical:
      "Yoqilganda karta to‘lovi avtomatik tasdiqlanadi, buyurtma ishga o‘tadi. O‘chirilganda — qo‘lda tekshiriladigan chek, keyin «Qabul qilish». OCR uchun GOOGLE_VISION_API_KEY (summa ±10%).",
    merchantLoginLabel: "Do‘kon identifikatori (MerchantLogin)",
    merchantLoginPlaceholder: "my_shop_id",
    pass1Label: "Parol #1 (jonli)",
    pass2Label: "Parol #2 (jonli)",
    pass1TestLabel: "Parol #1 (test)",
    pass2TestLabel: "Parol #2 (test)",
    testModeLabel: "Test rejimi (IsTest=1)",
    saveRobokassaBtn: "Robokassa’ni saqlash",
    robokassaSaveError: (msg) => `Robokassa saqlash xatosi: ${msg}`,
    docsSaveError: (msg) => `Hujjatlarni saqlash xatosi: ${msg}`,
    uploadFailed: (name) => `${name} yuklanmadi`,
    uploadError: "Yuklash xatosi",
    confirmDeleteOffer: "Oferta faylini o‘chirasizmi?",
    confirmDeletePrivacy: "Siyosat faylini o‘chirasizmi?",
    unknownError: "Noma’lum xato",
  },
};

function RobokassaPage() {
  const { locale } = useAdminLocale();
  const { isPhysicalShop } = useVertical();
  const tr = copy[locale];
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });

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

  useEffect(() => {
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
  }, [settings.data]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app";

  async function onSaveRobokassa() {
    // Значения ещё не пришли из settings.data (useEffect выше их подставит) —
    // сохранить сейчас значит записать пустые поля поверх боевых реквизитов
    // Robokassa (тот же баг, что Блок 4.7 уже чинил на admin.settings.tsx).
    if (settings.isLoading) return;
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
    if (settings.isLoading) return;
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

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">{tr.robokassaTitle}</h1>

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
          <Label>{isPhysicalShop ? tr.aboutLabelPhysical : tr.aboutLabel}</Label>
          <Textarea
            rows={5}
            value={legalAbout}
            onChange={(e) => setLegalAbout(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onSaveLegal} disabled={settings.isLoading}>
            {tr.saveDocsBtn}
          </Button>
          {legalSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <div className="rounded-md bg-muted/50 p-3 text-sm space-y-2">
          <p className="font-medium">{tr.robokassaUrlLabel}</p>
          <code className="block break-all text-xs">{origin}/api/public/robokassa/result</code>
          <code className="block break-all text-xs">{origin}/api/public/robokassa/success</code>
          <code className="block break-all text-xs">{origin}/api/public/robokassa/fail</code>
          <p className="text-muted-foreground text-xs">{tr.robokassaRegionHint}</p>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={rkEnabled} onCheckedChange={(c) => setRkEnabled(!!c)} />
          <span>{isPhysicalShop ? tr.robokassaEnableLabelPhysical : tr.robokassaEnableLabel}</span>
        </label>
        {rkEnabled && (
          <p className="text-xs text-muted-foreground">
            {isPhysicalShop ? tr.robokassaEnabledHintPhysical : tr.robokassaEnabledHint}
          </p>
        )}

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
          <Button onClick={onSaveRobokassa} disabled={settings.isLoading}>
            {tr.saveRobokassaBtn}
          </Button>
          {rkSaved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>
    </div>
  );
}
