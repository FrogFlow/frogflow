import { hasModule } from "./modules.server";
import { moduleDef, type ModuleKey } from "./registry";
import { requireAdmin } from "../admin-session.server";

/**
 * Проверка «модуль оплачен» на стороне сервера.
 *
 * До этого файла тумблеры в панели были косметикой: маршруты `/admin/vip`,
 * `/admin/instagram` и `/admin/blocked` закрыты через `beforeLoad`, но это
 * клиентский роутер. Сами серверные функции модуль не проверяли — все 39
 * требовали только `requireAdmin()`. Клиент, не купивший VIP, мог вызвать
 * `getVipSubscriptionsFn` напрямую POST-запросом и пользоваться разделом
 * мимо тумблера.
 *
 * Чужих данных так не достать — ключ арендатора и RLS отдают только свои
 * строки, — поэтому это обход оплаты, а не утечка. Но отключение модуля —
 * то, на чём держится вся панель, и оно должно работать там, где решение
 * действительно принимается: на сервере.
 *
 * Ставить рядом с `requireAdmin()` в каждой серверной функции модуля.
 */
export async function requireModule(key: ModuleKey): Promise<void> {
  if (await hasModule(key)) return;
  throw new Error(
    `Модуль «${moduleDef(key).title}» не подключён к вашему тарифу. ` +
      `Чтобы активировать — свяжитесь с администратором.`,
  );
}

/**
 * `requireAdmin() + requireModule(key)` — the pair every server function in
 * a paid module needs at its top. Used to be copy-pasted verbatim (same two
 * lines, different key literal) into 7 separate *.functions.ts files; kept
 * here as the one place that actually does the check. Callers still import
 * it dynamically (`await import("./modules/require-module.server")`) from
 * their own thin per-module wrapper — a *.functions.ts file is a client/server
 * boundary, and a static top-level import of a .server.ts module from there
 * risks pulling server-only code into the client bundle.
 */
export async function requireAdminWithModule(key: ModuleKey): Promise<void> {
  await requireAdmin();
  await requireModule(key);
}
