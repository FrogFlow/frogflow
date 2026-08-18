import {
  createFileRoute,
  Outlet,
  Link,
  redirect,
  notFound,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { adminCheck, adminLogout } from "@/lib/admin.functions";
import { Button } from "@/components-ui/button";
import { useModules } from "@/lib/modules/use-modules";
import { localeNames, SUPPORTED_LOCALES, t, type Locale } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { AdminAutoTranslator } from "@/components/admin-auto-translator";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context }) => {
    if (context.isPanel) throw notFound();
    const res = await adminCheck();
    if (!res.authed) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Админ-панель" }] }),
  component: AdminLayout,
});

function AdminLayout() {
  const router = useRouter();
  const logout = useServerFn(adminLogout);
  const modules = useModules();
  const [locale, setLocale] = useState<Locale>("ru");
  useEffect(() => {
    const saved = window.localStorage.getItem("admin-locale");
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) setLocale(saved as Locale);
  }, []);
  function changeLocale(next: Locale) {
    setLocale(next);
    window.localStorage.setItem("admin-locale", next);
    document.documentElement.lang = next;
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminAutoTranslator locale={locale} />
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 min-h-[3.5rem] py-2 flex items-center justify-between gap-4">
          {/*
            Переносим пункты на новую строку, а не прячем в горизонтальный
            скролл. Ширина меню зависит от того, сколько модулей НЕ куплено:
            заблокированный пункт несёт ещё и замок, поэтому у клиента с одним
            магазином меню шире, чем у клиента со всеми модулями. Скрытая
            прокрутка в такой ситуации просто съедала «Настройки».
          */}
          <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
            <div className="font-semibold mr-1 shrink-0 px-2 text-sm uppercase text-muted-foreground">
              {t("adminPanel", locale)}
            </div>
            <NavLink to="/admin">{t("dashboard", locale)}</NavLink>
            <NavLink to="/admin/categories">{t("categories", locale)}</NavLink>
            <NavLink to="/admin/products">{t("products", locale)}</NavLink>
            <NavLink to="/admin/orders">{t("orders", locale)}</NavLink>
            <NavLink to="/admin/broadcast">{t("broadcast", locale)}</NavLink>
            <NavLink to="/admin/payment-methods">{t("payments", locale)}</NavLink>
            {modules.instagram ? (
              <NavLink to="/admin/instagram">Instagram</NavLink>
            ) : (
              <LockedNavLink>Instagram</LockedNavLink>
            )}
            {modules.vip ? (
              <NavLink to="/admin/vip">{t("vip", locale)}</NavLink>
            ) : (
              <LockedNavLink>{t("vip", locale)}</LockedNavLink>
            )}
            {modules.blocked ? (
              <NavLink to="/admin/blocked">{t("blocked", locale)}</NavLink>
            ) : (
              <LockedNavLink>{t("blocked", locale)}</LockedNavLink>
            )}
            <NavLink to="/admin/settings">{t("settings", locale)}</NavLink>
          </div>
          <select aria-label={t("language", locale)} value={locale} onChange={(e) => changeLocale(e.target.value as Locale)} className="h-8 rounded-md border bg-background px-2 text-sm">
            {SUPPORTED_LOCALES.map((code) => <option key={code} value={code}>{localeNames[code]}</option>)}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              await router.navigate({ to: "/login" });
            }}
          >
            {t("logout", locale)}
          </Button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="px-2.5 py-1.5 rounded-md text-sm hover:bg-accent shrink-0"
      activeProps={{ className: "px-2.5 py-1.5 rounded-md text-sm bg-accent font-medium shrink-0" }}
      activeOptions={{ exact: to === "/admin" }}
    >
      {children}
    </Link>
  );
}

/** Non-clickable stand-in for a nav item whose module isn't part of this client's package yet. */
function LockedNavLink({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="button"
      aria-disabled="true"
      title="Модуль не подключён. Чтобы активировать — свяжитесь с администратором."
      className="px-2.5 py-1.5 rounded-md text-sm text-muted-foreground/50 opacity-60 cursor-not-allowed select-none shrink-0 flex items-center gap-1"
      onClick={(e) => {
        e.preventDefault();
        alert(
          "Этот раздел не подключён к вашему тарифу.\nЧтобы активировать — свяжитесь с администратором.",
        );
      }}
    >
      {children}
      <span aria-hidden="true">🔒</span>
    </span>
  );
}
