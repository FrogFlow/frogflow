import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { imageUrl } from "@/lib/public-image";
import type { Json } from "@/integrations-supabase/types";

/**
 * Публичная веб-витрина каталога (Кейс 3, №8) — read-only страница без
 * авторизации: покупать по-прежнему можно только через бота (кнопка
 * «Открыть в Telegram» ведёт туда), здесь только просмотр.
 *
 * Панель оператора (CONTROL_PLANE=1) — не арендатор: у неё нет BOT_ID, а
 * подключение к базе идёт под service_role в обход RLS (см.
 * control-plane.server.ts). Без этой проверки страница отдавала бы первый
 * попавшийся каталог среди всех клиентов на общей базе.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(amount: number, currency: string): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const cur = (currency || "").toUpperCase();
  return cur === "KZT" ? `${value} ₸` : `${value} ${currency}`;
}

type StorefrontProduct = {
  id: string;
  name: string;
  description: string | null;
  category_ids: Json;
  rating_avg: number | null;
  rating_count: number;
  product_images: Array<{ image_path: string; sort_order: number }> | null;
  price: number | string;
  currency: string | null;
  country_prices: Json;
};

function wrapPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 72rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; line-height: 1.5; color: #1a1a1a; background: #fafafa; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    h1 { font-size: 1.5rem; margin: 0; }
    h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; scroll-margin-top: 1rem; }
    .tg-btn { display: inline-block; background: #229ed9; color: #fff; text-decoration: none; padding: 0.6rem 1.1rem; border-radius: 0.5rem; font-weight: 600; }
    .layout { display: flex; align-items: flex-start; gap: 2rem; }
    .toc { position: sticky; top: 1rem; flex: 0 0 13rem; display: flex; flex-direction: column; gap: 0.15rem; }
    .toc a { display: flex; justify-content: space-between; gap: 0.5rem; color: #1a1a1a; text-decoration: none; font-size: 0.9rem; padding: 0.4rem 0.6rem; border-radius: 0.4rem; border-left: 2px solid transparent; }
    .toc a:hover { background: #eee; border-left-color: #229ed9; }
    .toc .count { color: #999; font-size: 0.8rem; }
    .content { flex: 1; min-width: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; overflow: hidden; display: flex; flex-direction: column; }
    .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #f0f0f0; }
    .card-body { padding: 0.75rem 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
    .card-name { font-weight: 600; }
    .card-desc { font-size: 0.85rem; color: #555; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .card-price { margin-top: auto; font-weight: 700; }
    .card-rating { font-size: 0.8rem; color: #b8860b; }
    .empty { color: #666; padding: 2rem 0; text-align: center; }
    @media (max-width: 720px) {
      .layout { flex-direction: column; }
      .toc { position: static; flex-direction: row; flex-wrap: nowrap; overflow-x: auto; gap: 0.5rem; width: 100%; padding-bottom: 0.35rem; -webkit-overflow-scrolling: touch; }
      .toc a { flex: 0 0 auto; white-space: nowrap; background: #fff; border: 1px solid #e5e5e5; border-left: none; }
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}

export const Route = createFileRoute("/shop")({
  server: {
    handlers: {
      GET: async () => {
        if (isControlPlane()) {
          return new Response("Not found", { status: 404 });
        }
        const { hasModule } = await import("@/lib/modules/modules.server");
        if (!(await hasModule("web_storefront"))) {
          return new Response("Not found", { status: 404 });
        }

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { resolvePrice } = await import("@/lib/pricing.server");
        const { getCachedBotUrl } = await import("@/lib/bot-url.server");

        const [{ data: shopSetting }, { data: cats }, { data: hiddenCats }, { data: products }] =
          await Promise.all([
            supabaseAdmin.from("app_settings").select("value").eq("key", "shop_name").maybeSingle(),
            supabaseAdmin
              .from("categories")
              .select("id, name")
              .eq("is_visible", true)
              .order("sort_order")
              .order("name"),
            supabaseAdmin.from("categories").select("id").eq("is_visible", false),
            supabaseAdmin
              .from("products")
              .select(
                "id, name, description, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices",
              )
              .eq("is_active", true)
              .order("sort_order")
              .order("name")
              .limit(200),
          ]);

        const shopName = shopSetting?.value?.trim() || "Магазин";
        const botUrl = await getCachedBotUrl();

        // Товар скрытой категории не должен всплывать в витрине — тот же
        // фильтр, что использует поиск в боте (Блок 4.5 кейса 2).
        const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
        const visibleProducts = ((products ?? []) as StorefrontProduct[]).filter((p) => {
          const catIds = (p.category_ids as string[] | null) ?? [];
          return catIds.length === 0 || catIds.some((id) => !hiddenIds.has(id));
        });

        const priced = new Map<string, { amount: number; currency: string }>();
        for (const p of visibleProducts) {
          const money = await resolvePrice(p, null);
          priced.set(p.id, money);
        }

        function renderCard(p: StorefrontProduct): string {
          const imgs = (p.product_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const img = imgs[0] ? imageUrl(imgs[0].image_path) : null;
          const money = priced.get(p.id);
          const ratingHtml =
            p.rating_count > 0 && p.rating_avg !== null
              ? `<div class="card-rating">⭐ ${p.rating_avg.toFixed(1)} (${p.rating_count})</div>`
              : "";
          return `<div class="card">
            ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : ""}
            <div class="card-body">
              <div class="card-name">${escapeHtml(p.name)}</div>
              ${p.description ? `<div class="card-desc">${escapeHtml(p.description)}</div>` : ""}
              ${ratingHtml}
              ${money ? `<div class="card-price">${escapeHtml(formatMoney(money.amount, money.currency))}</div>` : ""}
            </div>
          </div>`;
        }

        type Section = { id: string; label: string; count: number; html: string };
        const sections: Section[] = [];
        const used = new Set<string>();
        for (const c of cats ?? []) {
          const inCat = visibleProducts.filter((p) => {
            const catIds = (p.category_ids as string[] | null) ?? [];
            return catIds.includes(c.id as string);
          });
          if (inCat.length === 0) continue;
          inCat.forEach((p) => used.add(p.id));
          const id = `cat-${c.id as string}`;
          const label = c.name as string;
          sections.push({
            id,
            label,
            count: inCat.length,
            html: `<h2 id="${id}">${escapeHtml(label)}</h2><div class="grid">${inCat.map(renderCard).join("")}</div>`,
          });
        }
        const rootProducts = visibleProducts.filter((p) => !used.has(p.id));
        if (rootProducts.length > 0) {
          // Заголовок «Без категории» нужен, только если рядом есть другие
          // секции — для магазина без категорий вообще (одна общая сетка)
          // это была бы лишняя, ничего не объясняющая надпись.
          const hasOtherSections = sections.length > 0;
          const id = "cat-other";
          const label = "Без категории";
          const heading = hasOtherSections
            ? `<h2 id="${id}">${escapeHtml(label)}</h2>`
            : `<div id="${id}"></div>`;
          sections.push({
            id,
            label,
            count: rootProducts.length,
            html: `${heading}<div class="grid">${rootProducts.map(renderCard).join("")}</div>`,
          });
        }

        // Содержание слева имеет смысл только когда есть что перелистывать —
        // один раздел и так виден целиком без навигации.
        const navHtml =
          sections.length > 1
            ? `<nav class="toc" aria-label="Категории">${sections
                .map(
                  (s) =>
                    `<a href="#${s.id}">${escapeHtml(s.label)} <span class="count">${s.count}</span></a>`,
                )
                .join("")}</nav>`
            : "";

        const contentHtml =
          sections.length > 0
            ? sections.map((s) => s.html).join("\n")
            : `<div class="empty">Каталог пока пуст.</div>`;

        const body =
          `<header>
            <h1>${escapeHtml(shopName)}</h1>
            ${botUrl ? `<a class="tg-btn" href="${escapeHtml(botUrl)}">Открыть в Telegram →</a>` : ""}
          </header>` +
          (navHtml
            ? `<div class="layout">${navHtml}<div class="content">${contentHtml}</div></div>`
            : contentHtml);

        return new Response(wrapPage(shopName, body), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },
  },
});
