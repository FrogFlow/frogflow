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
  stock_quantity: number | null;
};

type WrapPageOptions = {
  description: string;
  image?: string | null;
  url?: string | null;
};

function wrapPage(title: string, bodyHtml: string, opts: WrapPageOptions): string {
  const desc = escapeHtml(opts.description);
  const metaTags = [
    `<meta name="description" content="${desc}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${desc}" />`,
    opts.image ? `<meta property="og:image" content="${escapeHtml(opts.image)}" />` : "",
    opts.url ? `<meta property="og:url" content="${escapeHtml(opts.url)}" />` : "",
  ]
    .filter(Boolean)
    .join("\n  ");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${metaTags}
  <style>
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 72rem; margin: 0 auto; padding: 0 1.25rem 3rem; line-height: 1.5; color: #1a1a1a; background: #fafafa; }
    header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0 -1.25rem 1.5rem; padding: 1rem 1.25rem; flex-wrap: wrap; background: #fafafa; box-shadow: 0 1px 0 #e5e5e5; }
    h1 { font-size: 1.5rem; margin: 0; }
    h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; scroll-margin-top: 4.5rem; }
    .tg-btn { display: inline-block; background: #229ed9; color: #fff; text-decoration: none; padding: 0.6rem 1.1rem; border-radius: 0.5rem; font-weight: 600; }
    .search { width: 100%; box-sizing: border-box; padding: 0.6rem 0.9rem; margin-bottom: 1.25rem; border: 1px solid #ddd; border-radius: 0.5rem; font-size: 0.95rem; font-family: inherit; }
    .layout { display: flex; align-items: flex-start; gap: 2rem; }
    .toc { position: sticky; top: 4.5rem; flex: 0 0 13rem; display: flex; flex-direction: column; gap: 0.15rem; }
    .toc a { display: flex; justify-content: space-between; gap: 0.5rem; color: #1a1a1a; text-decoration: none; font-size: 0.9rem; padding: 0.4rem 0.6rem; border-radius: 0.4rem; border-left: 2px solid transparent; }
    .toc a:hover { background: #eee; border-left-color: #229ed9; }
    .toc .count { color: #999; font-size: 0.8rem; }
    .content { flex: 1; min-width: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; overflow: hidden; display: flex; flex-direction: column; }
    .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #f0f0f0; }
    .card.out-of-stock img { opacity: 0.5; }
    .card-body { padding: 0.75rem 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.35rem; flex: 1; }
    .card-name { font-weight: 600; }
    .card-desc { font-size: 0.85rem; color: #555; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .card-price { margin-top: auto; font-weight: 700; }
    .card-rating { font-size: 0.8rem; color: #b8860b; }
    .card-oos { font-size: 0.8rem; font-weight: 600; color: #b91c1c; }
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
  <script>
    (function () {
      var input = document.getElementById("shop-search");
      if (!input) return;
      var empty = document.getElementById("shop-search-empty");
      var sections = Array.prototype.slice.call(document.querySelectorAll(".cat-section"));
      input.addEventListener("input", function () {
        var q = input.value.trim().toLowerCase();
        var anyVisible = false;
        sections.forEach(function (sec) {
          var cards = Array.prototype.slice.call(sec.querySelectorAll(".card"));
          var sectionHasMatch = false;
          cards.forEach(function (card) {
            var match = !q || (card.dataset.name || "").indexOf(q) !== -1;
            card.style.display = match ? "" : "none";
            if (match) sectionHasMatch = true;
          });
          sec.style.display = sectionHasMatch ? "" : "none";
          if (sectionHasMatch) anyVisible = true;
        });
        if (empty) empty.style.display = anyVisible ? "none" : "";
      });
    })();
  </script>
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
        const { appOrigin } = await import("@/lib/app-origin.server");

        // Складской учёт — платный модуль (Кейс 4): без него stock_quantity
        // на витрине не смотрим вовсе, как и остальной код проекта
        // (bot.server.ts решает ровно так же перед показом остатка).
        const stockEnabled = await hasModule("stock");

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
                "id, name, description, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices, stock_quantity",
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
          const outOfStock = stockEnabled && p.stock_quantity !== null && p.stock_quantity <= 0;
          const oosHtml = outOfStock ? `<div class="card-oos">Нет в наличии</div>` : "";
          const nameForSearch = escapeHtml(p.name.toLowerCase());
          return `<div class="card${outOfStock ? " out-of-stock" : ""}" data-name="${nameForSearch}">
            ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : ""}
            <div class="card-body">
              <div class="card-name">${escapeHtml(p.name)}</div>
              ${p.description ? `<div class="card-desc">${escapeHtml(p.description)}</div>` : ""}
              ${ratingHtml}
              ${oosHtml}
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
            html: `<section class="cat-section"><h2 id="${id}">${escapeHtml(label)}</h2><div class="grid">${inCat.map(renderCard).join("")}</div></section>`,
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
            html: `<section class="cat-section">${heading}<div class="grid">${rootProducts.map(renderCard).join("")}</div></section>`,
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

        // Поиск по названию имеет смысл, только если есть что искать —
        // на пустом каталоге пустое поле было бы бессмысленным элементом.
        const searchHtml =
          visibleProducts.length > 0
            ? `<input
                type="text"
                id="shop-search"
                class="search"
                placeholder="Поиск по названию…"
                autocomplete="off"
              /><div id="shop-search-empty" class="empty" style="display:none">Ничего не найдено.</div>`
            : "";

        const body =
          `<header>
            <h1>${escapeHtml(shopName)}</h1>
            ${botUrl ? `<a class="tg-btn" href="${escapeHtml(botUrl)}">Открыть в Telegram →</a>` : ""}
          </header>` +
          searchHtml +
          (navHtml
            ? `<div class="layout">${navHtml}<div class="content">${contentHtml}</div></div>`
            : contentHtml);

        // Превью при пересылке ссылки (Telegram/WhatsApp/Instagram разворачивают
        // og:-теги в карточку с картинкой) — берём первый товар с фото, порядок
        // тот же, что и на самой странице (sort_order, name).
        const firstWithImage = visibleProducts.find((p) => (p.product_images?.length ?? 0) > 0);
        const ogImage = firstWithImage
          ? imageUrl(
              firstWithImage.product_images!.slice().sort((a, b) => a.sort_order - b.sort_order)[0]
                .image_path,
            )
          : null;
        const origin = appOrigin();

        return new Response(
          wrapPage(shopName, body, {
            description: `Витрина «${shopName}» — фото, цены и наличие товаров. Заказ и оплата — через Telegram.`,
            image: ogImage,
            url: origin ? `${origin}/shop` : null,
          }),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      },
    },
  },
});
