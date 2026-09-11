import { useRouteContext } from "@tanstack/react-router";
import { isConsultantVertical, isPhysicalShopVertical, type VerticalKey } from "./registry";

/**
 * Ниша деплоя, прокинутая с сервера через root context
 * (getRuntimeModulesFn). На клиенте process.env.VERTICAL недоступен —
 * без этого хука админка не может отличить кондитерскую от цифрового
 * магазина и рисует «файлы» / «автора» там, где нужны торты.
 *
 * isPhysicalShop — не «товары физические», а «витрина кондитерской»:
 * зоны доставки, задаток, самовывоз. Консультант (VERTICAL=consultant)
 * тоже physical по товару, но этот флаг у него false.
 */
export function useVertical(): {
  vertical: VerticalKey;
  verticalTitle: string;
  defaultFulfillmentKind: "digital" | "physical";
  isPhysicalShop: boolean;
  isConsultant: boolean;
} {
  const ctx = useRouteContext({ from: "__root__" });
  const vertical = (ctx.vertical ?? "digital") as VerticalKey;
  const defaultFulfillmentKind = ctx.defaultFulfillmentKind ?? "digital";
  return {
    vertical,
    verticalTitle: ctx.verticalTitle ?? "",
    defaultFulfillmentKind,
    isPhysicalShop: isPhysicalShopVertical(vertical),
    isConsultant: isConsultantVertical(vertical),
  };
}
