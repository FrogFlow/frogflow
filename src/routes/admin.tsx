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

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            <div className="font-semibold mr-4 shrink-0 px-2 text-sm uppercase tracking-wider text-muted-foreground">
              Админ-панель
            </div>
            <NavLink to="/admin">Дашборд</NavLink>
            <NavLink to="/admin/categories">Категории</NavLink>
            <NavLink to="/admin/products">Товары</NavLink>
            <NavLink to="/admin/orders">Заказы</NavLink>
            <NavLink to="/admin/broadcast">Рассылка</NavLink>
            <NavLink to="/admin/payment-methods">Реквизиты</NavLink>
            {modules.instagram ? (
              <NavLink to="/admin/instagram">📸 Instagram</NavLink>
            ) : (
              <LockedNavLink>📸 Instagram</LockedNavLink>
            )}
            {modules.vip ? (
              <NavLink to="/admin/vip">👑 VIP-группа</NavLink>
            ) : (
              <LockedNavLink>👑 VIP-группа</LockedNavLink>
            )}
            {modules.blocked ? (
              <NavLink to="/admin/blocked">🚫 Блокировка</NavLink>
            ) : (
              <LockedNavLink>🚫 Блокировка</LockedNavLink>
            )}
            <NavLink to="/admin/settings">Настройки</NavLink>
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
      className="px-3 py-1.5 rounded-md text-sm text-muted-foreground/50 opacity-60 cursor-not-allowed select-none shrink-0 flex items-center gap-1"
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
