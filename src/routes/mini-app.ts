import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { imageUrl } from "@/lib/public-image";
import type { Json } from "@/integrations-supabase/types";

/**
 * Telegram Mini App (модуль telegram_mini_app): каталог и корзина внутри
 * Telegram. initData проверяется на API; корзина — общая cart_items с ботом.
 * Оплата — в чате: checkout отправляет корзину в бот и закрывает Mini App.
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

type MiniAppProduct = {
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
  product_variants: Array<{
    id: string;
    name: string;
    price: number | string;
    sort_order: number;
  }> | null;
};

function wrapMiniAppPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(title)}</title>
  <script>
    (function () {
      function save(key, value) {
        try { if (value) sessionStorage.setItem(key, value); } catch (e) {}
      }
      try {
        var packed = (location.hash || "") + "\\n" + (location.search || "");
        if (packed.indexOf("tgWebAppData") !== -1) save("ff_tg_launch", packed);
      } catch (e) {}
      window.addEventListener("message", function (ev) {
        try {
          var d = ev.data;
          if (typeof d === "string") {
            if (d.indexOf("tgWebAppData") !== -1 || d.indexOf("hash=") !== -1) save("ff_tg_launch", d);
            d = JSON.parse(d);
          }
          if (!d || typeof d !== "object") return;
          var raw = d.tgWebAppData || d.initData ||
            (d.eventData && (d.eventData.tgWebAppData || d.eventData.initData));
          if (typeof raw === "string" && raw.indexOf("hash=") !== -1) save("ff_tg_init", raw);
        } catch (e) {}
      });
    })();
  </script>
  <script src="https://telegram.org/js/telegram-web-app.js?63"></script>
  <style>
    :root {
      --bg: var(--tg-theme-bg-color, #f6f6f8);
      --text: var(--tg-theme-text-color, #17171a);
      --hint: var(--tg-theme-hint-color, #71717a);
      --link: var(--tg-theme-link-color, #229ed9);
      --btn: var(--tg-theme-button-color, #229ed9);
      --btn-text: var(--tg-theme-button-text-color, #fff);
      --secondary: var(--tg-theme-secondary-bg-color, #fff);
      --border: color-mix(in srgb, var(--text) 12%, transparent);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 0 0 calc(5.5rem + env(safe-area-inset-bottom));
    }
    header {
      padding: 1rem 1rem 0.5rem;
      position: sticky;
      top: 0;
      z-index: 5;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    h1 { font-size: 1.25rem; margin: 0; }
    .subtitle { font-size: 0.8rem; color: var(--hint); margin: 0.25rem 0 0; }
    .search {
      width: 100%;
      margin: 0.75rem 1rem;
      padding: 0.65rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--secondary);
      color: var(--text);
      font-size: 1rem;
    }
    .grid {
      display: grid;
      gap: 0.75rem;
      padding: 0 1rem 1rem;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    }
    .card {
      background: var(--secondary);
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .card.out-of-stock { opacity: 0.65; }
    .thumb {
      aspect-ratio: 1;
      background: color-mix(in srgb, var(--text) 6%, transparent);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .card-body { padding: 0.65rem; }
    .card-name { font-weight: 600; font-size: 0.9rem; line-height: 1.3; }
    .card-desc {
      font-size: 0.75rem;
      color: var(--hint);
      margin-top: 0.25rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-price { font-weight: 700; margin-top: 0.35rem; color: var(--link); }
    .card-oos { font-size: 0.75rem; color: #c0392b; margin-top: 0.25rem; }
    .variant-select {
      width: 100%;
      margin-top: 0.5rem;
      padding: 0.45rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      font-size: 0.85rem;
    }
    .add-btn {
      width: 100%;
      margin-top: 0.5rem;
      padding: 0.5rem;
      border: none;
      border-radius: 10px;
      background: var(--btn);
      color: var(--btn-text);
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .add-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .empty { padding: 2rem 1rem; text-align: center; color: var(--hint); }
    .cart-bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
      background: var(--secondary);
      border-top: 1px solid var(--border);
      display: flex;
      gap: 0.75rem;
      align-items: center;
      z-index: 10;
    }
    .cart-bar.hidden { display: none; }
    .cart-summary { flex: 1; min-width: 0; }
    .cart-summary strong { display: block; font-size: 0.95rem; }
    .cart-summary span { font-size: 0.8rem; color: var(--hint); }
    .checkout-btn {
      flex-shrink: 0;
      padding: 0.65rem 1rem;
      border: none;
      border-radius: 12px;
      background: var(--btn);
      color: var(--btn-text);
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .checkout-btn:disabled { opacity: 0.5; }
    .cart-sheet {
      position: fixed;
      inset: 0;
      z-index: 20;
      background: color-mix(in srgb, #000 40%, transparent);
      display: flex;
      align-items: flex-end;
    }
    .cart-sheet.hidden { display: none; }
    .cart-panel {
      width: 100%;
      max-height: 70vh;
      background: var(--secondary);
      border-radius: 16px 16px 0 0;
      padding: 1rem;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom));
    }
    .cart-line {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }
    .cart-line button {
      border: none;
      background: none;
      color: #c0392b;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .cart-error { color: #c0392b; font-size: 0.85rem; margin: 0.5rem 0; }
    .toast {
      position: fixed;
      top: 1rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--secondary);
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      border-radius: 999px;
      font-size: 0.85rem;
      z-index: 30;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; }
    .add-btn:disabled, .checkout-btn:disabled { opacity: 0.45; cursor: default; }
  </style>
</head>
<body>
  ${bodyHtml}
  <div id="toast" class="toast" role="status"></div>
  <script>
    (function () {
      /**
       * Telegram.WebApp.initData часто пустой в первый тик: SDK ещё не
       * прочитал #tgWebAppData, натив инжектит объект позже, hash потом
       * стирается. Раньше из-за этого каталог затирался текстом
       * «Откройте магазин из Telegram» прямо внутри Mini App.
       */
      var tg = null;
      var cachedInitData = "";
      var cartReady = false;

      function bindTelegram() {
        var next = window.Telegram && window.Telegram.WebApp;
        if (!next) return null;
        if (tg !== next) {
          tg = next;
          try { tg.ready(); tg.expand(); } catch (e) {}
        }
        return tg;
      }

      function looksLike(s) {
        return !!(s && s.indexOf("hash=") !== -1);
      }

      function fromLocation(source) {
        var raw = (source || "").replace(/^[#?]/, "");
        if (!raw) return "";
        try {
          var encoded = new URLSearchParams(raw).get("tgWebAppData");
          if (looksLike(encoded)) return encoded.trim();
        } catch (e) {}
        var prefix = "tgWebAppData=";
        var start = raw.indexOf(prefix);
        if (start < 0) return "";
        var rest = raw.slice(start + prefix.length);
        var cut = rest.search(/&tgWebApp[A-Z]/);
        if (cut >= 0) rest = rest.slice(0, cut);
        try { rest = decodeURIComponent(rest.replace(/\\+/g, " ")).trim(); }
        catch (e) { rest = rest.trim(); }
        return looksLike(rest) ? rest : "";
      }

      function readStorage(key) {
        try { return sessionStorage.getItem(key) || ""; } catch (e) { return ""; }
      }

      function fromPacked(packed) {
        if (looksLike(packed)) return packed.trim();
        var parts = packed.split("\\n");
        for (var i = 0; i < parts.length; i++) {
          var got = fromLocation(parts[i]);
          if (looksLike(got)) return got;
        }
        return fromLocation(packed);
      }

      function fromOfficialStorage() {
        try {
          var raw = readStorage("__telegram__initParams");
          if (!raw) return "";
          var parsed = JSON.parse(raw);
          var v = (parsed.tgWebAppData || parsed.initData || "").trim();
          return looksLike(v) ? v : fromLocation(v);
        } catch (e) { return ""; }
      }

      function initData() {
        if (cachedInitData) return cachedInitData;
        bindTelegram();
        var data = (
          (tg && tg.initData) ||
          readStorage("ff_tg_init") ||
          fromPacked(readStorage("ff_tg_launch")) ||
          fromLocation(location.hash) ||
          fromLocation(location.search) ||
          fromOfficialStorage() ||
          ""
        ).trim();
        if (!looksLike(data)) return "";
        cachedInitData = data;
        return data;
      }

      function apiHeaders() {
        return {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData(),
        };
      }

      function showToast(msg) {
        var el = document.getElementById("toast");
        if (!el) return;
        el.textContent = msg;
        el.classList.add("show");
        setTimeout(function () { el.classList.remove("show"); }, 2200);
      }

      var cartBar = document.getElementById("mini-cart-bar");
      var cartSheet = document.getElementById("mini-cart-sheet");
      var cartLines = document.getElementById("mini-cart-lines");
      var cartTotalEl = document.getElementById("mini-cart-total");
      var cartCountEl = document.getElementById("mini-cart-count");
      var checkoutBtn = document.getElementById("mini-checkout");
      var cartError = document.getElementById("mini-cart-error");
      var state = { items: [], total: 0, currency: "KZT" };

      function formatMoney(amount, currency) {
        var value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
        var cur = (currency || "").toUpperCase();
        return cur === "KZT" ? value + " ₸" : value + " " + currency;
      }

      function renderCart() {
        var count = state.items.reduce(function (s, it) { return s + it.quantity; }, 0);
        if (cartCountEl) cartCountEl.textContent = String(count);
        if (cartTotalEl) cartTotalEl.textContent = formatMoney(state.total, state.currency);
        if (cartBar) cartBar.classList.toggle("hidden", count === 0);
        if (checkoutBtn) checkoutBtn.disabled = count === 0;
        if (!cartLines) return;
        if (!state.items.length) {
          cartLines.innerHTML = "<p class=\\"empty\\">Корзина пуста</p>";
          return;
        }
        cartLines.innerHTML = state.items
          .map(function (it) {
            return (
              "<div class=\\"cart-line\\">" +
              "<span>" + it.name + " × " + it.quantity + " — " + formatMoney(it.line_total, it.currency) + "</span>" +
              "<button type=\\"button\\" data-remove=\\"" + it.id + "\\">Удалить</button>" +
              "</div>"
            );
          })
          .join("");
        cartLines.querySelectorAll("[data-remove]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            removeItem(btn.getAttribute("data-remove"));
          });
        });
      }

      function refreshCart() {
        return fetch("/api/public/mini-app/cart", { headers: apiHeaders() })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : "cart_failed");
            state.items = res.d.items || [];
            state.total = res.d.total || 0;
            state.currency = res.d.currency || "KZT";
            renderCart();
          });
      }

      function addProduct(productId, variantId) {
        return fetch("/api/public/mini-app/cart", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            action: "add",
            product_id: productId,
            product_variant_id: variantId || null,
          }),
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) {
              var code = res.d && res.d.error ? res.d.error : "add_failed";
              if (code === "mixed_cart") showToast("Смешанная корзина недоступна");
              else if (code === "out_of_stock") showToast("Нет в наличии");
              else if (code === "digital_limit") showToast("Уже в корзине");
              else showToast("Не удалось добавить");
              return;
            }
            state.items = res.d.items || [];
            state.total = (res.d.items || []).reduce(function (s, it) { return s + it.line_total; }, 0);
            state.currency = state.items[0] ? state.items[0].currency : "KZT";
            renderCart();
            showToast("Добавлено в корзину");
          });
      }

      function removeItem(id) {
        return fetch("/api/public/mini-app/cart", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ action: "remove", cart_item_id: id }),
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) return;
            state.items = res.d.items || [];
            state.total = (res.d.items || []).reduce(function (s, it) { return s + it.line_total; }, 0);
            renderCart();
          });
      }

      document.querySelectorAll(".add-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (!initData()) {
            showToast("Сессия Telegram ещё не готова — закройте и откройте магазин из бота");
            return;
          }
          var card = btn.closest(".card");
          var productId = btn.getAttribute("data-product-id");
          var select = card ? card.querySelector(".variant-select") : null;
          var variantId = select && select.value ? select.value : null;
          if (btn.getAttribute("data-has-variants") === "1" && !variantId) {
            showToast("Выберите вариант");
            return;
          }
          btn.disabled = true;
          addProduct(productId, variantId).finally(function () {
            if (btn.getAttribute("data-has-variants") === "1") {
              btn.disabled = !select || !select.value || !initData();
            } else {
              btn.disabled = !initData();
            }
          });
        });
      });

      document.querySelectorAll(".variant-select").forEach(function (sel) {
        sel.addEventListener("change", function () {
          var card = sel.closest(".card");
          var btn = card ? card.querySelector(".add-btn") : null;
          if (btn) btn.disabled = !initData() || !sel.value;
        });
      });

      var openCart = document.getElementById("mini-open-cart");
      if (openCart) {
        openCart.addEventListener("click", function () {
          if (cartSheet) cartSheet.classList.remove("hidden");
        });
      }
      var closeCart = document.getElementById("mini-close-cart");
      if (closeCart) {
        closeCart.addEventListener("click", function () {
          if (cartSheet) cartSheet.classList.add("hidden");
        });
      }
      if (cartSheet) {
        cartSheet.addEventListener("click", function (e) {
          if (e.target === cartSheet) cartSheet.classList.add("hidden");
        });
      }

      if (checkoutBtn) {
        checkoutBtn.addEventListener("click", function () {
          if (cartError) cartError.textContent = "";
          checkoutBtn.disabled = true;
          fetch("/api/public/mini-app/checkout", {
            method: "POST",
            headers: apiHeaders(),
          })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
              if (!res.ok) {
                if (cartError) cartError.textContent = "Не удалось открыть оплату в чате";
                checkoutBtn.disabled = false;
                return;
              }
              if (tg) tg.close();
            })
            .catch(function () {
              if (cartError) cartError.textContent = "Ошибка сети";
              checkoutBtn.disabled = false;
            });
        });
      }

      var search = document.getElementById("mini-search");
      if (search) {
        search.addEventListener("input", function () {
          var q = search.value.trim().toLowerCase();
          document.querySelectorAll(".card").forEach(function (card) {
            var name = card.getAttribute("data-name") || "";
            card.style.display = !q || name.indexOf(q) !== -1 ? "" : "none";
          });
        });
      }

      function setCartEnabled(on) {
        document.querySelectorAll(".add-btn").forEach(function (btn) {
          if (btn.getAttribute("data-has-variants") === "1") {
            var card = btn.closest(".card");
            var select = card ? card.querySelector(".variant-select") : null;
            btn.disabled = !on || !select || !select.value;
          } else {
            btn.disabled = !on;
          }
        });
        if (openCart) openCart.disabled = !on;
        if (checkoutBtn) checkoutBtn.disabled = !on || state.items.length === 0;
      }

      function boot() {
        if (initData()) {
          if (!cartReady) {
            cartReady = true;
            setCartEnabled(true);
            refreshCart().catch(function () {
              showToast("Не удалось загрузить корзину");
            });
          }
          return;
        }
        setTimeout(boot, 100);
      }

      setCartEnabled(false);
      boot();
    })();
  </script>
