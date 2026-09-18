/* Inventory: per-variant stock, status, adjustments and movement history. */
Views.inventory = (() => {
  let tab = "stock";
  let search = "";
  let dept = "";
  let statusFilter = "";
  let season = "";
  const MOVE_LABEL = { opening: "Opening", sale: "Sale", return: "Return", "exchange-in": "Exchange in", "exchange-out": "Exchange out", adjust: "Adjustment", cancel: "Cancelled sale" };

  function variantRows() {
    const q = search.trim().toLowerCase();
    const rows = [];
    state.products.forEach(product => {
      if (dept && product.category !== dept) return;
      if (season && product.season !== season) return;
      (product.variants || []).forEach(variant => {
        const qty = variantStock(product.id, variant.id);
        const status = BPStock.stockStatus(qty, lowStockLevel(product));
        if (statusFilter === "alerts" && status === "in") return;
        if (statusFilter && statusFilter !== "alerts" && status !== statusFilter) return;
        if (q && ![product.name, product.sku, product.barcode, variant.sku, variant.barcode, variant.size, variant.color, product.type].join(" ").toLowerCase().includes(q)) return;
        rows.push({ product, variant, qty, status });
      });
    });
    return rows.sort((a, b) => a.product.name.localeCompare(b.product.name) || String(a.variant.size).localeCompare(String(b.variant.size)));
  }

  const STATUS_BADGE = {
    in: `<span class="badge good"><span class="dot"></span>In Stock</span>`,
    low: `<span class="badge warn"><span class="dot"></span>Low Stock</span>`,
    out: `<span class="badge bad"><span class="dot"></span>Out of Stock</span>`
  };

  let layout = UI.safeGet("bp-inventory-layout", "cards");

  /* One card per product with every variant's stock listed in full. */
  function renderCards(body, rows) {
    const financial = can("financialReports");
    const groups = new Map();
    rows.forEach(row => {
      if (!groups.has(row.product.id)) groups.set(row.product.id, []);
      groups.get(row.product.id).push(row);
    });
    body.innerHTML = rows.length ? `<div class="info-grid wide">${[...groups.values()].slice(0, 200).map(list => {
      const product = list[0].product;
      const total = productStock(product);
      const status = BPStock.stockStatus(total, lowStockLevel(product));
      return `<div class="info-card">
        <div class="info-card-head">
          ${product.image ? `<img class="thumb lg" src="${product.image}" alt="">` : `<span class="thumb lg">${esc(initials(product.name))}</span>`}
          <div class="grow">
            <div class="info-title">${esc(product.name)}</div>
            <div class="cell-sub">${esc([deptLabel(product.category), product.type, product.season].filter(Boolean).join(" · "))}</div>
            <div style="margin-top:6px">${STATUS_BADGE[status]}</div>
          </div>
          <div class="right"><div class="info-price">${num(total)}</div><div class="cell-sub">units in stock</div></div>
        </div>
        <div class="info-fields">
          <div><small>SKU</small><strong>${esc(product.sku || "—")}</strong></div>
          <div><small>Barcode</small><strong>${esc(product.barcode || "—")}</strong></div>
          ${financial ? `<div><small>Cost price</small><strong>${product.costPrice ? money(product.costPrice) : "—"}</strong></div>` : ""}
          <div><small>Sale price</small><strong>${money(product.price)}</strong></div>
          <div><small>Low stock level</small><strong>${lowStockLevel(product)}</strong></div>
        </div>
        <div class="variant-list">
          <div class="variant-line variant-line-head"><span>Size</span><span>Colour</span><span>SKU / Barcode</span><span class="right">Stock</span><span>Status</span><span></span></div>
          ${list.map(({ variant, qty, status: vStatus }) => `<div class="variant-line">
            <span class="cell-main">${esc(variant.size || "—")}</span>
            <span>${esc(variant.color || "—")}</span>
            <span class="cell-sub">${esc(variant.sku || product.sku || "—")}<br>${esc(variant.barcode || product.barcode || "")}</span>
            <span class="right num cell-main" style="font-size:16px">${num(qty)}</span>
            <span>${STATUS_BADGE[vStatus]}</span>
            <span class="right">${can("stockAdjust") ? `<button class="btn btn-soft btn-sm" data-adjust="${esc(product.id)}" data-variant="${esc(variant.id)}" type="button">${icon("edit", 14)} Adjust</button>` : ""}</span>
          </div>`).join("")}
        </div>
      </div>`;
    }).join("")}</div>` : UI.empty("inventory", "No stock rows match", "Adjust the filters or add products.");
  }

  function renderStock(body) {
    const rows = variantRows();
    if (layout === "cards") return renderCards(body, rows);
    const financial = can("financialReports");
    body.innerHTML = rows.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Product</th><th>SKU</th><th>Barcode</th><th>Category</th><th>Size</th><th>Colour</th>${financial ? `<th class="right">Cost</th>` : ""}<th class="right">Sale price</th><th class="right">Stock</th><th class="right">Alert at</th><th>Status</th>${can("stockAdjust") ? `<th></th>` : ""}</tr></thead>
      <tbody>${rows.slice(0, 500).map(({ product, variant, qty, status }) => `<tr>
        <td><div class="product-cell">${product.image ? `<img class="thumb sm" src="${product.image}" alt="">` : `<span class="thumb sm">${esc(initials(product.name))}</span>`}<span class="cell-main">${esc(product.name)}</span></div></td>
        <td>${esc(variant.sku || product.sku || "—")}</td>
        <td class="cell-sub">${esc(variant.barcode || product.barcode || "—")}</td>
        <td>${esc(deptLabel(product.category))}${product.type ? `<div class="cell-sub">${esc(product.type)}</div>` : ""}</td>
        <td>${esc(variant.size || "—")}</td>
        <td>${esc(variant.color || "—")}</td>
        ${financial ? `<td class="right num">${product.costPrice ? money(product.costPrice) : "—"}</td>` : ""}
        <td class="right num">${money(product.price)}</td>
        <td class="right num cell-main" style="font-size:16px">${num(qty)}</td>
        <td class="right num cell-sub">${lowStockLevel(product)}</td>
        <td>${STATUS_BADGE[status]}</td>
        ${can("stockAdjust") ? `<td><button class="btn btn-soft btn-sm" data-adjust="${esc(product.id)}" data-variant="${esc(variant.id)}" type="button">${icon("edit", 15)} Adjust</button></td>` : ""}
      </tr>`).join("")}</tbody></table></div>
      ${rows.length > 500 ? `<div class="pager">Showing first 500 of ${rows.length} rows — refine your search.</div>` : ""}`
      : UI.empty("inventory", "No stock rows match", "Adjust the filters or add products.");
  }

  function renderHistory(body) {
    const moves = state.stockMoves.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 300);
    const legacy = state.stockHistory.slice().reverse().slice(0, 100);
    body.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Product</th><th>Variant</th><th>Type</th><th class="right">Change</th><th>Reference</th><th>User</th></tr></thead><tbody>
      ${moves.map(move => {
        const product = productById(move.productId);
        const variant = product?.variants?.find(item => item.id === move.variantId);
        return `<tr><td class="cell-sub">${fmtDateTime(move.date)}</td><td class="cell-main">${esc(product?.name || "Deleted product")}</td><td>${esc(BPStock.variantLabel(variant) || "—")}</td><td><span class="badge ${move.qty < 0 ? "bad" : "good"}">${esc(MOVE_LABEL[move.type] || move.type)}</span></td><td class="right num cell-main">${move.qty > 0 ? "+" : ""}${move.qty}</td><td class="cell-sub">${esc([move.ref, move.note].filter(Boolean).join(" · "))}</td><td>${esc(move.user || "")}</td></tr>`;
      }).join("")}
      ${legacy.map(entry => `<tr><td class="cell-sub">${esc(entry.date)}</td><td class="cell-main">${esc(entry.product)}</td><td>—</td><td><span class="badge">Previous system</span></td><td class="right num">${Number(entry.change) > 0 ? "+" : ""}${esc(entry.change)}</td><td class="cell-sub">${esc(entry.remarks || "")}</td><td>${esc(entry.user || "")}</td></tr>`).join("")}
    </tbody></table></div>`;
  }

  function render(root, params = {}) {
    if (params.status) statusFilter = params.status;
    const alerts = stockAlerts();
    const units = sum(state.products, product => productStock(product));
    const financial = can("financialReports");
    const costValue = sum(state.products, product => Math.max(0, productStock(product)) * Number(product.costPrice || 0));
    const retailValue = sum(state.products, product => Math.max(0, productStock(product)) * Number(product.price || 0));
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Inventory</h1><p>Live stock for every size and colour.</p></div>
        <div class="page-actions"><button class="btn btn-soft" id="invExport" type="button">${icon("download", 18)} Export CSV</button>${can("products") ? `<button class="btn btn-accent" onclick="Views.products.edit(null)" type="button">${icon("plus", 18)} Add product</button>` : ""}</div>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:16px">
        <div class="kpi t-info"><div class="kpi-top"><span class="kpi-label">Units in stock</span><span class="kpi-icon">${icon("inventory", 20)}</span></div><div class="kpi-value" data-count="${units}">0</div><div class="kpi-sub">${state.products.length} products</div></div>
        <div class="kpi t-warn"><div class="kpi-top"><span class="kpi-label">Low stock</span><span class="kpi-icon">${icon("alert", 20)}</span></div><div class="kpi-value" data-count="${alerts.filter(a => a.status === "low").length}">0</div><div class="kpi-sub">products at alert level</div></div>
        <div class="kpi t-bad"><div class="kpi-top"><span class="kpi-label">Out of stock</span><span class="kpi-icon">${icon("ban", 20)}</span></div><div class="kpi-value" data-count="${alerts.filter(a => a.status === "out").length}">0</div><div class="kpi-sub">products</div></div>
        <div class="kpi t-good"><div class="kpi-top"><span class="kpi-label">Retail value</span><span class="kpi-icon">${icon("tag", 20)}</span></div><div class="kpi-value" data-count="${retailValue}" data-format="money">0</div><div class="kpi-sub">at sale price</div></div>
        ${financial ? `<div class="kpi t-accent"><div class="kpi-top"><span class="kpi-label">Stock value at cost</span><span class="kpi-icon">${icon("cash", 20)}</span></div><div class="kpi-value" data-count="${costValue}" data-format="money">0</div><div class="kpi-sub">where cost price is set</div></div>` : ""}
      </div>
      <div class="card">
        <div class="toolbar" style="justify-content:space-between">
          <div class="tabs" id="invTabs"><button class="tab ${tab === "stock" ? "active" : ""}" data-tab="stock" type="button">${icon("layers", 16)} Stock levels</button><button class="tab ${tab === "history" ? "active" : ""}" data-tab="history" type="button">${icon("history", 16)} Movement history</button></div>
        </div>
        <div class="toolbar ${tab === "stock" ? "" : "hidden"}" style="padding-top:0">
          <div class="input-icon">${icon("search", 18)}<input class="input" id="invSearch" placeholder="Search product, SKU, barcode, size, colour" value="${esc(search)}"></div>
          <select class="select" id="invDept"><option value="">All departments</option>${DEPARTMENTS.map(item => `<option value="${esc(item.value)}" ${dept === item.value ? "selected" : ""}>${item.label}</option>`).join("")}</select>
          <select class="select" id="invSeason"><option value="">All seasons</option>${SEASONS.map(item => `<option ${season === item ? "selected" : ""}>${item}</option>`).join("")}</select>
          <div class="segmented" id="invLayout"><button class="${layout === "cards" ? "active" : ""}" data-layout="cards" type="button">${icon("dashboard", 15)} Cards</button><button class="${layout === "table" ? "active" : ""}" data-layout="table" type="button">${icon("menu", 15)} Table</button></div>
          <select class="select" id="invStatus"><option value="">All statuses</option><option value="alerts" ${statusFilter === "alerts" ? "selected" : ""}>Needs attention</option><option value="in" ${statusFilter === "in" ? "selected" : ""}>In Stock</option><option value="low" ${statusFilter === "low" ? "selected" : ""}>Low Stock</option><option value="out" ${statusFilter === "out" ? "selected" : ""}>Out of Stock</option></select>
        </div>
        <div id="invBody" style="padding:0 8px 8px"></div>
      </div>`;
    const body = root.querySelector("#invBody");
    const draw = () => (tab === "stock" ? renderStock(body) : renderHistory(body));
    root.querySelector("#invTabs").addEventListener("click", event => {
      const next = event.target.closest("[data-tab]")?.dataset.tab;
      if (next && next !== tab) { tab = next; render(root); UI.animateCounters(root); }
    });
    root.querySelector("#invSearch").addEventListener("input", debounce(event => { search = event.target.value; draw(); }, 120));
    root.querySelector("#invDept").addEventListener("change", event => { dept = event.target.value; draw(); });
    root.querySelector("#invSeason").addEventListener("change", event => { season = event.target.value; draw(); });
    root.querySelector("#invStatus").addEventListener("change", event => { statusFilter = event.target.value; draw(); });
    root.querySelector("#invExport").addEventListener("click", exportCsv);
    root.querySelector("#invLayout").addEventListener("click", event => {
      const next = event.target.closest("[data-layout]")?.dataset.layout;
      if (!next) return;
      layout = next;
      UI.safeSet("bp-inventory-layout", layout);
      root.querySelectorAll("#invLayout button").forEach(button => button.classList.toggle("active", button.dataset.layout === layout));
      draw();
    });
    body.addEventListener("click", event => {
      const button = event.target.closest("[data-adjust]");
      if (button) adjust(button.dataset.adjust, button.dataset.variant);
    });
    draw();
  }

  function exportCsv() {
    const financial = can("financialReports");
    const rows = [["Product", "SKU", "Barcode", "Department", "Type", "Season", "Size", "Colour", ...(financial ? ["Cost Price"] : []), "Sale Price", "Stock", "Low Stock Level", "Status"]];
    variantRows().forEach(({ product, variant, qty, status }) => rows.push([product.name, variant.sku || product.sku, variant.barcode || product.barcode, deptLabel(product.category), product.type, product.season, variant.size, variant.color, ...(financial ? [product.costPrice || 0] : []), product.price, qty, lowStockLevel(product), { in: "In Stock", low: "Low Stock", out: "Out of Stock" }[status]]));
    downloadFile("brands-planets-inventory.csv", toCsv(rows));
    toast("Inventory exported ✓");
  }

  function adjust(productId, variantId) {
    if (!can("stockAdjust")) return toast("You don't have permission to adjust stock.", "error");
    const product = productById(productId);
    const variant = product?.variants?.find(item => item.id === variantId);
    if (!variant) return;
    const current = variantStock(productId, variantId);
    const modal = UI.openModal({
      title: "Stock adjustment",
      subtitle: `${esc(product.name)}${BPStock.variantLabel(variant) ? ` · ${esc(BPStock.variantLabel(variant))}` : ""} · currently ${current}`,
      size: "sm",
      body: `<form id="adjForm" class="form-section">
        <div class="segmented" id="adjMode" style="width:100%"><button class="active" data-mode="add" type="button" style="flex:1">Add stock</button><button data-mode="remove" type="button" style="flex:1">Remove</button><button data-mode="set" type="button" style="flex:1">Set count</button></div>
        <div class="field"><label for="adjQty" id="adjLabel">Quantity to add</label><input id="adjQty" type="number" min="0" step="1" inputmode="numeric" autofocus></div>
        <div class="field"><label>Reason</label><select id="adjReason"><option>New stock received</option><option>Stock count correction</option><option>Damaged / defective</option><option>Lost / theft</option><option>Transferred to another outlet</option><option>Other</option></select></div>
        <div class="field"><label>Note <span class="faint">(optional)</span></label><input id="adjNote"></div>
        <div class="summary-box"><div class="sum-row"><span>New stock level</span><strong class="big-amount" id="adjResult">${current}</strong></div></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="adjForm" type="submit">Review adjustment</button>`
    });
    const el = modal.el;
    let mode = "add";
    const target = () => {
      const qty = Math.round(Number(el.querySelector("#adjQty").value || 0));
      return mode === "add" ? current + qty : mode === "remove" ? current - qty : qty;
    };
    const update = () => { el.querySelector("#adjResult").textContent = target(); };
    el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    el.querySelector("#adjMode").addEventListener("click", event => {
      const next = event.target.closest("[data-mode]")?.dataset.mode;
      if (!next) return;
      mode = next;
      el.querySelectorAll("#adjMode button").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
      el.querySelector("#adjLabel").textContent = { add: "Quantity to add", remove: "Quantity to remove", set: "Counted quantity" }[mode];
      update();
    });
    el.querySelector("#adjQty").addEventListener("input", update);
    el.querySelector("#adjForm").addEventListener("submit", async event => {
      event.preventDefault();
      const next = target();
      const delta = next - current;
      if (!delta) return toast("No change to save.", "info");
      if (next < 0) return toast("Stock can't go below zero.", "error");
      const reason = el.querySelector("#adjReason").value;
      const note = el.querySelector("#adjNote").value.trim();
      const ok = await UI.confirm({ title: "Confirm stock adjustment", message: `${esc(product.name)} ${esc(BPStock.variantLabel(variant))}: <strong>${current} → ${next}</strong> (${delta > 0 ? "+" : ""}${delta})<br>${esc(reason)}`, confirmText: "Adjust stock", tone: "primary", iconName: "inventory" });
      if (!ok) return;
      addStockMove({ productId, variantId, qty: delta, type: "adjust", note: [reason, note].filter(Boolean).join(" — ") });
      audit("stock.adjust", "product", productId, `${product.name} ${BPStock.variantLabel(variant)}: ${current} → ${next} (${reason}${note ? `, ${note}` : ""})`);
      save();
      modal.close();
      toast("Inventory Updated ✓");
      Shell.rerender();
    });
  }

  function refresh() {
    const body = $("#invBody");
    if (body && !UI.hasModal()) (tab === "stock" ? renderStock(body) : renderHistory(body));
  }

  return { render, refresh };
})();
