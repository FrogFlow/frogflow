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
  affirmativeInterest: string;
  declineReply: string;
  telegramIntro: string;
};

export const TZ_COPY: ConsultantCopyPack = {
  askCountry:
    "Здравствуйте! Подскажите, из какой вы страны обращаетесь?\n\n🇰🇿 Казахстан\n🇷🇺 Россия",
  askProduct: "Какой товар вас интересует?",
  oos: "Данного товара сейчас нет в наличии. В ближайшее время с вами свяжется менеджер и предложит доступные альтернативы.",
  purchase: "Спасибо! В ближайшее время с вами свяжется менеджер для оформления заказа.",
  unrecognized:
    "Спасибо за обращение! В ближайшее время с вами свяжется менеджер для консультации.",
  catalogEmpty:
    "Спасибо за обращение! В ближайшее время с вами свяжется менеджер для консультации.",
  cdek: "Доставка осуществляется курьерской службой СДЭК и оплачивается покупателем при получении по тарифам СДЭК.",
  catalogLink: (url) =>
    `С полным каталогом и подробной информацией о товарах вы можете ознакомиться на нашем сайте: ${url.replace(/^https?:\/\//, "")}. Если потребуется уточнить наличие конкретной позиции, напишите сюда.`,
  crossSell: "",
  otherCategories:
    "В нашем ассортименте также представлены: постельное бельё, одеяла, подушки, пледы и полотенца. Напишите интересующую позицию или категорию для проверки наличия и стоимости.",
  affirmativeInterest:
    "В нашем ассортименте представлены: постельное бельё, одеяла, подушки, пледы и полотенца. Напишите интересующую позицию или категорию для проверки наличия и стоимости.",
  declineReply:
    "Хорошо. Если появятся вопросы или решите оформить заказ — пишите, ответим по наличию и стоимости.",
  telegramIntro:
    "Консультации по наличию и цене — в Instagram Direct. Напишите сюда страну и товар — ответим по прайсу.",
};

