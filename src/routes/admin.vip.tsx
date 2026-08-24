import { createFileRoute, Outlet, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAdminLocale } from "@/lib/admin-locale";
import { getSettings } from "@/lib/settings.functions";
import type { Locale } from "@/lib/i18n";

const copy: Record<
  Locale,
  {
    dashboard: string;
    tariffs: string;
    subscribers: string;
    settings: string;
    testMode: string;
  }
> = {
  ru: {
    dashboard: "Дашборд VIP",
    tariffs: "Тарифы",
    subscribers: "Подписчики",
    settings: "Настройки VIP",
    testMode: "🧪 Тест-режим активен (время в минутах)",
  },
  kk: {
    dashboard: "VIP тақтасы",
    tariffs: "Тарифтер",
    subscribers: "Жазылушылар",
    settings: "VIP баптаулары",
    testMode: "🧪 Тест режимі белсенді (уақыт минутпен)",
  },
  en: {
    dashboard: "VIP dashboard",
    tariffs: "Plans",
    subscribers: "Subscribers",
    settings: "VIP settings",
    testMode: "🧪 Test mode is active (time in minutes)",
  },
  uz: {
    dashboard: "VIP boshqaruv paneli",
    tariffs: "Tariflar",
    subscribers: "Obunachilar",
    settings: "VIP sozlamalari",
    testMode: "🧪 Test rejimi faol (vaqt daqiqalarda)",
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
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const isTest = settings.data?.vip_test_mode === "true";

  return (
    <div className="space-y-6">
      {isTest && (
        <div className="bg-yellow-100 text-yellow-800 text-xs px-3 py-2 rounded font-medium border border-yellow-200">
          {c.testMode}
        </div>
      )}
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
