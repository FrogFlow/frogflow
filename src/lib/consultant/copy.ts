import type { ConsultantCountry } from "./intent";
import type { ConsultantProduct } from "./catalog";

export const consultantCopy = {
  askCountry:
    "Здравствуйте. Напишите, пожалуйста, из какой вы страны — Казахстан или Россия. От этого зависит цена.",
  catalogEmpty:
    "Каталог ещё не загружен. В ближайшее время с вами свяжется менеджер и уточнит наличие.",
  oos: "Данного товара сейчас нет в наличии. В ближайшее время с вами свяжется менеджер и предложит доступные альтернативы.",
  purchase: "Спасибо! В ближайшее время с вами свяжется менеджер для оформления заказа.",
  clarify: "Уточните, пожалуйста, какой товар нужен: название, размер и цвет — если они важны.",
  apiError: "Сейчас не могу ответить по каталогу. В ближайшее время с вами свяжется менеджер.",
  cdek: "Доставка по России — СДЭК, за счёт покупателя. Стоимость доставки бот не рассчитывает.",
  catalogLink: "Полный ассортимент: https://bovi.kz",
  crossSell: "Может, вас интересует что-нибудь ещё из нашего ассортимента?",
};

export function formatProductReply(
  product: ConsultantProduct,
  country: ConsultantCountry | undefined,
  priceRub: number | null,
): string {
  const colors = product.colors.length > 0 ? product.colors.join(", ") : "уточните у менеджера";
  const stock = product.stock ? "в наличии" : "нет в наличии";
  const price =
    country === "RU" && priceRub
      ? `${product.price_kzt.toLocaleString("ru-RU")} ₸ / ${priceRub.toLocaleString("ru-RU")} ₽`
      : `${product.price_kzt.toLocaleString("ru-RU")} ₸`;
  const lines = [
    product.name,
    product.size ? `Размер: ${product.size}` : "",
    `Цвета: ${colors}`,
    `Наличие: ${stock}`,
    `Цена: ${price}`,
  ].filter(Boolean);
  if (country === "RU") lines.push(consultantCopy.cdek);
  lines.push(consultantCopy.crossSell);
  return lines.join("\n");
}
