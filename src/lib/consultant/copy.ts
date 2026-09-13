import type { ConsultantCountry } from "./intent";
import type { ConsultantProduct } from "./catalog";
import { priceRub } from "./rate";

/** Дословные реплики ТЗ BOVI. Вариант B — сухой A/B без клише. */
export type ConsultantCopyPack = {
  askCountry: string;
  askProduct: string;
  oos: string;
  purchase: string;
  unrecognized: string;
  catalogEmpty: string;
  cdek: string;
  catalogLink: (url: string) => string;
  crossSell: string;
  otherCategories: string;
  telegramIntro: string;
};

export const TZ_COPY: ConsultantCopyPack = {
  askCountry:
    "Здравствуйте! Подскажите, пожалуйста, из какой вы страны — Казахстан или Россия, чтобы мы показали актуальные цены и условия доставки?",
  askProduct: "Какой товар, размер или расцветка вас интересуют? Напишите, пожалуйста:",
  oos: "Данного товара сейчас нет в наличии. В ближайшее время с вами свяжется менеджер и предложит доступные альтернативы.",
  purchase: "Спасибо! В ближайшее время с вами свяжется менеджер для оформления заказа.",
  unrecognized:
    "Спасибо за обращение! В ближайшее время с вами свяжется менеджер для консультации.",
  catalogEmpty:
    "Спасибо за обращение! В ближайшее время с вами свяжется менеджер для консультации.",
  cdek: "Доставка осуществляется курьерской службой СДЭК и оплачивается покупателем при получении по тарифам СДЭК.",
  catalogLink: (url) =>
    `С полным каталогом и подробной информацией о товарах вы можете ознакомиться на нашем сайте: ${url.replace(/^https?:\/\//, "")}. Если потребуется уточнить наличие конкретной позиции, напишите сюда.`,
  crossSell: "Может, вас интересует что-нибудь ещё из нашего ассортимента?",
  otherCategories:
    "В нашем ассортименте также представлены: матрасы, одеяла, подушки, посуда, постельное бельё и полотенца. Напишите интересующую позицию или категорию для проверки наличия и стоимости.",
  telegramIntro:
    "Консультации по наличию и цене — в Instagram Direct. Напишите сюда страну и товар — ответим по прайсу.",
};

const AB_COPY: ConsultantCopyPack = {
  ...TZ_COPY,
  askCountry:
    "Здравствуйте! Напишите, пожалуйста, страну — Казахстан или Россия. От этого зависят цена и доставка.",
  askProduct: "Напишите товар, размер или цвет — проверим наличие и цену.",
  crossSell: "Нужно проверить ещё что-то из ассортимента?",
};

export type CopyBucket = "a" | "b";

export function copyForBucket(bucket: CopyBucket | undefined): ConsultantCopyPack {
  return bucket === "b" ? AB_COPY : TZ_COPY;
}

/** Совместимость со старыми тестами: пакет A = ТЗ. */
export const consultantCopy = {
  askCountry: TZ_COPY.askCountry,
  catalogEmpty: TZ_COPY.catalogEmpty,
  oos: TZ_COPY.oos,
  purchase: TZ_COPY.purchase,
  clarify: TZ_COPY.askProduct,
  apiError: TZ_COPY.unrecognized,
  cdek: TZ_COPY.cdek,
  catalogLink: TZ_COPY.catalogLink("bovi.kz"),
  crossSell: TZ_COPY.crossSell,
  otherCategories: TZ_COPY.otherCategories,
};

