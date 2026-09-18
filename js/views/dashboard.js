/* Dashboard: KPIs, sales graph, top sellers, recent sales, stock alerts. */
Views.dashboard = (() => {
  let graphPeriod = UI.safeGet("bp-dash-period", "week");
  let topPeriod = "month";

  function series(period) {
    const today = todayKey();
    const active = state.bills.filter(bill => !isCancelled(bill));
    if (period === "today") {
      const labels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
      const values = Array(24).fill(0);
      active.filter(bill => recordDateKey(bill.date) === today).forEach(bill => { values[localHour(bill.date)] += billTotals(bill).total; });
      const firstHour = Math.min(9, ...values.map((value, hour) => value ? hour : 24));
      return { labels: labels.slice(firstHour), values: values.slice(firstHour) };
    }
    if (period === "year") {
      const year = today.slice(0, 4);
      const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const values = Array(12).fill(0);
      active.forEach(bill => {
        const key = recordDateKey(bill.date);
        if (key.startsWith(year)) values[Number(key.slice(5, 7)) - 1] += billTotals(bill).total;
      });
      const month = Number(today.slice(5, 7));
      return { labels: labels.slice(0, month), values: values.slice(0, month) };
    }
    const days = period === "month" ? Number(today.slice(8, 10)) : 7;
    const start = period === "month" ? `${today.slice(0, 7)}-01` : addDaysKey(today, -6);
    const byDay = new Map();
    active.forEach(bill => {
      const key = recordDateKey(bill.date);
      if (key >= start && key <= today) byDay.set(key, (byDay.get(key) || 0) + billTotals(bill).total);
    });
    const keys = Array.from({ length: days }, (_, i) => addDaysKey(start, i));
    return {
      labels: keys.map(key => period === "month" ? String(Number(key.slice(8, 10))) : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(dateFromKey(key))),
      values: keys.map(key => byDay.get(key) || 0)
    };
  }

  function kpi(label, value, { format = "money", sub = "", iconName = "sales", tone = "", hero = false } = {}) {
    return `<div class="kpi ${hero ? "hero" : tone}">
      <div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon">${icon(iconName, 20)}</span></div>
      <div class="kpi-value" data-count="${Math.round(value)}" data-format="${format}">${format === "money" ? money(0) : 0}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
    </div>`;
  }

  function renderChart(root) {
    const { labels, values } = series(graphPeriod);
    const total = values.reduce((a, b) => a + b, 0);
    root.querySelector("#dashGraphTotal").textContent = money(total);
    Charts.render(root.querySelector("#salesChart"), {
      type: graphPeriod === "today" || graphPeriod === "year" || graphPeriod === "week" ? "bar" : "line",
      labels,
      datasets: [{ label: "Sales", data: values, color: UI.isDark() ? "#6f9bd6" : "#0d2b4f" }]
    });
  }

  function topProductsHtml() {
    const rows = productSales(periodRange(topPeriod)).filter(row => row.qty > 0).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 6);
    if (!rows.length) return UI.empty("trendingUp", "No sales in this period yet");
    const max = rows[0].qty || 1;
    return `<div class="list">${rows.map((row, index) => `<div class="list-item">
      <span class="rank ${index < 3 ? `r${index + 1}` : ""}">${index + 1}</span>
      ${row.image ? `<img class="thumb" src="${row.image}" alt="">` : `<span class="thumb">${esc(initials(row.name))}</span>`}
      <div class="grow"><strong>${esc(row.name)}</strong><small>${esc(row.sku || "—")} · ${num(row.qty)} sold</small><div class="meter"><span style="width:${Math.max(6, row.qty / max * 100)}%"></span></div></div>
      <div class="right"><strong class="num">${money(row.revenue)}</strong></div>
    </div>`).join("")}</div>`;
  }

  function render(root) {
    const today = periodRange("today");
    const summary = salesSummary(today);
    const financial = can("financialReports");
    const products = state.products.filter(product => product.active !== false);
    const alerts = stockAlerts();
    const low = alerts.filter(alert => alert.status === "low");
    const out = alerts.filter(alert => alert.status === "out");
    const yesterday = salesSummary(periodRange("yesterday"));
    const change = yesterday.net ? Math.round((summary.net - yesterday.net) / yesterday.net * 100) : null;
    const recent = state.bills.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
    const user = currentUser();
    const hour = localHour(new Date());
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    root.innerHTML = `
      <div class="page-head">
        <div><h1>${greeting}, ${esc(user.name || user.username)}</h1><p>${fmtDate(todayKey())} · ${esc(currentOutlet().name)} · here's how the store is doing today.</p></div>
        <div class="page-actions">
          ${can("reports") ? `<button class="btn btn-soft" onclick="Shell.go('reports')" type="button">${icon("reports", 18)} Reports</button>` : ""}
          ${can("pos") ? `<button class="btn btn-accent btn-lg" onclick="Shell.go('pos')" type="button">${icon("pos", 20)} New Sale <kbd>F2</kbd></button>` : ""}
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi("Today Sales", summary.net, { hero: true, iconName: "sales", sub: change === null ? `${summary.orders} orders` : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs yesterday` })}
        ${kpi("Today Orders", summary.orders, { format: "num", iconName: "pos", tone: "t-accent", sub: `${num(summary.items)} items sold` })}
        ${financial ? kpi("Today Profit", summary.netProfit, { iconName: "trendingUp", tone: "t-good", sub: summary.missingCost ? `${summary.missingCost} item(s) without cost price` : "After cost & expenses" }) : ""}
        ${kpi("Total Products", products.length, { format: "num", iconName: "products", tone: "t-info", sub: `${num(sum(products, product => productStock(product)))} units in stock` })}
        ${kpi("Low Stock", low.length, { format: "num", iconName: "alert", tone: "t-warn", sub: "At or below alert level" })}
        ${kpi("Out of Stock", out.length, { format: "num", iconName: "inventory", tone: "t-bad", sub: "Needs restocking" })}
        ${kpi("Returns", summary.returns, { format: "num", iconName: "returns", tone: "", sub: `${money(summary.refunds)} refunded today` })}
        ${kpi("Cash Sales", summary.cash, { iconName: "cash", tone: "t-good", sub: "Collected in cash" })}
        ${kpi("Card / Bank Sales", summary.cardBank, { iconName: "card", tone: "t-info", sub: "Card, bank & wallets" })}
        ${kpi("Pending Payments", summary.pending, { iconName: "clock", tone: "t-warn", sub: `${summary.pendingCount} invoice(s) today` })}
      </div>

      <div class="split-main" style="margin-top:16px">
        <div class="card">
          <div class="card-head">
            <div><h3>Sales Graph</h3><p><strong id="dashGraphTotal" class="num"></strong> in this period</p></div>
            <div class="segmented" id="graphPeriod">${[["today", "Today"], ["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([id, label]) => `<button class="${graphPeriod === id ? "active" : ""}" data-period="${id}" type="button">${label}</button>`).join("")}</div>
          </div>
          <div class="card-body"><div class="chart-box"><canvas id="salesChart" aria-label="Sales graph" role="img"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>Top Selling Products</h3><p>By quantity sold</p></div>
            <select class="select" id="topPeriod" style="width:auto;min-height:38px">${[["today", "Today"], ["7days", "7 days"], ["month", "This month"], ["year", "This year"]].map(([id, label]) => `<option value="${id}" ${topPeriod === id ? "selected" : ""}>${label}</option>`).join("")}</select>
          </div>
          <div class="card-body" id="topProducts">${topProductsHtml()}</div>
        </div>
      </div>

      <div class="split-main" style="margin-top:16px">
        <div class="card">
          <div class="card-head"><div><h3>Recent Sales</h3><p>Latest invoices across all tills</p></div>${can("sales") ? `<button class="btn btn-ghost btn-sm" onclick="Shell.go('sales')" type="button">View all ${icon("chevronRight", 16)}</button>` : ""}</div>
          <div class="card-body" style="padding-top:8px">
            ${recent.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Customer</th><th class="right">Items</th><th class="right">Total</th><th>Payment</th><th>Cashier</th><th>Time</th><th>Status</th></tr></thead><tbody>
              ${recent.map(bill => {
                const status = billStatus(bill);
                return `<tr class="clickable" data-bill="${esc(bill.id)}"><td class="cell-main">${esc(bill.id)}</td><td>${esc(bill.customerName || "Walk-in")}</td><td class="right num">${billItemCount(bill)}</td><td class="right num cell-main">${money(billTotals(bill).total)}</td><td>${esc(billPaymentLabel(bill))}</td><td>${esc(bill.cashier || "")}</td><td class="cell-sub">${recordDateKey(bill.date) === todayKey() ? fmtTime(bill.date) : fmtDateTime(bill.date)}</td><td><span class="badge ${STATUS_TONE[status]}">${status}</span></td></tr>`;
              }).join("")}
            </tbody></table></div>` : UI.empty("sales", "No sales yet", "Completed sales appear here in real time.")}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Stock Alerts</h3><p>${alerts.length} product(s) need attention</p></div>${can("inventory") ? `<button class="btn btn-ghost btn-sm" onclick="Shell.go('inventory',{status:'alerts'})" type="button">Inventory ${icon("chevronRight", 16)}</button>` : ""}</div>
          <div class="card-body">
            ${alerts.length ? `<div class="list">${alerts.slice(0, 7).map(alert => `<div class="list-item">
              ${alert.product.image ? `<img class="thumb" src="${alert.product.image}" alt="">` : `<span class="thumb">${esc(initials(alert.product.name))}</span>`}
              <div class="grow"><strong>${esc(alert.product.name)}</strong><small>${esc(alert.product.sku || "")} · alert at ${lowStockLevel(alert.product)}</small>
                <div class="meter ${alert.status === "out" ? "bad" : "warn"}"><span style="width:${Math.max(4, Math.min(100, alert.qty / Math.max(1, lowStockLevel(alert.product)) * 100))}%"></span></div></div>
              <span class="badge ${alert.status === "out" ? "bad" : "warn"}">${alert.status === "out" ? "Out" : `${alert.qty} left`}</span>
            </div>`).join("")}</div>` : UI.empty("check", "All stock levels look healthy")}
          </div>
        </div>
      </div>`;

    root.querySelector("#graphPeriod").addEventListener("click", event => {
      const period = event.target.closest("[data-period]")?.dataset.period;
      if (!period) return;
      graphPeriod = period;
      UI.safeSet("bp-dash-period", period);
      root.querySelectorAll("#graphPeriod button").forEach(button => button.classList.toggle("active", button.dataset.period === period));
      renderChart(root);
    });
    root.querySelector("#topPeriod").addEventListener("change", event => {
      topPeriod = event.target.value;
      root.querySelector("#topProducts").innerHTML = topProductsHtml();
    });
    root.querySelector("tbody")?.addEventListener("click", event => {
      const id = event.target.closest("[data-bill]")?.dataset.bill;
      if (id && can("sales")) Views.sales.openInvoice(id);
    });
    requestAnimationFrame(() => renderChart(root));
  }

  function refresh() {
    const root = $("#view");
    if (!root || UI.hasModal()) return;
    render(root);
    // Background refresh: show new numbers without replaying the count-up.
    root.querySelectorAll("[data-count]").forEach(el => {
      el.textContent = (el.dataset.format === "money" ? money : num)(Number(el.dataset.count));
      el.dataset.value = el.dataset.count;
    });
  }

  return { render, refresh };
})();
