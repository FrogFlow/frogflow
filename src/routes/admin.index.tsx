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
      'In Settings set the deposit and pickup/delivery, in Delivery zones — areas. In Orders: Accept → In production → Ready → Delivered.',
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
  },
};

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const { locale } = useAdminLocale();
  const { isPhysicalShop } = useVertical();
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
      {delivering > 0 && <p className="text-sm text-blue-700">{c.delivering(delivering)}</p>}
      <div className="bg-card border rounded-lg p-4">
        <h2 className="font-medium mb-2">{c.howToTitle}</h2>
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          <li>{isPhysicalShop ? c.step1Physical : c.step1}</li>
          <li>{c.step2}</li>
          <li>{c.step3}</li>
          <li>{isPhysicalShop ? c.step4Physical : c.step4}</li>
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