function foldReply(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Своя карточка/шаблон, а не реплика менеджера — по ней нельзя ставить паузу. */
export function looksLikeConsultantBotReply(text: string): boolean {
  const t = foldReply(text);
  if (!t) return false;
  const snippets = [
    TZ_COPY.askCountry,
    TZ_COPY.askProduct,
    TZ_COPY.oos,
    TZ_COPY.purchase,
    TZ_COPY.otherCategories,
    TZ_COPY.crossSell,
    TZ_COPY.unrecognized,
    AB_COPY.askCountry,
    AB_COPY.askProduct,
    AB_COPY.crossSell,
  ];
  if (snippets.some((s) => t === foldReply(s) || t.includes(foldReply(s).slice(0, 32)))) {
    return true;
  }
  return (
    /есть в наличии/i.test(t) ||
    /данного товара сейчас нет в наличии/i.test(t) ||
    /из какой вы страны/i.test(t) ||
    /какой товар, размер или расцветка/i.test(t) ||
    /в нашем ассортименте также/i.test(t) ||
    /напишите товар, размер или цвет/i.test(t) ||
    /стоимость\s*[—\-]\s*[\d\s]+[₸₽]/i.test(t) ||
    /чем\s+(я\s+)?могу\s+помочь/i.test(t) ||
    /мы\s+прода[её]м/i.test(t) ||
    /напишите[,\s]+что\s+вас\s+интересует/i.test(t) ||
    /жду\s+вашего/i.test(t) ||
    /я\s+здесь[,\s]+чтобы\s+помочь/i.test(t) ||
    /матрас.*одеял.*подуш/i.test(t) ||
    /в\s+бюджет/i.test(t) ||
    /можно\s+собрать/i.test(t) ||
    /на\s+[\d\s]+\s*₸\s+сейчас/i.test(t)
  );
}

export const COUNTRY_BUTTONS = [
  { type: "postback" as const, title: "Казахстан", payload: "CONSULTANT_COUNTRY:KZ" },
  { type: "postback" as const, title: "Россия", payload: "CONSULTANT_COUNTRY:RU" },
];

export function formatProductReply(
  product: ConsultantProduct,
  country: ConsultantCountry | undefined,
  priceRub: number | null,
  opts: { includeCdek: boolean; shopUrl?: string; pack?: ConsultantCopyPack } = {
    includeCdek: false,
  },
): string {
  const pack = opts.pack ?? TZ_COPY;
  const colors = product.colors.length > 0 ? product.colors.join(", ") : "уточните у менеджера";
  const size = product.size ? `${product.size}`.replace(/\s*см$/i, "") : "";
  const amount =
    country === "RU" && priceRub != null
      ? `${priceRub.toLocaleString("ru-RU")} ₽`
      : `${product.price_kzt.toLocaleString("ru-RU")} ₸`;
  const title = product.name;
  const sizeBit = size ? ` ${size} см` : "";
  const lines = [
    `${title}${sizeBit} есть в наличии. Доступные расцветки: ${colors}. Стоимость — ${amount}.`,
  ];
  if (country === "RU" && opts.includeCdek) lines.push(pack.cdek);
  lines.push(pack.crossSell);
  return lines.join("\n");
}

function moneyLine(
  product: ConsultantProduct,
  country: ConsultantCountry | undefined,
  rate: number | null,
): string {
  const size = product.size ? `${product.size}`.replace(/\s*см$/i, "") : "";
  const sizeBit = size ? ` ${size} см` : "";
  const amount =
    country === "RU" && rate != null
      ? `${priceRubAmount(product.price_kzt, rate)} ₽`
      : `${product.price_kzt.toLocaleString("ru-RU")} ₸`;
  return `${product.name}${sizeBit} есть в наличии — ${amount}`;
}

function priceRubAmount(priceKzt: number, rate: number): string {
  return priceRub(priceKzt, rate).toLocaleString("ru-RU");
}

/** Совет по бюджету: 1–2 позиции, не шаблон одной карточки. */
export function formatBudgetReply(
  products: ConsultantProduct[],
  budgetKzt: number,
  country: ConsultantCountry | undefined,
  rate: number | null = null,
): string {
  const cap =
    country === "RU" && rate != null
      ? `${priceRubAmount(budgetKzt, rate)} ₽`
      : `${budgetKzt.toLocaleString("ru-RU")} ₸`;
  const lines = [`В бюджет ${cap} сейчас влезает, например:`];
  for (const p of products) lines.push(moneyLine(p, country, rate));
  lines.push("Что ближе — напишите, уточню размер или цвет.");
  return lines.join("\n");
}

/** Корзина/набор: несколько позиций и сумма, не повтор одной карточки. */
export function formatBasketReply(
  items: ConsultantProduct[],
  totalKzt: number,
  budgetKzt: number,
  country: ConsultantCountry | undefined,
  rate: number | null = null,
): string {
  const money = (n: number) =>
    country === "RU" && rate != null
      ? `${priceRubAmount(n, rate)} ₽`
      : `${n.toLocaleString("ru-RU")} ₸`;
  if (items.length === 0) {
    return `На ${money(budgetKzt)} сейчас нет набора из наличия. Напишите категорию — подберём по одной позиции.`;
  }
  const lines = [`На ${money(budgetKzt)} можно собрать:`];
  for (const p of items) lines.push(moneyLine(p, country, rate));
  if (items.length === 1) {
    lines.push(
      `Вместе ${money(totalKzt)}. Вторую позицию в ${money(budgetKzt)} уже не влезает — если собрать из более мелких, напишите.`,
    );
  } else {
    lines.push(`Вместе ${money(totalKzt)}. Если нужно ближе к сумме или другие позиции — напишите.`);
  }
  return lines.join("\n");
}
