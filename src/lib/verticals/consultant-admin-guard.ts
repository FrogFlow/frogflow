import { redirect } from "@tanstack/react-router";

/** Витринные страницы админки: в consultant их нет в меню, но URL всё ещё живой. */
export function rejectConsultantShopPage(context: { vertical?: string }): void {
  if (context.vertical === "consultant") {
    throw redirect({ to: "/admin/consultant" });
  }
}

/** /admin/consultant только на нише consultant. */
export function rejectNonConsultantPage(context: { vertical?: string }): void {
  if (context.vertical !== "consultant") {
    throw redirect({ to: "/admin" });
  }
}
