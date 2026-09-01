import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import {
  escapeMiniAppHtml,
  renderMiniAppCartShell,
} from "@/lib/mini-app-catalog.server";
import { miniAppStrings } from "@/lib/mini-app-i18n";
import {
  miniAppHtmlResponse,
  miniAppLocaleFromQuery,
  wrapMiniAppPage,
} from "@/lib/mini-app-page.server";

export const Route = createFileRoute("/mini-app/orders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });
        const { miniAppModuleEnabled } = await import("@/lib/mini-app.server");
        if (!(await miniAppModuleEnabled())) {
          return new Response("Not found", { status: 404 });
        }
        const url = new URL(request.url);
        const locale = miniAppLocaleFromQuery(url);
        const strings = miniAppStrings(locale);
        const escape = escapeMiniAppHtml;
        const back = new URLSearchParams({ lang: locale });
        const country = (url.searchParams.get("country") || "").toUpperCase();
        if (/^[A-Z]{2,8}$/.test(country)) back.set("country", country);
        const body = `
          <header>
            <a class="back-link" href="/mini-app?${escape(back.toString())}">${escape(strings.backToCatalog)}</a>
            <h1>${escape(strings.myOrders)}</h1>
          </header>
          <main id="mini-orders" class="orders-list" aria-live="polite">
            <p class="empty">${escape(strings.loading)}</p>
          </main>
          ${renderMiniAppCartShell(locale)}`;
        return miniAppHtmlResponse(wrapMiniAppPage(strings.myOrders, body, locale));
      },
    },
  },
});
