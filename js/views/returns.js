/*
 * Exchanges (exchange-only policy, no cash refunds). The price difference is always "what the customer paid before"
 * minus "what the remaining items cost under the invoice's original pricing"
 * (including its Buy X Get Y snapshot), so a free item can never be refunded
 * as if it had been paid for.
 */
Views.returns = (() => {
  let root = null;
  let query = "";
  let billId = "";
  // Store policy: exchange only — returned items must be swapped, never refunded in cash.
  const mode = "exchange";
  let picks = {};
  let reason = RETURN_REASONS[0];
  let note = "";
  let restock = true;
  let method = "Cash";
  let replacements = [];

  function reset() {
    picks = {};
    reason = RETURN_REASONS[0];
    note = "";
    restock = true;
    replacements = [];
    method = "Cash";
  }

  function findBills(q) {
    const text = q.trim().toLowerCase();
    if (!text) return state.bills.filter(bill => !isCancelled(bill)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
    const digits = text.replace(/\D/g, "");
    return state.bills.filter(bill => {
      if (isCancelled(bill)) return false;
      if (String(bill.id).toLowerCase().includes(text)) return true;
      if (digits.length >= 4 && phoneKey(bill.customerPhone).includes(digits)) return true;
      return (bill.items || []).some(item => [item.barcode, item.sku].filter(Boolean).some(code => String(code).toLowerCase() === text) || productById(item.id)?.barcode?.toLowerCase() === text);
    }).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20);
  }

  function computeChange(bill) {
    const before = currentLines(bill);
    const oldNet = priceLines(bill, before);
    const after = before.map(line => ({ ...line, qty: line.qty - (picks[line.key] || 0) }));
    const replacementLines = mode === "exchange" ? replacements.map((item, index) => {
      const product = productById(item.productId);
      const variant = product?.variants?.find(entry => entry.id === item.variantId) || {};
      return {
        key: `x-new-${index}`,
        id: item.productId,
        variantId: item.variantId,
        name: product?.name || "",
        sku: variant.sku || product?.sku || "",
        barcode: variant.barcode || product?.barcode || "",
        size: variant.size || "",
        color: variant.color || "",
        category: product?.category || "",
        type: product?.type || "",
        season: product?.season || "",
        price: Number(product?.price || 0),
        qty: item.qty,
        ...(product?.costPrice !== undefined ? { cost: Number(product.costPrice || 0) } : {})
      };
    }) : [];
    const newNet = priceLines(bill, [...after, ...replacementLines]);
    const returned = before.filter(line => picks[line.key] > 0).map(line => ({
      key: line.key, id: line.id, variantId: line.variantId, name: line.name, sku: line.sku || "", size: line.size || "", color: line.color || "",
      price: Number(line.price || 0), qty: picks[line.key], ...(line.cost !== undefined ? { cost: line.cost } : {})
    }));
    return { oldNet, newNet, netChange: Math.round(newNet - oldNet), returned, replacementLines };
  }

  function billCard(bill) {
    const status = billStatus(bill);
    return `<button class="list-item" style="width:100%;text-align:left" data-pick-bill="${esc(bill.id)}" type="button">
      <span class="thumb">${icon("sales", 18)}</span>
      <span class="grow"><strong>${esc(bill.id)} · ${esc(bill.customerName || "Walk-in")}</strong><small>${fmtDateTime(bill.date)} · ${billItemCount(bill)} item(s) · ${esc(bill.customerPhone || "no phone")}</small></span>
      <span class="right"><strong class="num">${money(billTotals(bill).total)}</strong><div><span class="badge ${STATUS_TONE[status]}">${status}</span></div></span>
    </button>`;
  }

  function renderFinder() {
    const results = findBills(query);
    return `<div class="card card-pad">
      <div class="form-section-title" style="margin-bottom:12px">${icon("search", 18)} Find the sale</div>
      <div class="input-icon">${icon("barcode", 20)}<input class="input" id="retSearch" placeholder="Invoice number, customer phone, or scan item barcode" value="${esc(query)}" autocomplete="off" style="min-height:54px;font-size:16px"></div>
      <div class="list" style="margin-top:10px">${results.length ? results.map(billCard).join("") : UI.empty("search", "No matching sales", "Check the invoice number or phone.")}</div>
      ${!query ? `<p class="muted" style="font-size:13px;margin-top:8px">Showing the latest sales. Scanning a product barcode finds sales that include it.</p>` : ""}
    </div>`;
  }

  function lineRow(line, bill) {
    const product = productById(line.id);
    const picked = picks[line.key] || 0;
    const free = bill.v === 2 ? Number((bill.items || []).find((item, index) => lineKey(item, index) === line.key)?.freeQty || 0) : 0;
    const disabled = line.qty <= 0;
    return `<div class="return-line ${picked ? "selected" : ""} ${disabled ? "disabled" : ""}" data-line="${esc(line.key)}">
      <input type="checkbox" data-toggle ${picked ? "checked" : ""} ${disabled ? "disabled" : ""} style="width:22px;height:22px;accent-color:var(--accent)" aria-label="Select ${esc(line.name)}">
      ${product?.image ? `<img class="thumb" src="${product.image}" alt="">` : `<span class="thumb">${esc(initials(line.name))}</span>`}
      <div><div class="cell-main">${esc(line.name)}${line.replacement ? ` <span class="badge info">exchanged in</span>` : ""}${free ? ` <span class="free-tag">had ${free} FREE</span>` : ""}</div><div class="cell-sub">${esc([line.size, line.color].filter(Boolean).join(" / ") || "Standard")} · ${money(line.price)} · ${disabled ? "all returned" : `${line.qty} with customer`}</div></div>
      <div class="qty"><button data-q="-1" type="button" ${disabled ? "disabled" : ""}>${icon("minus", 15)}</button><strong>${picked}</strong><button data-q="1" type="button" ${disabled ? "disabled" : ""}>${icon("plus", 15)}</button></div>
      <span class="num cell-main" style="min-width:90px;text-align:right">${picked ? money(picked * line.price) : ""}</span>
    </div>`;
  }

  function replacementHtml() {
    return `<div class="form-section">
      <div class="form-section-title">${icon("plus", 18)} New items for the exchange</div>
      <div class="customer-search input-icon" style="margin:0">${icon("search", 18)}<input class="input" id="repSearch" placeholder="Search or scan the replacement product" autocomplete="off"><div class="customer-results hidden" id="repResults"></div></div>
      ${replacements.length ? replacements.map((item, index) => {
        const product = productById(item.productId);
        const sizes = [...new Set(product.variants.map(variant => variant.size).filter(Boolean))];
        const current = product.variants.find(variant => variant.id === item.variantId) || {};
        const colors = [...new Set(product.variants.filter(variant => !current.size || variant.size === current.size).map(variant => variant.color).filter(Boolean))];
        return `<div class="return-line selected" data-rep="${index}" style="grid-template-columns:48px minmax(0,1fr) auto auto auto">
          ${product.image ? `<img class="thumb" src="${product.image}" alt="">` : `<span class="thumb">${esc(initials(product.name))}</span>`}
          <div><div class="cell-main">${esc(product.name)}</div><div class="cl-variants">${sizes.length ? `<select data-rep-field="size">${sizes.map(size => `<option ${size === current.size ? "selected" : ""}>${esc(size)}</option>`).join("")}</select>` : ""}${colors.length ? `<select data-rep-field="color">${colors.map(color => `<option ${color === current.color ? "selected" : ""}>${esc(color)}</option>`).join("")}</select>` : ""}<span class="cell-sub">${variantStock(product.id, item.variantId)} in stock</span></div></div>
          <div class="qty"><button data-rq="-1" type="button">${icon("minus", 15)}</button><strong>${item.qty}</strong><button data-rq="1" type="button">${icon("plus", 15)}</button></div>
          <span class="num cell-main">${money(product.price * item.qty)}</span>
          <button class="icon-btn sm danger" data-rep-remove type="button">${icon("trash", 16)}</button>
        </div>`;
      }).join("") : `<p class="muted" style="font-size:13.5px">Tip: for a size swap, pick the same product here and choose the new size.</p>`}
    </div>`;
  }

  function renderDetail(bill) {
    const lines = currentLines(bill);
    const change = computeChange(bill);
    const count = change.returned.reduce((total, item) => total + item.qty, 0);
    const diff = change.netChange;
    const hasSomething = count > 0 && replacements.length > 0 && diff >= 0;
    const verdict = diff < 0
      ? { label: "Add more items (no refunds)", tone: "bad", amount: -diff }
      : diff > 0 ? { label: "Customer pays", tone: "good", amount: diff } : { label: "Even exchange", tone: "info", amount: 0 };
    const blocker = !count ? "Select the item(s) the customer is bringing back."
      : !replacements.length ? "Add the new item(s) the customer is taking."
      : diff < 0 ? `Exchange only — no cash refunds. Pick new items worth at least ${money(-diff)} more.` : "";
    return `<div class="split-main">
      <div class="stack">
        <div class="card card-pad">
          <div class="row between wrap" style="margin-bottom:12px">
            <div><h3 style="font-size:17px">${esc(bill.id)}</h3><p class="muted" style="font-size:13px">${fmtDateTime(bill.date)} · ${esc(bill.customerName || "Walk-in")} ${bill.customerPhone ? `· ${esc(bill.customerPhone)}` : ""} · paid ${money(billNetTotal(bill))}</p></div>
            <button class="btn btn-ghost btn-sm" data-change-bill type="button">${icon("chevronLeft", 16)} Choose another sale</button>
          </div>
          <div class="badge info" style="margin-bottom:14px">${icon("returns", 13)} Exchange only · no cash refunds</div>
          <div class="stack" style="gap:8px" id="retLines">${lines.map(line => lineRow(line, bill)).join("")}</div>
        </div>
        ${mode === "exchange" ? `<div class="card card-pad" id="repBox">${replacementHtml()}</div>` : ""}
      </div>
      <div class="stack">
        <div class="card card-pad">
          <div class="form-section">
            <div class="field"><label>Reason</label><select id="retReason">${RETURN_REASONS.map(item => `<option ${reason === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
            <div class="field"><label>Note ${reason === "Other" ? "*" : `<span class="faint">(optional)</span>`}</label><input id="retNote" value="${esc(note)}" placeholder="Details for the record"></div>
            <label class="check"><span class="switch"><input type="checkbox" id="retRestock" ${restock ? "checked" : ""}><span></span></span> Put the items coming back into stock (turn off for damaged items)</label>
          </div>
        </div>
        <div class="card card-pad">
          <div class="summary-box">
            <div class="sum-row"><span>Items returned</span><strong>${count}</strong></div>
            ${mode === "exchange" ? `<div class="sum-row"><span>New items</span><strong>${replacements.reduce((total, item) => total + item.qty, 0)}</strong></div>` : ""}
            <div class="sum-row"><span>Customer paid for current items</span><strong>${money(change.oldNet)}</strong></div>
            <div class="sum-row"><span>Value after ${mode}</span><strong>${money(change.newNet)}</strong></div>
            ${bill.v === 2 && (bill.promoSnapshot || []).length ? `<div class="sum-row promo"><span>🎁 Deal re-applied to what the customer keeps</span></div>` : ""}
            <div class="sum-row total"><span>${verdict.label}</span><strong style="color:var(--${verdict.tone})">${money(verdict.amount)}</strong></div>
          </div>
          ${diff > 0 ? `<div class="field" style="margin-top:12px"><label>Payment method</label><select id="retMethod">${PAYMENT_METHODS.filter(item => item.id !== "Split").map(item => `<option ${method === item.id ? "selected" : ""}>${item.id}</option>`).join("")}</select></div>` : ""}
          ${blocker ? `<div class="form-error" style="margin-top:12px">${esc(blocker)}</div>` : ""}
          <button class="btn btn-accent btn-xl btn-block" id="retProcess" type="button" style="margin-top:14px" ${hasSomething ? "" : "disabled"}>${icon("check", 20)} Process exchange</button>
        </div>
      </div>
    </div>`;
  }

  function draw() {
    if (!root) return;
    const bill = billId ? state.bills.find(item => item.id === billId) : null;
    root.querySelector("#retBody").innerHTML = bill ? renderDetail(bill) : renderFinder();
    if (!bill) {
      const input = root.querySelector("#retSearch");
      input.addEventListener("input", debounce(event => {
        query = event.target.value;
        const pos = event.target.selectionStart;
        draw();
        const next = root.querySelector("#retSearch");
        next.focus();
        next.setSelectionRange(pos, pos);
      }, 200));
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          const results = findBills(input.value);
          if (results.length === 1) selectBill(results[0].id);
        }
      });
      if (window.matchMedia("(pointer: fine)").matches) input.focus();
    } else {
      bindRepSearch();
    }
    renderRecent();
  }

  function selectBill(id) {
    billId = id;
    reset();
    draw();
  }

  function bindRepSearch() {
    const input = root.querySelector("#repSearch");
    if (!input) return;
    const results = root.querySelector("#repResults");
    input.addEventListener("input", debounce(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) return results.classList.add("hidden");
      const matches = state.products.filter(product => product.active !== false && [product.name, product.sku, product.barcode, ...(product.variants || []).flatMap(variant => [variant.sku, variant.barcode])].join(" ").toLowerCase().includes(q)).slice(0, 8);
      results.innerHTML = matches.map(product => `<button class="search-item" data-add-rep="${esc(product.id)}" type="button"><span class="thumb sm">${esc(initials(product.name))}</span><span><strong>${esc(product.name)}</strong><small>${money(product.price)} · ${productStock(product)} in stock</small></span></button>`).join("") || `<div class="empty-state" style="padding:12px">No products</div>`;
      results.classList.remove("hidden");
    }, 100));
    input.addEventListener("blur", () => setTimeout(() => results.classList.add("hidden"), 160));
    results.addEventListener("mousedown", event => event.preventDefault());
    results.addEventListener("click", event => {
      const id = event.target.closest("[data-add-rep]")?.dataset.addRep;
      if (id) addReplacement(id);
    });
  }

  function addReplacement(productId, variantId) {
    const product = productById(productId);
    if (!product) return;
    const reserved = id => replacements.filter(item => item.productId === productId && item.variantId === id).reduce((total, item) => total + item.qty, 0);
    const variant = variantId ? product.variants.find(item => item.id === variantId) : product.variants.find(item => variantStock(productId, item.id) - reserved(item.id) > 0);
    if (!variant || variantStock(productId, variant.id) - reserved(variant.id) <= 0) return toast(`${product.name} is out of stock.`, "error");
    const existing = replacements.find(item => item.productId === productId && item.variantId === variant.id);
    if (existing) existing.qty += 1;
    else replacements.push({ productId, variantId: variant.id, qty: 1 });
    draw();
    toast("Exchange item added ✓", "success", 1200);
  }

  function handleBarcode(code) {
    const bill = billId ? state.bills.find(item => item.id === billId) : null;
    if (!bill) {
      query = code;
      draw();
      const results = findBills(code);
      if (results.length === 1) selectBill(results[0].id);
      return;
    }
    const match = barcodeMap().get(String(code).toLowerCase());
    if (!match) return toast(`No product found for "${code}".`, "error");
    // An item from this invoice that isn't selected yet = coming back; anything else = the new item.
    const line = currentLines(bill).find(item => item.qty > (picks[item.key] || 0) && item.id === match.product.id && (!match.variant || item.variantId === match.variant.id));
    if (line && !replacements.length) {
      picks[line.key] = (picks[line.key] || 0) + 1;
      return draw();
    }
    addReplacement(match.product.id, match.variant?.id);
  }

  async function process() {
    const bill = state.bills.find(item => item.id === billId);
    if (!bill) return;
    if (reason === "Other" && !note.trim()) return toast("Add a note explaining the reason.", "warn");
    const change = computeChange(bill);
    if (!change.returned.length) return toast("Select the item(s) the customer is bringing back.", "warn");
    if (!change.replacementLines.length) return toast("Add the new item(s) for the exchange — cash refunds aren't allowed.", "warn");
    if (change.netChange < 0) return toast(`Exchange only — pick new items worth at least ${money(-change.netChange)} more.`, "warn");
    for (const line of change.replacementLines) {
      const needed = change.replacementLines.filter(item => item.id === line.id && item.variantId === line.variantId).reduce((total, item) => total + item.qty, 0);
      if (needed > variantStock(line.id, line.variantId)) return toast(`Not enough stock for ${line.name} ${[line.size, line.color].filter(Boolean).join(" ")}.`, "error");
    }
    const diff = change.netChange;
    const summary = `${change.returned.map(item => `${item.name} ${[item.size, item.color].filter(Boolean).join("/")} x${item.qty}`).join(", ") || "no items returned"}${change.replacementLines.length ? `<br>New: ${change.replacementLines.map(item => `${item.name} ${[item.size, item.color].filter(Boolean).join("/")} x${item.qty}`).join(", ")}` : ""}`;
    const ok = await UI.confirm({
      title: "Process exchange?",
      message: `${esc(summary)}<br><br><strong>${diff > 0 ? `Collect ${money(diff)} by ${method}` : "Even exchange — no money changes hands"}</strong>${restock ? "" : "<br>Items coming back will NOT go back into stock."}`,
      confirmText: "Confirm exchange",
      tone: "primary",
      iconName: "returns"
    });
    if (!ok) return;
    const recordId = uid("r");
    const record = {
      id: recordId,
      date: new Date().toISOString(),
      billId: bill.id,
      type: mode,
      reason,
      note: note.trim(),
      restock,
      user: currentUser().username,
      outletId: currentOutlet().id,
      returned: change.returned,
      replacement: change.replacementLines.map(({ key, ...item }, index) => ({ ...item, key: `x-${recordId}-${index}` })),
      netChange: diff,
      method: diff ? method : ""
    };
    if (restock) record.returned.forEach(item => addStockMove({ productId: item.id, variantId: item.variantId, qty: item.qty, type: "exchange-in", ref: bill.id, note: reason }));
    record.replacement.forEach(item => addStockMove({ productId: item.id, variantId: item.variantId, qty: -item.qty, type: "exchange-out", ref: bill.id, note: reason }));
    state.returns.push(record);
    audit("exchange.create", "bill", bill.id, `Exchange on ${bill.id}: ${record.returned.reduce((t, i) => t + i.qty, 0)} back, ${record.replacement.reduce((t, i) => t + i.qty, 0)} new · ${diff > 0 ? `collected ${money(diff)}` : "even"} · ${reason}`);
    save({ immediate: true });
    toast("Exchange completed · Inventory Updated ✓");
    const done = UI.openModal({
      size: "sm",
      body: `<div class="success-view">
        <div class="success-check"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
        <h2>Exchange completed</h2>
        <p class="muted">${diff > 0 ? `Collect ${money(diff)} from the customer (${esc(method)}).` : "Even exchange — nothing to pay."}</p>
      </div>`,
      footer: `<button class="btn btn-soft" data-print type="button">${icon("printer", 18)} Print updated receipt</button><button class="btn btn-primary" data-close type="button">Done</button>`
    });
    done.el.querySelector("[data-print]").addEventListener("click", () => Receipt.print(bill, "Updated Receipt"));
    done.el.querySelector("[data-close]")?.addEventListener("click", () => done.close());
    billId = "";
    query = "";
    reset();
    draw();
  }

  function renderRecent() {
    const box = root.querySelector("#retRecent");
    const recent = state.returns.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 15);
    box.innerHTML = recent.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Invoice</th><th>Type</th><th>Items</th><th>Reason</th><th class="right">Amount</th><th>By</th></tr></thead><tbody>
      ${recent.map(record => `<tr class="clickable" data-open-bill="${esc(record.billId)}"><td class="cell-sub">${fmtDateTime(record.date)}</td><td class="cell-main">${esc(record.billId)}</td><td><span class="badge ${record.type === "exchange" ? "info" : "warn"}">${record.type === "exchange" ? "Exchange" : "Return"}</span></td><td class="cell-sub">${esc((record.returned || []).map(item => `${item.name} x${item.qty}`).join(", "))}${record.replacement?.length ? ` → ${esc(record.replacement.map(item => `${item.name} ${item.size || ""} x${item.qty}`).join(", "))}` : ""}</td><td>${esc(record.reason || "")}</td><td class="right num cell-main">${record.netChange < 0 ? `-${money(-record.netChange)}` : record.netChange > 0 ? `+${money(record.netChange)}` : money(0)}</td><td>${esc(record.user || "")}</td></tr>`).join("")}
    </tbody></table></div>` : UI.empty("returns", "No exchanges yet");
  }

  function render(container, params = {}) {
    root = container;
    // Only start fresh when a different invoice is opened, so a re-render never wipes an exchange in progress.
    if (params.invoice && params.invoice !== billId && state.bills.some(bill => bill.id === params.invoice)) {
      billId = params.invoice;
      reset();
    }
    root.innerHTML = `
      <div class="page-head"><div><h1>Exchanges</h1><p>Exchange only — no cash refunds. Find the sale, pick the items coming back and the new items going out. Stock updates automatically.</p></div></div>
      <div id="retBody"></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h3>Recent exchanges</h3></div></div><div class="card-body" id="retRecent"></div></div>`;
    root.addEventListener("click", event => {
      const pickBill = event.target.closest("[data-pick-bill]")?.dataset.pickBill;
      if (pickBill) return selectBill(pickBill);
      if (event.target.closest("[data-change-bill]")) { billId = ""; reset(); return draw(); }
      const lineEl = event.target.closest("[data-line]");
      const bill = state.bills.find(item => item.id === billId);
      if (lineEl && bill) {
        const line = currentLines(bill).find(item => item.key === lineEl.dataset.line);
        if (!line || line.qty <= 0) return;
        const step = event.target.closest("[data-q]")?.dataset.q;
        if (step) picks[line.key] = clamp((picks[line.key] || 0) + Number(step), 0, line.qty);
        else if (event.target.closest("[data-toggle]") || !event.target.closest("button")) picks[line.key] = picks[line.key] ? 0 : 1;
        return draw();
      }
      const repEl = event.target.closest("[data-rep]");
      if (repEl) {
        const index = Number(repEl.dataset.rep);
        const item = replacements[index];
        const step = event.target.closest("[data-rq]")?.dataset.rq;
        if (step) {
          const next = item.qty + Number(step);
          if (next < 1) replacements.splice(index, 1);
          else if (next > variantStock(item.productId, item.variantId)) return toast("Not enough stock.", "error");
          else item.qty = next;
          return draw();
        }
        if (event.target.closest("[data-rep-remove]")) { replacements.splice(index, 1); return draw(); }
      }
      if (event.target.closest("#retProcess")) return process();
      const openBill = event.target.closest("[data-open-bill]")?.dataset.openBill;
      if (openBill && can("sales")) Views.sales.openInvoice(openBill);
    });
    root.addEventListener("change", event => {
      if (event.target.id === "retReason") {
        reason = event.target.value;
        if (reason === "Damaged") restock = false;
        return draw();
      }
      if (event.target.id === "retRestock") { restock = event.target.checked; return; }
      if (event.target.id === "retMethod") { method = event.target.value; return; }
      const field = event.target.dataset.repField;
      if (field) {
        const index = Number(event.target.closest("[data-rep]").dataset.rep);
        const item = replacements[index];
        const product = productById(item.productId);
        const current = product.variants.find(variant => variant.id === item.variantId) || {};
        const want = { size: current.size || "", color: current.color || "", [field]: event.target.value };
        const match = product.variants.find(variant => (variant.size || "") === want.size && (variant.color || "") === want.color) || product.variants.find(variant => (variant[field] || "") === event.target.value);
        if (match) {
          if (variantStock(product.id, match.id) < item.qty) toast(`${BPStock.variantLabel(match)} has only ${variantStock(product.id, match.id)} in stock.`, "warn");
          item.variantId = match.id;
        }
        draw();
      }
    });
    root.addEventListener("input", event => {
      if (event.target.id === "retNote") note = event.target.value;
    });
    draw();
  }

  // Data synced from another till: redraw in place, keeping the current selections.
  function refresh() {
    if (root && document.contains(root) && !UI.hasModal()) draw();
  }

  return { render, refresh, handleBarcode };
})();
