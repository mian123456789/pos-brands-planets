/* Promotions / Deals admin (Buy X Get Y Free). */
Views.promotions = (() => {
  const STATUS = {
    live: ["good", "Live now"],
    scheduled: ["info", "Scheduled"],
    expired: ["", "Expired"],
    inactive: ["", "Inactive"]
  };

  function stats(promoId) {
    const result = { orders: 0, free: 0, savings: 0, revenue: 0 };
    state.bills.forEach(bill => {
      if (isCancelled(bill)) return;
      const applied = (bill.promotions || []).find(promo => promo.promoId === promoId);
      if (!applied) return;
      result.orders += 1;
      result.free += applied.freeCount || 0;
      result.savings += applied.saving || 0;
      result.revenue += billTotals(bill).total;
    });
    return result;
  }

  function scopeText(promo) {
    const scope = promo.scope || { mode: "all" };
    if (scope.mode !== "filter") return "All products";
    const parts = [
      ...(scope.departments || []).map(deptLabel),
      ...(scope.seasons || []).map(season => season === "Summer" ? "Summer stock" : season === "Winter" ? "Winter stock" : season),
      ...(scope.types || []),
      ...(scope.productIds || []).length ? [`${scope.productIds.length} specific product(s)`] : []
    ];
    return parts.join(", ") || "No products selected";
  }
  function scheduleText(promo) {
    const start = promo.startDate ? `${fmtDate(promo.startDate)}${promo.startTime ? ` ${promo.startTime}` : ""}` : "Now";
    const end = promo.endDate ? `${fmtDate(promo.endDate)}${promo.endTime ? ` ${promo.endTime}` : ""}` : "No end date";
    return `${start} → ${end}`;
  }

  function card(promo) {
    const status = BPPromotions.promotionStatus(promo);
    const [tone, label] = STATUS[status];
    const s = stats(promo.id);
    const outlets = (promo.outletIds || []).map(id => state.settings.outlets.find(outlet => outlet.id === id)?.name).filter(Boolean);
    const editable = can("promotions");
    return `<div class="promo-card ${status === "live" ? "live" : ""}" data-id="${esc(promo.id)}">
      <div class="promo-title">
        <div><h3>${esc(promo.name)}</h3><span class="badge ${tone}">${status === "live" ? `<span class="dot"></span>` : ""}${label}</span></div>
        ${editable ? `<label class="switch" title="${promo.active === false ? "Activate" : "Deactivate"}"><input type="checkbox" data-toggle ${promo.active !== false ? "checked" : ""}><span></span></label>` : ""}
      </div>
      <div class="promo-rule">${esc(BPPromotions.promoLabel(promo))}</div>
      <div class="promo-meta">
        <span>${icon("calendar", 15)} ${esc(scheduleText(promo))}</span>
        <span>${icon("tag", 15)} ${esc(scopeText(promo))}${(promo.excludeProductIds || []).length ? ` · ${promo.excludeProductIds.length} excluded` : ""}</span>
        <span>${icon("sparkles", 15)} Cheapest eligible item free${promo.maxFreePerInvoice ? ` · max ${promo.maxFreePerInvoice} free/invoice` : ""}${promo.minPurchase ? ` · min ${money(promo.minPurchase)}` : ""}</span>
        <span>${icon("store", 15)} ${outlets.length ? esc(outlets.join(", ")) : "All outlets"}</span>
      </div>
      <div class="promo-stats">
        <div><small>Deal orders</small><strong>${s.orders}</strong></div>
        <div><small>Free items</small><strong>${s.free}</strong></div>
        <div><small>Savings given</small><strong>${money(s.savings)}</strong></div>
      </div>
      ${editable ? `<div class="row"><button class="btn btn-soft btn-sm" data-act="edit" type="button">${icon("edit", 15)} Edit</button><button class="btn btn-ghost btn-sm" data-act="duplicate" type="button">Duplicate</button><span class="top-spacer"></span><button class="icon-btn sm danger" data-act="delete" type="button" aria-label="Delete promotion">${icon("trash", 16)}</button></div>` : ""}
    </div>`;
  }

  function render(root) {
    const promos = state.promotions.slice().sort((a, b) => {
      const order = { live: 0, scheduled: 1, inactive: 2, expired: 3 };
      return order[BPPromotions.promotionStatus(a)] - order[BPPromotions.promotionStatus(b)] || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Promotions & Deals</h1><p>At checkout the cashier chooses: apply the deal (discounts are removed) or keep discount %. Never both.</p></div>
        <div class="page-actions">${can("promotions") ? `<button class="btn btn-accent btn-lg" id="promoAdd" type="button">${icon("plus", 18)} Create promotion</button>` : `<span class="badge">${icon("lock", 12)} View only</span>`}</div>
      </div>
      ${promos.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${promos.map(card).join("")}</div>`
        : `<div class="card">${UI.empty("promotions", "No promotions yet", "Create a Buy 2 Get 1 Free deal — the cheapest eligible item becomes free automatically.", can("promotions") ? `<button class="btn btn-accent" onclick="Views.promotions.edit()" type="button">${icon("plus", 18)} Create promotion</button>` : "")}</div>`}`;
    root.querySelector("#promoAdd")?.addEventListener("click", () => edit());
    root.addEventListener("click", async event => {
      const id = event.target.closest("[data-id]")?.dataset.id;
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (!id || !act) return;
      if (act === "edit") edit(id);
      if (act === "duplicate") edit(id, true);
      if (act === "delete") remove(id);
    });
    root.addEventListener("change", event => {
      if (!event.target.matches("[data-toggle]")) return;
      const promo = state.promotions.find(item => item.id === event.target.closest("[data-id]").dataset.id);
      if (!promo) return;
      promo.active = event.target.checked;
      audit("promotion.update", "promotion", promo.id, `${promo.active ? "Activated" : "Deactivated"} ${promo.name}`);
      save();
      toast(promo.active ? "Promotion activated 🎁" : "Promotion deactivated", promo.active ? "promo" : "info");
      Shell.rerender();
    });
  }

  function productPicker(el, selector, initial) {
    const box = el.querySelector(selector);
    let ids = [...initial];
    const draw = () => {
      box.querySelector(".tag-list").innerHTML = ids.map(id => {
        const product = productById(id);
        return `<span class="tag">${esc(product?.name || "Deleted product")}<button type="button" data-rm="${esc(id)}">${icon("x", 12)}</button></span>`;
      }).join("");
    };
    box.innerHTML = `<div class="tag-input"><span class="tag-list row wrap" style="gap:6px"></span><input placeholder="Search products…" autocomplete="off"></div><div class="customer-results hidden"></div>`;
    box.style.position = "relative";
    const input = box.querySelector("input");
    const results = box.querySelector(".customer-results");
    input.addEventListener("input", debounce(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) return results.classList.add("hidden");
      const matches = state.products.filter(product => !ids.includes(product.id) && [product.name, product.sku, product.barcode].join(" ").toLowerCase().includes(q)).slice(0, 8);
      results.innerHTML = matches.map(product => `<button class="search-item" data-add="${esc(product.id)}" type="button"><span class="thumb sm">${esc(initials(product.name))}</span><span><strong>${esc(product.name)}</strong><small>${esc(product.sku || "")} · ${money(product.price)}</small></span></button>`).join("") || `<div class="empty-state" style="padding:12px">No products</div>`;
      results.classList.remove("hidden");
    }, 100));
    input.addEventListener("blur", () => setTimeout(() => results.classList.add("hidden"), 160));
    results.addEventListener("mousedown", event => event.preventDefault());
    results.addEventListener("click", event => {
      const id = event.target.closest("[data-add]")?.dataset.add;
      if (!id) return;
      ids.push(id);
      input.value = "";
      results.classList.add("hidden");
      draw();
    });
    box.addEventListener("click", event => {
      const id = event.target.closest("[data-rm]")?.dataset.rm;
      if (id) { ids = ids.filter(item => item !== id); draw(); }
    });
    draw();
    return () => ids;
  }

  function edit(id, duplicate = false) {
    if (!can("promotions")) return toast("Only admins can create or edit promotions.", "error");
    const existing = id ? state.promotions.find(item => item.id === id) : null;
    const promo = existing ? JSON.parse(JSON.stringify(existing)) : {
      name: "Brands Planets Summer Deal", type: "bxgy", buyQty: 2, freeQty: 1, freeRule: "cheapest",
      startDate: todayKey(), startTime: "", endDate: "", endTime: "", active: true,
      scope: { mode: "all", departments: [], seasons: [], types: [], productIds: [] },
      excludeProductIds: [], maxFreePerInvoice: 0, minPurchase: 0, outletIds: []
    };
    if (duplicate) promo.name = `${promo.name} (copy)`;
    const scope = { mode: "all", departments: [], seasons: [], types: [], productIds: [], ...(promo.scope || {}) };
    const types = [...new Set([...PRODUCT_TYPES, ...state.products.map(product => product.type).filter(Boolean)])];
    const checks = (name, values, selected, label = value => value) => values.map(value => `<label><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? "checked" : ""}>${esc(label(value))}</label>`).join("");
    const modal = UI.openModal({
      title: existing && !duplicate ? "Edit promotion" : "Create promotion",
      subtitle: "The cheapest eligible items in the cart become free automatically.",
      size: "xl",
      body: `<form id="promoForm" novalidate>
        <div class="form-section">
          <div class="form-section-title">${icon("promotions", 18)} Deal</div>
          <div class="form-grid form-grid-3">
            <div class="field span-2"><label>Promotion name *</label><input id="prName" value="${esc(promo.name)}"></div>
            <div class="field"><label>Promotion type</label><select id="prType"><option value="bxgy">Buy X Get Y Free</option></select></div>
            <div class="field"><label>Buy quantity</label><input id="prBuy" type="number" min="1" step="1" value="${esc(promo.buyQty)}"></div>
            <div class="field"><label>Free quantity</label><input id="prFree" type="number" min="1" step="1" value="${esc(promo.freeQty)}"></div>
            <div class="field"><label>Free item rule</label><select id="prRule"><option value="cheapest">Cheapest eligible product</option></select><span class="hint">Expensive items are never made free while a cheaper eligible item is paid for.</span></div>
          </div>
          <div class="promo-banner" style="margin:0" id="prPreview"></div>
        </div>
        <div class="form-section">
          <div class="form-section-title">${icon("calendar", 18)} Schedule & status (Pakistan time)</div>
          <div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
            <div class="field"><label>Start date</label><input id="prStartDate" type="date" value="${esc(promo.startDate || "")}"></div>
            <div class="field"><label>Start time</label><input id="prStartTime" type="time" value="${esc(promo.startTime || "")}"></div>
            <div class="field"><label>End date</label><input id="prEndDate" type="date" value="${esc(promo.endDate || "")}"></div>
            <div class="field"><label>End time</label><input id="prEndTime" type="time" value="${esc(promo.endTime || "")}"></div>
          </div>
          <label class="check"><span class="switch"><input type="checkbox" id="prActive" ${promo.active !== false ? "checked" : ""}><span></span></span> Promotion is active</label>
        </div>
        <div class="form-section">
          <div class="form-section-title">${icon("tag", 18)} Eligible products</div>
          <div class="segmented" id="prScope"><button class="${scope.mode !== "filter" ? "active" : ""}" data-scope="all" type="button">All products</button><button class="${scope.mode === "filter" ? "active" : ""}" data-scope="filter" type="button">Choose categories / products</button></div>
          <div id="prFilter" class="stack ${scope.mode === "filter" ? "" : "hidden"}" style="gap:12px">
            <div class="field"><label>Departments</label><div class="perm-grid">${checks("dept", DEPARTMENTS.map(item => item.value), scope.departments, deptLabel)}</div></div>
            <div class="field"><label>Season stock</label><div class="perm-grid">${checks("season", SEASONS, scope.seasons, value => value === "All Season" ? "All-season stock" : `${value} stock`)}</div></div>
            <div class="field"><label>Specific categories</label><div class="perm-grid">${checks("type", types, scope.types)}</div></div>
            <div class="field"><label>Specific products</label><div id="prProducts"></div></div>
            <p class="hint">A product qualifies if it matches <strong>any</strong> of the selections above.</p>
          </div>
          <div class="field"><label>Exclude these products</label><div id="prExclude"></div></div>
        </div>
        <div class="form-section">
          <div class="form-section-title">${icon("settings", 18)} Limits & outlets</div>
          <div class="form-grid">
            <div class="field"><label>Maximum free products per invoice</label><input id="prMax" type="number" min="0" step="1" value="${esc(promo.maxFreePerInvoice || 0)}"><span class="hint">0 = no limit</span></div>
            <div class="field"><label>Minimum purchase value (Rs.)</label><input id="prMin" type="number" min="0" step="1" value="${esc(promo.minPurchase || 0)}"><span class="hint">0 = no minimum (whole invoice subtotal)</span></div>
          </div>
          <div class="field"><label>Outlets</label><div class="perm-grid">${checks("outlet", state.settings.outlets.map(outlet => outlet.id), promo.outletIds || [], value => state.settings.outlets.find(outlet => outlet.id === value)?.name || value)}</div><span class="hint">Leave all unticked to run at every outlet.</span></div>
        </div>
        <div id="prError" class="form-error hidden" style="margin-top:14px"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-accent btn-lg" form="promoForm" type="submit">${icon("check", 18)} Save promotion</button>`
    });
    const el = modal.el;
    el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    let scopeMode = scope.mode === "filter" ? "filter" : "all";
    const getProducts = productPicker(el, "#prProducts", scope.productIds || []);
    const getExcluded = productPicker(el, "#prExclude", promo.excludeProductIds || []);
    const preview = () => {
      const buy = Math.max(1, Math.floor(Number(el.querySelector("#prBuy").value || 1)));
      const free = Math.max(1, Math.floor(Number(el.querySelector("#prFree").value || 1)));
      el.querySelector("#prPreview").innerHTML = `<span class="pb-icon">🎁</span><div><strong>BUY ${buy} GET ${free} FREE</strong><small>Every ${buy + free} eligible items → the ${free === 1 ? "cheapest one is" : `${free} cheapest are`} free. ${buy + free} items = ${free} free, ${(buy + free) * 2} items = ${free * 2} free, and so on.</small></div>`;
    };
    el.querySelector("#prBuy").addEventListener("input", preview);
    el.querySelector("#prFree").addEventListener("input", preview);
    el.querySelector("#prScope").addEventListener("click", event => {
      const next = event.target.closest("[data-scope]")?.dataset.scope;
      if (!next) return;
      scopeMode = next;
      el.querySelectorAll("#prScope button").forEach(button => button.classList.toggle("active", button.dataset.scope === next));
      el.querySelector("#prFilter").classList.toggle("hidden", next !== "filter");
    });
    preview();

    el.querySelector("#promoForm").addEventListener("submit", event => {
      event.preventDefault();
      const error = el.querySelector("#prError");
      const fail = text => { error.textContent = text; error.classList.remove("hidden"); error.scrollIntoView({ block: "nearest" }); };
      const values = name => $$(`input[name=${name}]:checked`, el).map(input => input.value);
      const record = {
        ...(existing && !duplicate ? existing : { id: uid("promo"), createdAt: new Date().toISOString(), createdBy: currentUser().username }),
        name: el.querySelector("#prName").value.trim(),
        type: "bxgy",
        buyQty: Math.floor(Number(el.querySelector("#prBuy").value)),
        freeQty: Math.floor(Number(el.querySelector("#prFree").value)),
        freeRule: "cheapest",
        startDate: el.querySelector("#prStartDate").value,
        startTime: el.querySelector("#prStartTime").value,
        endDate: el.querySelector("#prEndDate").value,
        endTime: el.querySelector("#prEndTime").value,
        active: el.querySelector("#prActive").checked,
        scope: scopeMode === "filter"
          ? { mode: "filter", departments: values("dept"), seasons: values("season"), types: values("type"), productIds: getProducts() }
          : { mode: "all", departments: [], seasons: [], types: [], productIds: [] },
        excludeProductIds: getExcluded(),
        maxFreePerInvoice: Math.max(0, Math.floor(Number(el.querySelector("#prMax").value || 0))),
        minPurchase: Math.max(0, Number(el.querySelector("#prMin").value || 0)),
        outletIds: values("outlet")
      };
      if (!record.name) return fail("Give the promotion a name.");
      if (!(record.buyQty >= 1) || !(record.freeQty >= 1)) return fail("Buy and free quantities must be at least 1.");
      if (record.startDate && record.endDate && `${record.endDate} ${record.endTime || "23:59"}` < `${record.startDate} ${record.startTime || "00:00"}`) return fail("The end date must be after the start date.");
      if (record.scope.mode === "filter" && !record.scope.departments.length && !record.scope.seasons.length && !record.scope.types.length && !record.scope.productIds.length) return fail("Pick at least one department, season, category or product — or choose All products.");
      if (existing && !duplicate) Object.assign(existing, record);
      else state.promotions.push(record);
      audit(existing && !duplicate ? "promotion.update" : "promotion.create", "promotion", record.id, `${existing && !duplicate ? "Updated" : "Created"} ${record.name} (${BPPromotions.promoLabel(record)}, ${scopeText(record)})`);
      save({ immediate: true });
      modal.close();
      toast("Promotion saved 🎁", "promo");
      Shell.rerender();
    });
  }

  async function remove(id) {
    const promo = state.promotions.find(item => item.id === id);
    if (!promo) return;
    const ok = await UI.confirm({ title: `Delete "${promo.name}"?`, message: "Past invoices keep their promotion details. You can also just deactivate it.", confirmText: "Delete promotion" });
    if (!ok) return;
    markDeleted("promotions", id);
    state.promotions = state.promotions.filter(item => item.id !== id);
    audit("promotion.delete", "promotion", id, `Deleted ${promo.name}`);
    save({ immediate: true });
    toast("Promotion deleted", "info");
    Shell.rerender();
  }

  return { render, edit };
})();
