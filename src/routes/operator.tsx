import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { operatorRouteStatusFn } from "@/lib/operator/operator-auth.functions";

/**
 * Гейт для ВСЕГО поддерева /operator/*, включая страницу входа: на
 * клиентском деплое (CONTROL_PLANE не задан) любой путь /operator/*
 * выглядит как несуществующий — см. CONTROL-PLANE-PLAN.md §2.
 *
 * Требование быть залогиненным — уровнем ниже, в operator._authed.tsx:
 * /operator/login должен остаться доступен до входа.
 */
export const Route = createFileRoute("/operator")({
  beforeLoad: async () => {
    const { status } = await operatorRouteStatusFn();
    if (status === "not_this_deployment") throw notFound();
  },
  component: () => <Outlet />,
});
