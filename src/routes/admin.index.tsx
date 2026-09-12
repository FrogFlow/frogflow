import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/orders.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import { useVertical } from "@/lib/verticals/use-vertical";
import type { Locale } from "@/lib/i18n";

const copy: Record<
  Locale,
  {
    title: string;
    products: string;
    totalOrders: string;
    awaitingPayment: string;
    awaiting: string;
    delivered: string;
    delivering: (n: number) => string;
    inProduction: string;
    ready: string;
    howToTitle: string;
    step1: string;
    step1Physical: string;
    step2: string;
    step3: string;
    step4: string;
    step4Physical: string;
    step1Consultant: string;
    step2Consultant: string;
    step3Consultant: string;
    step4Consultant: string;
  }
> = {
  ru: {
    title: "Дашборд",
    products: "Товары",
    totalOrders: "Всего заказов",
    awaitingPayment: "Ждут оплаты",
    awaiting: "Ждут подтверждения",
    delivered: "Выдано",
    inProduction: "В работе",
    ready: "Готовы к выдаче",
    delivering: (n) =>
      `Выдаётся сейчас: ${n} — порции файлов ещё идут (см. «Заказы» → Продолжить выдачу).`,
    howToTitle: "Как пользоваться",
    step1: "Создайте категории и добавьте товары.",
    step1Physical:
      "Создайте категории и добавьте торты и десерты. Новый товар по умолчанию физический — файлы прикладывать не нужно.",
    step2: "В разделе «Реквизиты» отредактируйте инструкции по оплате для каждой страны.",
    step3: "В «Настройках» укажите ваш Telegram ID — туда будут приходить уведомления о заказах.",
    step4:
      "При выключенной Robokassa: проверьте скриншот и нажмите «Подтвердить». При включённой — для RU/BY/OTHER/KZ чек может выдать файлы сразу (уведомление без кнопки); прочие страны — через Robokassa.",
    step4Physical:
      "В «Настройках» задайте задаток и самовывоз/доставку, в «Зонах доставки» — районы. В «Заказах»: Принять → В работу → Готов → Выдан.",
    step1Consultant: "В «Instagram» подключите Direct — входящие диалоги будут там же.",
    step2Consultant:
      "В разделе «Консультант» будет таблица каталога (Google Sheets / ежедневный Excel) — бот отвечает только прайсом.",
    step3Consultant: "Там же — курс VTB KZ и правила диалога. Цены и остатки модель не выдумывает.",
    step4Consultant:
      "В Direct бот отвечает сам. «Купить» / «менеджер» или ответ менеджера ставит паузу. Вернуть бота — в «Консультант».",
  },
  kk: {
    title: "Басқару тақтасы",
    products: "Тауарлар",
    totalOrders: "Барлық тапсырыстар",
    awaitingPayment: "Төлемді күтуде",
    awaiting: "Растауды күтуде",
    delivered: "Берілді",
    inProduction: "Дайындалуда",
    ready: "Беруге дайын",
    delivering: (n) =>
      `Қазір беріледі: ${n} — файл бөліктері әлі жіберілуде («Тапсырыстар» → Беруді жалғастыру бөлімін қараңыз).`,
    howToTitle: "Қалай пайдалану керек",
    step1: "Санаттарды құрып, тауарлар қосыңыз.",
    step1Physical:
      "Санаттар құрып, торт пен десерттер қосыңыз. Жаңа тауар әдепкіде физикалық — файл жүктеудің қажеті жоқ.",
    step2: "«Төлем деректері» бөлімінде әр ел үшін төлем нұсқаулығын өңдеңіз.",
    step3: "«Баптауларда» Telegram ID-іңізді көрсетіңіз — тапсырыс хабарламалары соған келеді.",
    step4:
      "Robokassa өшірулі болса: скриншотты тексеріп, «Растау» батырмасын басыңыз. Қосулы болса — RU/BY/OTHER/KZ үшін чек файлдарды бірден бере алады (батырмасыз хабарлама); басқа елдер — Robokassa арқылы.",
    step4Physical:
      "«Баптауларда» алдын ала төлем мен өзі алып кету/жеткізуді, «Жеткізу аймақтарында» аудандарды көрсетіңіз. «Тапсырыстарда»: Қабылдау → Жұмысқа → Дайын → Берілді.",
    step1Consultant:
      "«Instagram» бөлімінде Direct-ті қосыңыз — кіріс диалогтар сол жерде болады.",
    step2Consultant:
      "«Кеңесші» бөлімінде каталог кестесі болады (Google Sheets / күнделікті Excel) — бот тек прайспен жауап береді.",
    step3Consultant:
      "Сол жерде — VTB KZ бағамы және диалог ережелері. Баға мен қорды модель ойлап шығармайды.",
    step4Consultant:
      "Direct-те бот өзі жауап береді. «Сатып алу» / «менеджер» менеджер чатын ашып, ботты тоқтатады.",
  },
  en: {
    title: "Dashboard",
    products: "Products",
    totalOrders: "Total orders",
    awaitingPayment: "Awaiting payment",
    awaiting: "Awaiting confirmation",
    delivered: "Delivered",
    inProduction: "In production",
    ready: "Ready for pickup",
    delivering: (n) =>
      `Delivering now: ${n} — file batches are still being sent (see "Orders" → Continue delivery).`,
    howToTitle: "How to use this panel",
    step1: "Create categories and add products.",
    step1Physical:
      "Create categories and add cakes and desserts. New products default to physical — no files to attach.",
    step2: 'In "Payment details", edit the payment instructions for each country.',
    step3: 'In "Settings", set your Telegram ID — order notifications will be sent there.',
    step4:
      'With Robokassa disabled: check the screenshot and click "Confirm". With it enabled — for RU/BY/OTHER/KZ the receipt may release the files right away (a notification with no button); other countries go through Robokassa.',
    step4Physical:
      "In Settings set the deposit and pickup/delivery, in Delivery zones — areas. In Orders: Accept → In production → Ready → Delivered.",
    step1Consultant: "In Instagram connect Direct — incoming conversations stay on that tab.",
    step2Consultant:
      "The Consultant page will hold the catalog sheet (Google Sheets / daily Excel) — the bot answers from the price list only.",
    step3Consultant:
      "Same page: VTB KZ rate and dialog rules. The model must not invent prices or stock.",
    step4Consultant:
      "In Direct the bot replies on its own. “Buy” / “manager” opens manager chat and stops the bot.",
  },
  uz: {
    title: "Boshqaruv paneli",
    products: "Mahsulotlar",
    totalOrders: "Jami buyurtmalar",
    awaitingPayment: "To‘lovni kutmoqda",
    awaiting: "Tasdiqni kutmoqda",
    delivered: "Berildi",
    inProduction: "Tayyorlanmoqda",
    ready: "Berishga tayyor",
    delivering: (n) =>
      `Hozir berilmoqda: ${n} — fayl qismlari hali yuborilmoqda («Buyurtmalar» → Berishni davom ettirish bo‘limini qarang).`,
    howToTitle: "Qanday foydalanish kerak",
    step1: "Kategoriyalar yarating va mahsulot qo‘shing.",
    step1Physical:
      "Kategoriyalar yarating va tort va desertlar qo‘shing. Yangi mahsulot standart jismoniy — fayl yuklash shart emas.",
    step2:
      "«To‘lov ma’lumotlari» bo‘limida har bir mamlakat uchun to‘lov yo‘riqnomasini tahrirlang.",
    step3:
      "«Sozlamalar»da Telegram ID’ingizni ko‘rsating — buyurtma xabarnomalari o‘sha yerga keladi.",
    step4:
      "Robokassa o‘chirilgan bo‘lsa: skrinshotni tekshirib, «Tasdiqlash» tugmasini bosing. Yoqilgan bo‘lsa — RU/BY/OTHER/KZ uchun chek fayllarni darhol berishi mumkin (tugmasiz xabarnoma); boshqa mamlakatlar — Robokassa orqali.",
    step4Physical:
      "«Sozlamalar»da oldindan to‘lov va olib ketish/yetkazib berishni, «Yetkazib berish zonalari»da tumanlarni belgilang. «Buyurtmalar»da: Qabul qilish → Ishga → Tayyor → Berildi.",
    step1Consultant:
      "«Instagram» bo‘limida Direct’ni ulang — kiruvchi suhbatlar o‘sha yerda bo‘ladi.",
    step2Consultant:
      "«Maslahatchi» bo‘limida katalog jadvali bo‘ladi (Google Sheets / kunlik Excel) — bot faqat narxlar ro‘yxati bilan javob beradi.",
    step3Consultant:
      "O‘sha yerda — VTB KZ kursi va dialog qoidalari. Model narx va qoldiqni o‘ylab topmaydi.",
    step4Consultant:
      "Direct’da bot o‘zi javob beradi. «Sotib olish» / «menejer» menejer chatini ochadi va botni to‘xtatadi.",
  },
};

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const { locale } = useAdminLocale();
  const { isPhysicalShop, isConsultant } = useVertical();
  const c = copy[locale];
  const stats = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => getDashboardStats() });
  const s = stats.data;

  const products = s?.products ?? 0;
  const total = s?.total ?? 0;
  const awaitingPayment = s?.awaitingPayment ?? 0;
  const awaiting = s?.awaitingConfirmation ?? s?.awaiting ?? 0;
  const delivered = s?.delivered ?? 0;
  const delivering = s?.delivering ?? 0;
  const inProduction = s?.inProduction ?? 0;
  const ready = s?.ready ?? 0;
  const showProduction = isPhysicalShop || inProduction > 0;
  const showReady = isPhysicalShop || ready > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{c.title}</h1>
      {!isConsultant && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Stat label={c.products} value={products} />
          <Stat label={c.totalOrders} value={total} />
          <Stat label={c.awaitingPayment} value={awaitingPayment} highlight={awaitingPayment > 0} />
          <Stat label={c.awaiting} value={awaiting} highlight={awaiting > 0} />
          {showProduction && (
            <Stat label={c.inProduction} value={inProduction} highlight={inProduction > 0} />
          )}
          {showReady && <Stat label={c.ready} value={ready} highlight={ready > 0} />}
          <Stat label={c.delivered} value={delivered} />
        </div>
      )}
      {delivering > 0 && !isPhysicalShop && !isConsultant && (
        <p className="text-sm text-blue-700">{c.delivering(delivering)}</p>
      )}
      <div className="bg-card border rounded-lg p-4">
        <h2 className="font-medium mb-2">{c.howToTitle}</h2>
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          {isConsultant ? (
            <>
              <li>{c.step1Consultant}</li>
              <li>{c.step2Consultant}</li>
              <li>{c.step3Consultant}</li>
              <li>{c.step4Consultant}</li>
            </>
          ) : (
            <>
              <li>{isPhysicalShop ? c.step1Physical : c.step1}</li>
              <li>{c.step2}</li>
              <li>{c.step3}</li>
              <li>{isPhysicalShop ? c.step4Physical : c.step4}</li>
            </>
          )}
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 bg-card ${highlight ? "border-primary ring-1 ring-primary/40" : ""}`}
    >
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${highlight ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