const AB_COPY: ConsultantCopyPack = {
  ...TZ_COPY,
  askCountry:
    "Здравствуйте! Из какой вы страны обращаетесь?\n\n🇰🇿 Казахстан\n🇷🇺 Россия",
  askProduct: "Какой товар вас интересует?",
  crossSell: "",
  affirmativeInterest:
    "У нас есть: постельное бельё, одеяла, подушки, пледы и полотенца. Напишите товар или категорию — проверим наличие и цену.",
  declineReply:
    "Хорошо. Если появятся вопросы или решите оформить заказ — пишите, всегда на связи.",
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

export function foldReply(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Очистка markdown-разметки (*, **, #), которая не поддерживается в Instagram Direct. */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*{2,}([\s\S]*?)\*{2,}/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1$2$3")
    .replace(/\*{2,}/g, "")
    .replace(/^(\s*)\*\s+/gm, "$1• ")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
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
    TZ_COPY.affirmativeInterest,
    TZ_COPY.declineReply,
    TZ_COPY.unrecognized,
    AB_COPY.askCountry,
    AB_COPY.askProduct,
    AB_COPY.crossSell,
    AB_COPY.affirmativeInterest,
    AB_COPY.declineReply,
  ]
    .map(foldReply)
    .filter((s) => s.length >= 10);
  if (snippets.some((s) => t === s || t.includes(s.slice(0, 32)))) {
    return true;
  }
  return (
    /есть в наличии/i.test(t) ||
    /данного товара сейчас нет в наличии/i.test(t) ||
    /из какой вы страны/i.test(t) ||
    /какой товар вас интересует/i.test(t) ||
    /какой товар, размер или расцветка/i.test(t) ||
    /в нашем ассортименте также/i.test(t) ||
    /напишите товар, размер или цвет/i.test(t) ||
    /стоимость\s*[—\-]\s*[\d\s]+[₸₽]/i.test(t) ||
    /чем\s+(я\s+)?могу\s+помочь/i.test(t) ||
    /мы\s+прода[её]м/i.test(t) ||
    /напишите[,\s]+что\s+вас\s+интересует/i.test(t) ||
    /жду\s+вашего/i.test(t) ||
    /я\s+здесь[,\s]+чтобы\s+помочь/i.test(t) ||
    /одеял.*подуш/i.test(t) ||
    /матрас.*одеял.*подуш/i.test(t) ||
    /в\s+бюджет/i.test(t) ||
    /можно\s+собрать/i.test(t) ||
    /на\s+[\d\s]+\s*₸\s+сейчас/i.test(t) ||
    /ещё из этой категории/i.test(t) ||
    /размеры сейчас в наличии/i.test(t) ||
    /доставка в россию есть/i.test(t) ||
    /bovi\.kz/i.test(t) ||
    /сдэк|cdek/i.test(t) ||
    /сәлеметсіз|қайырлы\s+күн|бағасы|өлшемі|қолжетімді|жеткізу|оқасы\s+жоқ|байланыстамыз/i.test(t) ||
    /(?:казахстан|қазақстан).*россия|россия.*(?:казахстан|қазақстан)/i.test(t) ||
    /🇰🇿|🇷🇺/.test(t)
  );
}

export const COUNTRY_BUTTONS = [
  { type: "postback" as const, title: "Казахстан 🇰🇿", payload: "CONSULTANT_COUNTRY:KZ" },
  { type: "postback" as const, title: "Россия 🇷🇺", payload: "CONSULTANT_COUNTRY:RU" },
];

export function formatProductReply(
  product: ConsultantProduct,
  country: ConsultantCountry | undefined,
  priceRub: number | null,
  opts: { includeCdek: boolean; shopUrl?: string; pack?: ConsultantCopyPack; selectedColor?: string } = {
    includeCdek: false,
  },
): string {
  const pack = opts.pack ?? TZ_COPY;
  const size = product.size ? `${product.size}`.replace(/\s*см$/i, "") : "";
  const amount =
    country === "RU" && priceRub != null
      ? `${priceRub.toLocaleString("ru-RU")} ₽`
      : `${product.price_kzt.toLocaleString("ru-RU")} ₸`;
  const title = product.name;
  const sizeBit = size ? ` ${size} см` : "";

  let headerLine: string;
  if (
    opts.selectedColor &&
    product.colors.some((c) => c.toLowerCase().includes(opts.selectedColor!.toLowerCase()))
  ) {
    headerLine = `${title}${sizeBit}, цвет ${opts.selectedColor}, есть в наличии. Стоимость — ${amount}.`;
  } else {
    const colors = product.colors.length > 0 ? product.colors.join(", ") : "уточните у менеджера";
    headerLine = `${title}${sizeBit} есть в наличии. Доступные расцветки: ${colors}. Стоимость — ${amount}.`;
  }

  const lines = [headerLine];
  if (country === "RU" && opts.includeCdek) lines.push(pack.cdek);
  if (pack.crossSell?.trim()) lines.push(pack.crossSell.trim());
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

/** Другие размеры/цвета — не повтор той же карточки. */
export function formatVariantsReply(
  products: ConsultantProduct[],
  country: ConsultantCountry | undefined,
  rate: number | null = null,
): string {
  if (products.length === 0) {
    return "Других размеров и цветов в этой позиции сейчас нет. Напишите, что ещё посмотреть.";
  }
  const lines = ["Ещё из этой категории в наличии:"];
  for (const p of products) {
    const colors = p.colors.length ? ` · ${p.colors.join(", ")}` : "";
    lines.push(`${moneyLine(p, country, rate)}${colors}`);
  }
  lines.push("Какой размер или цвет ближе?");
  return lines.join("\n");
}

export function formatSizeOptionsReply(
  products: ConsultantProduct[],
  country: ConsultantCountry | undefined,
  rate: number | null = null,
  opts: { includeCdek?: boolean } = {},
): string {
  if (products.length === 0) {
    return "Напишите размер — проверю наличие и цену.";
  }
  const lines = ["Размеры в наличии:"];
  for (const p of products) {
    const size = p.size ? `${p.size}`.replace(/\s*см$/i, "") : "";
    const sizeBit = size ? ` ${size} см` : "";
    const amount =
      country === "RU" && rate != null
        ? `${priceRubAmount(p.price_kzt, rate)} ₽`
        : `${p.price_kzt.toLocaleString("ru-RU")} ₸`;
    lines.push(`• ${p.name}${sizeBit} — ${amount}`);
  }
  if (country === "RU" && opts.includeCdek) lines.push(TZ_COPY.cdek);
  lines.push("Какой размер вам нужен?");
  return lines.join("\n");
}

export function formatThanksReply(): string {
  return "Пожалуйста! Если нужен другой размер или цвет — напишите.";
}

export function formatMissingColorReply(wanted: string, alternatives: string[]): string {
  const alts = alternatives.length ? alternatives.join(", ") : "белый и бежевый";
  return `${wanted} сейчас нет в наличии. Есть ${alts}. Напишите, какой ближе, или пришлите фото с видео.`;
}
