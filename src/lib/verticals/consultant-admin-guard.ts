import { redirect } from "@tanstack/react-router";
import { isBoviConsultantVertical } from "./registry";

/** Витринные страницы админки: в consultant их нет в меню, но URL всё ещё живой. */
export function rejectConsultantShopPage(context: { vertical?: string }): void {
  if (isBoviConsultantVertical(context.vertical)) {
    throw redirect({ to: "/admin/consultant" });
  }
}

/** /admin/consultant только на нишах консультанта BOVI (обе версии). */
export function rejectNonConsultantPage(context: { vertical?: string }): void {
  if (!isBoviConsultantVertical(context.vertical)) {
    throw redirect({ to: "/admin" });
  }
}
