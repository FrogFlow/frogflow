import { createFileRoute } from "@tanstack/react-router";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/consultant")({
  component: ConsultantPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    intro: string;
    catalogTitle: string;
    catalogBody: string;
    catalogStatus: string;
    rateTitle: string;
    rateBody: string;
    rateEmpty: string;
    rulesTitle: string;
    rules: string[];
  }
> = {
  ru: {
    title: "Консультант",
    intro:
      "Основа ниши: каталог из таблицы, курс VTB и правила диалога. Живые интеграции подключим следующим шагом — сейчас только каркас.",
    catalogTitle: "Каталог из Google Sheets",
    catalogBody:
      "Ежедневный Excel/CSV менеджера → таблица → бот отвечает только тем, что есть в прайсе. Цены и остатки модель не выдумывает.",
    catalogStatus: "Таблица ещё не подключена.",
    rateTitle: "Курс VTB Казахстан",
    rateBody:
      "KZT из прайса. RUB = ₸ / (курс покупки VTB KZ × 0,95), обновление раз в 15 минут. Если запрос курса не прошёл — последний удачный.",
    rateEmpty: "Последний курс: нет данных.",
    rulesTitle: "Правила диалога",
    rules: [
      "Сухой тон: без «отлично», «передаю менеджеру», лишних эмоций.",
      "Сначала страна: Казахстан или Россия. Потом уточнение товара.",
      "В наличии — ответ по прайсу и уместный допродаж. Нет в наличии — честно сказать.",
      "Доставка по РФ: CDEK, оплату доставки считает не бот — платит покупатель.",
      "Сайт: bovi.kz — можно дать ссылку, если спрашивают ассортимент целиком.",
      "«Купить», «оформить», «менеджер» — чат с менеджером, бот останавливается.",
      "Если менеджер взял диалог сам — бот молчит, пока оператор не вернёт его.",
    ],
  },
  kk: {
    title: "Кеңесші",
    intro:
      "Ниша негізі: кесте каталогы, VTB бағамы және диалог ережелері. Нақты интеграциялар келесі қадамда — қазір тек қаңқа.",
    catalogTitle: "Google Sheets каталогы",
    catalogBody:
      "Менеджердің күнделікті Excel/CSV → кесте → бот тек прайстағыны айтады. Баға мен қорды модель ойлап шығармайды.",
    catalogStatus: "Кесте әлі қосылмаған.",
    rateTitle: "VTB Қазақстан бағамы",
    rateBody:
      "KZT — прайстан. RUB = ₸ / (VTB KZ сатып алу бағамы × 0,95), 15 минут сайын. Сұрау өтпесе — соңғы сәтті мән.",
    rateEmpty: "Соңғы бағам: дерек жоқ.",
    rulesTitle: "Диалог ережелері",
    rules: [
      "Құрғақ тон: «керемет», «менеджерге беремін» жоқ.",
      "Алдымен ел: Қазақстан немесе Ресей. Содан кейін тауар.",
      "Қорда бар — прайс және орынды қосымша ұсыныс. Жоқ — ашық айту.",
      "РФ жеткізуі: CDEK, жеткізу құнын бот есептемейді — сатып алушы төлейді.",
      "Сайт: bovi.kz — толық ассортимент сұралса сілтеме беруге болады.",
      "«Сатып алу», «рәсімдеу», «менеджер» — менеджер чаты, бот тоқтайды.",
      "Менеджер диалогты өзі алса — оператор қайтарғанша бот үндемейді.",
    ],
  },
  en: {
    title: "Consultant",
    intro:
      "Foundation: sheet catalog, VTB rate, and dialog rules. Live integrations come next — this is the skeleton only.",
    catalogTitle: "Catalog from Google Sheets",
    catalogBody:
      "Manager’s daily Excel/CSV → sheet → the bot answers only from the price list. The model must not invent prices or stock.",
    catalogStatus: "No sheet connected yet.",
    rateTitle: "VTB Kazakhstan rate",
    rateBody:
      "KZT from the sheet. RUB = ₸ / (VTB KZ buy rate × 0.95), refreshed every 15 minutes. If the fetch fails — last good rate.",
    rateEmpty: "Last rate: no data.",
    rulesTitle: "Dialog rules",
    rules: [
      "Dry tone: no “great”, “handing you to a manager”, extra cheer.",
      "Country first: Kazakhstan or Russia. Then the product.",
      "In stock — answer from the list and a relevant upsell. Out of stock — say so.",
      "RF delivery: CDEK; the bot does not calculate shipping — the buyer pays it.",
      "Shop URL: bovi.kz — share if they ask for the full assortment.",
      "“Buy”, “checkout”, “manager” — open manager chat and stop the bot.",
      "If an operator takes the thread — the bot stays silent until handed back.",
    ],
  },
  uz: {
    title: "Maslahatchi",
    intro:
      "Asos: jadval katalogi, VTB kursi va dialog qoidalari. Jonli integratsiyalar keyin — hozir faqat qobiq.",
    catalogTitle: "Google Sheets katalogi",
    catalogBody:
      "Menejerning kunlik Excel/CSV → jadval → bot faqat narxlar ro‘yxatidan javob beradi. Model narx va qoldiqni o‘ylab topmaydi.",
    catalogStatus: "Jadval hali ulanmagan.",
    rateTitle: "VTB Qozog‘iston kursi",
    rateBody:
      "KZT — ro‘yxatdan. RUB = ₸ / (VTB KZ sotib olish kursi × 0,95), 15 daqiqada. So‘rov o‘tmasa — oxirgi muvaffaqiyatli qiymat.",
    rateEmpty: "Oxirgi kurs: ma’lumot yo‘q.",
    rulesTitle: "Dialog qoidalari",
    rules: [
      "Quruq ohang: «ajoyib», «menejerga o‘tkazaman» yo‘q.",
      "Avval mamlakat: Qozog‘iston yoki Rossiya. Keyin tovar.",
      "Omborda bor — ro‘yxat va o‘rinli qo‘shimcha taklif. Yo‘q — ochiq aytish.",
      "RF yetkazib berish: CDEK, yetkazib berish narxini bot hisoblamaydi — xaridor to‘laydi.",
      "Sayt: bovi.kz — to‘liq assortiment so‘ralsa havola berish mumkin.",
      "«Sotib olish», «rasmiylashtirish», «menejer» — menejer chati, bot to‘xtaydi.",
      "Menejer dialogni o‘zi olsa — operator qaytarguncha bot jim turadi.",
    ],
  },
};

function ConsultantPage() {
  const { locale } = useAdminLocale();
  const c = copy[locale];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{c.intro}</p>
      </div>

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">{c.catalogTitle}</h2>
        <p className="text-sm text-muted-foreground">{c.catalogBody}</p>
        <p className="text-sm">{c.catalogStatus}</p>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">{c.rateTitle}</h2>
        <p className="text-sm text-muted-foreground">{c.rateBody}</p>
        <p className="text-sm">{c.rateEmpty}</p>
      </section>

      <section className="bg-card border rounded-lg p-4 space-y-2">
        <h2 className="font-medium">{c.rulesTitle}</h2>
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          {c.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
