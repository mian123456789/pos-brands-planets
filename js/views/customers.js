/* Customers: directory, stats and purchase history. */
Views.customers = (() => {
  let search = "";
  let sort = "recent";

  function rows() {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return allCustomers().filter(customer => !q || String(customer.name || "").toLowerCase().includes(q) || (digits && phoneKey(customer.phone).includes(digits)) || String(customer.email || "").toLowerCase().includes(q))
      .map(customer => ({ customer, stats: customerStats(customer.phone) }))
      .sort((a, b) => sort === "spent" ? b.stats.spent - a.stats.spent : sort === "orders" ? b.stats.orders - a.stats.orders : sort === "name" ? String(a.customer.name).localeCompare(String(b.customer.name)) : String(b.stats.last || b.customer.createdAt || "").localeCompare(String(a.stats.last || a.customer.createdAt || "")));
  }

  function renderTable(root) {
    const list = rows();
    root.querySelector("#custTable").innerHTML = list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th class="right">Total orders</th><th class="right">Total spending</th><th>Last purchase</th><th></th></tr></thead>
      <tbody>${list.slice(0, 400).map(({ customer, stats }) => `<tr class="clickable" data-id="${esc(customer.id)}">
        <td><div class="product-cell"><span class="avatar navy" style="width:36px;height:36px">${esc(initials(customer.name))}</span><div><div class="cell-main">${esc(customer.name)}</div>${customer.saved ? "" : `<div class="cell-sub">From past invoices</div>`}</div></div></td>
        <td>${esc(customer.phone || "—")}</td>
        <td class="cell-sub">${esc(customer.email || "—")}</td>
        <td class="right num">${stats.orders}</td>
        <td class="right num cell-main">${money(stats.spent)}</td>
        <td class="cell-sub">${stats.last ? fmtDate(stats.last) : "—"}</td>
        <td><div class="actions"><button class="icon-btn sm" data-act="edit" title="Edit" type="button">${icon("edit", 16)}</button>${customer.saved && can("customers") ? `<button class="icon-btn sm danger" data-act="delete" title="Delete" type="button">${icon("trash", 16)}</button>` : ""}</div></td>
      </tr>`).join("")}</tbody></table></div>` : UI.empty("customers", "No customers found", "Customers are added at checkout or here.");
  }

  function render(root) {
    const all = allCustomers();
    const stats = all.map(customer => customerStats(customer.phone));
    const repeat = stats.filter(item => item.orders > 1).length;
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Customers</h1><p>${all.length} customers · ${repeat} repeat buyers</p></div>
        <div class="page-actions"><button class="btn btn-soft" id="custExport" type="button">${icon("download", 18)} Export</button><button class="btn btn-accent" id="custAdd" type="button">${icon("userPlus", 18)} Add customer</button></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="input-icon">${icon("search", 18)}<input class="input" id="custSearch" placeholder="Search by phone number or name" value="${esc(search)}" inputmode="search"></div>
          <select class="select" id="custSort"><option value="recent">Most recent</option><option value="spent" ${sort === "spent" ? "selected" : ""}>Top spending</option><option value="orders" ${sort === "orders" ? "selected" : ""}>Most orders</option><option value="name" ${sort === "name" ? "selected" : ""}>Name A–Z</option></select>
        </div>
        <div id="custTable" style="padding:0 8px 8px"></div>
      </div>`;
    root.querySelector("#custSearch").addEventListener("input", debounce(event => { search = event.target.value; renderTable(root); }, 120));
    root.querySelector("#custSort").addEventListener("change", event => { sort = event.target.value; renderTable(root); });
    root.querySelector("#custAdd").addEventListener("click", () => editCustomer(null));
    root.querySelector("#custExport").addEventListener("click", () => {
      downloadFile("brands-planets-customers.csv", toCsv([["Name", "Phone", "Email", "Orders", "Total Spending", "Last Purchase"], ...rows().map(({ customer, stats }) => [customer.name, customer.phone, customer.email || "", stats.orders, Math.round(stats.spent), stats.last ? recordDateKey(stats.last) : ""])]));
      toast("Customers exported ✓");
    });
    root.querySelector("#custTable").addEventListener("click", event => {
      const id = event.target.closest("[data-id]")?.dataset.id;
      if (!id) return;
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (act === "edit") editCustomer(id);
      else if (act === "delete") removeCustomer(id);
      else openCustomer(id);
    });
    renderTable(root);
  }

  function openCustomer(id) {
    const customer = allCustomers().find(item => item.id === id);
    if (!customer) return;
    const stats = customerStats(customer.phone);
    const bills = state.bills.filter(bill => phoneKey(bill.customerPhone) === phoneKey(customer.phone) && phoneKey(customer.phone)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const modal = UI.openModal({
      title: esc(customer.name),
      subtitle: `${esc(customer.phone || "")}${customer.email ? ` · ${esc(customer.email)}` : ""}`,
      size: "lg",
      body: `<div class="detail-grid" style="margin-bottom:16px">
          <div class="detail"><small>Total orders</small><strong>${stats.orders}</strong></div>
          <div class="detail"><small>Total spending</small><strong>${money(stats.spent)}</strong></div>
          <div class="detail"><small>Average order</small><strong>${money(stats.orders ? stats.spent / stats.orders : 0)}</strong></div>
          <div class="detail"><small>Last purchase</small><strong>${stats.last ? fmtDate(stats.last) : "—"}</strong></div>
        </div>
        ${bills.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Date</th><th class="right">Items</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>
          ${bills.map(bill => { const status = billStatus(bill); return `<tr class="clickable" data-bill="${esc(bill.id)}"><td class="cell-main">${esc(bill.id)}</td><td>${fmtDateTime(bill.date)}</td><td class="right">${billItemCount(bill)}</td><td class="right num">${money(billTotals(bill).total)}</td><td><span class="badge ${STATUS_TONE[status]}">${status}</span></td></tr>`; }).join("")}
        </tbody></table></div>` : UI.empty("sales", "No purchases yet")}`,
      footer: `${can("pos") ? `<button class="btn btn-accent" data-sell type="button">${icon("pos", 18)} Start sale for this customer</button>` : ""}`
    });
    modal.el.addEventListener("click", event => {
      const billId = event.target.closest("[data-bill]")?.dataset.bill;
      if (billId && can("sales")) { modal.close(); Views.sales.openInvoice(billId); }
      if (event.target.closest("[data-sell]")) {
        modal.close();
        Shell.go("pos");
        setTimeout(() => Views.pos.setCustomer(customer), 60);
      }
    });
  }

  function editCustomer(id) {
    const found = id ? allCustomers().find(item => item.id === id) : null;
    const saved = found?.saved ? state.customers.find(item => item.id === found.id) : null;
    const modal = UI.openModal({
      title: found ? "Edit customer" : "Add customer",
      size: "sm",
      body: `<form id="custEdit" class="form-section">
        <div class="field"><label>Name</label><input id="ceName" value="${esc(found?.name || "")}" required></div>
        <div class="field"><label>Phone</label><input id="cePhone" value="${esc(found?.phone || "")}" inputmode="tel" placeholder="03XXXXXXXXX"></div>
        <div class="field"><label>Email <span class="faint">(optional)</span></label><input id="ceEmail" type="email" value="${esc(found?.email || "")}"></div>
        <div id="ceError" class="form-error hidden"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="custEdit" type="submit">Save</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#custEdit").addEventListener("submit", event => {
      event.preventDefault();
      const name = modal.el.querySelector("#ceName").value.trim();
      const phone = phoneKey(modal.el.querySelector("#cePhone").value);
      const email = modal.el.querySelector("#ceEmail").value.trim();
      const error = modal.el.querySelector("#ceError");
      const fail = text => { error.textContent = text; error.classList.remove("hidden"); };
      if (!name) return fail("Name is required.");
      if (!/^0\d{10}$/.test(phone) && !/^92\d{10}$/.test(phone)) return fail("Enter a valid phone number, e.g. 03001234567.");
      if (state.customers.some(item => item.id !== saved?.id && phoneKey(item.phone) === phone)) return fail("Another customer already uses this phone number.");
      if (saved) {
        Object.assign(saved, { name, phone, email });
        audit("customer.update", "customer", saved.id, `Updated customer ${name}`);
      } else {
        const record = { id: uid("c"), name, phone, email, createdAt: new Date().toISOString(), createdBy: currentUser().username };
        state.customers.push(record);
        audit("customer.create", "customer", record.id, `Added customer ${name} (${phone})`);
      }
      save();
      modal.close();
      toast("Customer saved ✓");
      Shell.rerender();
    });
  }

  async function removeCustomer(id) {
    const customer = state.customers.find(item => item.id === id);
    if (!customer) return;
    const ok = await UI.confirm({ title: `Delete ${customer.name}?`, message: "Past invoices keep the customer's name and phone.", confirmText: "Delete" });
    if (!ok) return;
    markDeleted("customers", id);
    state.customers = state.customers.filter(item => item.id !== id);
    audit("customer.delete", "customer", id, `Deleted customer ${customer.name}`);
    save();
    toast("Customer deleted", "info");
    Shell.rerender();
  }

  function refresh() {
    const root = $("#view");
    if (root?.querySelector("#custTable") && !UI.hasModal()) renderTable(root);
  }

  return { render, refresh, openCustomer };
})();
