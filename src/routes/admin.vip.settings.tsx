import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSettings, saveSetting } from "@/lib/settings.functions";
import { runVipCronNow } from "@/lib/vip-subscriptions.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Checkbox } from "@/components-ui/checkbox";
import { Textarea } from "@/components-ui/textarea";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/vip/settings")({
  component: AdminVipSettings,
});

const copy: Record<
  Locale,
  {
    loading: string;
    title: string;
    groupIdLabel: string;
    groupIdPlaceholder: string;
    groupIdHint: string;
    warn1Days: string;
    warn1Minutes: string;
    warn1Hint: (unit: string) => string;
    warn2Days: string;
    warn2Minutes: string;
    warn2Hint: (unit: string) => string;
    unitDays: string;
    unitDay: string;
    unitMinutes: string;
    unitMinute: string;
    instructionsLabel: string;
    instructionsPlaceholder: string;
    instructionsHint: string;
    welcomeLabel: string;
    welcomePlaceholder: string;
    testModeLabel: string;
    testModeHint: (before: string) => string;
    testModeHintBefore: string;
    runCronBtn: string;
    runCronBusy: string;
    runCronHint: string;
    cronDone: (r: {
      warned: number;
      warned2: number;
      expired: number;
      kickFailed: number;
    }) => string;
    cronError: (msg: string) => string;
    saveBtn: string;
    savedLabel: string;
  }