</body>
</html>`;
}

export const Route = createFileRoute("/mini-app")({
  server: {
    handlers: {
      GET: async () => {
        if (isControlPlane()) return new Response("Not found", { status: 404 });

        const { hasModule } = await import("@/lib/modules/modules.server");
        if (!(await hasModule("telegram_mini_app"))) {
          return new Response("Not found", { status: 404 });
        }

        const { supabaseAdmin } = await import("@/integrations-supabase/client.server");
        const { resolvePrice } = await import("@/lib/pricing.server");
        const { fetchAll } = await import("@/lib/csv");

        const stockEnabled = await hasModule("stock");

        const [{ data: shopSetting }, { data: cats }, { data: hiddenCats }, products] =
          await Promise.all([
            supabaseAdmin.from("app_settings").select("value").eq("key", "shop_name").maybeSingle(),
            supabaseAdmin
              .from("categories")
              .select("id, name")
              .eq("is_visible", true)
              .order("sort_order")
              .order("name"),
            supabaseAdmin.from("categories").select("id").eq("is_visible", false),
            fetchAll<MiniAppProduct>(
              (from, to) =>
                supabaseAdmin
                  .from("products")
                  .select(
                    "id, name, description, category_ids, rating_avg, rating_count, product_images(image_path, sort_order), price, currency, country_prices, stock_quantity, product_variants(id, name, price, sort_order)",
                  )
                  .eq("is_active", true)
                  .order("sort_order")
                  .order("name")
                  .range(from, to),
              "товары mini-app",
            ),
          ]);

        const shopName = shopSetting?.value?.trim() || "Магазин";
        const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
        const visibleProducts = products.filter((p) => {
          const catIds = (p.category_ids as string[] | null) ?? [];
          return catIds.length === 0 || catIds.some((id) => !hiddenIds.has(id));
        });

        const priced = new Map<string, { amount: number; currency: string; isFrom: boolean }>();
        for (const p of visibleProducts) {
          const variants = p.product_variants ?? [];
          if (variants.length > 0) {
            const pricedVariants = await Promise.all(variants.map((v) => resolvePrice(p, null, v)));
            const minAmount = Math.min(...pricedVariants.map((m) => m.amount));
            const currency = pricedVariants[0]?.currency ?? p.currency ?? "KZT";
            priced.set(p.id, { amount: minAmount, currency, isFrom: true });
          } else {
            const money = await resolvePrice(p, null);
            priced.set(p.id, { ...money, isFrom: false });
          }
        }

        function renderCard(p: MiniAppProduct): string {
          const imgs = (p.product_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const img = imgs[0] ? imageUrl(imgs[0].image_path) : null;
          const money = priced.get(p.id);
          const outOfStock = stockEnabled && p.stock_quantity !== null && p.stock_quantity <= 0;
          const variants = (p.product_variants ?? [])
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order);
          const hasVariants = variants.length > 0;
          const priceLabel = money
            ? `${money.isFrom ? "от " : ""}${formatMoney(money.amount, money.currency)}`
            : "";

          let actionsHtml = "";
          if (!outOfStock) {
            if (hasVariants) {
              const opts = variants
                .map(
                  (v) =>
                    `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)} — ${escapeHtml(
                      formatMoney(Number(v.price), money?.currency ?? p.currency ?? "KZT"),
                    )}</option>`,
                )
                .join("");
              actionsHtml = `<select class="variant-select" aria-label="Вариант"><option value="">Вариант</option>${opts}</select>
                <button type="button" class="add-btn" data-product-id="${escapeHtml(p.id)}" data-has-variants="1" disabled>В корзину</button>`;
            } else {
              actionsHtml = `<button type="button" class="add-btn" data-product-id="${escapeHtml(p.id)}">В корзину</button>`;
            }
          } else {
            actionsHtml = `<div class="card-oos">Нет в наличии</div>`;
          }

          return `<div class="card${outOfStock ? " out-of-stock" : ""}" data-name="${escapeHtml(p.name.toLowerCase())}">
            <div class="thumb">${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : ""}</div>
            <div class="card-body">
              <div class="card-name">${escapeHtml(p.name)}</div>
              ${p.description ? `<div class="card-desc">${escapeHtml(p.description)}</div>` : ""}
              ${priceLabel ? `<div class="card-price">${escapeHtml(priceLabel)}</div>` : ""}
              ${actionsHtml}
            </div>
          </div>`;
        }

        const cardsHtml =
          visibleProducts.length > 0
            ? visibleProducts.map(renderCard).join("")
            : `<div class="empty">Каталог пока пуст.</div>`;

        const searchHtml =
          visibleProducts.length > 0
            ? `<input type="search" id="mini-search" class="search" placeholder="Поиск…" autocomplete="off" />`
            : "";

        const bodyHtml = `
          <header>
            <h1>${escapeHtml(shopName)}</h1>
            <p class="subtitle">${visibleProducts.length > 0 ? `${visibleProducts.length} товаров` : ""}</p>
          </header>
          ${searchHtml}
          <div class="grid">${cardsHtml}</div>
          <div id="mini-cart-bar" class="cart-bar hidden">
            <button type="button" id="mini-open-cart" class="cart-summary" style="border:none;background:none;text-align:left;cursor:pointer;color:inherit">
              <strong id="mini-cart-total">0 ₸</strong>
              <span><span id="mini-cart-count">0</span> в корзине — открыть</span>
            </button>
            <button type="button" id="mini-checkout" class="checkout-btn" disabled>Оплатить</button>
          </div>
          <div id="mini-cart-sheet" class="cart-sheet hidden" aria-hidden="true">
            <div class="cart-panel">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
                <strong>Корзина</strong>
                <button type="button" id="mini-close-cart" style="border:none;background:none;font-size:1.25rem;cursor:pointer">×</button>
              </div>
              <div id="mini-cart-lines"></div>
              <div id="mini-cart-error" class="cart-error"></div>
              <p style="font-size:0.8rem;color:var(--hint);margin:0.5rem 0 0">Оплата продолжится в чате с ботом.</p>
            </div>
          </div>`;

        return new Response(wrapMiniAppPage(shopName, bodyHtml), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
