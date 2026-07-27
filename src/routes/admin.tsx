import { createFileRoute, Outlet, Link, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { adminCheck, adminLogout } from "@/lib/admin.functions";
import { Button } from "@/components-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components-ui/dropdown-menu";

export type AdminMode = "telegram" | "instagram";

const MODE_KEY = "admin_shop_mode";

function modeFromPath(pathname: string): AdminMode {
  return pathname.startsWith("/admin/ig") ? "instagram" : "telegram";
}

function readStoredMode(): AdminMode {
  if (typeof window === "undefined") return "telegram";
  const v = localStorage.getItem(MODE_KEY);
  return v === "instagram" ? "instagram" : "telegram";
}

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const res = await adminCheck();
    if (!res.authed) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Админ-панель" }] }),
  component: AdminLayout,
});

function AdminLayout() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const logout = useServerFn(adminLogout);
  const [mode, setMode] = useState<AdminMode>(() => modeFromPath(pathname));

  useEffect(() => {
    const fromPath = modeFromPath(pathname);
    setMode(fromPath);
    localStorage.setItem(MODE_KEY, fromPath);
  }, [pathname]);

  useEffect(() => {
    // Restore mode on first load of /admin only
    if (pathname === "/admin" || pathname === "/admin/") {
      const stored = readStoredMode();
      if (stored === "instagram") {
        void router.navigate({ to: "/admin/ig" });
      }
    }
  }, []);

  async function switchMode(next: AdminMode) {
    localStorage.setItem(MODE_KEY, next);
    setMode(next);
    await router.navigate({ to: next === "instagram" ? "/admin/ig" : "/admin" });
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="font-semibold mr-2 shrink-0 px-2">
                  {mode === "instagram" ? "📷 Instagram" : "📚 Магазин"} ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => void switchMode("telegram")}>
                  Telegram (магазин)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void switchMode("instagram")}>
                  Instagram
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {mode === "telegram" ? (
              <>
                <NavLink to="/admin">Дашборд</NavLink>
                <NavLink to="/admin/categories">Категории</NavLink>
                <NavLink to="/admin/products">Товары</NavLink>
                <NavLink to="/admin/orders">Заказы</NavLink>
                <NavLink to="/admin/broadcast">Рассылка</NavLink>
                <NavLink to="/admin/payment-methods">Реквизиты</NavLink>
                <NavLink to="/admin/settings">Настройки</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/admin/ig">Дашборд IG</NavLink>
                <NavLink to="/admin/ig/keywords">Правила</NavLink>
                <NavLink to="/admin/ig/leads">Лиды</NavLink>
                <NavLink to="/admin/ig/account">Аккаунт</NavLink>
                <NavLink to="/admin/ig/exclusions">Исключения</NavLink>
                <NavLink to="/admin/ig/log">Лог</NavLink>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              await router.navigate({ to: "/login" });
            }}
          >
            Выйти
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
      className="px-3 py-1.5 rounded-md text-sm hover:bg-accent shrink-0"
      activeProps={{ className: "px-3 py-1.5 rounded-md text-sm bg-accent font-medium shrink-0" }}
      activeOptions={{ exact: to === "/admin" || to === "/admin/ig" }}
    >
      {children}
    </Link>
  );
}
