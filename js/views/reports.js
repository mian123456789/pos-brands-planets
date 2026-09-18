/* Reports: sales, profit, products, inventory, cashiers, promotions, returns, payments. */
Views.reports = (() => {
  let tab = "sales";
  let period = "month";
  let custom = { start: addDaysKey(todayKey(), -29), end: todayKey() };
  let exportRows = [];

  const TABS = [
    ["sales", "Sales", "sales"],
    ["profit", "Profit", "trendingUp", "financialReports"],
    ["products", "Products", "products"],
    ["inventory", "Inventory", "inventory"],
    ["cashiers", "Cashier Performance", "staff"],
    ["promotions", "Promotions", "promotions"],
    ["returns", "Returns", "returns"],
    ["payments", "Payment Methods", "card"]
  ];

  function effectiveRange() {
    const range = periodRange(period, custom);
    if (period === "all") {
      const first = state.bills.map(bill => recordDateKey(bill.date)).filter(Boolean).sort()[0] || todayKey();
      return { ...range, start: first, end: todayKey() };
    }
    return range;
  }
  function days(range) {
    const list = [];
    for (let day = range.start; day <= range.end && list.length < 800; day = addDaysKey(day, 1)) list.push(day);
    return list;
  }
  function dailyBuckets(range) {
    const keys = days(range);
    const byMonth = keys.length > 62;
    const bucketKey = key => byMonth ? key.slice(0, 7) : key;
    const buckets = new Map();
    keys.forEach(key => buckets.set(bucketKey(key), { key: bucketKey(key), orders: 0, items: 0, gross: 0, promo: 0, sales: 0, refunds: 0, cogs: 0, expenses: 0 }));
    state.bills.forEach(bill => {
      if (isCancelled(bill)) return;
      const key = recordDateKey(bill.date);
      if (!dateInRange(key, range)) return;
      const bucket = buckets.get(bucketKey(key));
      const totals = billTotals(bill);
      bucket.orders += 1;
      bucket.items += billItemCount(bill);
      bucket.gross += totals.subtotal;
      bucket.promo += totals.promoDiscount + totals.itemDiscount + totals.billLevelDiscount;
      bucket.sales += totals.total;
      bucket.cogs += sum(bill.items || [], lineCost);
    });
    state.returns.forEach(record => {
      const key = recordDateKey(record.date);
      if (!dateInRange(key, range)) return;
      const bucket = buckets.get(bucketKey(key));
      bucket.refunds -= record.netChange;
      if (record.restock !== false) bucket.cogs -= sum(record.returned || [], lineCost);
      bucket.cogs += sum(record.replacement || [], lineCost);
    });
    state.expenses.forEach(expense => {
      if (!dateInRange(expense.date, range)) return;
      buckets.get(bucketKey(expense.date)).expenses += Number(expense.amount || 0);
    });
    return {
      byMonth,
      rows: [...buckets.values()].map(bucket => ({ ...bucket, net: bucket.sales - bucket.refunds, profit: bucket.sales - bucket.refunds - bucket.cogs })),
      label: key => byMonth ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "2-digit" }).format(dateFromKey(`${key}-01`)) : new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(dateFromKey(key))
    };
  }

  const kpi = (label, value, format = "money", sub = "", tone = "") => `<div class="kpi ${tone}"><div class="kpi-top"><span class="kpi-label">${label}</span></div><div class="kpi-value" data-count="${Math.round(value)}" data-format="${format}">${format === "money" ? money(value) : format === "pct" ? `${value}%` : num(value)}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
  const kpiRow = items => `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:16px">${items.join("")}</div>`;
  const chartCard = (id, title, sub = "", size = "") => `<div class="card"><div class="card-head"><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div></div><div class="card-body"><div class="chart-box ${size}"><canvas id="${id}"></canvas></div></div></div>`;
  const table = (head, rows) => rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>${head.map(cell => `<th class="${cell.startsWith(">") ? "right" : ""}">${esc(cell.replace(/^>/, ""))}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : UI.empty("reports", "No data for this period");
  const tableCard = (title, html) => `<div class="card" style="margin-top:16px"><div class="card-head"><h3>${title}</h3></div><div class="card-body">${html}</div></div>`;

  /* ------------------------------------------------------------ tabs */
  const views = {
    sales(range) {
      const s = salesSummary(range);
      const daily = dailyBuckets(range);
      exportRows = [["Period", "Orders", "Items", "Gross", "Discounts", "Refunds", "Net Sales"], ...daily.rows.map(row => [row.key, row.orders, row.items, row.gross, row.promo, row.refunds, row.net])];
      return {
        html: kpiRow([
          kpi("Net sales", s.net, "money", `${s.orders} orders`, "t-accent"),
          kpi("Gross sales", s.gross),
          kpi("Promotion discounts", s.promo, "money", s.legacyDiscount ? `+ ${money(s.legacyDiscount)} old manual discounts` : ""),
          kpi("Refunds", s.refunds, "money", `${s.returns} returns`, "t-bad"),
          kpi("Average order", s.orders ? s.sales / s.orders : 0),
          kpi("Items sold", s.items, "num")
        ]) + chartCard("rChart", `Sales ${daily.byMonth ? "by month" : "by day"}`, range.label) +
          tableCard("Breakdown", table(["Period", ">Orders", ">Items", ">Gross", ">Discounts", ">Refunds", ">Net sales"], daily.rows.slice().reverse().map(row => `<tr><td>${daily.label(row.key)}</td><td class="right">${row.orders}</td><td class="right">${row.items}</td><td class="right num">${money(row.gross)}</td><td class="right num">${money(row.promo)}</td><td class="right num">${money(row.refunds)}</td><td class="right num cell-main">${money(row.net)}</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: daily.rows.length > 20 ? "line" : "bar", labels: daily.rows.map(row => daily.label(row.key)), datasets: [{ label: "Net sales", data: daily.rows.map(row => row.net) }] })
      };
    },
    profit(range) {
      const s = salesSummary(range);
      const daily = dailyBuckets(range);
      const margin = s.net ? Math.round(s.grossProfit / s.net * 100) : 0;
      exportRows = [["Period", "Net Sales", "Cost of Goods", "Gross Profit", "Expenses", "Net Profit"], ...daily.rows.map(row => [row.key, row.net, Math.round(row.cogs), Math.round(row.profit), row.expenses, Math.round(row.profit - row.expenses)])];
      return {
        html: (s.missingCost ? `<div class="promo-banner" style="margin:0 0 16px"><span class="pb-icon">⚠️</span><div><strong>${s.missingCost} sold item(s) have no cost price</strong><small>Add cost prices in Products for accurate profit. Those items are counted with zero cost.</small></div></div>` : "") +
          kpiRow([
            kpi("Net sales", s.net, "money", "", "t-accent"),
            kpi("Cost of goods", s.cogs),
            kpi("Gross profit", s.grossProfit, "money", `${margin}% margin`, "t-good"),
            kpi("Expenses", s.expenses, "money", "", "t-warn"),
            kpi("Net profit", s.netProfit, "money", "After expenses", s.netProfit >= 0 ? "t-good" : "t-bad")
          ]) + chartCard("rChart", "Sales vs profit", range.label) +
          tableCard("Profit by period", table(["Period", ">Net sales", ">Cost", ">Gross profit", ">Expenses", ">Net profit"], daily.rows.slice().reverse().map(row => `<tr><td>${daily.label(row.key)}</td><td class="right num">${money(row.net)}</td><td class="right num">${money(row.cogs)}</td><td class="right num">${money(row.profit)}</td><td class="right num">${money(row.expenses)}</td><td class="right num cell-main">${money(row.profit - row.expenses)}</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: "bar", labels: daily.rows.map(row => daily.label(row.key)), datasets: [{ label: "Net sales", data: daily.rows.map(row => row.net) }, { label: "Profit", data: daily.rows.map(row => row.profit - row.expenses) }] })
      };
    },
    products(range) {
      const rows = productSales(range).filter(row => row.qty > 0 || row.revenue > 0).sort((a, b) => b.revenue - a.revenue);
      const total = sum(rows, row => row.revenue) || 1;
      exportRows = [["Product", "SKU", "Qty Sold", "Free Units", "Revenue", "Share %"], ...rows.map(row => [row.name, row.sku, row.qty, row.free, Math.round(row.revenue), (row.revenue / total * 100).toFixed(1)])];
      const top = rows.slice(0, 10);
      return {
        html: kpiRow([kpi("Products sold", rows.length, "num", "", "t-info"), kpi("Units sold", sum(rows, row => row.qty), "num"), kpi("Free units given", sum(rows, row => row.free), "num", "", "t-accent"), kpi("Revenue", sum(rows, row => row.revenue))]) +
          chartCard("rChart", "Top 10 products by revenue", range.label) +
          tableCard("All products", table(["Product", "SKU", ">Qty sold", ">Free units", ">Revenue", ">Share"], rows.map(row => `<tr><td><div class="product-cell">${row.image ? `<img class="thumb sm" src="${row.image}" alt="">` : `<span class="thumb sm">${esc(initials(row.name))}</span>`}<span class="cell-main">${esc(row.name)}</span></div></td><td>${esc(row.sku || "—")}</td><td class="right">${num(row.qty)}</td><td class="right">${row.free || "—"}</td><td class="right num cell-main">${money(row.revenue)}</td><td class="right">${(row.revenue / total * 100).toFixed(1)}%</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: "bar", labels: top.map(row => row.name.length > 16 ? `${row.name.slice(0, 15)}…` : row.name), datasets: [{ label: "Revenue", data: top.map(row => Math.round(row.revenue)) }] })
      };
    },
    inventory() {
      const financial = can("financialReports");
      const groups = new Map();
      state.products.forEach(product => {
        const key = `${deptLabel(product.category)}${product.type ? ` · ${product.type}` : ""}`;
        const entry = groups.get(key) || { key, products: 0, units: 0, retail: 0, cost: 0, low: 0, out: 0 };
        const qty = productStock(product);
        entry.products += 1;
        entry.units += qty;
        entry.retail += Math.max(0, qty) * Number(product.price || 0);
        entry.cost += Math.max(0, qty) * Number(product.costPrice || 0);
        const status = BPStock.stockStatus(qty, lowStockLevel(product));
        if (status === "low") entry.low += 1;
        if (status === "out") entry.out += 1;
        groups.set(key, entry);
      });
      const rows = [...groups.values()].sort((a, b) => b.units - a.units);
      exportRows = [["Group", "Products", "Units", "Retail Value", ...(financial ? ["Cost Value"] : []), "Low", "Out"], ...rows.map(row => [row.key, row.products, row.units, Math.round(row.retail), ...(financial ? [Math.round(row.cost)] : []), row.low, row.out])];
      return {
        html: kpiRow([kpi("Units in stock", sum(rows, row => row.units), "num", "", "t-info"), kpi("Retail value", sum(rows, row => row.retail), "money", "", "t-good"), ...(financial ? [kpi("Cost value", sum(rows, row => row.cost))] : []), kpi("Low stock", sum(rows, row => row.low), "num", "", "t-warn"), kpi("Out of stock", sum(rows, row => row.out), "num", "", "t-bad")]) +
          chartCard("rChart", "Units by category", "Current stock") +
          tableCard("Stock by category", table(["Category", ">Products", ">Units", ">Retail value", ...(financial ? [">Cost value"] : []), ">Low", ">Out"], rows.map(row => `<tr><td class="cell-main">${esc(row.key)}</td><td class="right">${row.products}</td><td class="right">${num(row.units)}</td><td class="right num">${money(row.retail)}</td>${financial ? `<td class="right num">${money(row.cost)}</td>` : ""}<td class="right">${row.low ? `<span class="badge warn">${row.low}</span>` : "—"}</td><td class="right">${row.out ? `<span class="badge bad">${row.out}</span>` : "—"}</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: "doughnut", money: false, labels: rows.slice(0, 8).map(row => row.key), datasets: [{ label: "Units", data: rows.slice(0, 8).map(row => Math.max(0, row.units)) }] })
      };
    },
    cashiers(range) {
      const map = new Map();
      billsInRange(range).filter(bill => !isCancelled(bill)).forEach(bill => {
        const entry = map.get(bill.cashier) || { cashier: bill.cashier || "—", orders: 0, items: 0, sales: 0, promoOrders: 0, returns: 0 };
        entry.orders += 1;
        entry.items += billItemCount(bill);
        entry.sales += billTotals(bill).total;
        if (billTotals(bill).promoDiscount) entry.promoOrders += 1;
        map.set(bill.cashier, entry);
      });
      returnsInRange(range).forEach(record => {
        const entry = map.get(record.user) || { cashier: record.user || "—", orders: 0, items: 0, sales: 0, promoOrders: 0, returns: 0 };
        entry.returns += 1;
        map.set(record.user, entry);
      });
      const rows = [...map.values()].sort((a, b) => b.sales - a.sales);
      exportRows = [["Cashier", "Orders", "Items", "Sales", "Average Order", "Promo Orders", "Returns Processed"], ...rows.map(row => [row.cashier, row.orders, row.items, Math.round(row.sales), Math.round(row.orders ? row.sales / row.orders : 0), row.promoOrders, row.returns])];
      return {
        html: chartCard("rChart", "Sales by cashier", range.label) +
          tableCard("Cashier performance", table(["Cashier", ">Orders", ">Items", ">Sales", ">Avg order", ">Deal orders", ">Returns"], rows.map((row, index) => `<tr><td><div class="product-cell"><span class="rank ${index < 3 ? `r${index + 1}` : ""}">${index + 1}</span><span class="cell-main">${esc(row.cashier)}</span></div></td><td class="right">${row.orders}</td><td class="right">${row.items}</td><td class="right num cell-main">${money(row.sales)}</td><td class="right num">${money(row.orders ? row.sales / row.orders : 0)}</td><td class="right">${row.promoOrders}</td><td class="right">${row.returns}</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: "bar", labels: rows.map(row => row.cashier), datasets: [{ label: "Sales", data: rows.map(row => Math.round(row.sales)) }] })
      };
    },
    promotions(range) {
      const bills = billsInRange(range).filter(bill => !isCancelled(bill) && (bill.promotions || []).length);
      const byPromo = new Map();
      const dealProducts = new Map();
      bills.forEach(bill => {
        (bill.promotions || []).forEach(promo => {
          const entry = byPromo.get(promo.promoId) || { name: promo.name, label: BPPromotions.promoLabel(promo), orders: 0, free: 0, savings: 0, revenue: 0 };
          entry.orders += 1;
          entry.free += promo.freeCount || 0;
          entry.savings += promo.saving || 0;
          entry.revenue += billTotals(bill).total;
          byPromo.set(promo.promoId, entry);
        });
        (bill.items || []).forEach(item => {
          const entry = dealProducts.get(item.id) || { name: item.name, qty: 0, free: 0 };
          entry.qty += Number(item.qty || 0);
          entry.free += Number(item.freeQty || 0);
          dealProducts.set(item.id, entry);
        });
      });
      const promos = [...byPromo.values()];
      const products = [...dealProducts.values()].sort((a, b) => b.qty - a.qty).slice(0, 15);
      exportRows = [["Promotion", "Rule", "Orders", "Free Products", "Revenue Generated", "Promotional Savings"], ...promos.map(row => [row.name, row.label, row.orders, row.free, Math.round(row.revenue), Math.round(row.savings)])];
      return {
        html: kpiRow([
          kpi("Buy 2 Get 1 Free orders", bills.length, "num", "", "t-accent"),
          kpi("Total free products", sum(promos, row => row.free), "num"),
          kpi("Revenue generated", sum(promos, row => row.revenue), "money", "From deal orders", "t-good"),
          kpi("Total promotional savings", sum(promos, row => row.savings), "money", "Given to customers", "t-warn")
        ]) + `<div class="grid grid-2">${chartCard("rChart", "Most popular deal products", "Units sold in deal orders", "sm")}${`<div class="card"><div class="card-head"><h3>By promotion</h3></div><div class="card-body">${table(["Promotion", ">Orders", ">Free", ">Revenue", ">Savings"], promos.map(row => `<tr><td><div class="cell-main">${esc(row.name)}</div><div class="cell-sub">${esc(row.label)}</div></td><td class="right">${row.orders}</td><td class="right">${row.free}</td><td class="right num">${money(row.revenue)}</td><td class="right num">${money(row.savings)}</td></tr>`))}</div></div>`}</div>` +
          tableCard("Most popular deal products", table(["Product", ">Units in deal orders", ">Given free"], products.map(row => `<tr><td class="cell-main">${esc(row.name)}</td><td class="right">${row.qty}</td><td class="right">${row.free}</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: "bar", money: false, labels: products.slice(0, 8).map(row => row.name.length > 14 ? `${row.name.slice(0, 13)}…` : row.name), datasets: [{ label: "Units", data: products.slice(0, 8).map(row => row.qty), color: "#f47b20" }] })
      };
    },
    returns(range) {
      const records = returnsInRange(range);
      const byReason = new Map();
      records.forEach(record => byReason.set(record.reason || "Other", (byReason.get(record.reason || "Other") || 0) + sum(record.returned || [], item => item.qty)));
      exportRows = [["Date", "Invoice", "Type", "Items Returned", "New Items", "Reason", "Refund/Collected", "User"], ...records.map(record => [recordDateKey(record.date), record.billId, record.type, sum(record.returned || [], item => item.qty), sum(record.replacement || [], item => item.qty), record.reason, record.netChange, record.user])];
      return {
        html: kpiRow([
          kpi("Returns & exchanges", records.length, "num", "", "t-warn"),
          kpi("Items returned", sum(records, record => sum(record.returned || [], item => item.qty)), "num"),
          kpi("Refunded", sum(records.filter(record => record.netChange < 0), record => -record.netChange), "money", "", "t-bad"),
          kpi("Collected on exchanges", sum(records.filter(record => record.netChange > 0), record => record.netChange), "money", "", "t-good")
        ]) + chartCard("rChart", "Items returned by reason", range.label, "sm") +
          tableCard("Returns & exchanges", table(["Date", "Invoice", "Type", "Items", "Reason", ">Amount", "By"], records.slice().reverse().map(record => `<tr><td class="cell-sub">${fmtDateTime(record.date)}</td><td class="cell-main">${esc(record.billId)}</td><td>${record.type === "exchange" ? "Exchange" : "Return"}</td><td class="cell-sub">${esc((record.returned || []).map(item => `${item.name} x${item.qty}`).join(", "))}</td><td>${esc(record.reason || "")}</td><td class="right num">${record.netChange < 0 ? "-" : "+"}${money(Math.abs(record.netChange))}</td><td>${esc(record.user || "")}</td></tr>`))),
        chart: () => Charts.render($("#rChart"), { type: "doughnut", money: false, labels: [...byReason.keys()], datasets: [{ label: "Items", data: [...byReason.values()] }] })
      };
    },
    payments(range) {
      const s = salesSummary(range);
      const entries = Object.entries(s.byMethod).sort((a, b) => b[1] - a[1]);
      const total = sum(entries, entry => entry[1]) || 1;
      exportRows = [["Method", "Amount", "Share %"], ...entries.map(([method, value]) => [method, Math.round(value), (value / total * 100).toFixed(1)])];
      return {
        html: kpiRow([kpi("Cash", s.cash, "money", "", "t-good"), kpi("Card / Bank / Wallet", s.cardBank, "money", "", "t-info"), kpi("Pending payments", s.pending, "money", `${s.pendingCount} invoice(s)`, "t-warn")]) +
          `<div class="grid grid-2">${chartCard("rChart", "Payment mix", range.label, "sm")}<div class="card"><div class="card-head"><h3>By method</h3></div><div class="card-body">${table(["Method", ">Amount", ">Share"], entries.map(([method, value]) => `<tr><td class="cell-main">${esc(method)}</td><td class="right num">${money(value)}</td><td class="right">${(value / total * 100).toFixed(1)}%</td></tr>`))}</div></div></div>`,
        chart: () => Charts.render($("#rChart"), { type: "doughnut", labels: entries.map(entry => entry[0]), datasets: [{ label: "Amount", data: entries.map(entry => Math.round(entry[1])) }] })
      };
    }
  };

  function render(root, params = {}) {
    if (params.tab) tab = params.tab;
    const allowedTabs = TABS.filter(([, , , perm]) => !perm || can(perm));
    if (!allowedTabs.some(([id]) => id === tab)) tab = allowedTabs[0][0];
    const range = effectiveRange();
    const view = views[tab](range);
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Reports</h1><p>${esc(range.label)} · ${fmtDate(range.start)} – ${fmtDate(range.end)}</p></div>
        <div class="page-actions">
          <select class="select" id="repPeriod" style="width:auto">${PERIODS.map(([id, label]) => `<option value="${id}" ${period === id ? "selected" : ""}>${label}</option>`).join("")}</select>
          <span class="row ${period === "custom" ? "" : "hidden"}"><input class="input" type="date" id="repStart" value="${custom.start}"><input class="input" type="date" id="repEnd" value="${custom.end}"></span>
          <button class="btn btn-soft" id="repExport" type="button">${icon("download", 18)} Export CSV</button>
        </div>
      </div>
      <div class="tabs" id="repTabs" style="margin-bottom:16px">${allowedTabs.map(([id, label, ic]) => `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}" type="button">${icon(ic, 16)} ${label}</button>`).join("")}</div>
      <div id="repBody">${view.html}</div>`;
    root.querySelector("#repTabs").addEventListener("click", event => {
      const next = event.target.closest("[data-tab]")?.dataset.tab;
      if (next) { tab = next; render(root); UI.animateCounters(root); }
    });
    root.querySelector("#repPeriod").addEventListener("change", event => { period = event.target.value; render(root); UI.animateCounters(root); });
    ["repStart", "repEnd"].forEach(id => root.querySelector(`#${id}`).addEventListener("change", () => {
      custom = { start: root.querySelector("#repStart").value, end: root.querySelector("#repEnd").value };
      render(root);
    }));
    root.querySelector("#repExport").addEventListener("click", () => {
      downloadFile(`brands-planets-${tab}-report-${range.start}-to-${range.end}.csv`, toCsv(exportRows));
      toast("Report exported ✓");
    });
    requestAnimationFrame(() => view.chart?.());
  }

  return { render };
})();
