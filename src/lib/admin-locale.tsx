import { createContext, useContext } from "react";
import type { Locale } from "@/lib/i18n";

/**
 * Locale selected in the admin panel header (see AdminLayout in
 * src/routes/admin.tsx). Exposed via context so every page rendered inside
 * <Outlet/> can read the current locale without prop-drilling.
 */
export const AdminLocaleContext = createContext<{
  locale: Locale;
  changeLocale: (next: Locale) => void;
} | null>(null);

/** Read the admin panel's current locale. Must be used inside AdminLayout's <Outlet/>. */
export function useAdminLocale() {
  const ctx = useContext(AdminLocaleContext);
  if (!ctx) throw new Error("useAdminLocale must be used within AdminLayout");
  return ctx;
}
