import { createFileRoute, Outlet, Link, redirect } from "@tanstack/react-router";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

const copy: Record<
  Locale,
  { dashboard: string; tariffs: string; subscribers: string; settings: string }
> = {
  ru: {
    dashboard: "Дашборд VIP",
    tariffs: "Тарифы",
    subscribers: "Подписчики",
    settings: "Настройки VIP",
  },
  kk: {
    dashboard: "VIP тақтасы",
    tariffs: "Тарифтер",
    subscribers: "Жазылушылар",
    settings: "VIP баптаулары",
  },
  en: {
    dashboard: "VIP dashboard",
    tariffs: "Plans",
    subscribers: "Subscribers",
    settings: "VIP settings",
  },
  uz: {
    dashboard: "VIP boshqaruv paneli",
    tariffs: "Tariflar",
    subscribers: "Obunachilar",
    settings: "VIP sozlamalari",
  },
};

export const Route = createFileRoute("/admin/vip")({
  beforeLoad: ({ context }) => {
    if (!context.modules.vip) throw redirect({ to: "/admin" });
  },
  component: AdminVipLayout,
});

function NavLink({
  to,
  children,
  exact,
}: {
  to: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      className="px-3 py-1.5 rounded-md text-sm hover:bg-accent shrink-0"
      activeProps={{ className: "px-3 py-1.5 rounded-md text-sm bg-accent font-medium shrink-0" }}
      activeOptions={exact ? { exact: true } : undefined}
    >
      {children}
    </Link>
  );
}

function AdminVipLayout() {
  const { locale } = useAdminLocale();
  const c = copy[locale];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 border-b pb-2 overflow-x-auto">
        <NavLink to="/admin/vip" exact>
          {c.dashboard}
        </NavLink>
        <NavLink to="/admin/vip/tariffs">{c.tariffs}</NavLink>
        <NavLink to="/admin/vip/subscribers">{c.subscribers}</NavLink>
        <NavLink to="/admin/vip/settings">{c.settings}</NavLink>
      </div>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
