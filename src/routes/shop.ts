import { createFileRoute } from "@tanstack/react-router";
import { isControlPlane } from "@/lib/control-plane.server";
import { imageUrl } from "@/lib/public-image";
import type { Json } from "@/integrations-supabase/types";

/**
 * Публичная веб-витрина каталога (модуль web_storefront): каталог с корзиной
 * и переходом в Telegram для оплаты. Позиции с витрины переносятся в
 * cart_items бота через deep link ?start=wc_<token> — даже если покупатель
 * никогда раньше не открывал бота.
 *
 * Панель оператора (CONTROL_PLANE=1) — не арендатор: у неё нет BOT_ID, а
 * подключение к базе идёт под service_role в обход RLS (см.
 * control-plane.server.ts). Без этой проверки страница отдавала бы первый
 * попавшийся каталог среди всех клиентов на общей базе.
 *
 * Блок 10, находка 10.2 (сознательно отложена) — витрина не знает про
 * физические товары помимо цены варианта (10.1, уже исправлено): нет ни
 * срока изготовления, ни списка вариантов на карточке (только цена "от"),
 * значок "Нет в наличии" смотрит на stock_quantity, который у товара "под
 * заказ" (без остатка) всегда NULL и просто не сработает — не false
 * positive, но и не покрывает сценарий "остаток есть, но недостаточно".
 * Полноценная физическая карточка на витрине (варианты кнопками, срок,
 * адрес/дата — которых тут и не может быть, покупка всё равно только через
 * бота) — заметно шире одной точечной правки.
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

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
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
  // Блок 10, находка 10.1 — витрина не знала о вариантах вовсе и всегда
  // показывала products.price, тогда как боты уже показывают
  // "от <минимальная цена варианта>" (resolvePrice с вариантом). Для
  // товара с вариантами products.price — легаси-значение, которое магазин
  // никогда не берёт (см. Блок 8, находка 8.4) — витрина показывала именно
  // его, вторую, отличную от ботов цену на один и тот же торт.
  product_variants: Array<{
    id: string;
    name: string;
    price: number | string;
    sort_order: number;
  }> | null;
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
    :root {
      --bg: #f6f6f8;
      --surface: #ffffff;
      --border: #e7e7ea;
      --text: #17171a;
      --text-muted: #71717a;
      --accent: #229ed9;
      --accent-dark: #1b7fae;
      --accent-soft: rgba(34, 158, 217, 0.1);
      --star: #d99a1b;
      --danger: #c0392b;
      --danger-soft: rgba(192, 57, 43, 0.1);
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06);
      --shadow-hover: 0 8px 20px rgba(16, 24, 40, 0.1), 0 2px 6px rgba(16, 24, 40, 0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101114;
        --surface: #18191d;
        --border: #2a2b30;
        --text: #eceef1;
        --text-muted: #9a9ba3;
        --accent-soft: rgba(34, 158, 217, 0.18);
        --star: #e0ac3c;
        --danger-soft: rgba(224, 92, 78, 0.18);
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        --shadow-hover: 0 10px 24px rgba(0, 0, 0, 0.45);
      }
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
      max-width: 76rem;
      margin: 0 auto;
      padding: 0 1.25rem 3.5rem;
      line-height: 1.5;
      color: var(--text);
      background: var(--bg);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin: 0 -1.25rem 1.75rem;
      padding: 1.1rem 1.25rem;
      flex-wrap: wrap;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .brand h1 { font-size: 1.4rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
    .brand .subtitle { margin: 0.15rem 0 0; font-size: 0.85rem; color: var(--text-muted); }
    h2 { font-size: 1.2rem; font-weight: 700; margin: 2.25rem 0 1rem; scroll-margin-top: 4.75rem; }
    .tg-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      padding: 0.65rem 1.2rem;
      border-radius: 0.6rem;
      font-weight: 600;
      font-size: 0.92rem;
      box-shadow: var(--shadow);
      transition: background-color 0.15s ease, transform 0.15s ease;
    }
    .tg-btn:hover { background: var(--accent-dark); transform: translateY(-1px); }
    .search {
      width: 100%;
      padding: 0.7rem 1rem;
      margin-bottom: 1.5rem;
      border: 1px solid var(--border);
      border-radius: 0.65rem;
      font-size: 0.95rem;
      font-family: inherit;
      color: var(--text);
      background: var(--surface);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .layout { display: flex; align-items: flex-start; gap: 2.25rem; }
    .toc {
      position: sticky;
      top: 4.75rem;
      flex: 0 0 13.5rem;
      max-height: calc(100vh - 6rem);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding-right: 0.25rem;
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }
    .toc::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
    .toc::-webkit-scrollbar-track { background: transparent; }
    .toc::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
    .toc::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
    .toc a {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      color: var(--text);
      text-decoration: none;
      font-size: 0.9rem;
      padding: 0.5rem 0.7rem;
      border-radius: 0.5rem;
      border-left: 2px solid transparent;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .toc a:hover { background: var(--accent-soft); }
    .toc a.active { background: var(--accent-soft); border-left-color: var(--accent); color: var(--accent-dark); font-weight: 600; }
    .toc .count {
      color: var(--text-muted);
      font-size: 0.75rem;
      background: var(--border);
      border-radius: 999px;
      padding: 0.05rem 0.45rem;
      flex-shrink: 0;
    }
    .content { flex: 1; min-width: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr)); gap: 1.25rem; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 1rem;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .card:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }
    .card .thumb { overflow: hidden; background: var(--border); aspect-ratio: 1 / 1; }
    .card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
    .card:hover img { transform: scale(1.04); }
    .card.out-of-stock img { opacity: 0.45; }
    .card-body { padding: 0.9rem 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.4rem; flex: 1; }
    .card-name { font-weight: 600; font-size: 0.98rem; }
    .card-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .card-price { margin-top: auto; padding-top: 0.15rem; font-weight: 800; font-size: 1.05rem; }
    .card-rating { font-size: 0.8rem; color: var(--star); font-weight: 600; }
    .card-oos {
      display: inline-block;
      align-self: flex-start;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--danger);
      background: var(--danger-soft);
      border-radius: 999px;
      padding: 0.15rem 0.55rem;
    }
    .card-actions { display: flex; flex-direction: column; gap: 0.45rem; margin-top: 0.35rem; }
    .variant-select {
      width: 100%;
      padding: 0.45rem 0.55rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      font-size: 0.85rem;
      font-family: inherit;
      color: var(--text);
      background: var(--bg);
    }
    .add-cart-btn {
      width: 100%;
      padding: 0.55rem 0.75rem;
      border: 1px solid var(--accent);
      border-radius: 0.55rem;
      background: var(--accent-soft);
      color: var(--accent-dark);
      font-weight: 600;
      font-size: 0.88rem;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .add-cart-btn:hover:not(:disabled) { background: var(--accent); color: #fff; }
    .add-cart-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .header-actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
    .cart-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.65rem 1rem;
      border: 1px solid var(--border);
      border-radius: 0.6rem;
      background: var(--surface);
      color: var(--text);
      font-weight: 600;
      font-size: 0.92rem;
      cursor: pointer;
      box-shadow: var(--shadow);
    }
    .cart-open-btn .badge {
      background: var(--accent);
      color: #fff;
      border-radius: 999px;
      padding: 0.05rem 0.45rem;
      font-size: 0.75rem;
      min-width: 1.25rem;
      text-align: center;
    }
    .cart-panel {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      background: rgba(0, 0, 0, 0.45);
      padding: 0;
    }
    .cart-panel.hidden { display: none; }
    .cart-sheet {
      width: 100%;
      max-width: 28rem;
      max-height: 85vh;
      background: var(--surface);
      border-radius: 1rem 1rem 0 0;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-hover);
      display: flex;
      flex-direction: column;
    }
    .cart-sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.1rem;
      border-bottom: 1px solid var(--border);
      font-weight: 700;
    }
    .cart-close-btn {
      border: none;
      background: transparent;
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
      color: var(--text-muted);
    }
    .cart-lines { flex: 1; overflow-y: auto; padding: 0.75rem 1.1rem; }
    .cart-line {
      display: flex;
      gap: 0.65rem;
      align-items: flex-start;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--border);
    }
    .cart-line:last-child { border-bottom: none; }
    .cart-line-name { flex: 1; font-size: 0.92rem; font-weight: 600; }
    .cart-line-meta { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.15rem; }
    .cart-line-qty {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
    }
    .cart-line-qty button {
      width: 1.65rem;
      height: 1.65rem;
      border: 1px solid var(--border);
      border-radius: 0.4rem;
      background: var(--bg);
      cursor: pointer;
      font-weight: 700;
    }
    .cart-line-remove {
      border: none;
      background: transparent;
      color: var(--danger);
      font-size: 0.8rem;
      cursor: pointer;
      padding: 0;
    }
    .cart-sheet-footer {
      padding: 1rem 1.1rem 1.25rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .cart-sheet-footer .tg-btn { justify-content: center; text-align: center; }
    .cart-empty-msg { color: var(--text-muted); text-align: center; padding: 1.5rem 0; }
    .cart-error { color: var(--danger); font-size: 0.85rem; }
    .empty { color: var(--text-muted); padding: 2.5rem 0; text-align: center; }
    @media (max-width: 720px) {
      .layout { flex-direction: column; }
      .toc {
        position: static;
        flex-direction: row;
        flex-wrap: nowrap;
        max-height: none;
        overflow-y: visible;
        overflow-x: auto;
        gap: 0.5rem;
        width: 100%;
        padding: 0 0 0.5rem;
        -webkit-overflow-scrolling: touch;
      }
      .toc a { flex: 0 0 auto; white-space: nowrap; background: var(--surface); border: 1px solid var(--border); border-left: 1px solid var(--border); }
      .toc a.active { border-color: var(--accent); }
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
    (function () {
      var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
      if (!links.length || !("IntersectionObserver" in window)) return;
      var byId = {};
      var targets = [];
      links.forEach(function (a) {
        var id = a.getAttribute("href").slice(1);
        var el = document.getElementById(id);
        if (!el) return;
        byId[id] = a;
        targets.push(el);
      });
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var link = byId[entry.target.id];
            if (!link) return;
            links.forEach(function (a) {
              a.classList.remove("active");
            });
            link.classList.add("active");
          });
        },
        { rootMargin: "-45% 0px -50% 0px" },
      );
      targets.forEach(function (el) {
        observer.observe(el);
      });
    })();
    (function () {
      var CART_KEY = "tg_bot_shop_cart";
      var panel = document.getElementById("shop-cart-panel");
      var openBtn = document.getElementById("shop-cart-open");
      if (!panel || !openBtn) return;

      function readCart() {
        try {
          var raw = localStorage.getItem(CART_KEY);
          var parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }

      function writeCart(cart) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
      }

      function lineKey(item) {
        return item.product_id + ":" + (item.product_variant_id || "");
      }

      function cartCount(cart) {
        var n = 0;
        cart.forEach(function (it) {
          n += it.quantity || 1;
        });
        return n;
      }

      function renderCart() {
        var cart = readCart();
        var countEl = document.getElementById("shop-cart-count");
        var linesEl = document.getElementById("shop-cart-lines");
        if (countEl) countEl.textContent = String(cartCount(cart));
        if (!linesEl) return;
        if (!cart.length) {
          linesEl.innerHTML = '<div class="cart-empty-msg">Корзина пуста — добавьте товары из каталога.</div>';
          return;
        }
        linesEl.innerHTML = cart
          .map(function (it, idx) {
            var meta = it.price_label ? it.price_label : "";
            if (it.variant_name) meta = (meta ? meta + " · " : "") + it.variant_name;
            return (
              '<div class="cart-line" data-idx="' +
              idx +
              '">' +
              '<div class="cart-line-name">' +
              escapeHtml(it.name || "Товар") +
              (meta ? '<div class="cart-line-meta">' + escapeHtml(meta) + "</div>" : "") +
              "</div>" +
              '<div class="cart-line-qty">' +
              '<button type="button" data-action="dec" data-idx="' +
              idx +
              '">−</button>' +
              "<span>" +
              it.quantity +
              "</span>" +
              '<button type="button" data-action="inc" data-idx="' +
              idx +
              '">+</button>' +
              "</div>" +
              '<button type="button" class="cart-line-remove" data-action="remove" data-idx="' +
              idx +
              '">Убрать</button>' +
              "</div>"
            );
          })
          .join("");
      }

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function openPanel() {
        panel.classList.remove("hidden");
        panel.setAttribute("aria-hidden", "false");
        renderCart();
      }

      function closePanel() {
        panel.classList.add("hidden");
        panel.setAttribute("aria-hidden", "true");
        var err = document.getElementById("shop-cart-error");
        if (err) err.style.display = "none";
      }

      openBtn.addEventListener("click", openPanel);
      var closeBtn = document.getElementById("shop-cart-close");
      if (closeBtn) closeBtn.addEventListener("click", closePanel);
      panel.addEventListener("click", function (e) {
        if (e.target === panel) closePanel();
      });

      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var action = t.getAttribute("data-action");
        var idx = t.getAttribute("data-idx");
        if (!action || !idx) return;
        var cart = readCart();
        var i = parseInt(idx, 10);
        if (i < 0 || i >= cart.length) return;
        if (action === "remove") cart.splice(i, 1);
        else if (action === "inc") cart[i].quantity = (cart[i].quantity || 1) + 1;
        else if (action === "dec") {
          cart[i].quantity = (cart[i].quantity || 1) - 1;
          if (cart[i].quantity <= 0) cart.splice(i, 1);
        }
        writeCart(cart);
        renderCart();
      });

      document.addEventListener("change", function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains("variant-select")) return;
        var card = t.closest(".card");
        var btn = card ? card.querySelector(".add-cart-btn") : null;
        if (btn) btn.disabled = !t.value;
      });

      document.addEventListener("click", function (e) {
        var btn = e.target;
        if (!btn || !btn.classList || !btn.classList.contains("add-cart-btn")) return;
        var productId = btn.getAttribute("data-product-id");
        if (!productId) return;
        var hasVariants = btn.getAttribute("data-has-variants") === "1";
        var card = btn.closest(".card");
        var select = card ? card.querySelector(".variant-select") : null;
        var variantId = null;
        var variantName = "";
        var priceLabel = btn.getAttribute("data-price-label") || "";
        if (hasVariants && select) {
          variantId = select.value || null;
          if (!variantId) return;
          variantName = select.options[select.selectedIndex].text.split(" — ")[0] || "";
          priceLabel = select.options[select.selectedIndex].text.split(" — ").slice(1).join(" — ");
        }
        var name = btn.getAttribute("data-name") || "Товар";
        var cart = readCart();
        var key = productId + ":" + (variantId || "");
        var found = null;
        cart.forEach(function (it) {
          if (lineKey(it) === key) found = it;
        });
        if (found) {
          found.quantity = (found.quantity || 1) + 1;
        } else {
          cart.push({
            product_id: productId,
            product_variant_id: variantId,
            quantity: 1,
            name: name,
            variant_name: variantName || null,
            price_label: priceLabel || null,
          });
        }
        writeCart(cart);
        renderCart();
        openPanel();
      });

      var checkoutBtn = document.getElementById("shop-cart-checkout");
      if (checkoutBtn) {
        checkoutBtn.addEventListener("click", function () {
          var cart = readCart();
          var err = document.getElementById("shop-cart-error");
          if (!cart.length) {
            if (err) {
              err.textContent = "Добавьте товары в корзину.";
              err.style.display = "";
            }
            return;
          }
          checkoutBtn.disabled = true;
          if (err) err.style.display = "none";
          var items = cart.map(function (it) {
            return {
              product_id: it.product_id,
              product_variant_id: it.product_variant_id || null,
              quantity: it.quantity || 1,
            };
          });
          fetch("/api/public/shop/handoff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: items }),
          })
            .then(function (res) {
              return res.json().then(function (data) {
                if (!res.ok) throw new Error(data && data.error ? data.error : "handoff_failed");
                return data;
              });
            })
            .then(function (data) {
              if (!data.url) throw new Error("no_url");
              localStorage.removeItem(CART_KEY);
              window.location.href = data.url;
            })
            .catch(function () {
              checkoutBtn.disabled = false;
              if (err) {
                err.textContent = "Не удалось открыть бот. Попробуйте ещё раз.";
                err.style.display = "";
              }
            });
        });
      }

      renderCart();
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
        const { fetchAll } = await import("@/lib/csv");

        // Складской учёт — платный модуль (Кейс 4): без него stock_quantity
        // на витрине не смотрим вовсе, как и остальной код проекта
        // (bot.server.ts решает ровно так же перед показом остатка).
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
            // Раньше здесь стоял .limit(200) — на каталоге клиента с ~400
            // товарами витрина тихо показывала только первую половину.
            // fetchAll (тот же приём, что listProducts в админке) читает
            // страницами, пока страница приходит полной — весь каталог,
            // сколько бы в нём ни было товаров.
            fetchAll<StorefrontProduct>(
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
              "товары витрины",
            ),
          ]);

        const shopName = shopSetting?.value?.trim() || "Магазин";
        const botUrl = await getCachedBotUrl();

        // Товар скрытой категории не должен всплывать в витрине — тот же
        // фильтр, что использует поиск в боте (Блок 4.5 кейса 2).
        const hiddenIds = new Set((hiddenCats ?? []).map((c) => c.id as string));
        const visibleProducts = products.filter((p) => {
          const catIds = (p.category_ids as string[] | null) ?? [];
          return catIds.length === 0 || catIds.some((id) => !hiddenIds.has(id));
        });

        // Блок 10, находка 10.1 — для товара с вариантами используем
        // минимальную цену варианта с пометкой "от", тем же приёмом, что
        // sendProductCard в bot.server.ts (m.priceFrom): resolvePrice с
        // третьим аргументом-вариантом, а не products.price.
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
          const variants = (p.product_variants ?? [])
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order);
          const hasVariants = variants.length > 0;
          const priceLabel = money
            ? `${money.isFrom ? "от " : ""}${formatMoney(money.amount, money.currency)}`
            : "";
          const priceLabelEsc = escapeHtml(priceLabel);

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
              actionsHtml = `<div class="card-actions">
                <select class="variant-select" data-product-id="${escapeHtml(p.id)}" aria-label="Вариант">
                  <option value="">Выберите вариант</option>
                  ${opts}
                </select>
                <button type="button" class="add-cart-btn" data-product-id="${escapeHtml(p.id)}" data-has-variants="1" data-name="${escapeHtml(p.name)}" disabled>Добавить в корзину</button>
              </div>`;
            } else {
              actionsHtml = `<div class="card-actions">
                <button type="button" class="add-cart-btn" data-product-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-price-label="${priceLabelEsc}">Добавить в корзину</button>
              </div>`;
            }
          }

          return `<div class="card${outOfStock ? " out-of-stock" : ""}" data-name="${nameForSearch}" data-product-id="${escapeHtml(p.id)}">
            <div class="thumb">${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : ""}</div>
            <div class="card-body">
              <div class="card-name">${escapeHtml(p.name)}</div>
              ${p.description ? `<div class="card-desc">${escapeHtml(p.description)}</div>` : ""}
              ${ratingHtml}
              ${oosHtml}
              ${money ? `<div class="card-price">${money.isFrom ? "от " : ""}${escapeHtml(formatMoney(money.amount, money.currency))}</div>` : ""}
              ${actionsHtml}
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

        const productCountLabel =
          visibleProducts.length > 0
            ? `${visibleProducts.length} ${pluralRu(visibleProducts.length, "товар", "товара", "товаров")} в каталоге`
            : "";

        const cartPanelHtml = botUrl
          ? `<div id="shop-cart-panel" class="cart-panel hidden" aria-hidden="true">
              <div class="cart-sheet" role="dialog" aria-labelledby="shop-cart-title">
                <div class="cart-sheet-header">
                  <span id="shop-cart-title">Корзина</span>
                  <button type="button" class="cart-close-btn" id="shop-cart-close" aria-label="Закрыть">×</button>
                </div>
                <div class="cart-lines" id="shop-cart-lines"></div>
                <div class="cart-sheet-footer">
                  <div id="shop-cart-error" class="cart-error" style="display:none"></div>
                  <button type="button" class="tg-btn" id="shop-cart-checkout">Оплатить в Telegram →</button>
                  <p style="margin:0;font-size:0.8rem;color:var(--text-muted);text-align:center">Откроется бот — товары уже будут в корзине, дальше выбор реквизитов и оплата.</p>
                </div>
              </div>
            </div>`
          : "";

        const body =
          `<header>
            <div class="brand">
              <h1>${escapeHtml(shopName)}</h1>
              ${productCountLabel ? `<p class="subtitle">${escapeHtml(productCountLabel)}</p>` : ""}
            </div>
            <div class="header-actions">
              ${botUrl ? `<button type="button" class="cart-open-btn" id="shop-cart-open">🛒 Корзина <span class="badge" id="shop-cart-count">0</span></button>` : ""}
              ${botUrl ? `<a class="tg-btn" href="${escapeHtml(botUrl)}">Открыть в Telegram →</a>` : ""}
            </div>
          </header>` +
          searchHtml +
          (navHtml
            ? `<div class="layout">${navHtml}<div class="content">${contentHtml}</div></div>`
            : contentHtml) +
          cartPanelHtml;

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
