import type { Locale } from "./i18n";
import { miniAppStringsClientPack, resolveMiniAppLocale } from "./mini-app-i18n";

/** Shared Mini App HTML shell, styles and client runtime. */
export function wrapMiniAppPage(
  title: string,
  bodyHtml: string,
  locale: Locale,
  extraHead?: string,
): string {
  const lang = locale;
  const i18n = JSON.stringify(miniAppStringsClientPack(locale));
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
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
    .back-link { color: var(--link); text-decoration: none; font-size: 0.9rem; display: inline-block; margin-bottom: 0.35rem; }
    .search {
      width: calc(100% - 2rem);
      margin: 0.75rem 1rem;
      padding: 0.65rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--secondary);
      color: var(--text);
      font-size: 1rem;
    }
    .cat-scroll {
      display: flex;
      gap: 0.5rem;
      padding: 0 1rem 0.75rem;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .cat-chip {
      flex-shrink: 0;
      padding: 0.4rem 0.85rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--secondary);
      color: var(--text);
      font-size: 0.85rem;
      cursor: pointer;
    }
    .cat-chip.active { background: var(--btn); color: var(--btn-text); border-color: transparent; }
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
    .thumb-link { text-decoration: none; color: inherit; display: block; }
    .card-body { padding: 0.65rem; }
    .card-name { font-weight: 600; font-size: 0.9rem; line-height: 1.3; }
    .card-link { color: inherit; text-decoration: none; }
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
    .add-btn, .primary-btn {
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
    .add-btn:disabled, .primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
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
      max-height: 85vh;
      background: var(--secondary);
      border-radius: 16px 16px 0 0;
      padding: 1rem;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom));
      overflow-y: auto;
    }
    .cart-line {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }
    .cart-line-info { flex: 1; min-width: 0; }
    .qty-controls {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .qty-btn {
      width: 28px;
      height: 28px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
    }
    .qty-btn:disabled { opacity: 0.4; }
    .cart-line button.remove-btn {
      border: none;
      background: none;
      color: #c0392b;
      cursor: pointer;
      font-size: 0.75rem;
      padding: 0;
    }
    .cart-error { color: #c0392b; font-size: 0.85rem; margin: 0.5rem 0; }
    .checkout-hint { font-size: 0.8rem; color: var(--hint); margin: 0.5rem 0 0; }
    .checkout-form { margin-top: 0.75rem; }
    .checkout-form.hidden { display: none; }
    .checkout-form label { display: block; font-size: 0.8rem; color: var(--hint); margin: 0.5rem 0 0.25rem; }
    .checkout-form input, .checkout-form select, .checkout-form textarea {
      width: 100%;
      padding: 0.55rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg);
      color: var(--text);
      font-size: 0.9rem;
    }
    .checkout-form textarea { min-height: 4rem; resize: vertical; }
    .checkout-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .checkout-actions button { flex: 1; }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.55rem;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
    }
    .pdp-gallery {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      padding: 0 1rem;
    }
    .pdp-gallery img {
      width: 100%;
      max-height: 280px;
      object-fit: contain;
      border-radius: 12px;
      background: var(--secondary);
    }
    .pdp-body { padding: 1rem; }
    .pdp-price { font-size: 1.25rem; font-weight: 700; color: var(--link); margin: 0.5rem 0; }
    .pdp-desc { font-size: 0.95rem; line-height: 1.5; color: var(--text); }
    .pdp-rating { font-size: 0.85rem; color: var(--hint); margin-bottom: 0.5rem; }
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
    .manual-instructions {
      font-size: 0.85rem;
      line-height: 1.45;
      white-space: pre-wrap;
      margin: 0.5rem 0;
      padding: 0.75rem;
      background: var(--bg);
      border-radius: 10px;
    }
    .manual-qr { max-width: 200px; margin: 0.5rem auto; display: block; border-radius: 8px; }
  </style>
  ${extraHead ?? ""}
</head>
<body>
  ${bodyHtml}
  <div id="toast" class="toast" role="status"></div>
  <script>
    window.__miniAppI18n = ${i18n};
    window.__miniAppLocale = "${lang}";
  </script>
  <script src="/mini-app-runtime.js"></script>
</body>
</html>`;
}

export function miniAppHtmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function miniAppLocaleFromQuery(url: URL): Locale {
  return resolveMiniAppLocale(url.searchParams.get("lang"));
}
