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

  var cartBar = document.getElementById("mini-cart-bar");
  var cartSheet = document.getElementById("mini-cart-sheet");
  var cartLines = document.getElementById("mini-cart-lines");
  var cartDiscounts = document.getElementById("mini-cart-discounts");
  var pendingPaymentEl = document.getElementById("mini-pending-payment");
  var ordersEl = document.getElementById("mini-orders");
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
    if (!cartLines) return;
    if (!state.items.length) {
      cartLines.innerHTML = "<p class=\\"empty\\">" + t("cartEmpty") + "</p>";
      renderDiscounts();
      return;
    }
    cartLines.innerHTML = state.items.map(function (it) {
      return (
        "<div class=\\"cart-line\\">" +
        "<div class=\\"cart-line-info\\">" + escapeHtml(it.name) + " — " + escapeHtml(formatMoney(it.line_total, it.currency)) + "</div>" +
        "<div class=\\"qty-controls\\">" +
        "<button type=\\"button\\" class=\\"qty-btn\\" data-qty-minus=\\"" + it.id + "\\" aria-label=\\"-\\"" + (quantityBusy[it.id] ? " disabled" : "") + ">−</button>" +
        "<span>" + it.quantity + "</span>" +
        "<button type=\\"button\\" class=\\"qty-btn\\" data-qty-plus=\\"" + it.id + "\\" aria-label=\\"+\\"" + (quantityBusy[it.id] ? " disabled" : "") + ">+</button>" +
        "</div>" +
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
        renderOrders(res.d.orders || [], res.d.botUrl || "");
      })
      .catch(function (error) {
        if (!error || !error.auth) ordersEl.innerHTML = "<p class=\\"empty\\">" + escapeHtml(t("networkError")) + "</p>";
      });
  }

  function renderOrders(orders, botUrl) {
    if (!ordersEl) return;
    if (!orders.length) {
      ordersEl.innerHTML = "<p class=\\"empty\\">" + escapeHtml(t("noOrders")) + "</p>";
      return;
    }
    var statuses = I.orderStatus || {};
    ordersEl.innerHTML = orders.map(function (order) {
      var status = statuses[order.status] || order.status;
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
      if (order.status === "delivered" && order.fulfillmentKind !== "physical") {
        actions += "<button type=\\"button\\" data-order-resend=\\"" + Number(order.id) + "\\">" +
          escapeHtml(t("resendFiles")) + "</button>";
      }
      if (botUrl) {
        actions += "<a href=\\"" + escapeHtml(botUrl) + "\\" data-bot-link>" +
          escapeHtml(t("contactSupport")) + "</a>";
      }
      return "<article class=\\"order-card\\"><div class=\\"order-head\\"><span>#" +
        Number(order.displayNo) + "</span><span>" + escapeHtml(status) + "</span></div>" +
        "<div class=\\"order-meta\\">" + escapeHtml(date) + " · " +
        escapeHtml(formatMoney(Number(order.total), order.currency)) + "</div>" +
        (order.fulfillmentAt ? "<div class=\\"order-meta\\">" + escapeHtml(order.fulfillmentAt) + "</div>" : "") +
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
        "<input type=\\"date\\" id=\\"mini-fulfill-date\\" min=\\"" + (data.minDate || "") + "\\" />" +
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
      if (instEl) instEl.textContent = data.instructions || "";
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
      checkoutForm.innerHTML = html;
      try { if (tg) tg.disableClosingConfirmation(); } catch (e) {}
      setTimeout(function () { if (tg) tg.close(); }, 2500);
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
      fetch("/api/public/mini-app/orders", { headers: apiHeaders() })
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
          });
          refreshCart().catch(function () {});
          loadOrders();
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

  document.querySelectorAll(".add-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!initData()) {
        showToast(t("sessionNotReady"));
        return;
      }
      var card = btn.closest(".card, .pdp-body");
      var productId = btn.getAttribute("data-product-id");
      var select = card ? card.querySelector(".variant-select") : null;
      var variantId = select && select.value ? select.value : null;
      if (btn.getAttribute("data-has-variants") === "1" && !variantId) {
        showToast(t("chooseVariant"));
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
      var card = sel.closest(".card, .pdp-body");
      var btn = card ? card.querySelector(".add-btn") : null;
      if (btn) btn.disabled = !initData() || !sel.value;
      var headline = card ? card.querySelector(".pdp-price") : null;
      var option = sel.options && sel.selectedIndex >= 0
        ? sel.options[sel.selectedIndex]
        : null;
      if (headline && option && option.getAttribute("data-price")) {
        headline.textContent = option.getAttribute("data-price");
      }
    });
  });

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
      }
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
