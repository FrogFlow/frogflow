/** Client-side Mini App runtime (served as /mini-app-runtime). */
export const MINI_APP_RUNTIME_JS = `(function () {
  var I = window.__miniAppI18n || {};
  var tg = null;
  var cachedInitData = "";
  var cartReady = false;
  var checkoutBusy = false;
  var bootAttempts = 0;
  var checkoutHistory = [];
  var mainButtonBound = false;
  var quantityBusy = {};
  var paymentPollTimer = null;
  var paymentPollOrderId = null;

  function t(key) { return I[key] || key; }

  function bindTelegram() {
    var next = window.Telegram && window.Telegram.WebApp;
    if (!next) return null;
    if (tg !== next) {
      tg = next;
      try {
        tg.ready();
        tg.expand();
        tg.setHeaderColor("secondary_bg_color");
        tg.setBackgroundColor("bg_color");
      } catch (e) {}
    }
    return tg;
  }

  function looksLike(s) { return !!(s && s.indexOf("hash=") !== -1); }

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

  function showSessionError() {
    revealContext();
    var existing = document.getElementById("mini-session-error");
    if (existing) return;
    var banner = document.createElement("div");
    banner.id = "mini-session-error";
    banner.className = "cart-error";
    banner.style.padding = "0.75rem 1rem";
    banner.style.textAlign = "center";
    banner.textContent = t("sessionNotReady");
    var header = document.querySelector("header");
    if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);
  }

  function revealContext() {
    var content = document.getElementById("mini-context-content");
    var loader = document.getElementById("mini-context-loader");
    if (content) content.classList.remove("context-pending");
    if (loader) loader.remove();
  }

  function parseResponse(response) {
    if (response.status === 401 || response.status === 403) {
      cachedInitData = "";
      cartReady = false;
      setCartEnabled(false);
      try { if (tg && tg.MainButton) tg.MainButton.hide(); } catch (e) {}
      showSessionError();
    }
    return response.json().then(function (data) {
      return { ok: response.ok, status: response.status, d: data };
    });
  }

  function expectedLocale() {
    bindTelegram();
    var code = "";
    try { code = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || ""; }
    catch (e) {}
    code = String(code).toLowerCase();
    if (code.indexOf("kk") === 0) return "kk";
    if (code.indexOf("en") === 0) return "en";
    if (code.indexOf("uz") === 0) return "uz";
    return "ru";
  }

  function reloadForContext(countryCode, savedLocale) {
    var url = new URL(window.location.href);
    var changed = false;
    var locale = /^(ru|kk|en|uz)$/.test(savedLocale || "")
      ? savedLocale
      : expectedLocale();
    if (url.searchParams.get("lang") !== locale) {
      url.searchParams.set("lang", locale);
      changed = true;
    }
    if (countryCode && url.searchParams.get("country") !== countryCode) {
      url.searchParams.set("country", countryCode);
      changed = true;
    }
    try {
      sessionStorage.setItem(
        "ff_mini_context",
        JSON.stringify({ locale: locale, countryCode: countryCode || "" }),
      );
    } catch (e) {}
    if (changed) {
      window.location.replace(url.pathname + "?" + url.searchParams.toString() + url.hash);
      return true;
    }
    return false;
  }

  function formatMoney(amount, currency) {
    var value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    var cur = (currency || "").toUpperCase();
    return cur === "KZT" ? value + " ₸" : value + " " + currency;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function linkifyPaymentInstructions(text) {
    var source = String(text || "");
    var urlRe = /(?:https?:\\/\\/|www\\.|pay\\.kaspi\\.kz\\/)[^\\s<>"']+/gi;
    var html = "";
    var last = 0;
    var match;
    while ((match = urlRe.exec(source))) {
      html += escapeHtml(source.slice(last, match.index));
      var raw = match[0];
      var trailing = "";
      var punct = raw.match(/[),.;!?]+$/);
      if (punct) {
        trailing = punct[0];
        raw = raw.slice(0, raw.length - trailing.length);
      }
      var href = /^https?:\\/\\//i.test(raw) ? raw : "https://" + raw;
      html += "<a href=\\"" + escapeHtml(href) + "\\" data-external=\\"1\\" rel=\\"noopener noreferrer\\">" +
        escapeHtml(raw) + "</a>" + escapeHtml(trailing);
      last = match.index + match[0].length;
    }
    return html + escapeHtml(source.slice(last));
  }

  var cartBar = document.getElementById("mini-cart-bar");
  var cartSheet = document.getElementById("mini-cart-sheet");
  var cartLines = document.getElementById("mini-cart-lines");
  var cartDiscounts = document.getElementById("mini-cart-discounts");
  var pendingPaymentEl = document.getElementById("mini-pending-payment");
  var ordersEl = document.getElementById("mini-orders");
  var libraryEl = document.getElementById("mini-library");
  var checkoutForm = document.getElementById("mini-checkout-form");
  var cartTotalEl = document.getElementById("mini-cart-total");
  var cartCountEl = document.getElementById("mini-cart-count");
  var checkoutBtn = document.getElementById("mini-checkout");
  var cartError = document.getElementById("mini-cart-error");
  var state = {
    items: [],
    total: 0,
    subtotal: 0,
    currency: "KZT",
    summary: null,
    pendingPayment: null,
    purchased: {},
  };

  function renderCart() {
    var count = state.items.reduce(function (s, it) { return s + it.quantity; }, 0);
    var hasPending = !!state.pendingPayment;
    if (cartCountEl) cartCountEl.textContent = String(count);
    if (cartTotalEl) cartTotalEl.textContent = formatMoney(state.total, state.currency);
    if (cartBar) cartBar.classList.toggle("hidden", count === 0 && !hasPending);
    if (checkoutBtn) {
      checkoutBtn.disabled = (count === 0 && !hasPending) || !initData();
      checkoutBtn.textContent = hasPending ? t("continuePayment") : t("pay");
    }
    if (tg && tg.MainButton) {
      try {
        if ((count > 0 || hasPending) && initData()) {
          tg.MainButton.setText(
            hasPending
              ? t("continuePayment")
              : t("pay") + " · " + formatMoney(state.total, state.currency),
          );
          tg.MainButton.show();
          if (!mainButtonBound) {
            mainButtonBound = true;
            tg.MainButton.onClick(beginCheckout);
          }
        } else {
          tg.MainButton.hide();
        }
      } catch (e) {}
    }
    renderPendingPayment();
    if (!cartLines) {
      syncCartButtons();
      return;
    }
    if (!state.items.length) {
      cartLines.innerHTML = "<p class=\\"empty\\">" + t("cartEmpty") + "</p>";
      renderDiscounts();
      syncCartButtons();
      return;
    }
    cartLines.innerHTML = state.items.map(function (it) {
      var qtyHtml = it.quantityLocked
        ? ""
        : "<div class=\\"qty-controls\\">" +
          "<button type=\\"button\\" class=\\"qty-btn\\" data-qty-minus=\\"" + it.id + "\\" aria-label=\\"-\\"" + (quantityBusy[it.id] ? " disabled" : "") + ">−</button>" +
          "<span>" + it.quantity + "</span>" +
          "<button type=\\"button\\" class=\\"qty-btn\\" data-qty-plus=\\"" + it.id + "\\" aria-label=\\"+\\"" + (quantityBusy[it.id] ? " disabled" : "") + ">+</button>" +
          "</div>";
      var thumb = it.image
        ? "<img class=\\"cart-thumb\\" src=\\"" + escapeHtml(it.image) + "\\" alt=\\"\\" />"
        : "";
      return (
        "<div class=\\"cart-line\\">" +
        thumb +
        "<div class=\\"cart-line-info\\">" + escapeHtml(it.name) + " — " + escapeHtml(formatMoney(it.line_total, it.currency)) + "</div>" +
        qtyHtml +
        "<button type=\\"button\\" class=\\"remove-btn\\" data-remove=\\"" + it.id + "\\">" + t("remove") + "</button>" +
        "</div>"
      );
    }).join("");
    cartLines.querySelectorAll("[data-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () { removeItem(btn.getAttribute("data-remove")); });
    });
    cartLines.querySelectorAll("[data-qty-minus]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-qty-minus");
        var item = state.items.find(function (x) { return x.id === id; });
        if (!item) return;
        setQuantity(id, item.quantity - 1);
      });
    });
    cartLines.querySelectorAll("[data-qty-plus]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-qty-plus");
        var item = state.items.find(function (x) { return x.id === id; });
        if (!item) return;
        setQuantity(id, item.quantity + 1);
      });
    });
    renderDiscounts();
    syncCartButtons();
  }

  function renderPendingPayment() {
    if (!pendingPaymentEl) return;
    var pending = state.pendingPayment;
    if (!pending) {
      pendingPaymentEl.innerHTML = "";
      return;
    }
    pendingPaymentEl.innerHTML =
      "<div class=\\"discount-box\\"><p><strong>" + escapeHtml(t("pendingOrder")) +
      " #" + Number(pending.displayNo) + "</strong></p><p>" +
      escapeHtml(pending.amountLabel || "") + "</p><div class=\\"checkout-actions\\">" +
      "<button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-resume-payment\\">" +
      escapeHtml(t("continuePayment")) + "</button><button type=\\"button\\" class=\\"btn-secondary\\" id=\\"mini-cancel-order\\">" +
      escapeHtml(t("cancelOrder")) + "</button></div></div>";
    var resume = document.getElementById("mini-resume-payment");
    if (resume) resume.addEventListener("click", function () {
      runCheckout({ resume_payment: true });
    });
    var cancel = document.getElementById("mini-cancel-order");
    if (cancel) cancel.addEventListener("click", function () {
      if (window.confirm(t("cancelOrder") + "?")) {
        runCheckout({ cancel_pending: true });
      }
    });
  }

  function renderDiscounts() {
    if (!cartDiscounts) return;
    var summary = state.summary;
    if (!summary || !state.items.length) {
      cartDiscounts.innerHTML = "";
      return;
    }
    var discountTotal = Number(summary.promoDiscount || 0) +
      Number(summary.pointsDiscount || 0) + Number(summary.giftDiscount || 0);
    var html = "<div class=\\"discount-box\\">";
    if (discountTotal > 0) {
      html += "<div class=\\"discount-row\\"><span>" + escapeHtml(t("subtotal")) + "</span><span>" +
        escapeHtml(formatMoney(summary.subtotal, state.currency)) + "</span></div>";
      html += "<div class=\\"discount-row\\"><span>" + escapeHtml(t("discount")) + "</span><span>−" +
        escapeHtml(formatMoney(discountTotal, state.currency)) + "</span></div>";
    }
    if (summary.couponsEnabled) {
      html += summary.promoCode
        ? "<div class=\\"discount-row\\"><span>" + escapeHtml(t("promoCode")) + ": " + escapeHtml(summary.promoCode) +
          "</span><button type=\\"button\\" class=\\"remove-btn\\" data-discount-action=\\"promo_clear\\">" + escapeHtml(t("clear")) + "</button></div>"
        : "<div class=\\"discount-entry\\"><input id=\\"mini-promo-code\\" maxlength=\\"100\\" placeholder=\\"" + escapeHtml(t("promoCode")) +
          "\\" /><button type=\\"button\\" data-discount-action=\\"promo_apply\\">" + escapeHtml(t("apply")) + "</button></div>";
    }
    if (summary.giftsEnabled) {
      html += summary.giftCode
        ? "<div class=\\"discount-row\\"><span>" + escapeHtml(t("giftCode")) + ": " + escapeHtml(summary.giftCode) +
          "</span><button type=\\"button\\" class=\\"remove-btn\\" data-discount-action=\\"gift_clear\\">" + escapeHtml(t("clear")) + "</button></div>"
        : "<div class=\\"discount-entry\\"><input id=\\"mini-gift-code\\" maxlength=\\"100\\" placeholder=\\"" + escapeHtml(t("giftCode")) +
          "\\" /><button type=\\"button\\" data-discount-action=\\"gift_apply\\">" + escapeHtml(t("apply")) + "</button></div>";
    }
    if (summary.loyaltyEnabled && summary.pointsBalance > 0) {
      html += "<div class=\\"discount-row\\"><span>" + escapeHtml(t("loyaltyPoints")) + ": " +
        Number(summary.pointsBalance) + "</span><button type=\\"button\\" class=\\"remove-btn\\" data-discount-action=\\"" +
        (summary.usePoints ? "points_clear" : "points_use") + "\\">" +
        escapeHtml(summary.usePoints ? t("clear") : t("usePoints")) + "</button></div>";
    }
    cartDiscounts.innerHTML = html + "</div>";
    cartDiscounts.querySelectorAll("[data-discount-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.getAttribute("data-discount-action");
        var code = "";
        if (action === "promo_apply") {
          var promo = document.getElementById("mini-promo-code");
          code = promo && promo.value ? promo.value.trim() : "";
        } else if (action === "gift_apply") {
          var gift = document.getElementById("mini-gift-code");
          code = gift && gift.value ? gift.value.trim() : "";
        }
        if ((action === "promo_apply" || action === "gift_apply") && !code) {
          showToast(t("invalidField"));
          return;
        }
        changeDiscount(action, code);
      });
    });
  }

  function applyCartPayload(data) {
    state.items = data.items || [];
    state.summary = data.summary || null;
    state.pendingPayment = data.pending_payment || null;
    state.subtotal = data.subtotal == null
      ? state.items.reduce(function (sum, item) { return sum + item.line_total; }, 0)
      : Number(data.subtotal);
    state.total = data.total == null ? state.subtotal : Number(data.total);
    state.currency = data.currency || (state.items[0] ? state.items[0].currency : "KZT");
    renderCart();
  }

  function refreshCart() {
    return fetch("/api/public/mini-app/cart", { headers: apiHeaders() })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) {
          var error = new Error(res.d && res.d.error ? res.d.error : "cart_failed");
          error.auth = res.status === 401 || res.status === 403;
          throw error;
        }
        if (reloadForContext(res.d.country_code || "", res.d.locale || "")) return;
        revealContext();
        applyCartPayload(res.d);
      });
  }

  function setQuantity(id, qty) {
    if (quantityBusy[id]) return Promise.resolve();
    quantityBusy[id] = true;
    renderCart();
    return fetch("/api/public/mini-app/cart", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ action: "set_quantity", cart_item_id: id, quantity: qty }),
    })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) {
          if (res.d && res.d.error === "out_of_stock") showToast(t("outOfStock"));
          else if (res.d && res.d.error === "digital_limit") showToast(t("digitalLimit"));
          return;
        }
        applyCartPayload(res.d);
      })
      .finally(function () {
        delete quantityBusy[id];
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
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) {
          var code = res.d && res.d.error ? res.d.error : "add_failed";
          if (code === "mixed_cart") showToast(t("mixedCart"));
          else if (code === "out_of_stock") showToast(t("outOfStock"));
          else if (code === "digital_limit") showToast(t("digitalLimit"));
          else showToast(t("couldNotAdd"));
          return;
        }
        applyCartPayload(res.d);
        try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("success"); } catch (e) {}
        showToast(t("addedToCart"));
      });
  }

  function removeItem(id) {
    return fetch("/api/public/mini-app/cart", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ action: "remove", cart_item_id: id }),
    })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) return;
        applyCartPayload(res.d);
      });
  }

  function changeDiscount(action, code) {
    return fetch("/api/public/mini-app/cart", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ action: action, code: code || undefined }),
    })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) {
          showToast(
            res.d && res.d.error === "invalid_code"
              ? t("invalidField")
              : t("checkoutFailed"),
          );
          return;
        }
        applyCartPayload(res.d);
      })
      .catch(function () { showToast(t("networkError")); });
  }

  function loadOrders() {
    if (!ordersEl || !initData()) return Promise.resolve();
    return fetch("/api/public/mini-app/orders", { headers: apiHeaders() })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : "orders_failed");
        renderOrders(res.d.orders || [], res.d.botUrl || "", !!res.d.reviewsEnabled);
      })
      .catch(function (error) {
        if (!error || !error.auth) ordersEl.innerHTML = "<p class=\\"empty\\">" + escapeHtml(t("networkError")) + "</p>";
      });
  }

  function deliveryLangLabel(code) {
    if (!code) return "";
    if (code === "all") return t("materialLangAll");
    if (code === "kk") return "KZ";
    return String(code).toUpperCase();
  }

  function renderOrders(orders, botUrl, reviewsEnabled) {
    if (!ordersEl) return;
    if (!orders.length) {
      ordersEl.innerHTML = "<p class=\\"empty\\">" + escapeHtml(t("noOrders")) + "</p>";
      return;
    }
    var statuses = I.orderStatus || {};
    ordersEl.innerHTML = orders.map(function (order) {
      var physical = order.fulfillmentKind === "physical";
      var status = physical && order.status === "delivering"
        ? (t("physicalDelivering") || statuses[order.status] || order.status)
        : (statuses[order.status] || order.status);
      var date = "";
      try {
        date = new Intl.DateTimeFormat(window.__miniAppLocale || "ru", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(order.createdAt));
      } catch (e) { date = order.createdAt || ""; }
      var actions = "";
      if (order.status === "awaiting_payment") {
        actions += "<button type=\\"button\\" data-order-resume=\\"" + Number(order.id) + "\\">" +
          escapeHtml(t("continuePayment")) + "</button>";
      }
      if (order.status === "delivered" && !physical) {
        actions += "<button type=\\"button\\" data-order-resend=\\"" + Number(order.id) + "\\">" +
          escapeHtml(t("resendFiles")) + "</button>";
      }
      if (botUrl) {
        actions += "<a href=\\"" + escapeHtml(botUrl) + "\\" data-bot-link>" +
          escapeHtml(t("contactSupport")) + "</a>";
      }
      var money = formatMoney(Number(order.total), order.currency);
      var paid = Number(order.paidAmount || 0);
      if (physical && paid > 0 && paid < Number(order.total)) {
        money += " · " + t("paidLabel") + " " + formatMoney(paid, order.currency);
      }
      var fulfill = "";
      if (order.fulfillmentType === "pickup") fulfill = t("pickup");
      else if (order.fulfillmentType === "delivery") fulfill = t("delivery");
      if (order.fulfillmentAt) {
        fulfill = fulfill ? fulfill + " · " + order.fulfillmentAt : order.fulfillmentAt;
      }
      var lang = deliveryLangLabel(order.deliveryLang);
      if (lang) fulfill = fulfill ? fulfill + " · " + lang : lang;
      var items = Array.isArray(order.items) ? order.items : [];
      var itemHtml = items.length
        ? "<div class=\\"order-items\\">" + items.map(function (item) {
            return escapeHtml(item.name || "");
          }).filter(Boolean).join("<br>") + "</div>"
        : "";
      var rateHtml = "";
      // Оценка физического заказа работает верно на бэкенде (reviews.server.ts
      // не проверяет fulfillment_kind вообще) и в боте — Mini App скрывала
      // кнопку без причины, оставляя покупателя торта без возможности
      // оставить отзыв после доставки.
      if (reviewsEnabled && order.status === "delivered") {
        rateHtml = items.map(function (item) {
          if (!item.productId) return "";
          var stars = "";
          for (var n = 1; n <= 5; n++) {
            stars += "<button type=\\"button\\" class=\\"star-btn" +
              (Number(item.rating) >= n ? " active" : "") +
              "\\" data-rate=\\"" + n + "\\" aria-label=\\"" + n + "\\">★</button>";
          }
          return "<div class=\\"order-stars\\" data-rate-order=\\"" + Number(order.id) +
            "\\" data-rate-product=\\"" + escapeHtml(item.productId) + "\\"><span>" +
            escapeHtml(t("rateMaterial")) + "</span>" + stars + "</div>";
        }).join("");
      }
      var digitalHint = order.status === "delivered" && !physical
        ? "<div class=\\"order-meta\\">" + escapeHtml(t("filesInBot")) + "</div>"
        : "";
      return "<article class=\\"order-card\\"><div class=\\"order-head\\"><span>#" +
        Number(order.displayNo) + "</span><span>" + escapeHtml(status) + "</span></div>" +
        "<div class=\\"order-meta\\">" + escapeHtml(date) + " · " +
        escapeHtml(money) + "</div>" +
        (fulfill ? "<div class=\\"order-meta\\">" + escapeHtml(fulfill) + "</div>" : "") +
        digitalHint +
        itemHtml +
        rateHtml +
        (actions ? "<div class=\\"order-actions\\">" + actions + "</div>" : "") +
        "</article>";
    }).join("");
    ordersEl.querySelectorAll("[data-order-resume]").forEach(function (button) {
      button.addEventListener("click", function () {
        runCheckout({ resume_payment: true });
        showCartSheet();
      });
    });
    ordersEl.querySelectorAll("[data-order-resend]").forEach(function (button) {
      button.addEventListener("click", function () {
        resendOrderFiles(Number(button.getAttribute("data-order-resend")), button);
      });
    });
    ordersEl.querySelectorAll("[data-bot-link]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (tg && tg.openTelegramLink) {
          event.preventDefault();
          tg.openTelegramLink(link.href);
        }
      });
    });
    ordersEl.querySelectorAll(".order-stars [data-rate]").forEach(function (button) {
      button.addEventListener("click", function () {
        var row = button.closest(".order-stars");
        if (!row) return;
        rateMaterial(
          Number(row.getAttribute("data-rate-order")),
          row.getAttribute("data-rate-product"),
          Number(button.getAttribute("data-rate")),
          row,
        );
      });
    });
  }

  function resendOrderFiles(orderId, button) {
    button.disabled = true;
    fetch("/api/public/mini-app/orders", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ action: "resend", order_id: orderId }),
    })
      .then(parseResponse)
      .then(function (res) {
        showToast(res.ok ? t("filesResent") : t("checkoutFailed"));
      })
      .catch(function () { showToast(t("networkError")); })
      .finally(function () { button.disabled = false; });
  }

  function rateMaterial(orderId, productId, rating, row) {
    if (!orderId || !productId || !rating) return;
    row.querySelectorAll("[data-rate]").forEach(function (btn) {
      btn.disabled = true;
    });
    fetch("/api/public/mini-app/orders", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        action: "rate",
        order_id: orderId,
        product_id: productId,
        rating: rating,
      }),
    })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) {
          showToast(t("checkoutFailed"));
          return;
        }
        row.querySelectorAll("[data-rate]").forEach(function (btn) {
          btn.classList.toggle("active", Number(btn.getAttribute("data-rate")) <= rating);
        });
        showToast(t("rateThanks"));
      })
      .catch(function () { showToast(t("networkError")); })
      .finally(function () {
        row.querySelectorAll("[data-rate]").forEach(function (btn) {
          btn.disabled = false;
        });
      });
  }

  function clearCheckoutForm() {
    if (!checkoutForm) return;
    stopPaymentPolling();
    checkoutForm.innerHTML = "";
    checkoutForm.classList.add("hidden");
  }

  function showCheckoutStep(data, fromHistory) {
    if (!checkoutForm) return;
    if (!fromHistory) {
      var last = checkoutHistory[checkoutHistory.length - 1];
      if (!last || last.step !== data.step) checkoutHistory.push(data);
    }
    checkoutForm.classList.remove("hidden");
    var html = "";
    var step = data.step;
    if (step === "need_contact") {
      html = "<p><strong>" + t("needContact") + "</strong></p><p>" + t("needContactHint") + "</p>" +
        "<label>" + t("phoneLabel") + "</label><input type=\\"tel\\" id=\\"mini-phone\\" placeholder=\\"+7...\\" />" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "need_country") {
      html = "<p><strong>" + t("needCountry") + "</strong></p><label>" + t("chooseCountry") + "</label><select id=\\"mini-country\\">" +
        (data.countries || []).map(function (c) {
          return "<option value=\\"" + escapeHtml(c.code) + "\\">" + escapeHtml(c.name) + "</option>";
        }).join("") + "</select>" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "need_fulfillment_type") {
      html = "<p><strong>" + t("needFulfillmentType") + "</strong></p><div class=\\"checkout-actions\\">" +
        (data.pickup ? "<button type=\\"button\\" class=\\"primary-btn\\" data-fulfill-type=\\"pickup\\">" + t("pickup") + "</button>" : "") +
        (data.delivery ? "<button type=\\"button\\" class=\\"primary-btn\\" data-fulfill-type=\\"delivery\\">" + t("delivery") + "</button>" : "") +
        "</div>";
    } else if (step === "need_fulfillment_date") {
      html = "<p><strong>" + t("needFulfillmentDate") + "</strong></p><label>" + t("dateLabel") + "</label>" +
        "<input type=\\"date\\" id=\\"mini-fulfill-date\\" min=\\"" + escapeHtml(data.minDate || "") +
        "\\" value=\\"" + escapeHtml(data.minDate || "") + "\\" />" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "need_delivery_zone") {
      html = "<p><strong>" + t("needDeliveryZone") + "</strong></p><label>" + t("needDeliveryZone") + "</label><select id=\\"mini-zone\\">" +
        (data.zones || []).map(function (z) {
          return "<option value=\\"" + escapeHtml(z.id) + "\\">" + escapeHtml(z.name) + (z.fee ? " — " + escapeHtml(z.feeLabel) : "") + "</option>";
        }).join("") + "</select>" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "need_delivery_language") {
      html = "<p><strong>" + t("chooseDeliveryLanguage") + "</strong></p><select id=\\"mini-delivery-language\\">" +
        (data.languages || []).map(function (language) {
          return "<option value=\\"" + escapeHtml(language.code) + "\\">" + escapeHtml(language.name) + "</option>";
        }).join("") + "</select>" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "need_address") {
      html = "<p><strong>" + t("needAddress") + "</strong></p><label>" + t("addressLabel") + "</label>" +
        "<textarea id=\\"mini-address\\"></textarea>" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "need_fulfillment_note") {
      html = "<p><strong>" + t("noteOptional") + "</strong></p><label>" + t("noteLabel") + "</label>" +
        "<textarea id=\\"mini-note\\"></textarea>" +
        "<div class=\\"checkout-actions\\"><button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-step-submit\\">" + t("continue") + "</button></div>";
    } else if (step === "choose_payment") {
      html = "<p><strong>" + t("choosePayment") + "</strong></p><p>" + escapeHtml(data.amountLabel || "") + "</p>" +
        "<div class=\\"checkout-actions\\">" +
        "<button type=\\"button\\" class=\\"primary-btn\\" data-pay=\\"robokassa\\">" + t("payRobokassa") + "</button>" +
        "<button type=\\"button\\" class=\\"btn-secondary\\" data-pay=\\"manual\\">" + t("payManual") + "</button>" +
        "</div>";
    } else if (step === "robokassa") {
      html = "<p><strong>" + escapeHtml(data.amountLabel || "") + "</strong></p>" +
        "<p class=\\"checkout-hint\\">" + t("waitingPayment") + "</p>" +
        "<button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-open-pay\\">" + t("openPayment") + "</button>";
      checkoutForm.innerHTML = html;
      var openPay = document.getElementById("mini-open-pay");
      if (openPay) openPay.addEventListener("click", function () {
        if (data.paymentUrl && tg) tg.openLink(data.paymentUrl);
        else if (data.paymentUrl) window.open(data.paymentUrl, "_blank");
      });
      startPaymentPolling(data.orderId);
      return;
    } else if (step === "manual_proof") {
      html = "<p><strong>" + escapeHtml(data.amountLabel || "") + "</strong></p>" +
        (data.qrImageUrl ? "<img class=\\"manual-qr\\" src=\\"" + escapeHtml(data.qrImageUrl) + "\\" alt=\\"QR\\" />" : "") +
        "<div class=\\"manual-instructions\\" id=\\"mini-manual-text\\"></div>" +
        "<label for=\\"mini-proof-file\\">" + t("chooseReceipt") + "</label>" +
        "<input type=\\"file\\" id=\\"mini-proof-file\\" accept=\\"image/jpeg,image/png,image/webp,image/heic,application/pdf\\" />" +
        "<img id=\\"mini-proof-preview\\" class=\\"proof-preview\\" alt=\\"Receipt preview\\" />" +
        "<progress id=\\"mini-proof-progress\\" class=\\"proof-progress\\" max=\\"100\\" value=\\"0\\"></progress>" +
        "<div id=\\"mini-proof-status\\" class=\\"proof-status\\" aria-live=\\"polite\\"></div>" +
        "<button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-upload-proof\\">" + t("uploadReceipt") + "</button>" +
        "<p class=\\"checkout-hint\\">" + t("sendProofInBot") + "</p>";
      checkoutForm.innerHTML = html;
      var instEl = document.getElementById("mini-manual-text");
      if (instEl) instEl.innerHTML = linkifyPaymentInstructions(data.instructions || "");
      var proofInput = document.getElementById("mini-proof-file");
      var proofPreview = document.getElementById("mini-proof-preview");
      if (proofInput) proofInput.addEventListener("change", function () {
        var file = proofInput.files && proofInput.files[0];
        if (!file || !proofPreview) return;
        if (file.type.indexOf("image/") === 0) {
          proofPreview.src = URL.createObjectURL(file);
          proofPreview.style.display = "block";
        } else {
          proofPreview.removeAttribute("src");
          proofPreview.style.display = "none";
        }
      });
      var uploadProof = document.getElementById("mini-upload-proof");
      if (uploadProof) uploadProof.addEventListener("click", function () {
        var file = proofInput && proofInput.files ? proofInput.files[0] : null;
        if (!file) {
          showToast(t("chooseReceipt"));
          return;
        }
        uploadPaymentProof(file, data.orderId, uploadProof);
      });
      return;
    } else if (step === "completed") {
      html = "<p><strong>" + escapeHtml(data.message || t("orderComplete")) + "</strong></p>";
      if (!window.__miniAppPhysicalShop) {
        html += "<p class=\\"checkout-hint\\">" + escapeHtml(t("filesAfterPayment")) + "</p>";
        html += "<a class=\\"primary-btn\\" href=\\"/mini-app/library" + location.search +
          "\\" style=\\"display:block;text-align:center;text-decoration:none;margin-top:0.75rem\\">" +
          escapeHtml(t("myMaterials")) + "</a>";
        html += "<a class=\\"btn-secondary\\" href=\\"/mini-app/orders" + location.search +
          "\\" style=\\"display:block;text-align:center;text-decoration:none;margin-top:0.5rem\\">" +
          escapeHtml(t("myOrders")) + "</a>";
      } else {
        html += "<a class=\\"primary-btn\\" href=\\"/mini-app/orders" + location.search +
          "\\" style=\\"display:block;text-align:center;text-decoration:none;margin-top:0.75rem\\">" +
          escapeHtml(t("myOrders")) + "</a>";
      }
      if (data.botUrl) {
        html += "<a class=\\"btn-secondary\\" href=\\"" + escapeHtml(data.botUrl) +
          "\\" data-bot-link style=\\"display:block;text-align:center;text-decoration:none;margin-top:0.5rem\\">" +
          escapeHtml(t("contactSupport")) + "</a>";
      }
      checkoutForm.innerHTML = html;
      checkoutForm.querySelectorAll("[data-bot-link]").forEach(function (link) {
        link.addEventListener("click", function (event) {
          if (tg && tg.openTelegramLink) {
            event.preventDefault();
            tg.openTelegramLink(link.href);
          }
        });
      });
      try { if (tg) tg.disableClosingConfirmation(); } catch (e) {}
      return;
    }
    checkoutForm.innerHTML = html;
    if (step !== "completed" && step !== "robokassa" && step !== "manual_proof") {
      var nav = document.createElement("div");
      nav.className = "checkout-actions";
      if (checkoutHistory.length > 1) {
        var back = document.createElement("button");
        back.type = "button";
        back.className = "btn-secondary";
        back.textContent = t("back");
        back.addEventListener("click", function () {
          checkoutHistory.pop();
          var previous = checkoutHistory[checkoutHistory.length - 1];
          if (previous) showCheckoutStep(previous, true);
        });
        nav.appendChild(back);
      }
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn-secondary";
      cancel.textContent = t("cancel");
      cancel.addEventListener("click", hideCartSheet);
      nav.appendChild(cancel);
      checkoutForm.insertBefore(nav, checkoutForm.firstChild);
    }
    var submit = document.getElementById("mini-step-submit");
    if (submit) {
      submit.addEventListener("click", function () {
        var body = {};
        if (step === "need_contact") {
          var phone = document.getElementById("mini-phone");
          body.contact_phone = phone && phone.value ? phone.value.trim() : "";
          if (!/^\\+?[0-9 ()-]{7,32}$/.test(body.contact_phone)) {
            showToast(t("invalidField"));
            if (phone) phone.setAttribute("aria-invalid", "true");
            return;
          }
        } else if (step === "need_country") {
          var country = document.getElementById("mini-country");
          body.country_code = country && country.value ? country.value : "";
        } else if (step === "need_fulfillment_date") {
          var dt = document.getElementById("mini-fulfill-date");
          body.fulfillment_date = dt && dt.value ? dt.value : "";
          if (!body.fulfillment_date) {
            showToast(t("invalidField"));
            if (dt) dt.setAttribute("aria-invalid", "true");
            return;
          }
        } else if (step === "need_delivery_zone") {
          var zone = document.getElementById("mini-zone");
          body.delivery_zone_id = zone && zone.value ? zone.value : "";
        } else if (step === "need_delivery_language") {
          var language = document.getElementById("mini-delivery-language");
          body.delivery_language = language && language.value ? language.value : "";
        } else if (step === "need_address") {
          var addr = document.getElementById("mini-address");
          body.fulfillment_address = addr && addr.value ? addr.value.trim() : "";
          if (!body.fulfillment_address) {
            showToast(t("invalidField"));
            if (addr) addr.setAttribute("aria-invalid", "true");
            return;
          }
        } else if (step === "need_fulfillment_note") {
          var note = document.getElementById("mini-note");
          body.fulfillment_note = note && note.value ? note.value.trim() : "";
        }
        runCheckout(body);
      });
    }
    checkoutForm.querySelectorAll("[data-fulfill-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        runCheckout({ fulfillment_type: btn.getAttribute("data-fulfill-type") });
      });
    });
    checkoutForm.querySelectorAll("[data-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        runCheckout({ payment_method: btn.getAttribute("data-pay") });
      });
    });
  }

  function stopPaymentPolling() {
    if (paymentPollTimer) {
      clearInterval(paymentPollTimer);
      paymentPollTimer = null;
    }
    paymentPollOrderId = null;
  }

  function startPaymentPolling(orderId) {
    stopPaymentPolling();
    if (!orderId) return;
    paymentPollOrderId = Number(orderId);
    var attempts = 0;
    paymentPollTimer = setInterval(function () {
      attempts += 1;
      if (attempts > 60) {
        stopPaymentPolling();
        return;
      }
      if (!initData() || document.visibilityState !== "visible") return;
      fetch("/api/public/mini-app/orders?poll=1", { headers: apiHeaders() })
        .then(parseResponse)
        .then(function (res) {
          if (!res.ok || !paymentPollOrderId) return;
          var orders = res.d.orders || [];
          var order = null;
          for (var i = 0; i < orders.length; i++) {
            if (Number(orders[i].id) === paymentPollOrderId) {
              order = orders[i];
              break;
            }
          }
          if (!order || order.status === "awaiting_payment") return;
          stopPaymentPolling();
          showToast(t("paymentConfirmed"));
          showCheckoutStep({
            step: "completed",
            message: t("paymentConfirmed"),
            orderId: order.id,
            botUrl: res.d.botUrl || "",
          });
          refreshCart().catch(function () {});
          loadOrders();
          loadLibrary();
        })
        .catch(function () {});
    }, 4000);
  }

  function uploadPaymentProof(file, orderId, button) {
    if (file.size > 20 * 1024 * 1024) {
      showToast(t("receiptTooLarge"));
      return;
    }
    var allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "application/pdf",
    ];
    if (allowed.indexOf(file.type) === -1) {
      showToast(t("invalidReceiptFile"));
      return;
    }
    var progress = document.getElementById("mini-proof-progress");
    var status = document.getElementById("mini-proof-status");
    var form = new FormData();
    form.append("file", file);
    if (orderId) form.append("order_id", String(orderId));
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/public/mini-app/proof");
    xhr.setRequestHeader("X-Telegram-Init-Data", initData());
    if (button) button.disabled = true;
    if (progress) {
      progress.style.display = "block";
      progress.value = 0;
    }
    if (status) status.textContent = t("uploadingReceipt");
    try { if (tg) tg.enableClosingConfirmation(); } catch (e) {}
    xhr.upload.onprogress = function (event) {
      if (progress && event.lengthComputable) {
        progress.value = Math.round((event.loaded / event.total) * 100);
      }
    };
    xhr.onload = function () {
      if (button) button.disabled = false;
      var result = {};
      try { result = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
      if (xhr.status === 401 || xhr.status === 403) {
        cachedInitData = "";
        setCartEnabled(false);
        showSessionError();
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !result.ok) {
        var errorText = result.error === "file_too_large"
          ? t("receiptTooLarge")
          : result.error === "invalid_file"
            ? t("invalidReceiptFile")
            : result.error === "rate_limited"
              ? t("rateLimited")
              : result.error === "order_already_processed"
                ? t("orderAlreadyProcessed")
                : t("checkoutFailed");
        if (status) status.textContent = errorText;
        return;
      }
      var message = result.outcome === "proof_retry"
        ? t("proofRetry")
        : result.outcome === "proof_review"
          ? t("proofReview")
          : result.outcome === "accepted"
            ? t("proofAccepted")
            : t("proofCompleted");
      if (status) status.textContent = message;
      if (result.outcome !== "proof_retry") {
        if (button) button.style.display = "none";
        try { if (tg) tg.disableClosingConfirmation(); } catch (e) {}
        refreshCart().catch(function () {});
      }
    };
    xhr.onerror = function () {
      if (button) button.disabled = false;
      if (status) status.textContent = t("networkError");
    };
    xhr.send(form);
  }

  function runCheckout(extraBody) {
    if (checkoutBusy) return Promise.resolve();
    checkoutBusy = true;
    try { if (tg) tg.enableClosingConfirmation(); } catch (e) {}
    if (cartError) cartError.textContent = t("loading");
    if (checkoutBtn) checkoutBtn.disabled = true;
    if (checkoutForm) checkoutForm.setAttribute("aria-busy", "true");
    if (checkoutForm) {
      checkoutForm.querySelectorAll("button").forEach(function (button) {
        button.disabled = true;
      });
    }
    var body = extraBody || {};
    return fetch("/api/public/mini-app/checkout", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body),
    })
      .then(parseResponse)
      .then(function (res) {
        checkoutBusy = false;
        if (checkoutForm) checkoutForm.setAttribute("aria-busy", "false");
        if (cartError) cartError.textContent = "";
        if (checkoutBtn) {
          checkoutBtn.disabled = state.items.length === 0 && !state.pendingPayment;
        }
        if (!res.ok) {
          var code = res.d && res.d.error;
          var msg = code === "in_progress"
            ? t("inProgress")
            : code === "pending_order_conflict"
              ? t("pendingConflict")
              : code === "order_already_processed" || code === "already_processed"
                ? t("orderAlreadyProcessed")
            : code === "rate_limited"
              ? t("rateLimited")
            : code === "empty_cart"
              ? t("cartEmpty")
              : code === "robokassa_unavailable" || code === "invalid_payment_method"
                ? t("paymentUnavailable")
                : code && code.indexOf("invalid_") === 0
                  ? t("invalidField")
                  : t("checkoutFailed");
          if (cartError) cartError.textContent = msg;
          if (checkoutForm) {
            checkoutForm.querySelectorAll("button").forEach(function (button) {
              button.disabled = false;
            });
          }
          if (code === "empty_cart") refreshCart().catch(function () {});
          return;
        }
        if (res.d.step === "pending_cancelled") {
          checkoutHistory = [];
          clearCheckoutForm();
          refreshCart().catch(function () {});
          showToast(t("cancelOrder"));
          return;
        }
        if (res.d.step) {
          showCheckoutStep(res.d);
          showCartSheet();
          if (res.d.step === "completed") {
            loadLibrary();
            loadOrders();
          }
          return;
        }
        if (res.d.paymentUrl) {
          showCheckoutStep({ step: "robokassa", paymentUrl: res.d.paymentUrl, amountLabel: res.d.amountLabel });
        }
      })
      .catch(function () {
        checkoutBusy = false;
        if (checkoutForm) checkoutForm.setAttribute("aria-busy", "false");
        if (cartError) cartError.textContent = t("networkError");
        if (checkoutBtn) checkoutBtn.disabled = false;
        if (checkoutForm) {
          checkoutForm.querySelectorAll("button").forEach(function (button) {
            button.disabled = false;
          });
        }
      });
  }

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (!el || !el.closest) return;
    var external = el.closest("a[data-external]");
    if (external) {
      var href = external.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      try {
        bindTelegram();
        if (tg && tg.openLink) tg.openLink(href);
        else window.open(href, "_blank");
      } catch (err) {
        window.open(href, "_blank");
      }
      return;
    }
    var shareBtn = el.closest("[data-share]");
    if (shareBtn) {
      var shareText = shareBtn.getAttribute("data-share") || "";
      // data-share-url — рабочий t.me/<bot>?start=p_<id> deep-link (сервер
      // строит его, зная username бота); location.href — запасной вариант,
      // если username получить не удалось, но он открывается только внутри
      // уже авторизованной сессии Telegram WebView.
      var shareUrl = shareBtn.getAttribute("data-share-url") || location.href;
      e.preventDefault();
      try {
        bindTelegram();
        if (tg && tg.openTelegramLink) {
          tg.openTelegramLink(
            "https://t.me/share/url?url=" + encodeURIComponent(shareUrl) +
            "&text=" + encodeURIComponent(shareText),
          );
          return;
        }
      } catch (err) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText + "\\n" + shareUrl).then(function () {
          showToast(t("copied"));
        }).catch(function () { showToast(t("copied")); });
      } else {
        showToast(shareText);
      }
      return;
    }
    var addBtn = el.closest(".add-btn");
    if (addBtn) {
      if (!initData()) {
        showToast(t("sessionNotReady"));
        return;
      }
      if (addBtn.classList.contains("purchased")) {
        var ownedOrder = addBtn.getAttribute("data-order-id");
        if (libraryEl && ownedOrder) {
          resendOrderFiles(Number(ownedOrder), addBtn);
          return;
        }
        location.assign("/mini-app/library" + location.search + location.hash);
        return;
      }
      if (addBtn.classList.contains("in-cart")) {
        showCartSheet();
        return;
      }
      var card = addBtn.closest(".card, .pdp-body");
      var productId = addBtn.getAttribute("data-product-id");
      var select = card ? card.querySelector(".variant-select") : null;
      var variantId = select && select.value ? select.value : null;
      if (addBtn.getAttribute("data-has-variants") === "1" && !variantId) {
        showToast(t("chooseVariant"));
        return;
      }
      addBtn.disabled = true;
      addProduct(productId, variantId).finally(function () {
        syncCartButtons();
      });
      return;
    }
    var link = el.closest("a[href]");
    if (!link || link.getAttribute("data-bot-link") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var rawHref = link.getAttribute("href");
    if (!rawHref || rawHref.charAt(0) !== "/") return;
    var next = new URL(rawHref, location.origin);
    if (next.origin !== location.origin) return;
    if (next.pathname === "/mini-app") {
      e.preventDefault();
      if (location.pathname === "/mini-app") {
        loadCatalog(next.pathname + (next.search || ""));
      } else {
        location.assign(next.pathname + next.search + location.hash);
      }
      return;
    }
    if (next.pathname.indexOf("/mini-app") === 0) {
      e.preventDefault();
      location.assign(next.pathname + next.search + location.hash);
    }
  });

  document.addEventListener("change", function (e) {
    var sel = e.target && e.target.closest ? e.target.closest(".variant-select") : null;
    if (!sel) return;
    var card = sel.closest(".card, .pdp-body");
    var btn = card ? card.querySelector(".add-btn") : null;
    if (btn) btn.disabled = !initData() || !sel.value;
    syncCartButtons();
    var headline = card ? card.querySelector(".pdp-price") : null;
    var option = sel.options && sel.selectedIndex >= 0
      ? sel.options[sel.selectedIndex]
      : null;
    if (headline && option && option.getAttribute("data-price")) {
      headline.textContent = option.getAttribute("data-price");
    }
  });

  var catalogRequest = 0;
  var smartSearchStarted = 0;
  var searchTimer = null;
  function replaceNode(selector, nextDoc) {
    var current = document.querySelector(selector);
    var incoming = nextDoc.querySelector(selector);
    if (current && incoming) {
      current.replaceWith(incoming.cloneNode(true));
      return;
    }
    if (current && !incoming) current.remove();
    if (!current && incoming) {
      var grid = document.querySelector(".grid");
      var searchBox = document.querySelector(".catalog-search");
      var cats = document.querySelector("#mini-categories");
      if (selector === ".pagination" && grid) grid.after(incoming.cloneNode(true));
      if (selector === "#mini-categories" && searchBox) searchBox.after(incoming.cloneNode(true));
      if (selector === "#mini-mlangs") {
        if (cats) cats.after(incoming.cloneNode(true));
        else if (searchBox) searchBox.after(incoming.cloneNode(true));
      }
      if (selector === "#mini-sorts") {
        var langs = document.querySelector("#mini-mlangs");
        if (langs) langs.after(incoming.cloneNode(true));
        else if (cats) cats.after(incoming.cloneNode(true));
        else if (searchBox) searchBox.after(incoming.cloneNode(true));
      }
    }
  }
  function visibleCatalogCards() {
    return document.querySelectorAll(".grid .card:not([hidden])");
  }
  function showSearchStatus(text) {
    var grid = document.querySelector(".grid");
    if (!grid) return;
    var empty = grid.querySelector(".empty");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "empty";
      empty.setAttribute("data-search-empty", "1");
      grid.appendChild(empty);
    }
    empty.hidden = false;
    empty.textContent = text;
  }
  function maybeSmartSearch(search, requestId) {
    var url = new URL(search, location.origin);
    var q = (url.searchParams.get("q") || "").trim();
    if (!q || !document.querySelector(".catalog-search") || visibleCatalogCards().length) return;
    if (smartSearchStarted === requestId) return;
    smartSearchStarted = requestId;
    var tries = 0;
    function start() {
      if (requestId !== catalogRequest) return;
      if (visibleCatalogCards().length) return;
      if (!initData()) {
        tries += 1;
        if (tries >= 100) return;
        setTimeout(start, 100);
        return;
      }
      showSearchStatus(t("searchingDeeper"));
      showToast(t("searchingDeeper"));
      fetch("/api/public/mini-app/search", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          q: q,
          country: url.searchParams.get("country") || "",
          lang: url.searchParams.get("lang") || "",
          mlang: url.searchParams.get("mlang") || "",
        }),
      })
        .then(parseResponse)
        .then(function (res) {
          if (requestId !== catalogRequest) return;
          if (res.ok && res.d && res.d.html && res.d.total) {
            var grid = document.querySelector(".grid");
            if (grid) grid.innerHTML = res.d.html;
            var subtitle = document.querySelector(".subtitle");
            if (subtitle) {
              var suffix = t("productsCountSuffix");
              subtitle.textContent = suffix && suffix !== "productsCountSuffix"
                ? (res.d.total + " " + suffix)
                : String(res.d.total);
            }
            setCartEnabled(!!initData());
            return;
          }
          showSearchStatus(t("searchEmpty"));
        })
        .catch(function () {
          if (requestId !== catalogRequest) return;
          showSearchStatus(t("searchEmpty"));
        });
    }
    start();
  }
  function loadCatalog(search) {
    var id = ++catalogRequest;
    return fetch(search, {
      headers: {
        Accept: "text/html",
        "X-Telegram-Init-Data": initData(),
      },
    })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        if (id !== catalogRequest) return;
        var nextDoc = new DOMParser().parseFromString(html, "text/html");
        replaceNode(".grid", nextDoc);
        replaceNode(".pagination", nextDoc);
        replaceNode(".subtitle", nextDoc);
        replaceNode("#mini-categories", nextDoc);
        replaceNode("#mini-mlangs", nextDoc);
        replaceNode("#mini-sorts", nextDoc);
        history.replaceState(null, "", search + location.hash);
        setCartEnabled(!!initData());
        maybeSmartSearch(search, id);
      })
      .catch(function () {
        showToast(t("networkError"));
      });
  }
  function filterVisibleCards(query) {
    var q = String(query || "").trim().toLowerCase();
    var tokens = q.split(/\\s+/).filter(Boolean);
    var cards = document.querySelectorAll(".grid .card");
    var shown = 0;
    cards.forEach(function (card) {
      var hay = (card.getAttribute("data-name") || "").toLowerCase();
      var match = !tokens.length || tokens.every(function (token) {
        return hay.indexOf(token) !== -1;
      });
      card.hidden = !match;
      if (match) shown += 1;
    });
    var empty = document.querySelector(".grid .empty");
    if (!empty && cards.length) {
      empty = document.createElement("div");
      empty.className = "empty";
      empty.setAttribute("data-search-empty", "1");
      var grid = document.querySelector(".grid");
      if (grid) grid.appendChild(empty);
    }
    if (empty && empty.getAttribute("data-search-empty") === "1") {
      empty.textContent = t("searchEmpty");
      empty.hidden = shown > 0 || !tokens.length;
    }
  }
  var searchForm = document.querySelector(".catalog-search");
  var searchInput = document.getElementById("mini-search-server");
  function runCatalogSearch(query) {
    var url = new URL(location.href);
    var q = String(query || "").trim();
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    url.searchParams.delete("page");
    loadCatalog(url.pathname + "?" + url.searchParams.toString());
  }
  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (searchTimer) clearTimeout(searchTimer);
      runCatalogSearch(searchInput.value);
    });
    searchInput.addEventListener("input", function () {
      filterVisibleCards(searchInput.value);
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        runCatalogSearch(searchInput.value);
      }, 280);
    });
  }

  var openCart = document.getElementById("mini-open-cart");
  function showCartSheet() {
    if (!cartSheet) return;
    cartSheet.classList.remove("hidden");
    cartSheet.setAttribute("aria-hidden", "false");
    var panel = cartSheet.querySelector(".cart-panel");
    if (panel) panel.focus();
  }
  function hideCartSheet() {
    if (!cartSheet) return;
    cartSheet.classList.add("hidden");
    cartSheet.setAttribute("aria-hidden", "true");
    clearCheckoutForm();
    checkoutHistory = [];
    try { if (tg) tg.disableClosingConfirmation(); } catch (e) {}
    if (openCart) openCart.focus();
  }
  if (openCart) {
    openCart.addEventListener("click", function () {
      showCartSheet();
    });
  }
  var closeCart = document.getElementById("mini-close-cart");
  if (closeCart) {
    closeCart.addEventListener("click", function () {
      hideCartSheet();
    });
  }
  if (cartSheet) {
    cartSheet.addEventListener("click", function (e) {
      if (e.target === cartSheet) {
        hideCartSheet();
      }
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && cartSheet && !cartSheet.classList.contains("hidden")) {
      hideCartSheet();
    }
    if (
      e.key === "Tab" &&
      cartSheet &&
      !cartSheet.classList.contains("hidden")
    ) {
      var focusable = cartSheet.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      );
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", beginCheckout);
  }

  function beginCheckout() {
    if (!initData()) {
      showToast(t("sessionNotReady"));
      return;
    }
    if (state.pendingPayment) {
      showCartSheet();
      renderPendingPayment();
      return;
    }
    runCheckout({});
  }

  function setCartEnabled(on) {
    document.querySelectorAll(".add-btn").forEach(function (btn) {
      if (btn.getAttribute("data-has-variants") === "1") {
        var card = btn.closest(".card, .pdp-body");
        var select = card ? card.querySelector(".variant-select") : null;
        btn.disabled = !on || !select || !select.value;
      } else {
        btn.disabled = !on;
      }
    });
    if (openCart) openCart.disabled = !on;
    if (checkoutBtn) {
      checkoutBtn.disabled =
        !on || (state.items.length === 0 && !state.pendingPayment);
    }
    syncCartButtons();
  }

  function syncCartButtons() {
    var ready = !!initData();
    document.querySelectorAll(".add-btn").forEach(function (btn) {
      var productId = btn.getAttribute("data-product-id");
      var card = btn.closest(".card, .pdp-body");
      var select = card ? card.querySelector(".variant-select") : null;
      var hasVariants = btn.getAttribute("data-has-variants") === "1";
      var variantId = select && select.value ? select.value : null;
      var ownedOrder = productId && state.purchased[productId] ? state.purchased[productId] : "";
      var inCart = !!(productId && state.items.some(function (it) {
        if (it.product_id !== productId) return false;
        if (hasVariants) return variantId && it.product_variant_id === variantId;
        return true;
      }));
      if (card && card.classList.contains("card")) card.classList.toggle("owned", !!ownedOrder);
      if (ownedOrder && !window.__miniAppPhysicalShop) {
        btn.classList.add("purchased");
        btn.classList.remove("in-cart");
        btn.setAttribute("data-order-id", String(ownedOrder));
        btn.textContent = btn.closest("#mini-library") ? t("resendFiles") : t("purchased");
        btn.disabled = !ready;
        return;
      }
      btn.classList.remove("purchased");
      btn.removeAttribute("data-order-id");
      btn.classList.toggle("in-cart", inCart);
      btn.textContent = inCart ? t("inCart") : t("addToCart");
      if (inCart) {
        btn.disabled = !ready;
        return;
      }
      if (hasVariants) {
        btn.disabled = !ready || !variantId;
      } else {
        btn.disabled = !ready;
      }
    });
  }

  function loadLibrary() {
    if (!initData() || window.__miniAppPhysicalShop) return Promise.resolve();
    return fetch("/api/public/mini-app/library", { headers: apiHeaders() })
      .then(parseResponse)
      .then(function (res) {
        if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : "library_failed");
        state.purchased = {};
        (res.d.items || []).forEach(function (item) {
          if (item.productId) state.purchased[item.productId] = item.lastOrderId;
        });
        renderLibrary(res.d.items || [], res.d.botUrl || "");
        syncCartButtons();
      })
      .catch(function () {
        if (libraryEl) libraryEl.innerHTML = "<p class=\\"empty\\">" + escapeHtml(t("networkError")) + "</p>";
      });
  }

  function renderLibrary(items, botUrl) {
    if (!libraryEl) return;
    if (!items.length) {
      libraryEl.innerHTML = "<p class=\\"empty\\">" + escapeHtml(t("emptyLibrary")) + "</p>";
      return;
    }
    libraryEl.innerHTML = items.map(function (item) {
      var thumb = item.image
        ? "<img src=\\"" + escapeHtml(item.image) + "\\" alt=\\"\\" />"
        : "<div class=\\"thumb\\" style=\\"width:56px;height:56px;border-radius:10px;flex-shrink:0\\">📄</div>";
      var langs = (item.languages || []).map(function (code) {
        return "<span class=\\"lang-chip\\">" + escapeHtml(code) + "</span>";
      }).join("");
      var href = "/mini-app/product/" + encodeURIComponent(item.productId) + location.search;
      return "<article class=\\"library-card\\">" + thumb +
        "<div class=\\"cart-line-info\\"><a class=\\"card-link\\" href=\\"" + escapeHtml(href) + "\\"><div class=\\"card-name\\">" +
        escapeHtml(item.name) + "</div></a><div class=\\"card-langs\\">" + langs + "</div></div>" +
        "<button type=\\"button\\" class=\\"add-btn purchased\\" data-product-id=\\"" + escapeHtml(item.productId) +
        "\\" data-order-id=\\"" + Number(item.lastOrderId) + "\\">" + escapeHtml(t("resendFiles")) + "</button></article>";
    }).join("") + (botUrl
      ? "<p class=\\"checkout-hint\\" style=\\"padding:0 0.25rem\\"><a href=\\"" + escapeHtml(botUrl) +
        "\\" data-bot-link>" + escapeHtml(t("contactSupport")) + "</a></p>"
      : "");
    libraryEl.querySelectorAll("[data-bot-link]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (tg && tg.openTelegramLink) {
          event.preventDefault();
          tg.openTelegramLink(link.href);
        }
      });
    });
  }

  function boot() {
    if (initData()) {
      if (!cartReady) {
        cartReady = true;
        setCartEnabled(true);
        refreshCart().catch(function (error) {
          revealContext();
          if (!error || !error.auth) showToast(t("cartLoadFailed"));
        });
        loadOrders();
        loadLibrary();
      }
      maybeSmartSearch(location.pathname + location.search, catalogRequest);
      return;
    }
    bootAttempts += 1;
    if (bootAttempts >= 100) {
      showSessionError();
      return;
    }
    setTimeout(boot, 100);
  }

  bindTelegram();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && initData()) {
      refreshCart().catch(function () {});
      loadOrders();
      loadLibrary();
    }
  });
  if (ordersEl) {
    setInterval(function () {
      if (document.visibilityState === "visible") loadOrders();
    }, 10000);
  }
  var backLink = document.querySelector(".back-link");
  if (backLink && tg && tg.BackButton) {
    try {
      tg.BackButton.show();
      tg.BackButton.onClick(function () { backLink.click(); });
    } catch (e) {}
  }

  setCartEnabled(false);
  boot();
})();
`;
