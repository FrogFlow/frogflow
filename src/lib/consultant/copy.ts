import type { ConsultantCountry } from "./intent";
import type { ConsultantProduct } from "./catalog";

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
    /стоимость\s*[—\-]\s*[\d\s]+[₸₽]/i.test(t)
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
