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
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { adminCheck, adminLogout } from "@/lib/admin.functions";
import { Button } from "@/components-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components-ui/dropdown-menu";
import { useModules } from "@/lib/modules/use-modules";
import { localeNames, SUPPORTED_LOCALES, t, type Locale } from "@/lib/i18n";
import { AdminLocaleContext } from "@/lib/admin-locale";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { totalManagerChatUnreadFn } from "@/lib/modules/manager-chat.functions";

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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [locale, setLocale] = useState<Locale>("ru");
  useEffect(() => {
    const saved = window.localStorage.getItem("admin-locale");
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved))
      setLocale(saved as Locale);
  }, []);
  function changeLocale(next: Locale) {
    setLocale(next);
    window.localStorage.setItem("admin-locale", next);
    document.documentElement.lang = next;
  }

  return (
    <AdminLocaleContext.Provider value={{ locale, changeLocale }}>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-4 min-h-[3.5rem] py-2 flex items-center justify-between gap-4">
            {/*
              Переносим пункты на новую строку, а не прячем в горизонтальный
              скролл. Плоский список из 9+ пунктов больше не умещался ни при
              каком разумном количестве модулей — сгруппировано в разделы
              (Каталог/Оплата/Продвижение/Аудитория), каждый со своим
              выпадающим меню, чтобы верхний уровень оставался коротким и не
              рос с каждым новым модулем.
            */}
            <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
              <div className="font-semibold mr-1 shrink-0 px-2 text-sm uppercase text-muted-foreground">
                {t("adminPanel", locale)}
              </div>
              <NavLink to="/admin">{t("dashboard", locale)}</NavLink>

              <GroupNav
                label={t("catalogGroup", locale)}
                active={
                  pathname.startsWith("/admin/categories") || pathname.startsWith("/admin/products")
                }
              >
                <GroupLink to="/admin/categories" locale={locale}>
                  {t("categories", locale)}
                </GroupLink>
                <GroupLink to="/admin/products" locale={locale}>
                  {t("products", locale)}
                </GroupLink>
              </GroupNav>

              <NavLink to="/admin/orders">{t("orders", locale)}</NavLink>

              <NavLink to="/admin/analytics">{t("analytics", locale)}</NavLink>

              <GroupNav
                label={t("paymentGroup", locale)}
                active={
                  pathname.startsWith("/admin/payment-methods") ||
                  pathname.startsWith("/admin/robokassa")
                }
              >
                <GroupLink to="/admin/payment-methods" locale={locale}>
                  {t("payments", locale)}
                </GroupLink>
                <GroupLink to="/admin/robokassa" locked={!modules.robokassa} locale={locale}>
                  Robokassa
                </GroupLink>
              </GroupNav>

              <GroupNav
                label={t("promotionGroup", locale)}
                active={
                  pathname.startsWith("/admin/broadcast") ||
                  pathname.startsWith("/admin/instagram") ||
                  pathname.startsWith("/admin/whatsapp") ||
                  pathname.startsWith("/admin/manager-chat") ||
                  pathname.startsWith("/admin/promo-codes") ||
                  pathname.startsWith("/admin/gift-certificates")
                }
              >
                <GroupLink to="/admin/broadcast" locale={locale}>
                  {t("broadcast", locale)}
                </GroupLink>
                <GroupLink to="/admin/promo-codes" locked={!modules.coupons} locale={locale}>
                  {t("promoCodes", locale)}
                </GroupLink>
                <GroupLink to="/admin/gift-certificates" locale={locale}>
                  {t("giftCertificates", locale)}
                </GroupLink>
                <GroupLink to="/admin/instagram" locked={!modules.instagram} locale={locale}>
                  Instagram
                </GroupLink>
                <GroupLink to="/admin/whatsapp" locked={!modules.whatsapp} locale={locale}>
                  WhatsApp
                </GroupLink>
                {modules.manager_chat ? (
                  <ManagerChatGroupLink locale={locale} />
                ) : (
                  <GroupLink to="/admin/manager-chat" locked locale={locale}>
                    {t("managerChat", locale)}
                  </GroupLink>
                )}
              </GroupNav>

              <GroupNav
                label={t("audienceGroup", locale)}
                active={pathname.startsWith("/admin/vip") || pathname.startsWith("/admin/blocked")}
              >
                <GroupLink to="/admin/vip" locked={!modules.vip} locale={locale}>
                  {t("vip", locale)}
                </GroupLink>
                <GroupLink to="/admin/blocked" locked={!modules.blocked} locale={locale}>
                  {t("blocked", locale)}
                </GroupLink>
              </GroupNav>

              <NavLink to="/admin/modules">{t("modules", locale)}</NavLink>
              <NavLink to="/admin/settings">{t("settings", locale)}</NavLink>
            </div>
            <select
              aria-label={t("language", locale)}
              value={locale}
              onChange={(e) => changeLocale(e.target.value as Locale)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {localeNames[code]}
                </option>
              ))}
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
    </AdminLocaleContext.Provider>
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

/** «Чат» item inside the «Продвижение» dropdown, with an unread-count badge — light polling so a new customer message is noticed off-tab. */
function ManagerChatGroupLink({ locale }: { locale: Locale }) {
  const unread = useQuery({
    queryKey: ["manager_chat_total_unread"],
    queryFn: () => totalManagerChatUnreadFn(),
    refetchInterval: 20_000,
  });
  return (
    <DropdownMenuItem asChild>
      <Link to="/admin/manager-chat" className="w-full flex items-center justify-between gap-2">
        {t("managerChat", locale)}
        {!!unread.data && (
          <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full bg-destructive text-destructive-foreground text-[10px] px-1">
            {unread.data}
          </span>
        )}
      </Link>
    </DropdownMenuItem>
  );
}

/** Top-level group with a dropdown of its own sub-pages — see GroupLink for locked items. */
function GroupNav({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`px-2.5 py-1.5 rounded-md text-sm hover:bg-accent shrink-0 flex items-center gap-1 ${
            active ? "bg-accent font-medium" : ""
          }`}
        >
          {label}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An item inside a GroupNav dropdown — either a real link, or a locked stand-in. */
function GroupLink({
  to,
  locked,
  locale,
  children,
}: {
  to: string;
  locked?: boolean;
  locale: Locale;
  children: React.ReactNode;
}) {
  if (locked) {
    // Не используем disabled: Radix перестаёт вызывать onSelect у
    // отключённых пунктов, а клик всё равно должен показать тост с
    // объяснением — тем же, что был у LockedNavLink в плоском меню.
    return (
      <DropdownMenuItem
        title={t("moduleLocked", locale)}
        className="text-muted-foreground/60"
        onSelect={(e) => {
          e.preventDefault();
          toast(t("moduleLockedAlert", locale));
        }}
      >
        {children}
        <span aria-hidden="true" className="ml-auto">
          🔒
        </span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild>
      <Link to={to} className="w-full">
        {children}
      </Link>
    </DropdownMenuItem>
  );
}
