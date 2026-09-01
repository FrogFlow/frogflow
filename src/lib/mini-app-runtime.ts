/** Client-side Mini App runtime (served as /mini-app-runtime.js). */
export const MINI_APP_RUNTIME_JS = `(function () {
  var I = window.__miniAppI18n || {};
  var tg = null;
  var cachedInitData = "";
  var cartReady = false;

  function t(key) { return I[key] || key; }

  function bindTelegram() {
    var next = window.Telegram && window.Telegram.WebApp;
    if (!next) return null;
    if (tg !== next) {
      tg = next;
      try { tg.ready(); tg.expand(); } catch (e) {}
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

  function formatMoney(amount, currency) {
    var value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
    var cur = (currency || "").toUpperCase();
    return cur === "KZT" ? value + " ₸" : value + " " + currency;
  }

  var cartBar = document.getElementById("mini-cart-bar");
  var cartSheet = document.getElementById("mini-cart-sheet");
  var cartLines = document.getElementById("mini-cart-lines");
  var checkoutForm = document.getElementById("mini-checkout-form");
  var cartTotalEl = document.getElementById("mini-cart-total");
  var cartCountEl = document.getElementById("mini-cart-count");
  var checkoutBtn = document.getElementById("mini-checkout");
  var cartError = document.getElementById("mini-cart-error");
  var state = { items: [], total: 0, currency: "KZT" };
  var activeCategory = "";

  function renderCart() {
    var count = state.items.reduce(function (s, it) { return s + it.quantity; }, 0);
    if (cartCountEl) cartCountEl.textContent = String(count);
    if (cartTotalEl) cartTotalEl.textContent = formatMoney(state.total, state.currency);
    if (cartBar) cartBar.classList.toggle("hidden", count === 0);
    if (checkoutBtn) checkoutBtn.disabled = count === 0 || !initData();
    if (!cartLines) return;
    if (!state.items.length) {
      cartLines.innerHTML = "<p class=\\"empty\\">" + t("cartEmpty") + "</p>";
      return;
    }
    cartLines.innerHTML = state.items.map(function (it) {
      return (
        "<div class=\\"cart-line\\">" +
        "<div class=\\"cart-line-info\\">" + it.name + " — " + formatMoney(it.line_total, it.currency) + "</div>" +
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

  function setQuantity(id, qty) {
    return fetch("/api/public/mini-app/cart", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ action: "set_quantity", cart_item_id: id, quantity: qty }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          if (res.d && res.d.error === "out_of_stock") showToast(t("outOfStock"));
          else if (res.d && res.d.error === "digital_limit") showToast(t("digitalLimit"));
          return;
        }
        state.items = res.d.items || [];
        state.total = (res.d.items || []).reduce(function (s, it) { return s + it.line_total; }, 0);
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
          if (code === "mixed_cart") showToast(t("mixedCart"));
          else if (code === "out_of_stock") showToast(t("outOfStock"));
          else if (code === "digital_limit") showToast(t("digitalLimit"));
          else showToast(t("couldNotAdd"));
          return;
        }
        state.items = res.d.items || [];
        state.total = (res.d.items || []).reduce(function (s, it) { return s + it.line_total; }, 0);
        state.currency = state.items[0] ? state.items[0].currency : "KZT";
        renderCart();
        showToast(t("addedToCart"));
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

  function clearCheckoutForm() {
    if (!checkoutForm) return;
    checkoutForm.innerHTML = "";
    checkoutForm.classList.add("hidden");
  }

  function showCheckoutStep(data) {
    if (!checkoutForm) return;
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
          return "<option value=\\"" + c.code + "\\">" + c.name + "</option>";
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
          return "<option value=\\"" + z.id + "\\">" + z.name + (z.fee ? " — " + z.feeLabel : "") + "</option>";
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
      html = "<p><strong>" + t("choosePayment") + "</strong></p><p>" + (data.amountLabel || "") + "</p>" +
        "<div class=\\"checkout-actions\\">" +
        "<button type=\\"button\\" class=\\"primary-btn\\" data-pay=\\"robokassa\\">" + t("payRobokassa") + "</button>" +
        "<button type=\\"button\\" class=\\"btn-secondary\\" data-pay=\\"manual\\">" + t("payManual") + "</button>" +
        "</div>";
    } else if (step === "robokassa") {
      html = "<p><strong>" + (data.amountLabel || "") + "</strong></p>" +
        "<button type=\\"button\\" class=\\"primary-btn\\" id=\\"mini-open-pay\\">" + t("openPayment") + "</button>";
      checkoutForm.innerHTML = html;
      var openPay = document.getElementById("mini-open-pay");
      if (openPay) openPay.addEventListener("click", function () {
        if (data.paymentUrl && tg) tg.openLink(data.paymentUrl);
        else if (data.paymentUrl) window.open(data.paymentUrl, "_blank");
        setTimeout(function () { if (tg) tg.close(); }, 500);
      });
      return;
    } else if (step === "manual_proof") {
      html = "<p><strong>" + (data.amountLabel || "") + "</strong></p>" +
        (data.qrImageUrl ? "<img class=\\"manual-qr\\" src=\\"" + data.qrImageUrl + "\\" alt=\\"QR\\" />" : "") +
        "<div class=\\"manual-instructions\\" id=\\"mini-manual-text\\"></div>" +
        "<p>" + t("sendProofInBot") + "</p>";
      checkoutForm.innerHTML = html;
      var instEl = document.getElementById("mini-manual-text");
      if (instEl) instEl.textContent = data.instructions || "";
      return;
    } else if (step === "completed") {
      html = "<p><strong>" + (data.message || t("orderComplete")) + "</strong></p>";
      checkoutForm.innerHTML = html;
      setTimeout(function () { if (tg) tg.close(); }, 2500);
      return;
    }
    checkoutForm.innerHTML = html;
    var submit = document.getElementById("mini-step-submit");
    if (submit) {
      submit.addEventListener("click", function () {
        var body = {};
        if (step === "need_contact") {
          var phone = document.getElementById("mini-phone");
          body.contact_phone = phone && phone.value ? phone.value.trim() : "";
        } else if (step === "need_country") {
          var country = document.getElementById("mini-country");
          body.country_code = country && country.value ? country.value : "";
        } else if (step === "need_fulfillment_date") {
          var dt = document.getElementById("mini-fulfill-date");
          body.fulfillment_date = dt && dt.value ? dt.value : "";
        } else if (step === "need_delivery_zone") {
          var zone = document.getElementById("mini-zone");
          body.delivery_zone_id = zone && zone.value ? zone.value : "";
        } else if (step === "need_address") {
          var addr = document.getElementById("mini-address");
          body.fulfillment_address = addr && addr.value ? addr.value.trim() : "";
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
    if (cartError) cartError.textContent = "";
    if (checkoutBtn) checkoutBtn.disabled = true;
    var body = extraBody || {};
    return fetch("/api/public/mini-app/checkout", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (checkoutBtn) checkoutBtn.disabled = state.items.length === 0;
        if (!res.ok) {
          if (cartError) cartError.textContent = t("checkoutFailed");
          return;
        }
        if (res.d.step) {
          showCheckoutStep(res.d);
          if (cartSheet) cartSheet.classList.remove("hidden");
          return;
        }
        if (res.d.paymentUrl) {
          showCheckoutStep({ step: "robokassa", paymentUrl: res.d.paymentUrl, amountLabel: res.d.amountLabel });
        }
      })
      .catch(function () {
        if (cartError) cartError.textContent = t("networkError");
        if (checkoutBtn) checkoutBtn.disabled = false;
      });
  }

  document.querySelectorAll(".add-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!initData()) {
        showToast(t("sessionNotReady"));
        return;
      }
      var card = btn.closest(".card");
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
      clearCheckoutForm();
    });
  }
  if (cartSheet) {
    cartSheet.addEventListener("click", function (e) {
      if (e.target === cartSheet) {
        cartSheet.classList.add("hidden");
        clearCheckoutForm();
      }
    });
  }

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
    var q = search ? search.value.trim().toLowerCase() : "";
    document.querySelectorAll(".card").forEach(function (card) {
      var name = card.getAttribute("data-name") || "";
      var cats = (card.getAttribute("data-categories") || "").split(",").filter(Boolean);
      var catOk = !activeCategory || cats.indexOf(activeCategory) !== -1;
      var qOk = !q || name.indexOf(q) !== -1;
      card.style.display = catOk && qOk ? "" : "none";
    });
  }

  document.querySelectorAll(".cat-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      activeCategory = chip.getAttribute("data-cat") || "";
      document.querySelectorAll(".cat-chip").forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });
      applyFilters();
    });
  });

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
        refreshCart().catch(function () { showToast(t("cartLoadFailed")); });
      }
      return;
    }
    setTimeout(boot, 100);
  }

  setCartEnabled(false);
  boot();
})();
`;