> = {
  ru: {
    loading: "Загрузка...",
    title: "Настройки VIP-группы",
    groupIdLabel: "ID Telegram Группы (начинается с -100)",
    groupIdPlaceholder: "-100123456789",
    groupIdHint:
      'Бот должен быть администратором в этой группе с правом "Приглашать участников" и "Исключать участников".',
    warn1Days: "1-е предупреждение (за N дней)",
    warn1Minutes: "1-е предупреждение (за N минут)",
    warn1Hint: (unit) => `Обычно 3 ${unit} до конца.`,
    warn2Days: "2-е предупреждение (за N дней)",
    warn2Minutes: "2-е предупреждение (за N минут)",
    warn2Hint: (unit) => `Обычно 1 ${unit} до конца. Должно быть меньше первого.`,
    unitDays: "дня",
    unitDay: "день",
    unitMinutes: "минуты",
    unitMinute: "минута",
    instructionsLabel: "Текст с реквизитами для VIP",
    instructionsPlaceholder: "Оплатите на Каспи +7... и пришлите чек",
    instructionsHint: "Этот текст показывается после того как пользователь выбрал тариф.",
    welcomeLabel: "Приветственное сообщение после выдачи доступа",
    welcomePlaceholder: "Спасибо за оплату! Ваша ссылка ниже:",
    testModeLabel: "Включить режим тестирования",
    testModeHint: (before) =>
      `Если включено: срок берётся из поля «минуты» в тарифе (не из дней). Включайте ${before} подтверждения оплаты — уже активные подписки сами не пересчитаются. Оба предупреждения тоже в минутах.`,
    testModeHintBefore: "до",
    runCronBtn: "Запустить проверку подписок сейчас",
    runCronBusy: "Проверяю…",
    runCronHint: "Для теста кика/напоминаний без ожидания cron",
    cronDone: (r) =>
      `Готово: 1-е предупр. ${r.warned}, 2-е предупр. ${r.warned2}, истекло/кик ${r.expired}, ошибок кика ${r.kickFailed}`,
    cronError: (msg) => `Ошибка: ${msg}`,
    saveBtn: "Сохранить настройки",
    savedLabel: "Сохранено ✓",
  },
  kk: {
    loading: "Жүктелуде...",
    title: "VIP-топ баптаулары",
    groupIdLabel: "Telegram топ ID-і (-100 бастап)",
    groupIdPlaceholder: "-100123456789",
    groupIdHint:
      "Бот бұл топта «Мүшелерді шақыру» және «Мүшелерді шығару» құқығы бар әкімші болуы керек.",
    warn1Days: "1-ескерту (N күн бұрын)",
    warn1Minutes: "1-ескерту (N минут бұрын)",
    warn1Hint: (unit) => `Әдетте соңына дейін 3 ${unit}.`,
    warn2Days: "2-ескерту (N күн бұрын)",
    warn2Minutes: "2-ескерту (N минут бұрын)",
    warn2Hint: (unit) => `Әдетте соңына дейін 1 ${unit}. Біріншісінен аз болуы керек.`,
    unitDays: "күн",
    unitDay: "күн",
    unitMinutes: "минут",
    unitMinute: "минут",
    instructionsLabel: "VIP үшін төлем деректері мәтіні",
    instructionsPlaceholder: "Kaspi-ге +7... төлеп, чекті жіберіңіз",
    instructionsHint: "Бұл мәтін пайдаланушы тарифті таңдағаннан кейін көрсетіледі.",
    welcomeLabel: "Қолжетімділік берілгеннен кейінгі сәлемдесу хабары",
    welcomePlaceholder: "Төлеміңіз үшін рахмет! Сілтемеңіз төменде:",
    testModeLabel: "Тестілеу режимін қосу",
    testModeHint: (before) =>
      `Қосылған болса: мерзім тарифтегі «минут» өрісінен алынады (күннен емес). ${before} төлемді растауды қосыңыз — белсенді жазылымдар өздігінен қайта есептелмейді. Екі ескерту де минутпен.`,
    testModeHintBefore: "дейін",
    runCronBtn: "Жазылымдарды қазір тексеру",
    runCronBusy: "Тексерілуде…",
    runCronHint: "cron-ды күтпей кик/еске салуларды тестілеу үшін",
    cronDone: (r) =>
      `Дайын: 1-ескерту ${r.warned}, 2-ескерту ${r.warned2}, мерзімі өтті/кик ${r.expired}, кик қатесі ${r.kickFailed}`,
    cronError: (msg) => `Қате: ${msg}`,
    saveBtn: "Баптауларды сақтау",
    savedLabel: "Сақталды ✓",
  },
  en: {
    loading: "Loading...",
    title: "VIP group settings",
    groupIdLabel: "Telegram group ID (starts with -100)",
    groupIdPlaceholder: "-100123456789",
    groupIdHint:
      'The bot must be an admin in this group with "Invite users" and "Ban users" rights.',
    warn1Days: "1st warning (N days before)",
    warn1Minutes: "1st warning (N minutes before)",
    warn1Hint: (unit) => `Usually 3 ${unit} before the end.`,
    warn2Days: "2nd warning (N days before)",
    warn2Minutes: "2nd warning (N minutes before)",
    warn2Hint: (unit) => `Usually 1 ${unit} before the end. Must be less than the first.`,
    unitDays: "days",
    unitDay: "day",
    unitMinutes: "minutes",
    unitMinute: "minute",
    instructionsLabel: "VIP payment details text",
    instructionsPlaceholder: "Pay via Kaspi +7... and send a receipt",
    instructionsHint: "This text is shown after the user picks a plan.",
    welcomeLabel: "Welcome message after access is granted",
    welcomePlaceholder: "Thanks for paying! Your link is below:",
    testModeLabel: "Enable test mode",
    testModeHint: (before) =>
      `When enabled: duration is taken from the plan's "minutes" field (not days). Turn it on ${before} confirming payment — already-active subscriptions won't be recalculated. Both warnings are in minutes too.`,
    testModeHintBefore: "before",
    runCronBtn: "Run subscription check now",
    runCronBusy: "Checking…",
    runCronHint: "To test kicks/reminders without waiting for cron",
    cronDone: (r) =>
      `Done: 1st warning ${r.warned}, 2nd warning ${r.warned2}, expired/kicked ${r.expired}, kick errors ${r.kickFailed}`,
    cronError: (msg) => `Error: ${msg}`,
    saveBtn: "Save settings",
    savedLabel: "Saved ✓",
  },
  uz: {
    loading: "Yuklanmoqda...",
    title: "VIP-guruh sozlamalari",
    groupIdLabel: "Telegram guruh ID (-100 bilan boshlanadi)",
    groupIdPlaceholder: "-100123456789",
    groupIdHint:
      "Bot bu guruhda «A'zolarni taklif qilish» va «A'zolarni chiqarish» huquqiga ega administrator bo'lishi kerak.",
    warn1Days: "1-ogohlantirish (N kun oldin)",
    warn1Minutes: "1-ogohlantirish (N daqiqa oldin)",
    warn1Hint: (unit) => `Odatda oxirigacha 3 ${unit}.`,
    warn2Days: "2-ogohlantirish (N kun oldin)",
    warn2Minutes: "2-ogohlantirish (N daqiqa oldin)",
    warn2Hint: (unit) => `Odatda oxirigacha 1 ${unit}. Birinchisidan kam bo‘lishi kerak.`,
    unitDays: "kun",
    unitDay: "kun",
    unitMinutes: "daqiqa",
    unitMinute: "daqiqa",
    instructionsLabel: "VIP uchun to‘lov ma’lumotlari matni",
    instructionsPlaceholder: "Kaspi orqali +7... to‘lang va chekni yuboring",
    instructionsHint: "Bu matn foydalanuvchi tarifni tanlaganidan keyin ko‘rsatiladi.",
    welcomeLabel: "Kirish berilgandan keyingi salomlashuv xabari",
    welcomePlaceholder: "To‘lov uchun rahmat! Havolangiz quyida:",
    testModeLabel: "Test rejimini yoqish",
    testModeHint: (before) =>
      `Yoqilgan bo‘lsa: muddat tarifdagi «daqiqa» maydonidan olinadi (kundan emas). ${before} to‘lovni tasdiqlashni yoqing — allaqachon faol obunalar avtomatik qayta hisoblanmaydi. Ikkala ogohlantirish ham daqiqada.`,
    testModeHintBefore: "oldin",
    runCronBtn: "Obunalarni hozir tekshirish",
    runCronBusy: "Tekshirilmoqda…",
    runCronHint: "cron kutmasdan kick/eslatmalarni sinash uchun",
    cronDone: (r) =>
      `Tayyor: 1-ogohlantirish ${r.warned}, 2-ogohlantirish ${r.warned2}, muddati o‘tgan/kick ${r.expired}, kick xatolari ${r.kickFailed}`,
    cronError: (msg) => `Xato: ${msg}`,
    saveBtn: "Sozlamalarni saqlash",
    savedLabel: "Saqlandi ✓",
  },
};

