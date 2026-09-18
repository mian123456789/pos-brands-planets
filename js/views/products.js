/* Products: catalogue and product form with size/colour variants. */
Views.products = (() => {
  let search = "";
  let dept = "";
  let status = "";

  function filtered() {
    const q = search.trim().toLowerCase();
    return state.products.filter(product => {
      if (dept && product.category !== dept) return false;
      if (status === "active" && product.active === false) return false;
      if (status === "inactive" && product.active !== false) return false;
      if (q && ![product.name, product.sku, product.barcode, product.type, product.season, ...(product.variants || []).flatMap(variant => [variant.sku, variant.barcode, variant.color])].join(" ").toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  let layout = UI.safeGet("bp-products-layout", "cards");

  /* Full card layout: every field visible, no sideways scrolling. */
  function cardHtml(product, promos, financial) {
    const stock = productStock(product);
    const stockState = BPStock.stockStatus(stock, lowStockLevel(product));
    const promo = promos.find(item => BPPromotions.isEligible(item, { productId: product.id, category: product.category, type: product.type, season: product.season }));
    const sizes = [...new Set((product.variants || []).map(variant => variant.size).filter(Boolean))];
    const colors = [...new Set((product.variants || []).map(variant => variant.color).filter(Boolean))];
    const tone = stockState === "out" ? "bad" : stockState === "low" ? "warn" : "good";
    return `<div class="info-card" data-id="${esc(product.id)}">
      <div class="info-card-head">
        ${product.image ? `<img class="thumb lg" src="${product.image}" alt="">` : `<span class="thumb lg">${esc(initials(product.name))}</span>`}
        <div class="grow">
          <div class="info-title">${esc(product.name)}</div>
          <div class="row wrap" style="gap:6px;margin-top:6px">
            ${product.active === false ? `<span class="badge">Inactive</span>` : `<span class="badge good"><span class="dot"></span>Active</span>`}
            ${promo ? `<span class="promo-badge">${esc(BPPromotions.promoLabel(promo))}</span>` : ""}
          </div>
        </div>
        <div class="info-price">${money(product.price)}</div>
      </div>
      <div class="info-fields">
        <div><small>SKU</small><strong>${esc(product.sku || "—")}</strong></div>
        <div><small>Barcode</small><strong>${esc(product.barcode || "—")}</strong></div>
        <div><small>Category</small><strong>${esc(deptLabel(product.category))}${product.type ? ` · ${esc(product.type)}` : ""}</strong></div>
        <div><small>Season</small><strong>${esc(product.season || "—")}</strong></div>
        <div><small>Sizes</small><strong>${sizes.length ? esc(sizes.join(", ")) : "One size"}</strong></div>
        <div><small>Colours</small><strong>${colors.length ? esc(colors.join(", ")) : "—"}</strong></div>
        ${financial ? `<div><small>Cost price</small><strong>${product.costPrice ? money(product.costPrice) : "—"}</strong></div>` : ""}
        <div><small>Stock</small><strong><span class="badge ${tone}">${num(stock)} ${stockState === "out" ? "· Out" : stockState === "low" ? "· Low" : ""}</span></strong></div>
      </div>
      <div class="info-actions">
        <button class="btn btn-soft btn-sm" data-act="edit" type="button">${icon("edit", 15)} Edit</button>
        <button class="btn btn-ghost btn-sm" data-act="delete" type="button" style="color:var(--bad)">${icon("trash", 15)} Delete</button>
      </div>
    </div>`;
  }

  function renderTable(root) {
    const rows = filtered();
    const financial = can("financialReports");
    const promos = BPPromotions.livePromotions(state.promotions, { outletId: currentOutlet().id });
    root.querySelector("#productCount").textContent = `${rows.length} of ${state.products.length}`;
    if (layout === "cards") {
      root.querySelector("#productTable").innerHTML = rows.length
        ? `<div class="info-grid">${rows.map(product => cardHtml(product, promos, financial)).join("")}</div>`
        : UI.empty("products", state.products.length ? "No matching products" : "No products yet", state.products.length ? "Try a different search or filter." : "Add your first product with sizes, colours and stock.");
      return;
    }
    root.querySelector("#productTable").innerHTML = rows.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Product</th><th>SKU / Barcode</th><th>Category</th><th>Variants</th>${financial ? `<th class="right">Cost</th>` : ""}<th class="right">Price</th><th class="right">Stock</th><th>Status</th><th class="right"></th></tr></thead>
      <tbody>${rows.map(product => {
        const stock = productStock(product);
        const stockState = BPStock.stockStatus(stock, lowStockLevel(product));
        const promo = promos.find(item => BPPromotions.isEligible(item, { productId: product.id, category: product.category, type: product.type, season: product.season }));
        const sizes = [...new Set((product.variants || []).map(variant => variant.size).filter(Boolean))];
        const colors = [...new Set((product.variants || []).map(variant => variant.color).filter(Boolean))];
        return `<tr class="clickable" data-id="${esc(product.id)}">
          <td><div class="product-cell">${product.image ? `<img class="thumb" src="${product.image}" alt="">` : `<span class="thumb">${esc(initials(product.name))}</span>`}<div><div class="cell-main">${esc(product.name)}</div>${promo ? `<span class="promo-badge" style="margin-top:4px">${esc(BPPromotions.promoLabel(promo))}</span>` : ""}</div></div></td>
          <td><div>${esc(product.sku || "—")}</div><div class="cell-sub">${esc(product.barcode || "")}</div></td>
          <td><div>${esc(deptLabel(product.category))}${product.type ? ` · ${esc(product.type)}` : ""}</div><div class="cell-sub">${esc(product.season || "")}</div></td>
          <td class="cell-sub">${sizes.length ? esc(sizes.join(" ")) : "One size"}${colors.length ? `<br>${esc(colors.join(", "))}` : ""}</td>
          ${financial ? `<td class="right num">${product.costPrice ? money(product.costPrice) : "—"}</td>` : ""}
          <td class="right num cell-main">${money(product.price)}</td>
          <td class="right"><span class="badge ${stockState === "out" ? "bad" : stockState === "low" ? "warn" : "good"}">${num(stock)}</span></td>
          <td>${product.active === false ? `<span class="badge">Inactive</span>` : `<span class="badge good"><span class="dot"></span>Active</span>`}</td>
          <td><div class="actions">
            <button class="icon-btn sm" data-act="edit" title="Edit" type="button">${icon("edit", 17)}</button>
            <button class="icon-btn sm danger" data-act="delete" title="Delete" type="button">${icon("trash", 17)}</button>
          </div></td>
        </tr>`;
      }).join("")}</tbody></table></div>` : UI.empty("products", state.products.length ? "No matching products" : "No products yet", state.products.length ? "Try a different search or filter." : "Add your first product with sizes, colours and stock.");
  }

  function render(root) {
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Products</h1><p>Catalogue, prices, sizes and colours. <span id="productCount" class="badge"></span></p></div>
        <div class="page-actions">
          <button class="btn btn-soft" id="productExport" type="button">${icon("download", 18)} Export CSV</button>
          <button class="btn btn-accent" id="productAdd" type="button">${icon("plus", 18)} Add product</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="input-icon">${icon("search", 18)}<input class="input" id="productSearch" placeholder="Search name, SKU, barcode, colour…" value="${esc(search)}"></div>
          <select class="select" id="productDept"><option value="">All departments</option>${DEPARTMENTS.map(item => `<option value="${esc(item.value)}" ${dept === item.value ? "selected" : ""}>${item.label}</option>`).join("")}</select>
          <select class="select" id="productStatus"><option value="">Active & inactive</option><option value="active" ${status === "active" ? "selected" : ""}>Active</option><option value="inactive" ${status === "inactive" ? "selected" : ""}>Inactive</option></select>
          <div class="segmented" id="productLayout"><button class="${layout === "cards" ? "active" : ""}" data-layout="cards" type="button">${icon("dashboard", 15)} Cards</button><button class="${layout === "table" ? "active" : ""}" data-layout="table" type="button">${icon("menu", 15)} Table</button></div>
        </div>
        <div id="productTable" style="padding:0 16px 16px"></div>
      </div>`;
    root.querySelector("#productLayout").addEventListener("click", event => {
      const next = event.target.closest("[data-layout]")?.dataset.layout;
      if (!next) return;
      layout = next;
      UI.safeSet("bp-products-layout", layout);
      root.querySelectorAll("#productLayout button").forEach(button => button.classList.toggle("active", button.dataset.layout === layout));
      renderTable(root);
    });
    root.querySelector("#productSearch").addEventListener("input", debounce(event => { search = event.target.value; renderTable(root); }, 120));
    root.querySelector("#productDept").addEventListener("change", event => { dept = event.target.value; renderTable(root); });
    root.querySelector("#productStatus").addEventListener("change", event => { status = event.target.value; renderTable(root); });
    root.querySelector("#productAdd").addEventListener("click", () => edit(null));
    root.querySelector("#productExport").addEventListener("click", exportCsv);
    root.querySelector("#productTable").addEventListener("click", event => {
      const id = event.target.closest("[data-id]")?.dataset.id;
      if (!id) return;
      const act = event.target.closest("[data-act]")?.dataset.act || "edit";
      if (act === "edit") edit(id);
      if (act === "delete") remove(id);
    });
    renderTable(root);
  }

  function exportCsv() {
    const financial = can("financialReports");
    const rows = [["Name", "SKU", "Barcode", "Department", "Type", "Season", "Size", "Color", "Variant SKU", "Variant Barcode", ...(financial ? ["Cost Price"] : []), "Sale Price", "Stock", "Low Stock Level", "Active"]];
    state.products.forEach(product => (product.variants || []).forEach(variant => rows.push([
      product.name, product.sku, product.barcode, deptLabel(product.category), product.type, product.season, variant.size, variant.color, variant.sku, variant.barcode,
      ...(financial ? [product.costPrice || 0] : []), product.price, variantStock(product.id, variant.id), lowStockLevel(product), product.active === false ? "No" : "Yes"
    ])));
    downloadFile("brands-planets-products.csv", toCsv(rows));
    toast("Products exported ✓");
  }

  /* ------------------------------------------------------------- form */
  function edit(id) {
    if (!can("products")) return toast("You don't have permission to edit products.", "error");
    const existing = id ? productById(id) : null;
    const product = existing ? JSON.parse(JSON.stringify(existing)) : {
      name: "", sku: "", barcode: "", category: DEPARTMENTS[0].value, type: "", season: "All Season",
      price: "", costPrice: "", lowStockLevel: state.settings.lowStockDefault ?? 5, active: true, image: "", remarks: "",
      variants: []
    };
    const canPrice = !existing || can("changePrices");
    const canStock = !existing || can("stockAdjust");
    const financial = can("financialReports");
    const standardSizes = BPStock.SIZES;
    const existingSizes = [...new Set((product.variants || []).map(variant => variant.size).filter(Boolean))];
    let sizes = existingSizes;
    let customSizes = existingSizes.filter(size => !standardSizes.includes(size));
    let colors = [...new Set((product.variants || []).map(variant => variant.color).filter(Boolean))];
    let image = product.image || "";
    // Values typed into the matrix, keyed by "size|color".
    const matrix = new Map((product.variants || []).map(variant => [`${variant.size || ""}|${variant.color || ""}`, {
      id: variant.id, sku: variant.sku || "", barcode: variant.barcode || "",
      stock: existing ? variantStock(existing.id, variant.id) : 0,
      current: existing ? variantStock(existing.id, variant.id) : 0
    }]));

    const modal = UI.openModal({
      title: existing ? `Edit ${esc(existing.name)}` : "Add product",
      subtitle: existing ? `SKU ${esc(existing.sku || "—")}` : "Fill in details, pick sizes and colours, then set stock per variant.",
      size: "xl",
      body: `<form id="productForm" novalidate>
        <div class="form-section">
          <div class="form-section-title">${icon("products", 18)} Product details</div>
          <div class="form-grid form-grid-3">
            <div class="field span-2"><label>Product name *</label><input id="pName" value="${esc(product.name)}" required></div>
            <div class="field"><label>Department</label><select id="pDept">${DEPARTMENTS.map(item => `<option value="${esc(item.value)}" ${product.category === item.value ? "selected" : ""}>${item.label}</option>`).join("")}</select></div>
            <div class="field"><label>SKU</label><input id="pSku" value="${esc(product.sku || "")}" placeholder="e.g. BP-TS-001"></div>
            <div class="field"><label>Barcode</label><input id="pBarcode" value="${esc(product.barcode || "")}" placeholder="Scan or type"></div>
            <div class="field"><label>Type</label><input id="pType" list="typeList" value="${esc(product.type || "")}" placeholder="T-Shirts, Jeans…"><datalist id="typeList">${PRODUCT_TYPES.map(type => `<option>${type}</option>`).join("")}</datalist></div>
            <div class="field"><label>Season</label><select id="pSeason">${SEASONS.map(season => `<option ${product.season === season ? "selected" : ""}>${season}</option>`).join("")}</select></div>
            <div class="field"><label>Sale price (Rs.) *</label><input id="pPrice" type="number" min="0" step="1" value="${esc(product.price)}" ${canPrice ? "" : "readonly title='You need price permission'"}>${canPrice ? "" : `<span class="hint">${icon("lock", 12)} Price locked for your role</span>`}</div>
            ${financial ? `<div class="field"><label>Cost price (Rs.)</label><input id="pCost" type="number" min="0" step="1" value="${esc(product.costPrice ?? "")}"></div>` : ""}
            <div class="field"><label>Low stock alert at</label><input id="pLow" type="number" min="0" step="1" value="${esc(product.lowStockLevel ?? 5)}"></div>
            <div class="field span-2"><label>Remarks</label><input id="pRemarks" value="${esc(product.remarks || "")}" placeholder="Optional notes"></div>
            <div class="field"><label>Status</label><label class="check" style="min-height:46px"><span class="switch"><input type="checkbox" id="pActive" ${product.active !== false ? "checked" : ""}><span></span></span> Active (sellable)</label></div>
          </div>
          <div class="image-drop">
            <span class="thumb" id="pImagePreview">${image ? `<img class="thumb" src="${image}" alt="">` : icon("image", 26)}</span>
            <div class="grow"><strong>Product photo</strong><div class="muted" style="font-size:13px">Shown on the POS and receipts. Large photos are resized automatically.</div></div>
            <label class="btn btn-soft btn-sm">${icon("download", 16)} Upload<input type="file" id="pImage" accept="image/*" hidden></label>
            <button class="btn btn-ghost btn-sm ${image ? "" : "hidden"}" id="pImageRemove" type="button">Remove</button>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">${icon("layers", 18)} Sizes & colours</div>
          <div class="field"><label>Sizes</label><div class="size-picker" id="sizePicker">${standardSizes.map(size => `<label><input type="checkbox" value="${size}" ${sizes.includes(size) ? "checked" : ""}><span>${size}</span></label>`).join("")}</div></div>
          <div class="form-grid">
            <div class="field"><label>Other sizes <span class="faint">(comma separated, e.g. 28, 30, 32)</span></label><input id="customSizes" value="${esc(customSizes.join(", "))}"></div>
            <div class="field"><label>Colours <span class="faint">(press Enter to add)</span></label><div class="tag-input" id="colorTags"></div><datalist id="colorList">${COLOR_SUGGESTIONS.map(color => `<option>${color}</option>`).join("")}</datalist></div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">${icon("inventory", 18)} Stock per variant ${canStock ? "" : `<span class="badge">${icon("lock", 12)} Stock changes need Stock Adjustment permission</span>`}</div>
          <div class="variant-matrix" id="variantMatrix"></div>
        </div>
        <div id="productError" class="form-error hidden" style="margin-top:16px"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary btn-lg" form="productForm" type="submit">${icon("check", 18)} ${existing ? "Save changes" : "Create product"}</button>`
    });
    const el = modal.el;
    el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());

    const combos = () => {
      const sizeList = [...sizes, ...customSizes.filter(size => !sizes.includes(size))];
      const sizeAxis = sizeList.length ? sizeList : [""];
      const colorAxis = colors.length ? colors : [""];
      return sizeAxis.flatMap(size => colorAxis.map(color => ({ size, color, key: `${size}|${color}` })));
    };
    const renderColors = () => {
      const box = el.querySelector("#colorTags");
      box.innerHTML = colors.map((color, index) => `<span class="tag">${esc(color)}<button type="button" data-rm-color="${index}" aria-label="Remove ${esc(color)}">${icon("x", 12)}</button></span>`).join("") + `<input id="colorInput" list="colorList" placeholder="${colors.length ? "Add colour" : "e.g. Black"}" autocomplete="off">`;
      const input = box.querySelector("#colorInput");
      const add = () => {
        input.value.split(",").map(value => value.trim()).filter(Boolean).forEach(value => {
          const name = value[0].toUpperCase() + value.slice(1);
          if (!colors.some(color => color.toLowerCase() === name.toLowerCase())) colors.push(name);
        });
        input.value = "";
        renderColors();
        renderMatrix();
        el.querySelector("#colorInput").focus();
      };
      input.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); }
        if (event.key === "Backspace" && !input.value && colors.length) { colors.pop(); renderColors(); renderMatrix(); el.querySelector("#colorInput").focus(); }
      });
      input.addEventListener("change", () => { if (input.value.trim()) add(); });
    };
    el.querySelector("#colorTags").addEventListener("click", event => {
      const index = event.target.closest("[data-rm-color]")?.dataset.rmColor;
      if (index === undefined) return;
      colors.splice(Number(index), 1);
      renderColors();
      renderMatrix();
    });
    const renderMatrix = () => {
      const list = combos();
      // Keep typed values when the first colour or size is added ("M" → "M / Black").
      const live = new Set(list.map(combo => combo.key));
      list.forEach(combo => {
        if (matrix.has(combo.key)) return;
        const fallback = [`${combo.size}|`, `|${combo.color}`, "|"].find(key => matrix.has(key) && !live.has(key));
        if (!fallback) return;
        matrix.set(combo.key, matrix.get(fallback));
        matrix.delete(fallback);
      });
      el.querySelector("#variantMatrix").innerHTML = `<div class="variant-row variant-head"><span>Variant</span><span class="vr-sku">SKU</span><span class="vr-barcode">Barcode</span><span>${existing ? "Stock" : "Opening stock"}</span><span></span></div>` +
        list.map(combo => {
          const saved = matrix.get(combo.key) || { sku: "", barcode: "", stock: 0, current: 0 };
          const label = [combo.size, combo.color].filter(Boolean).join(" / ") || "Standard";
          return `<div class="variant-row" data-combo="${esc(combo.key)}">
            <span class="vr-label">${esc(label)}${saved.id && existing ? "" : existing ? ` <span class="badge accent">new</span>` : ""}</span>
            <input class="vr-sku" data-k="sku" value="${esc(saved.sku)}" placeholder="Optional">
            <input class="vr-barcode" data-k="barcode" value="${esc(saved.barcode)}" placeholder="Optional">
            <input data-k="stock" type="number" step="1" value="${esc(saved.stock)}" ${canStock ? "" : "readonly"}>
            <span class="cell-sub">${existing && saved.id ? `was ${saved.current}` : ""}</span>
          </div>`;
        }).join("");
    };
    el.querySelector("#variantMatrix").addEventListener("input", event => {
      const row = event.target.closest("[data-combo]");
      const k = event.target.dataset.k;
      if (!row || !k) return;
      const entry = matrix.get(row.dataset.combo) || { sku: "", barcode: "", stock: 0, current: 0 };
      entry[k] = k === "stock" ? event.target.value : event.target.value.trim();
      matrix.set(row.dataset.combo, entry);
    });
    el.querySelector("#sizePicker").addEventListener("change", () => {
      sizes = $$("#sizePicker input:checked", el).map(input => input.value);
      renderMatrix();
    });
    el.querySelector("#customSizes").addEventListener("change", event => {
      customSizes = event.target.value.split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
      renderMatrix();
    });
    el.querySelector("#pImage").addEventListener("change", async event => {
      const file = event.target.files[0];
      if (!file) return;
      image = await readImageFile(file);
      el.querySelector("#pImagePreview").innerHTML = `<img class="thumb" src="${image}" alt="">`;
      el.querySelector("#pImageRemove").classList.remove("hidden");
    });
    el.querySelector("#pImageRemove").addEventListener("click", event => {
      image = "";
      el.querySelector("#pImagePreview").innerHTML = icon("image", 26);
      event.target.classList.add("hidden");
    });
    renderColors();
    renderMatrix();

    el.querySelector("#productForm").addEventListener("submit", async event => {
      event.preventDefault();
      const error = el.querySelector("#productError");
      const fail = text => { error.textContent = text; error.classList.remove("hidden"); error.scrollIntoView({ block: "nearest" }); };
      error.classList.add("hidden");
      const name = el.querySelector("#pName").value.trim();
      const price = Number(el.querySelector("#pPrice").value);
      const sku = el.querySelector("#pSku").value.trim();
      const barcode = el.querySelector("#pBarcode").value.trim();
      if (!name) return fail("Product name is required.");
      if (!Number.isFinite(price) || price < 0 || el.querySelector("#pPrice").value === "") return fail("Enter a valid sale price.");
      const list = combos();
      const variants = list.map((combo, index) => {
        const saved = matrix.get(combo.key) || {};
        return {
          id: saved.id || `v${Date.now().toString(36)}${index}`,
          size: combo.size,
          color: combo.color,
          sku: saved.sku || "",
          barcode: saved.barcode || "",
          stock: Math.round(Number(saved.stock || 0)),
          current: saved.current || 0,
          isNew: !saved.id
        };
      });
      if (variants.some(variant => !Number.isFinite(variant.stock))) return fail("Stock must be a whole number.");
      // Codes must be unique across the whole catalogue.
      const codes = [sku, barcode, ...variants.flatMap(variant => [variant.sku, variant.barcode])].filter(Boolean).map(code => code.toLowerCase());
      const duplicateInForm = codes.find((code, index) => codes.indexOf(code) !== index);
      if (duplicateInForm) return fail(`The code "${duplicateInForm}" is used twice in this product.`);
      const taken = state.products.filter(item => item.id !== existing?.id).flatMap(item => [item.sku, item.barcode, ...(item.variants || []).flatMap(variant => [variant.sku, variant.barcode])]).filter(Boolean).map(code => String(code).toLowerCase());
      const clash = codes.find(code => taken.includes(code));
      if (clash) return fail(`The SKU/barcode "${clash}" already belongs to another product.`);

      const removed = existing ? (existing.variants || []).filter(old => !variants.some(variant => variant.id === old.id)) : [];
      const removedStock = removed.reduce((total, variant) => total + variantStock(existing.id, variant.id), 0);
      if (removedStock > 0) {
        const ok = await UI.confirm({ title: "Remove variants with stock?", message: `${removed.map(BPStock.variantLabel).join(", ")} still have ${removedStock} unit(s). Removing them writes that stock off.`, confirmText: "Remove & write off" });
        if (!ok) return;
      }
      const stockChanges = existing ? variants.filter(variant => !variant.isNew && variant.stock !== variant.current) : [];
      if (existing && stockChanges.length && can("stockAdjust")) {
        const ok = await UI.confirm({ title: "Adjust stock?", message: stockChanges.map(variant => `${BPStock.variantLabel(variant) || "Standard"}: ${variant.current} → ${variant.stock}`).join("<br>"), confirmText: "Save stock changes", tone: "primary", iconName: "inventory" });
        if (!ok) return;
      }

      const now = new Date().toISOString();
      const record = existing || { id: uid("p"), createdAt: now, createdBy: currentUser().username, invV2: true };
      const oldPrice = existing ? Number(existing.price) : null;
      Object.assign(record, {
        name, sku, barcode,
        category: el.querySelector("#pDept").value,
        type: el.querySelector("#pType").value.trim(),
        season: el.querySelector("#pSeason").value,
        price: canPrice ? price : existing.price,
        lowStockLevel: Math.max(0, Math.round(Number(el.querySelector("#pLow").value || 0))),
        remarks: el.querySelector("#pRemarks").value.trim(),
        active: el.querySelector("#pActive").checked,
        image,
        discount: 0,
        invV2: true,
        variants: variants.map(({ id: vid, size, color, sku: vsku, barcode: vbarcode }) => ({ id: vid, size, color, sku: vsku, barcode: vbarcode }))
      });
      if (financial) record.costPrice = Math.max(0, Number(el.querySelector("#pCost").value || 0));
      else if (!existing) record.costPrice = 0;

      variants.forEach(variant => {
        if (!existing || variant.isNew) {
          if (variant.stock) addStockMove({ productId: record.id, variantId: variant.id, qty: variant.stock, type: existing ? "adjust" : "opening", note: existing ? "New variant" : "Opening stock" });
        } else if (can("stockAdjust") && variant.stock !== variant.current) {
          addStockMove({ productId: record.id, variantId: variant.id, qty: variant.stock - variant.current, type: "adjust", note: "Product edit" });
          audit("stock.adjust", "product", record.id, `${name} ${BPStock.variantLabel(variant) || ""}: ${variant.current} → ${variant.stock} (product edit)`);
        }
      });
      removed.forEach(variant => {
        const qty = variantStock(existing.id, variant.id);
        if (qty) addStockMove({ productId: record.id, variantId: variant.id, qty: -qty, type: "adjust", note: "Variant removed" });
      });
      if (!existing) state.products.push(record);
      invalidateCaches();
      record.stock = productStock(record);
      if (existing && oldPrice !== record.price) audit("product.price_change", "product", record.id, `${name}: ${money(oldPrice)} → ${money(record.price)}`);
      audit(existing ? "product.update" : "product.create", "product", record.id, `${existing ? "Updated" : "Created"} ${name} (${variants.length} variant${variants.length === 1 ? "" : "s"})`);
      save();
      modal.close();
      toast(existing ? "Product saved ✓" : "Product created · Inventory Updated ✓");
      Shell.rerender();
    });
  }

  async function remove(id) {
    const product = productById(id);
    if (!product || !can("products")) return;
    const stock = productStock(product);
    const ok = await UI.confirm({
      title: `Delete ${product.name}?`,
      message: `${stock ? `${stock} unit(s) in stock will no longer be tracked. ` : ""}Past sales keep their records. Consider marking it inactive instead.`,
      confirmText: "Delete product"
    });
    if (!ok) return;
    markDeleted("products", id);
    state.products = state.products.filter(item => item.id !== id);
    audit("product.delete", "product", id, `Deleted ${product.name} (${stock} in stock)`);
    save({ immediate: true });
    toast("Product deleted", "info");
    Shell.rerender();
  }

  function refresh() {
    const root = $("#view");
    if (root?.querySelector("#productTable") && !UI.hasModal()) renderTable(root);
  }

  return { render, refresh, edit };
})();
