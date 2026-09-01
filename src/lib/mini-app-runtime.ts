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

  function parseResponse(response) {
    if (response.status === 401 || response.status === 403) {
      cachedInitData = "";
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
    if (changed) {
      window.location.replace(url.pathname + "?" + url.searchParams.toString());
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
  var checkoutForm = document.getElementById("mini-checkout-form");
  var cartTotalEl = document.getElementById("mini-cart-total");
  var cartCountEl = document.getElementById("mini-cart-count");
  var checkoutBtn = document.getElementById("mini-checkout");
  var cartError = document.getElementById("mini-cart-error");
  var state = { items: [], total: 0, subtotal: 0, currency: "KZT", summary: null };
  var activeCategory = "";

  function renderCart() {
    var count = state.items.reduce(function (s, it) { return s + it.quantity; }, 0);
    if (cartCountEl) cartCountEl.textContent = String(count);
    if (cartTotalEl) cartTotalEl.textContent = formatMoney(state.total, state.currency);
    if (cartBar) cartBar.classList.toggle("hidden", count === 0);
    if (checkoutBtn) checkoutBtn.disabled = count === 0 || !initData();
    if (tg && tg.MainButton) {
      try {
        if (count > 0 && initData()) {
          tg.MainButton.setText(t("pay") + " · " + formatMoney(state.total, state.currency));
          tg.MainButton.show();
          if (!mainButtonBound) {
            mainButtonBound = true;
            tg.MainButton.onClick(function () { runCheckout({}); });
          }
        } else {
          tg.MainButton.hide();
        }
      } catch (e) {}
    }
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
        "<button type=\\"button\\" class=\\"qty-btn\\" data-qty-minus=\\"" + it.id + "\\" aria-label=\\"-\\">−</button>" +
        "<span>" + it.quantity + "</span>" +
        "<button type=\\"button\\" class=\\"qty-btn\\" data-qty-plus=\\"" + it.id + "\\" aria-label=\\"+\\">+</button>" +
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
        if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : "cart_failed");
        if (reloadForContext(res.d.country_code || "", res.d.locale || "")) return;
        applyCartPayload(res.d);
      });
  }

  function setQuantity(id, qty) {
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

  function clearCheckoutForm() {
    if (!checkoutForm) return;
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
        "<button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-open-pay\\">" + t("openPayment") + "</button>";
      checkoutForm.innerHTML = html;
      var openPay = document.getElementById("mini-open-pay");
      if (openPay) openPay.addEventListener("click", function () {
        if (data.paymentUrl && tg) tg.openLink(data.paymentUrl);
        else if (data.paymentUrl) window.open(data.paymentUrl, "_blank");
      });
      return;
    } else if (step === "manual_proof") {
      html = "<p><strong>" + escapeHtml(data.amountLabel || "") + "</strong></p>" +
        (data.qrImageUrl ? "<img class=\\"manual-qr\\" src=\\"" + escapeHtml(data.qrImageUrl) + "\\" alt=\\"QR\\" />" : "") +
        "<div class=\\"manual-instructions\\" id=\\"mini-manual-text\\"></div>" +
        "<p>" + t("sendProofInBot") + "</p>";
      checkoutForm.innerHTML = html;
      var instEl = document.getElementById("mini-manual-text");
      if (instEl) instEl.textContent = data.instructions || "";
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
        back.textContent = t("backToCatalog").replace("← ", "");
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

  function runCheckout(extraBody) {
    if (checkoutBusy) return Promise.resolve();
    checkoutBusy = true;
    try { if (tg) tg.enableClosingConfirmation(); } catch (e) {}
    if (cartError) cartError.textContent = "";
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
        if (checkoutBtn) checkoutBtn.disabled = state.items.length === 0;
        if (!res.ok) {
          var code = res.d && res.d.error;
          var msg = code === "in_progress"
            ? t("inProgress")
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
    checkoutBtn.addEventListener("click", function () {
      if (!initData()) {
        showToast(t("sessionNotReady"));
        return;
      }
      runCheckout({});
    });
  }

  var search = document.getElementById("mini-search");
  if (search) {
    search.addEventListener("input", function () { applyFilters(); });
  }

  function applyFilters() {
    var q = search ? search.value.trim().toLocaleLowerCase(window.__miniAppLocale || "ru") : "";
    document.querySelectorAll(".card").forEach(function (card) {
      var name = card.getAttribute("data-name") || "";
      var cats = (card.getAttribute("data-categories") || "").split(",").filter(Boolean);
      var catOk = !activeCategory || cats.length === 0 || cats.indexOf(activeCategory) !== -1;
      var qOk = !q || name.indexOf(q) !== -1;
      card.style.display = catOk && qOk ? "" : "none";
    });
  }

  document.querySelectorAll(".cat-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      activeCategory = chip.getAttribute("data-cat") || "";
      try { sessionStorage.setItem("ff_mini_category", activeCategory); } catch (e) {}
      document.querySelectorAll(".cat-chip").forEach(function (c) {
        c.classList.toggle("active", c === chip);
        c.setAttribute("aria-pressed", c === chip ? "true" : "false");
      });
      applyFilters();
    });
  });

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
    if (checkoutBtn) checkoutBtn.disabled = !on || state.items.length === 0;
  }

  function boot() {
    if (initData()) {
      if (!cartReady) {
        cartReady = true;
        setCartEnabled(true);
        refreshCart().catch(function () { showToast(t("cartLoadFailed")); });
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

  try {
    activeCategory = sessionStorage.getItem("ff_mini_category") || "";
    if (search) {
      search.value = sessionStorage.getItem("ff_mini_search") || "";
      search.addEventListener("input", function () {
        try { sessionStorage.setItem("ff_mini_search", search.value); } catch (e) {}
      });
    }
  } catch (e) {}
  document.querySelectorAll(".cat-chip").forEach(function (chip) {
    var selected = (chip.getAttribute("data-cat") || "") === activeCategory;
    chip.classList.toggle("active", selected);
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  applyFilters();

  bindTelegram();
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
