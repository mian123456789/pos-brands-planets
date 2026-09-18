/* Sales history, invoice view and sale actions. */
Views.sales = (() => {
  const PAGE_SIZE = 50;
  let period = "today";
  let custom = { start: todayKey(), end: todayKey() };
  let search = "";
  let statusFilter = "";
  let methodFilter = "";
  let page = 1;

  function filteredBills() {
    const range = periodRange(period, custom);
    const q = search.trim().toLowerCase();
    return state.bills.filter(bill => {
      if (!dateInRange(recordDateKey(bill.date), range)) return false;
      if (statusFilter && billStatus(bill) !== statusFilter) return false;
      if (methodFilter && !billPayments(bill).some(payment => (payment.method === "Bank" ? "Bank Transfer" : payment.method) === methodFilter)) return false;
      if (q && ![bill.id, bill.customerName, bill.customerPhone, bill.cashier, ...(bill.items || []).map(item => item.name)].join(" ").toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function rowHtml(bill) {
    const totals = billTotals(bill);
    const status = billStatus(bill);
    const names = (bill.items || []).map(item => item.name);
    return `<tr class="clickable" data-bill="${esc(bill.id)}">
      <td class="cell-main" style="white-space:nowrap">${esc(bill.id)}</td>
      <td style="white-space:nowrap">${fmtDate(bill.date)}</td>
      <td class="cell-sub">${fmtTime(bill.date)}</td>
      <td><div class="cell-main">${esc(bill.customerName || "Walk-in")}</div><div class="cell-sub">${esc(bill.customerPhone || "")}</div></td>
      <td>${esc(bill.cashier || "")}</td>
      <td style="max-width:220px"><div class="cell-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(names.slice(0, 2).join(", "))}${names.length > 2 ? ` +${names.length - 2}` : ""}</div></td>
      <td class="right num">${billItemCount(bill)}</td>
      <td class="right num">${money(totals.subtotal)}</td>
      <td class="right num">${totals.promoDiscount ? `<span class="badge accent">-${money(totals.promoDiscount)}</span>` : totals.discount ? `<span class="cell-sub">-${money(totals.discount)}</span>` : "—"}</td>
      <td class="right num cell-main">${money(totals.total)}</td>
      <td>${esc(billPaymentLabel(bill))}</td>
      <td><span class="badge ${STATUS_TONE[status]}">${status}</span></td>
      <td><div class="actions">
        <button class="icon-btn sm" data-act="view" title="View invoice" type="button">${icon("eye", 17)}</button>
        <button class="icon-btn sm" data-act="print" title="Print" type="button">${icon("printer", 17)}</button>
        ${can("returns") && !isCancelled(bill) ? `<button class="icon-btn sm" data-act="return" title="Return / Exchange" type="button">${icon("returns", 17)}</button>` : ""}
      </div></td>
    </tr>`;
  }

  function renderTable(root) {
    const bills = filteredBills();
    const pages = Math.max(1, Math.ceil(bills.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const slice = bills.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const active = bills.filter(bill => !isCancelled(bill));
    root.querySelector("#salesSummary").innerHTML = [
      ["Invoices", num(active.length)],
      ["Sales total", money(sum(active, bill => billTotals(bill).total))],
      ["Promotion savings", money(sum(active, bill => billTotals(bill).promoDiscount))],
      ["Items", num(sum(active, billItemCount))],
      ["Pending", money(sum(active, billDue))]
    ].map(([label, value]) => `<div class="detail"><small>${label}</small><strong>${value}</strong></div>`).join("");
    root.querySelector("#salesTable").innerHTML = bills.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Invoice #</th><th>Date</th><th>Time</th><th>Customer</th><th>Cashier</th><th>Products</th><th class="right">Qty</th><th class="right">Subtotal</th><th class="right">Promotion</th><th class="right">Final Total</th><th>Payment</th><th>Status</th><th class="right">Actions</th></tr></thead>
      <tbody>${slice.map(rowHtml).join("")}</tbody></table></div>
      <div class="pager"><span>Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, bills.length)} of ${bills.length}</span>
        <div class="row"><button class="btn btn-soft btn-sm" data-page="-1" ${page <= 1 ? "disabled" : ""} type="button">${icon("chevronLeft", 16)} Prev</button><button class="btn btn-soft btn-sm" data-page="1" ${page >= pages ? "disabled" : ""} type="button">Next ${icon("chevronRight", 16)}</button></div>
      </div>` : UI.empty("sales", "No sales found", "Try a different date range or search.");
  }

  function render(root, params = {}) {
    if (params.q) search = params.q;
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Sales</h1><p>Every invoice, with promotions, payments and status.</p></div>
        <div class="page-actions"><button class="btn btn-soft" id="salesExport" type="button">${icon("download", 18)} Export CSV</button>${can("pos") ? `<button class="btn btn-accent" onclick="Shell.go('pos')" type="button">${icon("plus", 18)} New sale</button>` : ""}</div>
      </div>
      <div class="card">
        <div class="toolbar" style="padding-bottom:6px">
          <div class="chip-row" id="salesPeriods">${PERIODS.filter(([id]) => ["today", "yesterday", "7days", "month", "custom"].includes(id)).map(([id, label]) => `<button class="chip sm ${period === id ? "active" : ""}" data-period="${id}" type="button">${label}</button>`).join("")}</div>
          <div class="row ${period === "custom" ? "" : "hidden"}" id="customRange"><input class="input" type="date" id="rangeStart" value="${custom.start}" style="min-height:40px"><span class="muted">to</span><input class="input" type="date" id="rangeEnd" value="${custom.end}" style="min-height:40px"></div>
        </div>
        <div class="toolbar" style="padding-top:6px">
          <div class="input-icon">${icon("search", 18)}<input class="input" id="salesSearch" placeholder="Invoice #, customer, phone, cashier, product" value="${esc(search)}"></div>
          <select class="select" id="salesStatus"><option value="">All statuses</option>${Object.keys(STATUS_TONE).map(status => `<option ${statusFilter === status ? "selected" : ""}>${status}</option>`).join("")}</select>
          <select class="select" id="salesMethod"><option value="">All payments</option>${PAYMENT_METHODS.filter(item => item.id !== "Split").map(item => `<option ${methodFilter === item.id ? "selected" : ""}>${item.id}</option>`).join("")}</select>
        </div>
        <div class="detail-grid" id="salesSummary" style="padding:0 20px 16px"></div>
        <div id="salesTable" style="padding:0 8px 8px"></div>
      </div>`;
    root.querySelector("#salesPeriods").addEventListener("click", event => {
      const next = event.target.closest("[data-period]")?.dataset.period;
      if (!next) return;
      period = next;
      page = 1;
      root.querySelectorAll("#salesPeriods .chip").forEach(chip => chip.classList.toggle("active", chip.dataset.period === period));
      root.querySelector("#customRange").classList.toggle("hidden", period !== "custom");
      renderTable(root);
    });
    ["rangeStart", "rangeEnd"].forEach(id => root.querySelector(`#${id}`).addEventListener("change", () => {
      custom = { start: root.querySelector("#rangeStart").value, end: root.querySelector("#rangeEnd").value };
      renderTable(root);
    }));
    root.querySelector("#salesSearch").addEventListener("input", debounce(event => { search = event.target.value; page = 1; renderTable(root); }, 150));
    root.querySelector("#salesStatus").addEventListener("change", event => { statusFilter = event.target.value; page = 1; renderTable(root); });
    root.querySelector("#salesMethod").addEventListener("change", event => { methodFilter = event.target.value; page = 1; renderTable(root); });
    root.querySelector("#salesExport").addEventListener("click", exportCsv);
    root.querySelector("#salesTable").addEventListener("click", event => {
      const pageStep = event.target.closest("[data-page]")?.dataset.page;
      if (pageStep) { page += Number(pageStep); return renderTable(root); }
      const id = event.target.closest("[data-bill]")?.dataset.bill;
      if (!id) return;
      const act = event.target.closest("[data-act]")?.dataset.act || "view";
      const bill = state.bills.find(item => item.id === id);
      if (act === "view") openInvoice(id);
      if (act === "print") Receipt.print(bill);
      if (act === "return") Shell.go("returns", { invoice: id });
    });
    renderTable(root);
  }

  function exportCsv() {
    const rows = [["Invoice", "Date", "Time", "Customer", "Phone", "Cashier", "Outlet", "Products", "Qty", "Subtotal", "Promotion", "Legacy Discount", "Final Total", "Net After Returns", "Payment", "Paid", "Due", "Status"]];
    filteredBills().forEach(bill => {
      const totals = billTotals(bill);
      rows.push([bill.id, recordDateKey(bill.date), fmtTime(bill.date), bill.customerName, bill.customerPhone, bill.cashier, bill.outlet || "", (bill.items || []).map(item => `${item.name}${item.size ? ` ${item.size}` : ""}${item.color ? ` ${item.color}` : ""} x${item.qty}`).join("; "), billItemCount(bill), totals.subtotal, totals.promoDiscount, totals.itemDiscount + totals.billLevelDiscount, totals.total, billNetTotal(bill), billPaymentLabel(bill), billAmountPaid(bill), billDue(bill), billStatus(bill)]);
    });
    downloadFile(`brands-planets-sales-${periodRange(period, custom).start}.csv`, toCsv(rows));
    toast("Sales exported ✓");
  }

  /* ---------------------------------------------------------- invoice */
  function openInvoice(id) {
    const bill = state.bills.find(item => item.id === id);
    if (!bill) return toast("Invoice not found.", "error");
    const status = billStatus(bill);
    const returns = billReturns(bill);
    const totals = billTotals(bill);
    const actions = [
      `<button class="btn btn-primary" data-inv="print" type="button">${icon("printer", 18)} Print</button>`,
      Receipt.whatsappPhone(bill.customerPhone) ? `<button class="btn btn-whatsapp" data-inv="wa" type="button">${icon("whatsapp", 18)} WhatsApp</button>` : "",
      can("returns") && !isCancelled(bill) ? `<button class="btn btn-soft" data-inv="return" type="button">${icon("returns", 18)} Return / Exchange</button>` : "",
      can("editSales") && !isCancelled(bill) ? `<button class="btn btn-soft" data-inv="edit" type="button">${icon("edit", 18)} ${billDue(bill) > 0 ? "Receive payment" : "Edit details"}</button>` : "",
      can("cancelSales") && !isCancelled(bill) ? `<button class="btn btn-soft" data-inv="cancel" type="button" style="color:var(--bad)">${icon("ban", 18)} Cancel sale</button>` : "",
      can("deleteSales") ? `<button class="btn btn-danger" data-inv="delete" type="button">${icon("trash", 18)} Delete</button>` : ""
    ].join("");
    const modal = UI.openModal({
      title: `Invoice ${esc(bill.id)}`,
      subtitle: `${fmtDateTime(bill.date)} · ${esc(bill.cashier || "")} · <span class="badge ${STATUS_TONE[status]}">${status}</span>`,
      size: "lg",
      body: `<div class="grid grid-2" style="align-items:start">
        <div class="invoice-preview">${Receipt.html(bill)}</div>
        <div class="stack">
          <div class="detail-grid">
            <div class="detail"><small>Final total</small><strong>${money(totals.total)}</strong></div>
            <div class="detail"><small>Paid</small><strong>${money(billAmountPaid(bill))}</strong></div>
            <div class="detail"><small>Due</small><strong>${money(billDue(bill))}</strong></div>
            <div class="detail"><small>Net after returns</small><strong>${money(billNetTotal(bill))}</strong></div>
          </div>
          ${totals.promoDiscount ? `<div class="promo-banner" style="margin:0"><span class="pb-icon">🎁</span><div><strong>${esc((bill.promotions || []).map(promo => BPPromotions.promoLabel(promo)).join(", "))}</strong><small>Saved ${money(totals.promoDiscount)} · Free: ${esc((bill.promotions || []).flatMap(promo => promo.freeItems || []).map(item => item.name).join(", "))}</small></div></div>` : ""}
          ${isCancelled(bill) ? `<div class="form-error">Cancelled by ${esc(bill.cancelledBy || "")} on ${fmtDateTime(bill.cancelledAt)}${bill.cancelReason ? ` — ${esc(bill.cancelReason)}` : ""}</div>` : ""}
          ${returns.length ? `<div class="card card-pad" style="box-shadow:none"><strong>Returns & exchanges</strong>${returns.map(record => `<div class="list-item"><div class="grow"><strong>${record.type === "exchange" ? "Exchange" : "Return"} · ${esc(record.reason || "")}</strong><small>${fmtDateTime(record.date)} · ${esc(record.user || "")}</small></div><span class="num cell-main">${record.netChange < 0 ? "Refund " : record.netChange > 0 ? "Collected " : ""}${money(Math.abs(record.netChange))}</span></div>`).join("")}</div>` : ""}
          <div class="row wrap">${actions}</div>
        </div>
      </div>`
    });
    modal.el.addEventListener("click", async event => {
      const act = event.target.closest("[data-inv]")?.dataset.inv;
      if (!act) return;
      if (act === "print") Receipt.print(bill);
      if (act === "wa") Receipt.sendWhatsApp(bill);
      if (act === "return") { modal.close(); Shell.go("returns", { invoice: bill.id }); }
      if (act === "edit") { modal.close(); editSale(bill.id); }
      if (act === "cancel") { if (await cancelSale(bill.id)) modal.close(); }
      if (act === "delete") { if (await deleteSale(bill.id)) modal.close(); }
    });
  }

  function notifyAdmin(title, bill, detail) {
    if (isAdmin()) return;
    addAdminNotification({
      type: "billChange",
      title,
      detail,
      bill: { id: bill.id, customer: bill.customerName, phone: bill.customerPhone, cashier: bill.cashier, total: billTotals(bill).total, items: (bill.items || []).map(item => `${item.name} x${item.qty}`).join(", ") }
    });
  }

  async function cancelSale(id) {
    const bill = state.bills.find(item => item.id === id);
    if (!bill || !can("cancelSales")) return false;
    const reason = await UI.confirm({
      title: `Cancel sale ${bill.id}?`,
      message: `Stock for the remaining items will be returned to inventory and ${money(billNetTotal(bill))} will no longer count as a sale.`,
      confirmText: "Cancel sale",
      input: { label: "Reason", placeholder: "e.g. Customer changed mind at counter", required: true }
    });
    if (reason === null) return false;
    currentLines(bill).forEach(line => {
      if (line.qty > 0) addStockMove({ productId: line.id, variantId: line.variantId, qty: line.qty, type: "cancel", ref: bill.id, note: reason });
    });
    bill.status = "Cancelled";
    bill.cancelledAt = new Date().toISOString();
    bill.cancelledBy = currentUser().username;
    bill.cancelReason = reason;
    audit("sale.cancel", "bill", bill.id, `Cancelled ${bill.id} (${money(billTotals(bill).total)}) — ${reason}`);
    notifyAdmin("Sale Cancelled", bill, `${currentUser().username} cancelled ${bill.id}: ${reason}`);
    save({ immediate: true });
    toast("Sale cancelled · Inventory Updated ✓");
    Shell.rerender();
    return true;
  }

  async function deleteSale(id) {
    const bill = state.bills.find(item => item.id === id);
    if (!bill || !can("deleteSales")) return false;
    const ok = await UI.confirm({
      title: `Delete invoice ${bill.id}?`,
      message: "The invoice is removed from all reports. Stock is <strong>not</strong> restored — use Cancel sale to put items back in stock.",
      confirmText: "Delete permanently",
      input: { label: `Type ${bill.id} to confirm`, required: true }
    });
    if (ok === null) return false;
    if (ok.trim() !== bill.id) {
      toast("Invoice number didn't match — nothing deleted.", "warn");
      return false;
    }
    notifyAdmin("Sale Deleted", bill, `${currentUser().username} deleted ${bill.id}.`);
    audit("sale.delete", "bill", bill.id, `Deleted ${bill.id} (${money(billTotals(bill).total)}, ${bill.customerName || "walk-in"})`);
    markDeleted("bills", bill.id);
    state.bills = state.bills.filter(item => item.id !== bill.id);
    save({ immediate: true });
    toast("Invoice deleted", "info");
    Shell.rerender();
    return true;
  }

  function editSale(id) {
    const bill = state.bills.find(item => item.id === id);
    if (!bill || !can("editSales")) return;
    const due = billDue(bill);
    const modal = UI.openModal({
      title: due > 0 ? "Receive payment" : "Edit sale details",
      subtitle: `${esc(bill.id)} · total ${money(billTotals(bill).total)}${due > 0 ? ` · due ${money(due)}` : ""}`,
      size: "md",
      body: `<form id="saleEdit" class="form-grid">
        <div class="field"><label>Customer name</label><input id="seName" value="${esc(bill.customerName || "")}"></div>
        <div class="field"><label>Phone</label><input id="sePhone" value="${esc(bill.customerPhone || "")}" inputmode="tel"></div>
        <div class="field"><label>Sale channel</label><select id="seMode">${SALE_MODES.map(mode => `<option ${bill.saleMode === mode ? "selected" : ""}>${mode}</option>`).join("")}</select></div>
        ${due > 0 ? `<div class="field"><label>Payment method</label><select id="seMethod">${PAYMENT_METHODS.filter(item => item.id !== "Split").map(item => `<option>${item.id}</option>`).join("")}</select></div>
          <div class="field"><label>Amount received now</label><input id="seAmount" type="number" min="0" max="${due}" value="${due}"></div>
          <div class="field"><label>Reference</label><input id="seRef" placeholder="Optional"></div>` : ""}
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="saleEdit" type="submit">${icon("check", 18)} Save</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#saleEdit").addEventListener("submit", event => {
      event.preventDefault();
      const changes = [];
      const name = modal.el.querySelector("#seName").value.trim();
      const phone = modal.el.querySelector("#sePhone").value.trim();
      if (name !== bill.customerName) changes.push(`customer "${name}"`);
      bill.customerName = name || bill.customerName;
      bill.customerPhone = phone;
      bill.saleMode = modal.el.querySelector("#seMode").value;
      if (due > 0) {
        const amount = clamp(Number(modal.el.querySelector("#seAmount").value || 0), 0, due);
        const method = modal.el.querySelector("#seMethod").value;
        const ref = modal.el.querySelector("#seRef").value.trim();
        if (amount > 0) {
          if (bill.v === 2) {
            bill.payments = [...billPayments(bill), { method, amount, tendered: amount, ref, date: new Date().toISOString(), by: currentUser().username }];
            bill.received = Number(bill.received || 0) + amount;
            if (bill.payments.length > 1) bill.paymentMethod = "Split";
          } else {
            bill.received = Number(bill.received || 0) + amount;
          }
          if (billDue(bill) <= 0) bill.paymentStatus = "Paid";
          changes.push(`received ${money(amount)} by ${method}`);
        }
      }
      bill.editedAt = new Date().toISOString();
      bill.editedBy = currentUser().username;
      audit("sale.edit", "bill", bill.id, `Edited ${bill.id}${changes.length ? `: ${changes.join(", ")}` : ""}`);
      save();
      modal.close();
      toast(due > 0 ? "Payment Successful ✓" : "Sale updated ✓");
      Shell.rerender();
    });
  }

  function refresh() {
    const root = $("#view");
    if (root && !UI.hasModal()) renderTable(root);
  }

  return { render, refresh, openInvoice, cancelSale, deleteSale };
})();