function AdminVipSettings() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });

  const [groupId, setGroupId] = useState("");
  const [warnDays, setWarnDays] = useState("");
  const [warnDays2, setWarnDays2] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [cronBusy, setCronBusy] = useState(false);
  const [cronResult, setCronResult] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setGroupId(settings.data.vip_group_id || "");
      setWarnDays(settings.data.vip_warn_days || "3");
      setWarnDays2(settings.data.vip_warn_days_2 || "1");
      setTestMode(settings.data.vip_test_mode === "true");
      setInstructions(settings.data.vip_payment_instructions || "");
      setWelcomeMsg(settings.data.vip_welcome_message || "");
    }
  }, [settings.data]);

  const onSave = async () => {
    // Раньше без try/catch: обрыв посередине шести последовательных записей
    // оставлял часть настроек сохранённой, часть нет, без единого сигнала
    // какая (Блок C.7, кейс 2, раунд 2). Promise.all — тот же приём, что и
    // на соседних страницах настроек.
    try {
      await Promise.all([
        saveSetting({ data: { key: "vip_group_id", value: groupId } }),
        saveSetting({ data: { key: "vip_warn_days", value: warnDays } }),
        saveSetting({ data: { key: "vip_warn_days_2", value: warnDays2 } }),
        saveSetting({ data: { key: "vip_test_mode", value: testMode ? "true" : "false" } }),
        saveSetting({ data: { key: "vip_payment_instructions", value: instructions } }),
        saveSetting({ data: { key: "vip_welcome_message", value: welcomeMsg } }),
      ]);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  };

  const onRunCron = async () => {
    setCronBusy(true);
    setCronResult(null);
    try {
      const r = await runVipCronNow();
      setCronResult(
        tr.cronDone({
          warned: r.warned,
          warned2: r.warned2 ?? 0,
          expired: r.expired,
          kickFailed: r.kickFailed,
        }) + (r.errors.length ? `\n${r.errors.join("\n")}` : ""),
      );
    } catch (e: unknown) {
      setCronResult(tr.cronError(errorMessage(e)));
    } finally {
      setCronBusy(false);
    }
  };

  if (settings.isLoading) return <div>{tr.loading}</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold">{tr.title}</h2>

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <div className="space-y-2">
          <Label>{tr.groupIdLabel}</Label>
          <Input
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder={tr.groupIdPlaceholder}
          />
          <p className="text-xs text-muted-foreground">{tr.groupIdHint}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{testMode ? tr.warn1Minutes : tr.warn1Days}</Label>
            <Input
              type="number"
              min={1}
              value={warnDays}
              onChange={(e) => setWarnDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tr.warn1Hint(testMode ? tr.unitMinutes : tr.unitDays)}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{testMode ? tr.warn2Minutes : tr.warn2Days}</Label>
            <Input
              type="number"
              min={1}
              value={warnDays2}
              onChange={(e) => setWarnDays2(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tr.warn2Hint(testMode ? tr.unitMinute : tr.unitDay)}
            </p>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <Label>{tr.instructionsLabel}</Label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={5}
            placeholder={tr.instructionsPlaceholder}
          />
          <p className="text-xs text-muted-foreground">{tr.instructionsHint}</p>
        </div>

        <div className="space-y-2 pt-2">
          <Label>{tr.welcomeLabel}</Label>
          <Textarea
            value={welcomeMsg}
            onChange={(e) => setWelcomeMsg(e.target.value)}
            rows={3}
            placeholder={tr.welcomePlaceholder}
          />
        </div>

        <div className="border rounded-md p-4 bg-muted/30 mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox checked={testMode} onCheckedChange={(c) => setTestMode(!!c)} id="test-mode" />
            <Label htmlFor="test-mode" className="font-semibold text-destructive cursor-pointer">
              {tr.testModeLabel}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            {tr.testModeHint(tr.testModeHintBefore)}
          </p>
          <div className="ml-6 pt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRunCron}
              disabled={cronBusy}
            >
              {cronBusy ? tr.runCronBusy : tr.runCronBtn}
            </Button>
            <span className="text-xs text-muted-foreground">{tr.runCronHint}</span>
          </div>
          {cronResult && (
            <pre className="text-xs ml-6 whitespace-pre-wrap text-muted-foreground">
              {cronResult}
            </pre>
          )}
        </div>

        <div className="pt-4 flex items-center gap-3">
          <Button onClick={onSave}>{tr.saveBtn}</Button>
          {saved && <span className="text-sm text-green-600">{tr.savedLabel}</span>}
        </div>
      </div>
    </div>
  );
}
