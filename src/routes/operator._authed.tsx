import {
  createFileRoute,
  notFound,
  Outlet,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { operatorLogoutFn, operatorRouteStatusFn } from "@/lib/operator/operator-auth.functions";
import { Button } from "@/components-ui/button";

/** Pathless layout — no URL segment of its own, just the auth gate + chrome for everything under /operator except /operator/login. */
export const Route = createFileRoute("/operator/_authed")({
  beforeLoad: async () => {
    const { status } = await operatorRouteStatusFn();
    if (status === "not_this_deployment") throw notFound(); // defense in depth — parent already checks this
    if (status === "unauthenticated") throw redirect({ to: "/operator/login" });
  },
  component: OperatorLayout,
});

function OperatorLayout() {
  const router = useRouter();
  const logout = useServerFn(operatorLogoutFn);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            <Link
              to="/operator"
              className="font-semibold mr-4 px-2 text-sm uppercase tracking-wider text-muted-foreground"
            >
              Панель оператора
            </Link>
            <NavLink to="/operator">Клиенты</NavLink>
            <NavLink to="/operator/broadcast">Рассылка</NavLink>
            <NavLink to="/operator/journal">Журнал</NavLink>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              await router.navigate({ to: "/operator/login" });
            }}
          >
            Выйти
          </Button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4 md:p-6">
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
      activeOptions={{ exact: to === "/operator" }}
    >
      {children}
    </Link>
  );
}
