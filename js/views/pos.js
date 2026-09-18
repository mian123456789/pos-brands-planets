/* New Sale / POS: product grid, cart, automatic promotions, hold/resume, checkout. */
Views.pos = (() => {
  const CART_KEY = "bp-cart";
  const PAGE = 60;
  const CHIPS = [
    { id: "ALL", label: "All" },
    { id: "DEALS", label: "Deals", deals: true },
    { id: "MEN", label: "Men", dept: "MEN'S" },
    { id: "WOMEN", label: "Women", dept: "WOMEN" },
    { id: "KIDS", label: "Kids", dept: "KID'S" },
    { id: "T-SHIRTS", label: "T-Shirts", type: "t-shirts" },
    { id: "SHIRTS", label: "Shirts", type: "shirts" },
    { id: "JEANS", label: "Jeans", type: "jeans" },
    { id: "TROUSERS", label: "Trousers", type: "trousers" },
    { id: "TRACKSUITS", label: "Tracksuits", type: "tracksuits" },
    { id: "WINTER", label: "Winter", season: "winter" },
    { id: "SUMMER", label: "Summer", season: "summer" }
  ];

  let root = null;
  let filter = "ALL";
  let query = "";
  let limit = PAGE;
  let lastFreeCount = 0;
  let cart = loadCart();

  function loadCart() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(CART_KEY) || "null"); } catch { return null; } })();
    return { lines: [], customer: null, saleMode: "In Store", ...(saved || {}) };
  }
  function persistCart() {
    UI.safeSet(CART_KEY, JSON.stringify(cart));
  }
  const itemCount = () => cart.lines.reduce((total, line) => total + line.qty, 0);

  /* ------------------------------------------------------ catalogue */
  function livePromos() {
    return BPPromotions.livePromotions(state.promotions, { outletId: currentOutlet().id });
  }
  function productPromo(product, promos) {
    return promos.find(promo => BPPromotions.isEligible(promo, { productId: product.id, category: product.category, type: product.type, season: product.season }));
  }
  function searchText(product) {
    if (!caches.posSearch) caches.posSearch = new Map();
    let text = caches.posSearch.get(product.id);
    if (!text) {
      text = [
        product.name, product.sku, product.barcode, product.category, deptLabel(product.category), product.type, product.season,
        ...(product.variants || []).flatMap(variant => [variant.sku, variant.barcode, variant.color, variant.size])
      ].filter(Boolean).join(" ").toLowerCase();
      caches.posSearch.set(product.id, text);
    }
    return text;
  }
  function extraTypeChips() {
    const known = new Set(CHIPS.filter(chip => chip.type).map(chip => chip.type));
    const types = new Set(state.products.map(product => String(product.type || "").trim()).filter(type => type && !known.has(type.toLowerCase())));
    return [...types].sort().map(type => ({ id: `T:${type.toLowerCase()}`, label: type, type: type.toLowerCase() }));
  }
  function filteredProducts() {
    const chip = [...CHIPS, ...extraTypeChips()].find(item => item.id === filter) || CHIPS[0];
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const promos = chip.deals ? livePromos() : null;
    return state.products.filter(product => {
      if (product.active === false) return false;
      if (chip.dept && product.category !== chip.dept) return false;
      if (chip.type && String(product.type || "").toLowerCase() !== chip.type) return false;
      if (chip.season && String(product.season || "").toLowerCase() !== chip.season) return false;
      if (promos && !productPromo(product, promos)) return false;
      if (tokens.length) {
        const text = searchText(product);
        if (!tokens.every(token => text.includes(token))) return false;
      }
      return true;
    });
  }

  function productCard(product, promos) {
    const stock = productStock(product);
    const status = BPStock.stockStatus(stock, lowStockLevel(product));
    const promo = productPromo(product, promos);
    const sizes = [...new Set((product.variants || []).map(variant => variant.size).filter(Boolean))];
    const colors = [...new Set((product.variants || []).map(variant => variant.color).filter(Boolean))];
    const stockBadge = status === "out"
      ? `<span class="badge bad p-stock">Out of stock</span>`
      : `<span class="badge ${status === "low" ? "warn" : "good"} p-stock"><span class="dot"></span>${num(stock)} in stock</span>`;
    return `<button class="p-card ${status === "out" ? "out" : ""}" data-pid="${esc(product.id)}" type="button">
      <div class="p-media">
        ${product.image ? `<img src="${product.image}" alt="" loading="lazy">` : `<span class="p-initial">${esc(initials(product.name))}</span>`}
        ${promo ? `<span class="promo-badge">${icon("promotions", 11)} ${esc(BPPromotions.promoLabel(promo))}</span>` : ""}
        ${stockBadge}
      </div>
      <div class="p-info">
        <div class="p-name">${esc(product.name)}</div>
        <div class="p-meta">${esc([product.sku, deptLabel(product.category), product.type].filter(Boolean).join(" · "))}</div>
        ${sizes.length || colors.length ? `<div class="p-variants">${esc([sizes.join(" "), colors.join(", ")].filter(Boolean).join(" · "))}</div>` : ""}
        <div class="p-price">${money(product.price)}</div>
      </div>
    </button>`;
  }

  function renderChips() {
    const chips = [...CHIPS, ...extraTypeChips()];
    root.querySelector("#posChips").innerHTML = chips.map(chip =>
      `<button class="chip ${chip.id === filter ? "active" : ""}" data-chip="${esc(chip.id)}" type="button">${chip.deals ? icon("promotions", 15) : ""}${esc(chip.label)}</button>`
    ).join("");
  }

  function renderGrid() {
    if (!root) return;
    const grid = root.querySelector("#posGrid");
    const products = filteredProducts();
    const promos = livePromos();
    if (!state.products.length) {
      grid.innerHTML = UI.empty("products", "No products yet", can("products") ? "Add your first product to start selling." : "Ask a manager to add products.", can("products") ? `<button class="btn btn-primary" onclick="Shell.go('products')">${icon("plus", 18)} Add product</button>` : "");
      return;
    }
    if (!products.length) {
      grid.innerHTML = UI.empty("search", "No matching products", "Try another name, SKU, barcode or category.");
      return;
    }
    grid.innerHTML = products.slice(0, limit).map(product => productCard(product, promos)).join("") +
      (products.length > limit ? `<button class="btn btn-soft show-more" data-more type="button">Show ${Math.min(PAGE, products.length - limit)} more of ${products.length - limit}</button>` : "");
  }

  /* ----------------------------------------------------------- cart */
  function enrich(line) {
    const product = productById(line.productId);
    if (!product) return null;
    const variant = (product.variants || []).find(item => item.id === line.variantId) || product.variants?.[0] || { id: BPStock.DEFAULT_VARIANT_ID };
    return {
      key: line.key,
      productId: product.id,
      variantId: variant.id,
      qty: line.qty,
      product,
      variant,
      name: product.name,
      price: Number(product.price || 0),
      sku: variant.sku || product.sku || "",
      barcode: variant.barcode || product.barcode || "",
      size: variant.size || "",
      color: variant.color || "",
      category: product.category || "",
      type: product.type || "",
      season: product.season || "",
      stock: variantStock(product.id, variant.id)
    };
  }
  function cartPricing() {
    cart.lines = cart.lines.filter(line => productById(line.productId));
    const lines = cart.lines.map(enrich).filter(Boolean);
    const result = BPPromotions.applyPromotions(lines, state.promotions, { outletId: currentOutlet().id });
    return { lines, result };
  }

  function customerHtml() {
    const customer = cart.customer;
    if (customer) {
      const stats = customerStats(customer.phone);
      return `<div class="customer-chip">
        <div class="avatar navy">${esc(initials(customer.name))}</div>
        <div class="grow"><strong>${esc(customer.name)}</strong><small>${esc(customer.phone || "")}${stats.orders ? ` · ${stats.orders} orders · ${money(stats.spent)}${stats.last ? ` · last ${fmtDate(stats.last)}` : ""}` : " · New customer"}</small></div>
        <button class="icon-btn sm" data-cust="walkin" title="Switch to walk-in" type="button">${icon("x", 18)}</button>
      </div>`;
    }
    return `<div class="customer-chip">
        <div class="avatar">${icon("user", 18)}</div>
        <div class="grow"><strong>Walk-in Customer</strong><small>Search by phone or name to attach a customer</small></div>
        <button class="btn btn-soft btn-sm" data-cust="add" type="button">${icon("userPlus", 16)} Quick add</button>
      </div>
      <div class="customer-search input-icon">
        ${icon("search", 18)}
        <input id="posCustomerSearch" class="input" placeholder="Customer phone or name (F6)" autocomplete="off" inputmode="search">
        <div id="posCustomerResults" class="customer-results hidden"></div>
      </div>`;
  }

  function lineHtml(line, freeQty) {
    const sizes = [...new Set(line.product.variants.map(variant => variant.size).filter(Boolean))];
    const colors = [...new Set(line.product.variants.filter(variant => !line.size || variant.size === line.size).map(variant => variant.color).filter(Boolean))];
    const gross = line.price * line.qty;
    const net = line.price * (line.qty - freeQty);
    return `<div class="cart-line ${freeQty ? "has-free" : ""}" data-key="${esc(line.key)}">
      ${line.product.image ? `<img class="thumb cl-thumb" src="${line.product.image}" alt="">` : `<div class="thumb cl-thumb">${esc(initials(line.name))}</div>`}
      <div class="cl-info">
        <div class="cl-name">${esc(line.name)}</div>
        <div class="cl-sub">${money(line.price)} each · ${num(line.stock)} left${line.sku ? ` · ${esc(line.sku)}` : ""}</div>
      </div>
      <div class="cl-total">${freeQty ? `<s>${money(gross)}</s>` : ""}${money(net)}${freeQty ? `<div><span class="free-tag">FREE x${freeQty}</span></div>` : ""}</div>
      <div class="cl-controls">
        <div class="cl-variants">
          ${sizes.length ? `<select data-field="size" aria-label="Size">${sizes.map(size => `<option ${size === line.size ? "selected" : ""}>${esc(size)}</option>`).join("")}</select>` : ""}
          ${colors.length ? `<select data-field="color" aria-label="Color">${colors.map(color => `<option ${color === line.color ? "selected" : ""}>${esc(color)}</option>`).join("")}</select>` : ""}
        </div>
        <div class="row" style="gap:6px">
          <div class="qty">
            <button data-act="dec" type="button" aria-label="Decrease quantity">${icon("minus", 16)}</button>
            <strong>${line.qty}</strong>
            <button data-act="inc" type="button" aria-label="Increase quantity">${icon("plus", 16)}</button>
          </div>
          <button class="icon-btn sm danger" data-act="remove" type="button" aria-label="Remove product">${icon("trash", 17)}</button>
        </div>
      </div>
    </div>`;
  }

  function promoBannerHtml(result) {
    const unlocked = result.applied.length > 0;
    const hint = result.hints.find(item => item.kind === "moreItems");
    const minHint = result.hints.find(item => item.kind === "minPurchase");
    let html = "";
    if (unlocked) {
      const promo = result.applied[0];
      html += `<div class="promo-banner unlocked" id="promoBanner">
        <span class="pb-icon">🎉</span>
        <div><strong>DEAL UNLOCKED</strong><small>${esc(result.applied.map(item => `${BPPromotions.promoLabel(item)} applied`).join(" · "))} — you save ${money(result.discount)}</small></div>
      </div>`;
      if (hint) html += `<div class="promo-banner"><span class="pb-icon">🎁</span><div><small>Add ${hint.needed} more eligible item${hint.needed > 1 ? "s" : ""} to unlock another FREE product.</small></div></div>`;
      void promo;
    } else if (hint) {
      html = `<div class="promo-banner" id="promoBanner"><span class="pb-icon">🎁</span><div><strong>${esc(hint.name || "Promotion")}</strong><small>Add ${hint.needed} more eligible item${hint.needed > 1 ? "s" : ""} to unlock your FREE product.</small></div></div>`;
    } else if (minHint) {
      html = `<div class="promo-banner" id="promoBanner"><span class="pb-icon">🎁</span><div><strong>${esc(minHint.name || "Promotion")}</strong><small>Spend ${money(minHint.needed)} more to unlock this deal.</small></div></div>`;
    }
    return html;
  }

  function renderCart() {
    if (!root) return;
    const { lines, result } = cartPricing();
    const count = itemCount();
    root.querySelector("#posCustomer").innerHTML = customerHtml();
    bindCustomerSearch();
    root.querySelector("#posCount").textContent = count;
    root.querySelector("#posLines").innerHTML = lines.length
      ? lines.map(line => lineHtml(line, result.lineFree[line.key] || 0)).join("")
      : `<div class="cart-empty">${icon("barcode", 40)}<strong>Scan or tap a product</strong><span>Items you add appear here.</span></div>`;
    root.querySelector("#posPromo").innerHTML = promoBannerHtml(result);
    const held = state.heldSales.length;
    root.querySelector("#posSummary").innerHTML = `
      <div class="sum-row"><span>Subtotal (${count} item${count === 1 ? "" : "s"})</span><strong>${money(result.subtotal)}</strong></div>
      ${result.applied.map(promo => `<div class="sum-row promo"><span>🎁 ${esc(BPPromotions.promoLabel(promo))}${promo.name ? ` · ${esc(promo.name)}` : ""}</span><strong>-${money(promo.saving)}</strong></div>`).join("")}
      <div class="sum-row total"><span>Final Total</span><strong id="posTotal">${money(result.total)}</strong></div>
      <div class="cart-actions">
        <button class="btn btn-soft" data-pos="hold" type="button" ${lines.length ? "" : "disabled"}>${icon("pause", 16)} Hold <kbd>F8</kbd></button>
        <button class="btn btn-soft" data-pos="held" type="button">${icon("play", 16)} Resume${held ? ` (${held})` : ""} <kbd>F9</kbd></button>
        <button class="btn btn-soft" data-pos="clear" type="button" ${lines.length ? "" : "disabled"}>${icon("trash", 16)} Clear</button>
      </div>
      <button class="btn btn-accent checkout-btn" data-pos="checkout" type="button" ${lines.length ? "" : "disabled"}>
        <span class="row">${icon("check", 20)} Checkout <kbd>F10</kbd></span><span class="amt">${money(result.total)}</span>
      </button>`;
    const bar = root.querySelector("#posMobileBar");
    bar.innerHTML = `<span>${icon("pos", 20)} ${count} item${count === 1 ? "" : "s"} · ${money(result.total)}</span><span class="btn btn-accent">View cart</span>`;
    bar.classList.toggle("hidden", !count);

    const freeCount = result.applied.reduce((total, promo) => total + promo.freeCount, 0);
    if (freeCount > lastFreeCount) {
      UI.celebrate(root.querySelector("#promoBanner"));
      toast("Promotion Applied 🎁", "promo");
    }
    lastFreeCount = freeCount;
  }

  function rerender() {
    renderGrid();
    renderCart();
  }

  function flashCard(productId) {
    const card = root?.querySelector(`.p-card[data-pid="${CSS.escape(productId)}"]`);
    if (!card) return;
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }

  function addVariant(productId, variantId, qty = 1) {
    const product = productById(productId);
    if (!product) return false;
    const key = `${productId}::${variantId}`;
    const existing = cart.lines.find(line => line.key === key);
    const stock = variantStock(productId, variantId);
    const wanted = (existing?.qty || 0) + qty;
    if (wanted > stock) {
      toast(stock <= 0 ? `${product.name} is out of stock.` : `Only ${stock} of ${product.name} in stock.`, "error");
      return false;
    }
    if (existing) existing.qty = wanted;
    else cart.lines.push({ key, productId, variantId, qty });
    persistCart();
    renderCart();
    flashCard(productId);
    toast("Product Added ✓", "success", 1200);
    return true;
  }
  function addProduct(productId) {
    const product = productById(productId);
    if (!product) return;
    const variant = (product.variants || []).find(item => {
      const inCart = cart.lines.find(line => line.key === `${productId}::${item.id}`)?.qty || 0;
      return variantStock(productId, item.id) - inCart > 0;
    });
    if (!variant) return toast(`${product.name} is out of stock.`, "error");
    addVariant(productId, variant.id);
  }
  function changeQty(key, delta) {
    const line = cart.lines.find(item => item.key === key);
    if (!line) return;
    if (delta > 0) {
      const stock = variantStock(line.productId, line.variantId);
      if (line.qty + delta > stock) return toast(`Only ${stock} in stock for this size/colour.`, "error");
    }
    line.qty = Math.max(1, line.qty + delta);
    persistCart();
    renderCart();
  }
  function removeLine(key) {
    cart.lines = cart.lines.filter(line => line.key !== key);
    persistCart();
    renderCart();
  }
  function changeVariant(key, field, value) {
    const line = cart.lines.find(item => item.key === key);
    const product = line && productById(line.productId);
    if (!product) return;
    const current = product.variants.find(variant => variant.id === line.variantId) || {};
    const want = { size: current.size || "", color: current.color || "", [field]: value };
    const match = product.variants.find(variant => (variant.size || "") === want.size && (variant.color || "") === want.color)
      || product.variants.find(variant => (variant[field] || "") === value);
    if (!match || match.id === line.variantId) return renderCart();
    const stock = variantStock(product.id, match.id);
    const newKey = `${product.id}::${match.id}`;
    const target = cart.lines.find(item => item.key === newKey);
    const qty = line.qty + (target?.qty || 0);
    if (qty > stock) {
      toast(stock <= 0 ? `${BPStock.variantLabel(match)} is out of stock.` : `Only ${stock} in stock for ${BPStock.variantLabel(match)}.`, "error");
      return renderCart();
    }
    if (target) {
      target.qty = qty;
      cart.lines = cart.lines.filter(item => item !== line);
    } else {
      line.key = newKey;
      line.variantId = match.id;
    }
    persistCart();
    renderCart();
    toast(`Changed to ${BPStock.variantLabel(match)} ✓`, "success", 1200);
  }

  function resetCart() {
    cart = { lines: [], customer: null, saleMode: "In Store" };
    lastFreeCount = 0;
    persistCart();
  }
  async function clearCart() {
    if (!cart.lines.length) return;
    const ok = await UI.confirm({ title: "Clear this sale?", message: `${itemCount()} item(s) will be removed from the cart.`, confirmText: "Clear cart" });
    if (!ok) return;
    resetCart();
    renderCart();
    toast("Cart cleared", "info");
  }

  /* ------------------------------------------------------ customers */
  function bindCustomerSearch() {
    const input = root.querySelector("#posCustomerSearch");
    if (!input) return;
    const results = root.querySelector("#posCustomerResults");
    const show = () => {
      const q = input.value.trim();
      if (!q) { results.classList.add("hidden"); return; }
      const matches = findCustomers(q);
      const digits = q.replace(/\D/g, "");
      results.innerHTML = matches.map(customer => {
        const stats = customerStats(customer.phone);
        return `<button class="search-item" data-pick="${esc(customer.id)}" type="button"><div class="avatar navy" style="width:34px;height:34px">${esc(initials(customer.name))}</div><div><strong>${esc(customer.name)}</strong><small>${esc(customer.phone)} · ${stats.orders} orders · ${money(stats.spent)}</small></div></button>`;
      }).join("") + `<button class="search-item" data-pick="__new" type="button"><div class="avatar" style="width:34px;height:34px">${icon("plus", 16)}</div><div><strong>Add new customer</strong><small>${digits.length >= 7 ? `Phone ${esc(digits)}` : `Name "${esc(q)}"`}</small></div></button>`;
      results.classList.remove("hidden");
    };
    input.addEventListener("input", debounce(show, 100));
    input.addEventListener("focus", show);
    input.addEventListener("blur", () => setTimeout(() => results.classList.add("hidden"), 180));
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = results.querySelector("[data-pick]");
        if (first) first.click();
      }
      if (event.key === "Escape") { input.value = ""; results.classList.add("hidden"); input.blur(); }
    });
    results.addEventListener("mousedown", event => event.preventDefault());
    results.addEventListener("click", event => {
      const pick = event.target.closest("[data-pick]")?.dataset.pick;
      if (!pick) return;
      if (pick === "__new") {
        const q = input.value.trim();
        const digits = q.replace(/\D/g, "");
        return quickAddCustomer(digits.length >= 7 ? { phone: digits } : { name: q });
      }
      const customer = allCustomers().find(item => item.id === pick);
      if (customer) selectCustomer(customer);
    });
  }
  function selectCustomer(customer) {
    cart.customer = { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email || "" };
    persistCart();
    renderCart();
    toast(`Customer: ${customer.name}`, "info", 1400);
    focusSearch();
  }
  function validPhone(phone) {
    const digits = phoneKey(phone);
    return /^0\d{10}$/.test(digits) || /^92\d{10}$/.test(digits);
  }
  function quickAddCustomer(prefill = {}) {
    const modal = UI.openModal({
      title: "Quick Add Customer",
      subtitle: "Saved for faster checkout and purchase history",
      size: "sm",
      body: `<form id="custForm" class="form-section">
        <div class="field"><label for="cName">Name</label><input id="cName" value="${esc(prefill.name || "")}" autocomplete="off" required ${prefill.name ? "" : "autofocus"}></div>
        <div class="field"><label for="cPhone">Phone</label><input id="cPhone" value="${esc(prefill.phone || "")}" inputmode="tel" placeholder="03XXXXXXXXX" autocomplete="off" ${prefill.name ? "autofocus" : ""}></div>
        <div class="field"><label for="cEmail">Email <span class="faint">(optional)</span></label><input id="cEmail" type="email" autocomplete="off"></div>
        <div id="custError" class="form-error hidden"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="custForm" type="submit">${icon("check", 18)} Save customer</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#custForm").addEventListener("submit", event => {
      event.preventDefault();
      const name = modal.el.querySelector("#cName").value.trim();
      const phone = phoneKey(modal.el.querySelector("#cPhone").value);
      const email = modal.el.querySelector("#cEmail").value.trim();
      const error = modal.el.querySelector("#custError");
      const fail = text => { error.textContent = text; error.classList.remove("hidden"); };
      if (!name) return fail("Enter the customer's name.");
      if (!validPhone(phone)) return fail("Enter a valid phone number, e.g. 03001234567.");
      const existing = state.customers.find(customer => phoneKey(customer.phone) === phone);
      if (existing) {
        modal.close();
        selectCustomer(existing);
        return toast("Customer already exists — selected.", "info");
      }
      const customer = { id: uid("c"), name, phone, email, createdAt: new Date().toISOString(), createdBy: currentUser().username };
      state.customers.push(customer);
      audit("customer.create", "customer", customer.id, `Added customer ${name} (${phone})`);
      save();
      modal.close();
      selectCustomer({ ...customer, saved: true });
      toast("Customer added ✓");
    });
  }

  /* ------------------------------------------------------ hold/resume */
  function holdCurrent({ silent = false, note = "" } = {}) {
    if (!cart.lines.length) {
      if (!silent) toast("Nothing to hold — the cart is empty.", "warn");
      return false;
    }
    const { result } = cartPricing();
    state.heldSales.push({
      id: uid("h"),
      date: new Date().toISOString(),
      cashier: currentUser().username,
      cashierId: currentUser().id,
      outletId: currentOutlet().id,
      customer: cart.customer,
      saleMode: cart.saleMode,
      lines: cart.lines,
      itemCount: itemCount(),
      total: result.total,
      note
    });
    save();
    resetCart();
    renderCart();
    if (!silent) toast("Sale Held ✓");
    return true;
  }
  function openHeld() {
    const held = state.heldSales.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const modal = UI.openModal({
      title: "Held Sales",
      subtitle: "Resume a sale to continue billing",
      size: "md",
      body: held.length ? `<div class="held-list">${held.map(item => `<div class="held-item">
          <div>
            <strong>${esc(item.customer?.name || "Walk-in Customer")}</strong>
            <small>${item.itemCount} item${item.itemCount === 1 ? "" : "s"} · ${money(item.total)} · ${fmtTime(item.date)}, ${fmtDate(item.date)} · by ${esc(item.cashier)}${item.note ? ` · ${esc(item.note)}` : ""}</small>
          </div>
          <div class="row">
            <button class="icon-btn danger" data-del="${esc(item.id)}" aria-label="Delete held sale" type="button">${icon("trash", 18)}</button>
            <button class="btn btn-primary" data-resume="${esc(item.id)}" type="button">${icon("play", 16)} Resume</button>
          </div>
        </div>`).join("")}</div>`
        : UI.empty("pause", "No held sales", "Press F8 during a sale to hold it for later.")
    });
    modal.el.addEventListener("click", async event => {
      const resumeId = event.target.closest("[data-resume]")?.dataset.resume;
      const deleteId = event.target.closest("[data-del]")?.dataset.del;
      if (resumeId) {
        modal.close();
        resume(resumeId);
      }
      if (deleteId) {
        const ok = await UI.confirm({ title: "Delete held sale?", message: "The held items will be discarded. Stock is not affected.", confirmText: "Delete" });
        if (!ok) return;
        markDeleted("heldSales", deleteId);
        state.heldSales = state.heldSales.filter(item => item.id !== deleteId);
        save();
        modal.close();
        openHeld();
        renderCart();
        toast("Held sale deleted", "info");
      }
    });
    setTimeout(() => modal.el.querySelector("[data-resume]")?.focus(), 50);
  }
  async function resume(id) {
    const held = state.heldSales.find(item => item.id === id);
    if (!held) return;
    if (cart.lines.length) {
      holdCurrent({ silent: true });
      toast("Current sale held so you can resume the other one.", "info");
    }
    const lines = (held.lines || []).filter(line => productById(line.productId));
    cart = { lines, customer: held.customer || null, saleMode: held.saleMode || "In Store" };
    markDeleted("heldSales", id);
    state.heldSales = state.heldSales.filter(item => item.id !== id);
    save();
    persistCart();
    lastFreeCount = 0;
    if (Shell.current() !== "pos") Shell.go("pos");
    else renderCart();
    const short = lines.filter(line => line.qty > variantStock(line.productId, line.variantId));
    toast("Sale Resumed ✓");
    if (short.length) toast(`${short.length} item(s) no longer have enough stock — check quantities.`, "warn");
  }
  function newSale() {
    if (cart.lines.length) {
      holdCurrent({ silent: true });
      toast("Previous sale held (F9 to resume). New sale started.", "info");
    } else {
      resetCart();
    }
    if (Shell.current() !== "pos") Shell.go("pos");
    else { renderCart(); focusSearch(); }
  }

  /* -------------------------------------------------------- checkout */
  function checkout() {
    const { lines, result } = cartPricing();
    if (!lines.length) return toast("Add products to the cart first.", "warn");
    const short = lines.find(line => line.qty > line.stock);
    if (short) return toast(`${short.name} (${BPStock.variantLabel(short.variant) || "item"}) has only ${short.stock} in stock.`, "error");
    const total = result.total;
    const customer = cart.customer;
    let method = "Cash";
    let payLater = false;
    let completing = false;
    let splitRows = [{ method: "Cash", amount: "", ref: "" }, { method: "Bank Transfer", amount: "", ref: "" }];
    const roundUp = step => Math.ceil(total / step) * step;
    const quick = [...new Set([total, roundUp(500), roundUp(1000), roundUp(5000)])].slice(0, 4);

    const modal = UI.openModal({
      title: "Checkout",
      subtitle: `${itemCount()} item(s) · ${esc(customer?.name || "Walk-in Customer")}`,
      size: "lg",
      body: `<div class="checkout">
        <div class="stack">
          <div class="due-card">
            <small>Amount Due</small>
            <div class="due-amount">${money(total)}</div>
            <div class="due-lines">
              <div><span>Subtotal</span><span>${money(result.subtotal)}</span></div>
              ${result.applied.map(promo => `<div class="promo"><span>🎁 ${esc(BPPromotions.promoLabel(promo))}</span><span>-${money(promo.saving)}</span></div>`).join("")}
              <div><span>Customer</span><span>${esc(customer?.name || "Walk-in")}</span></div>
            </div>
          </div>
          <div class="field"><label for="saleMode">Sale channel</label><select id="saleMode">${SALE_MODES.map(mode => `<option ${mode === saleMode(cart.saleMode) ? "selected" : ""}>${mode}</option>`).join("")}</select></div>
          <div class="field"><label>Payment status</label>
            <div class="segmented" id="payStatus" style="width:100%">${PAYMENT_STATUSES.map(status => `<button class="${status === "Paid" ? "active" : ""}" data-status="${status}" type="button" style="flex:1;min-height:44px" ${status === "Pending" && !customer ? "disabled title='Attach a customer (F6) to mark a sale as pending'" : ""}>${status === "Paid" ? icon("check", 16) : icon("clock", 16)} ${status}</button>`).join("")}</div>
            <span class="hint">${customer ? "Pending = customer pays the rest later (partial payment allowed)." : "Attach a customer to mark a sale as Pending."}</span>
          </div>
        </div>
        <div class="stack">
          <div class="pay-methods" id="payMethods">${PAYMENT_METHODS.map(item => `<button class="pay-method ${item.id === method ? "active" : ""}" data-method="${esc(item.id)}" type="button">${icon(item.icon, 24)}<span>${esc(item.id)}</span></button>`).join("")}</div>
          <div id="payPanel" class="stack"></div>
        </div>
      </div>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel <kbd>Esc</kbd></button>
        <button class="btn btn-accent btn-lg" id="completeSale" type="button">${icon("check", 20)} Complete Sale · ${money(total)}</button>`
    });
    const el = modal.el;
    el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());

    const compute = () => {
      if (method === "Cash") {
        const received = Number(el.querySelector("#cashReceived")?.value || 0);
        if (payLater) {
          const applied = Math.min(received, total);
          return { valid: true, payments: received > 0 ? [{ method: "Cash", amount: applied, tendered: received, ref: "" }] : [], change: Math.max(0, received - total), due: total - applied, received };
        }
        return {
          valid: received >= total,
          message: received >= total ? "" : `Enter cash received (at least ${money(total)}).`,
          payments: [{ method: "Cash", amount: total, tendered: received, ref: "" }],
          change: Math.max(0, received - total),
          due: 0,
          received
        };
      }
      if (method === "Split") {
        const rows = splitRows.map(row => ({ ...row, amount: Number(row.amount || 0) })).filter(row => row.amount > 0);
        const cash = sum(rows.filter(row => row.method === "Cash"), row => row.amount);
        const nonCash = sum(rows.filter(row => row.method !== "Cash"), row => row.amount);
        const paid = cash + nonCash;
        if (nonCash > total) return { valid: false, message: "The bank transfer amount can't be more than the bill.", payments: [], change: 0, due: 0, received: paid };
        const change = Math.max(0, paid - total);
        if (!payLater && paid < total) return { valid: false, message: `${money(total - paid)} still to collect.`, payments: [], change: 0, due: total - paid, received: paid };
        if (rows.length < 1) return { valid: payLater, message: "Enter the split amounts.", payments: [], change: 0, due: total, received: 0 };
        let cashChangeLeft = change;
        const payments = rows.map(row => {
          if (row.method === "Cash" && cashChangeLeft > 0) {
            const applied = Math.max(0, row.amount - cashChangeLeft);
            cashChangeLeft -= row.amount - applied;
            return { method: row.method, amount: applied, tendered: row.amount, ref: row.ref || "" };
          }
          return { method: row.method, amount: row.amount, tendered: row.amount, ref: row.ref || "" };
        });
        return { valid: true, payments, change, due: Math.max(0, total - paid), received: paid };
      }
      const ref = el.querySelector("#payRef")?.value.trim() || "";
      if (payLater) {
        const now = Math.min(total, Number(el.querySelector("#paidNow")?.value || 0));
        return { valid: true, payments: now > 0 ? [{ method, amount: now, tendered: now, ref }] : [], change: 0, due: total - now, received: now };
      }
      return { valid: true, payments: [{ method, amount: total, tendered: total, ref }], change: 0, due: 0, received: total };
    };

    const updateState = () => {
      const calc = compute();
      const button = el.querySelector("#completeSale");
      button.disabled = !calc.valid || completing;
      const changeBox = el.querySelector("#changeBox");
      if (changeBox) {
        const short = method === "Cash" && !payLater && calc.received < total;
        changeBox.classList.toggle("short", short || (payLater && calc.due > 0));
        changeBox.innerHTML = short
          ? `<span>Short by</span><strong>${money(total - calc.received)}</strong>`
          : payLater && calc.due > 0
            ? `<span>Balance due (pay later)</span><strong>${money(calc.due)}</strong>`
            : `<span>Change to return</span><strong>${money(calc.change)}</strong>`;
      }
      const splitInfo = el.querySelector("#splitInfo");
      if (splitInfo) splitInfo.innerHTML = calc.message ? `<div class="form-error">${esc(calc.message)}</div>` : calc.change ? `<div class="change-box"><span>Change to return</span><strong>${money(calc.change)}</strong></div>` : `<div class="change-box"><span>Fully paid</span><strong>${icon("check", 26)}</strong></div>`;
      return calc;
    };

    const renderPanel = () => {
      const panel = el.querySelector("#payPanel");
      el.querySelectorAll("[data-method]").forEach(button => button.classList.toggle("active", button.dataset.method === method));
      if (method === "Cash") {
        panel.innerHTML = `<div class="field cash-input"><label for="cashReceived">Cash received</label><input id="cashReceived" type="number" inputmode="decimal" min="0" step="1" placeholder="0" autocomplete="off"></div>
          <div class="quick-cash">${quick.map(amount => `<button class="btn btn-soft" data-quick="${amount}" type="button">${amount === total ? "Exact" : money(amount)}</button>`).join("")}</div>
          <div class="change-box" id="changeBox"></div>`;
        const input = panel.querySelector("#cashReceived");
        input.addEventListener("input", updateState);
        panel.querySelectorAll("[data-quick]").forEach(button => button.addEventListener("click", () => {
          input.value = button.dataset.quick;
          updateState();
          el.querySelector("#completeSale").focus();
        }));
        setTimeout(() => input.focus(), 40);
      } else if (method === "Split") {
        const methodOptions = selected => PAYMENT_METHODS.filter(item => item.id !== "Split").map(item => `<option ${item.id === selected ? "selected" : ""}>${esc(item.id)}</option>`).join("");
        panel.innerHTML = `<div class="stack" style="gap:10px">
            ${splitRows.map((row, index) => `<div class="split-row" data-row="${index}">
              <div class="field"><label>Method</label><select data-k="method">${methodOptions(row.method)}</select></div>
              <div class="field"><label>Amount</label><input data-k="amount" type="number" inputmode="decimal" min="0" value="${esc(row.amount)}" placeholder="0"></div>
              <div class="field split-ref"><label>Reference</label><input data-k="ref" value="${esc(row.ref)}" placeholder="Optional"></div>
              <button class="icon-btn danger" data-remove-row="${index}" type="button" aria-label="Remove payment" ${splitRows.length <= 1 ? "disabled" : ""}>${icon("trash", 18)}</button>
            </div>`).join("")}
            <div class="row"><button class="btn btn-soft btn-sm" id="addSplit" type="button">${icon("plus", 16)} Add payment</button><button class="btn btn-ghost btn-sm" id="fillSplit" type="button">Fill remaining</button></div>
            <div id="splitInfo"></div>
          </div>`;
        panel.querySelectorAll("[data-row]").forEach(rowEl => {
          const index = Number(rowEl.dataset.row);
          rowEl.querySelectorAll("[data-k]").forEach(input => input.addEventListener("input", () => {
            splitRows[index][input.dataset.k] = input.value;
            updateState();
          }));
        });
        panel.querySelectorAll("[data-remove-row]").forEach(button => button.addEventListener("click", () => {
          splitRows.splice(Number(button.dataset.removeRow), 1);
          renderPanel();
        }));
        panel.querySelector("#addSplit").addEventListener("click", () => {
          splitRows.push({ method: "Cash", amount: "", ref: "" });
          renderPanel();
        });
        panel.querySelector("#fillSplit").addEventListener("click", () => {
          const paid = sum(splitRows, row => row.amount);
          const target = splitRows.find(row => !Number(row.amount)) || splitRows[splitRows.length - 1];
          target.amount = String(Math.max(0, total - (paid - Number(target.amount || 0))));
          renderPanel();
        });
        setTimeout(() => panel.querySelector("[data-k=amount]")?.focus(), 40);
      } else {
        panel.innerHTML = `<div class="summary-box"><div class="sum-row"><span>Charge to ${esc(method)}</span><strong class="big-amount">${money(total)}</strong></div></div>
          ${payLater ? `<div class="field"><label for="paidNow">Amount paid now</label><input id="paidNow" type="number" inputmode="decimal" min="0" value="0"></div><div class="change-box" id="changeBox"></div>` : ""}
          <div class="field"><label for="payRef">Bank reference / transaction ID <span class="faint">(optional)</span></label><input id="payRef" autocomplete="off" placeholder="e.g. TID or sender name"></div>`;
        panel.querySelector("#paidNow")?.addEventListener("input", updateState);
        setTimeout(() => panel.querySelector("#payRef")?.focus(), 40);
      }
      updateState();
    };

    el.querySelector("#payMethods").addEventListener("click", event => {
      const selected = event.target.closest("[data-method]")?.dataset.method;
      if (!selected) return;
      method = selected;
      renderPanel();
    });
    el.querySelector("#payStatus").addEventListener("click", event => {
      const status = event.target.closest("[data-status]:not([disabled])")?.dataset.status;
      if (!status) return;
      payLater = status === "Pending";
      el.querySelectorAll("#payStatus button").forEach(button => button.classList.toggle("active", button.dataset.status === status));
      renderPanel();
    });
    el.querySelector("#saleMode").addEventListener("change", event => {
      cart.saleMode = event.target.value;
      persistCart();
    });

    const complete = () => {
      const calc = updateState();
      if (!calc.valid || completing) {
        if (calc.message) toast(calc.message, "warn");
        return;
      }
      completing = true;
      el.querySelector("#completeSale").disabled = true;
      const fresh = cartPricing();
      const promos = BPPromotions.livePromotions(state.promotions, { outletId: currentOutlet().id });
      const bill = {
        id: nextInvoiceId(),
        v: 2,
        date: new Date().toISOString(),
        cashier: currentUser().username,
        cashierId: currentUser().id,
        outletId: currentOutlet().id,
        outlet: currentOutlet().name,
        customerId: customer?.id || "",
        customerName: customer?.name || "Walk-in Customer",
        customerPhone: customer?.phone || "",
        walkIn: !customer,
        saleMode: saleMode(cart.saleMode),
        items: fresh.lines.map(line => ({
          key: line.key,
          id: line.productId,
          variantId: line.variantId,
          name: line.name,
          sku: line.sku,
          barcode: line.barcode,
          size: line.size,
          color: line.color,
          category: line.category,
          type: line.type,
          season: line.season,
          price: line.price,
          qty: line.qty,
          freeQty: fresh.result.lineFree[line.key] || 0,
          discount: 0,
          ...(line.product.costPrice !== undefined ? { cost: Number(line.product.costPrice || 0) } : {})
        })),
        subtotal: fresh.result.subtotal,
        promoDiscount: fresh.result.discount,
        total: fresh.result.total,
        promotions: fresh.result.applied,
        promoSnapshot: promos.map(promo => ({ ...promo })),
        paymentMethod: method,
        payments: calc.payments,
        received: calc.received,
        change: calc.change,
        paymentStatus: calc.due > 0 ? "Pending" : "Paid",
        bankRef: calc.payments.map(payment => payment.ref).filter(Boolean).join(", "),
        status: "Completed"
      };
      bill.items.forEach(item => addStockMove({ productId: item.id, variantId: item.variantId, qty: -item.qty, type: "sale", ref: bill.id }));
      state.bills.push(bill);
      audit("sale.create", "bill", bill.id, `Sale ${bill.id} · ${money(bill.total)} · ${billItemCount(bill)} item(s) · ${billPaymentLabel(bill)}${bill.promoDiscount ? ` · promo -${money(bill.promoDiscount)}` : ""}`);
      save();
      resetCart();
      rerender();
      showSuccess(modal, bill);
    };
    el.querySelector("#completeSale").addEventListener("click", complete);
    el.addEventListener("keydown", event => {
      if (event.key === "Enter" && !el.dataset.done && event.target.tagName !== "BUTTON") {
        event.preventDefault();
        complete();
      }
    });
    renderPanel();
  }

  function showSuccess(modal, bill) {
    const el = modal.el;
    el.dataset.done = "1";
    const canWhatsApp = Boolean(Receipt.whatsappPhone(bill.customerPhone));
    el.querySelector(".modal-head")?.remove();
    el.querySelector(".modal-foot")?.remove();
    el.querySelector(".modal-body").innerHTML = `<div class="success-view">
      <div class="success-check"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
      <h2>Payment Successful</h2>
      <p class="muted">Sale Completed ✓ · Invoice <strong>${esc(bill.id)}</strong> · ${money(bill.total)}</p>
      ${bill.change > 0 ? `<div class="change-box" style="width:100%"><span>Change to return</span><strong>${money(bill.change)}</strong></div>` : ""}
      ${billDue(bill) > 0 ? `<div class="change-box short" style="width:100%"><span>Balance due (pay later)</span><strong>${money(billDue(bill))}</strong></div>` : ""}
      ${bill.promoDiscount ? `<div class="badge accent" style="font-size:13px;padding:6px 12px">🎁 Customer saved ${money(bill.promoDiscount)}</div>` : ""}
      <div class="success-actions">
        <button class="btn btn-primary" data-s="print" type="button">${icon("printer", 22)} Print receipt <kbd>P</kbd></button>
        <button class="btn btn-whatsapp" data-s="wa" type="button" ${canWhatsApp ? "" : "disabled"}>${icon("whatsapp", 22)} WhatsApp</button>
        <button class="btn btn-accent" data-s="new" type="button" autofocus>${icon("plus", 22)} New sale <kbd>Enter</kbd></button>
      </div>
    </div>`;
    toast("Sale Completed ✓");
    const finish = () => {
      modal.close();
      focusSearch();
    };
    el.addEventListener("click", event => {
      const action = event.target.closest("[data-s]")?.dataset.s;
      if (action === "print") Receipt.print(bill);
      if (action === "wa") Receipt.sendWhatsApp(bill);
      if (action === "new") finish();
    });
    el.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); finish(); }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); Receipt.print(bill); }
    });
    setTimeout(() => el.querySelector("[data-s=new]")?.focus(), 60);
    if (state.settings.autoPrint) Receipt.print(bill);
  }

  /* ---------------------------------------------------------- barcode */
  function handleBarcode(code) {
    const match = barcodeMap().get(String(code).trim().toLowerCase());
    if (!match) {
      toast(`No product found for "${code}".`, "error");
      return false;
    }
    if (match.variant) return addVariant(match.product.id, match.variant.id);
    addProduct(match.product.id);
    return true;
  }
  function searchEnter() {
    const input = root.querySelector("#posSearch");
    const value = input.value.trim();
    if (!value) return;
    const exact = barcodeMap().get(value.toLowerCase());
    if (exact) {
      exact.variant ? addVariant(exact.product.id, exact.variant.id) : addProduct(exact.product.id);
    } else {
      const first = filteredProducts()[0];
      if (!first) return toast(`No product matches "${value}".`, "error");
      addProduct(first.id);
    }
    input.value = "";
    query = "";
    limit = PAGE;
    renderGrid();
  }

  function focusSearch() {
    const input = root?.querySelector("#posSearch");
    if (input && window.matchMedia("(pointer: fine)").matches) input.focus();
    else input?.focus({ preventScroll: true });
  }
  function focusCustomer() {
    if (cart.customer) {
      cart.customer = null;
      persistCart();
      renderCart();
    }
    root?.querySelector("#posCustomerSearch")?.focus();
  }
  function toggleSheet(open) {
    root?.querySelector("#posRight")?.classList.toggle("open", open);
  }

  /* ----------------------------------------------------------- render */
  function render(container) {
    root = container;
    root.innerHTML = `<div class="pos">
      <section class="pos-left">
        <div class="pos-search">
          <div class="scan-box">
            ${icon("barcode", 24)}
            <input id="posSearch" type="search" placeholder="Scan barcode or search name, SKU, category…" autocomplete="off" spellcheck="false" enterkeyhint="go" value="${esc(query)}" aria-label="Search products">
            <span class="scan-hint"><span class="scan-live"></span>Scanner ready · F4</span>
          </div>
        </div>
        <div class="chip-row" id="posChips"></div>
        <div class="product-grid" id="posGrid"></div>
      </section>
      <section class="pos-right" id="posRight">
        <div class="cart-panel">
          <div class="cart-customer" id="posCustomer"></div>
          <div class="cart-head">
            <h3>${icon("pos", 18)} Current Sale <span class="cart-count" id="posCount">0</span></h3>
            <button class="icon-btn sm cart-sheet-close" data-pos="sheet-close" type="button" aria-label="Close cart">${icon("chevronDown", 20)}</button>
          </div>
          <div class="cart-lines" id="posLines"></div>
          <div id="posPromo"></div>
          <div class="cart-summary" id="posSummary"></div>
        </div>
      </section>
      <button class="mobile-cart-bar hidden" id="posMobileBar" type="button"></button>
    </div>`;

    const search = root.querySelector("#posSearch");
    search.addEventListener("input", debounce(() => {
      query = search.value;
      limit = PAGE;
      renderGrid();
    }, 70));
    search.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchEnter();
      }
      if (event.key === "Escape" && search.value) {
        event.stopPropagation();
        search.value = "";
        query = "";
        renderGrid();
      }
    });
    root.querySelector("#posChips").addEventListener("click", event => {
      const chip = event.target.closest("[data-chip]")?.dataset.chip;
      if (!chip) return;
      filter = chip;
      limit = PAGE;
      renderChips();
      renderGrid();
    });
    root.querySelector("#posGrid").addEventListener("click", event => {
      if (event.target.closest("[data-more]")) {
        limit += PAGE;
        return renderGrid();
      }
      const pid = event.target.closest("[data-pid]")?.dataset.pid;
      if (pid) addProduct(pid);
    });
    root.querySelector("#posLines").addEventListener("click", event => {
      const key = event.target.closest("[data-key]")?.dataset.key;
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (!key || !act) return;
      if (act === "inc") changeQty(key, 1);
      if (act === "dec") {
        const line = cart.lines.find(item => item.key === key);
        if (line?.qty === 1) removeLine(key);
        else changeQty(key, -1);
      }
      if (act === "remove") removeLine(key);
    });
    root.querySelector("#posLines").addEventListener("change", event => {
      const select = event.target.closest("select[data-field]");
      const key = event.target.closest("[data-key]")?.dataset.key;
      if (select && key) changeVariant(key, select.dataset.field, select.value);
    });
    root.querySelector("#posCustomer").addEventListener("click", event => {
      const action = event.target.closest("[data-cust]")?.dataset.cust;
      if (action === "walkin") {
        cart.customer = null;
        persistCart();
        renderCart();
      }
      if (action === "add") quickAddCustomer();
    });
    root.querySelector(".pos-right").addEventListener("click", event => {
      const action = event.target.closest("[data-pos]")?.dataset.pos;
      if (action === "hold") holdCurrent();
      if (action === "held") openHeld();
      if (action === "clear") clearCart();
      if (action === "checkout") { toggleSheet(false); checkout(); }
      if (action === "sheet-close") toggleSheet(false);
    });
    root.querySelector("#posMobileBar").addEventListener("click", () => toggleSheet(true));

    renderChips();
    // A cart restored from before a reload shouldn't replay the "deal unlocked" celebration.
    lastFreeCount = cartPricing().result.applied.reduce((total, promo) => total + promo.freeCount, 0);
    rerender();
    setTimeout(focusSearch, 60);
  }

  function refresh() {
    if (!root || !document.contains(root)) return;
    renderChips();
    rerender();
  }

  return {
    render,
    refresh,
    handleBarcode,
    focusSearch,
    focusCustomer,
    hold: () => holdCurrent(),
    autoHold: note => holdCurrent({ silent: true, note }),
    openHeld,
    resume,
    newSale,
    checkout,
    hasItems: () => cart.lines.length > 0,
    addVariant,
    setCustomer: selectCustomer
  };
})();
