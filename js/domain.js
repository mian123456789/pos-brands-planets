/* Business rules: bill totals, returns, customers, stock and sales analytics. */
const PAYMENT_METHODS = [
  { id: "Cash", icon: "cash" },
  { id: "Card", icon: "card" },
  { id: "Bank Transfer", icon: "bank" },
  { id: "JazzCash", icon: "phone" },
  { id: "Easypaisa", icon: "phone" },
  { id: "Split", icon: "split" }
];
const DEPARTMENTS = [
  { value: "MEN'S", label: "Men" },
  { value: "WOMEN", label: "Women" },
  { value: "KID'S", label: "Kids" }
];
const PRODUCT_TYPES = ["T-Shirts", "Shirts", "Polo Shirts", "Jeans", "Trousers", "Shorts", "Tracksuits", "Hoodies", "Sweaters", "Jackets", "Kurta", "Nightwear", "Accessories", "Footwear", "Other"];
const SEASONS = ["Summer", "Winter", "All Season"];
const COLOR_SUGGESTIONS = ["Black", "White", "Navy", "Grey", "Blue", "Sky Blue", "Red", "Maroon", "Green", "Olive", "Beige", "Brown", "Khaki", "Pink", "Yellow", "Mustard", "Purple"];
const RETURN_REASONS = ["Wrong Size", "Damaged", "Customer Changed Mind", "Wrong Product", "Other"];
const SALE_MODES = ["In Store", "Online Store", "Exchange Item"];

const deptLabel = value => DEPARTMENTS.find(dept => dept.value === value)?.label || value || "";
const lineKey = (item, index) => item.key || `i${index}`;
const isCashMethod = method => method === "Cash";

/* ------------------------------------------------------------- bills */
function billTotals(bill) {
  const items = Array.isArray(bill.items) ? bill.items : [];
  const subtotal = items.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 0), 0);
  if (bill.v === 2) {
    const promoDiscount = Math.min(subtotal, Number(bill.promoDiscount || 0));
    return { subtotal, itemDiscount: 0, billLevelDiscount: 0, promoDiscount, discount: promoDiscount, total: subtotal - promoDiscount };
  }
  // Pre-redesign bills keep their original discount maths.
  const itemDiscount = items.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 0) * Number(item.discount || 0) / 100, 0);
  const hasPercent = bill.billDiscountPercent !== undefined;
  const billLevelDiscount = hasPercent
    ? Math.max(0, subtotal - itemDiscount) * clamp(Number(bill.billDiscountPercent || 0), 0, 100) / 100
    : Number(bill.billDiscount || 0);
  const discount = Math.min(subtotal, itemDiscount + billLevelDiscount);
  return { subtotal, itemDiscount, billLevelDiscount, promoDiscount: 0, discount, total: subtotal - discount };
}

function returnsByBill() {
  if (!caches.returnsByBill) {
    const map = new Map();
    state.returns.forEach(record => {
      if (!map.has(record.billId)) map.set(record.billId, []);
      map.get(record.billId).push(record);
    });
    caches.returnsByBill = map;
  }
  return caches.returnsByBill;
}
const billReturns = bill => returnsByBill().get(bill.id) || [];
const isCancelled = bill => bill.status === "Cancelled";

/** What the customer finally paid for this invoice after returns/exchanges. */
function billNetTotal(bill) {
  if (isCancelled(bill)) return 0;
  return billTotals(bill).total + sum(billReturns(bill), record => record.netChange);
}

function billPayments(bill) {
  if (Array.isArray(bill.payments) && bill.payments.length) return bill.payments;
  const total = billTotals(bill).total;
  const method = bill.paymentMethod === "Bank" ? "Bank Transfer" : (bill.paymentMethod || "Cash");
  return [{ method, amount: Math.min(total, Number(bill.received ?? total)), ref: bill.bankRef || "" }];
}
function billAmountPaid(bill) {
  return sum(billPayments(bill), payment => payment.amount);
}
function billDue(bill) {
  if (isCancelled(bill)) return 0;
  if (bill.v !== 2) {
    const status = bill.paymentStatus || (Number(bill.received || 0) >= billTotals(bill).total ? "Paid" : "Pending");
    return status === "Pending" ? Math.max(0, billTotals(bill).total - Number(bill.received || 0)) : 0;
  }
  return Math.max(0, billTotals(bill).total - billAmountPaid(bill));
}
function billPaymentLabel(bill) {
  const payments = billPayments(bill);
  if (payments.length > 1) return `Split (${payments.map(payment => payment.method).join(" + ")})`;
  return payments[0]?.method || bill.paymentMethod || "Cash";
}
function billStatus(bill) {
  if (isCancelled(bill)) return "Cancelled";
  const returns = billReturns(bill);
  if (returns.length) {
    const remaining = currentLines(bill).reduce((total, line) => total + line.qty, 0);
    if (!remaining) return "Returned";
    return returns.some(record => record.type === "exchange") ? "Exchanged" : "Partially Returned";
  }
  if (billDue(bill) > 0) return "Pending";
  return "Completed";
}
const STATUS_TONE = { Completed: "good", Pending: "warn", Cancelled: "bad", Returned: "bad", "Partially Returned": "warn", Exchanged: "info" };

function billItemCount(bill) {
  return sum(bill.items || [], item => item.qty);
}

/* Net revenue for one line (promo / legacy discounts spread onto the line). */
function lineNet(bill, item) {
  const gross = Number(item.price || 0) * Number(item.qty || 0);
  if (bill.v === 2) return Number(item.price || 0) * Math.max(0, Number(item.qty || 0) - Number(item.freeQty || 0));
  const afterItem = gross * (1 - clamp(Number(item.discount || 0), 0, 100) / 100);
  const totals = billTotals(bill);
  const beforeBillDiscount = totals.subtotal - totals.itemDiscount;
  const factor = beforeBillDiscount > 0 ? (beforeBillDiscount - totals.billLevelDiscount) / beforeBillDiscount : 1;
  return afterItem * factor;
}
function lineCost(item) {
  const cost = item.cost ?? productById(item.id)?.costPrice ?? 0;
  return Number(cost || 0) * Number(item.qty || 0);
}

/* --------------------------------------------------- returns/exchange */
/** Lines still with the customer: original items − returns + exchange replacements. */
function currentLines(bill) {
  const lines = (bill.items || []).map((item, index) => ({ ...item, key: lineKey(item, index), qty: Number(item.qty || 0) }));
  billReturns(bill).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(record => {
    (record.returned || []).forEach(returned => {
      const line = lines.find(item => item.key === returned.key);
      if (line) line.qty = Math.max(0, line.qty - Number(returned.qty || 0));
    });
    (record.replacement || []).forEach((item, index) => {
      lines.push({ ...item, key: item.key || `x-${record.id}-${index}`, qty: Number(item.qty || 0), replacement: true });
    });
  });
  return lines;
}
/** Price a set of lines the same way the original invoice was priced. */
function priceLines(bill, lines) {
  if (bill.v === 2) {
    const result = BPPromotions.applyPromotions(
      lines.filter(line => line.qty > 0).map(line => ({ ...line, productId: line.id })),
      bill.promoSnapshot || [],
      { ignoreSchedule: true }
    );
    return result.total;
  }
  const totals = billTotals(bill);
  const beforeBillDiscount = totals.subtotal - totals.itemDiscount;
  const factor = beforeBillDiscount > 0 ? (beforeBillDiscount - totals.billLevelDiscount) / beforeBillDiscount : 1;
  return sum(lines, line => Number(line.price || 0) * line.qty * (1 - clamp(Number(line.discount || 0), 0, 100) / 100)) * factor;
}

/* ------------------------------------------------------------- stock */
function addStockMove({ productId, variantId, qty, type, ref = "", note = "" }) {
  if (!qty) return;
  state.stockMoves.push({
    id: uid("mv"),
    date: new Date().toISOString(),
    productId,
    variantId: variantId || BPStock.DEFAULT_VARIANT_ID,
    qty: Number(qty),
    type,
    ref,
    note,
    user: currentUser()?.username || "",
    outlet: currentOutlet().id
  });
}
function lowStockLevel(product) {
  return Number(product.lowStockLevel ?? state.settings.lowStockDefault ?? 5);
}
function stockAlerts() {
  if (!caches.alerts) {
    const alerts = [];
    state.products.forEach(product => {
      if (product.active === false) return;
      const total = productStock(product);
      const status = BPStock.stockStatus(total, lowStockLevel(product));
      if (status !== "in") alerts.push({ product, qty: total, status });
    });
    caches.alerts = alerts.sort((a, b) => a.qty - b.qty);
  }
  return caches.alerts;
}

/* --------------------------------------------------------- customers */
const phoneKey = phone => String(phone || "").replace(/\D/g, "");
function customerStatsMap() {
  if (!caches.customerStats) {
    const map = new Map();
    state.bills.forEach(bill => {
      const key = phoneKey(bill.customerPhone);
      if (!key || isCancelled(bill)) return;
      const entry = map.get(key) || { orders: 0, spent: 0, last: "", name: bill.customerName };
      entry.orders += 1;
      entry.spent += billNetTotal(bill);
      if (!entry.last || bill.date > entry.last) {
        entry.last = bill.date;
        entry.name = bill.customerName || entry.name;
      }
      map.set(key, entry);
    });
    caches.customerStats = map;
  }
  return caches.customerStats;
}
function customerStats(phone) {
  return customerStatsMap().get(phoneKey(phone)) || { orders: 0, spent: 0, last: "" };
}
/** Saved customers plus anyone who appears on past invoices. */
function allCustomers() {
  if (!caches.customers) {
    const byPhone = new Map();
    state.customers.forEach(customer => byPhone.set(phoneKey(customer.phone) || customer.id, { ...customer, saved: true }));
    customerStatsMap().forEach((stats, key) => {
      if (!byPhone.has(key)) byPhone.set(key, { id: `bill:${key}`, name: stats.name || "Customer", phone: key, email: "", saved: false });
    });
    caches.customers = [...byPhone.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return caches.customers;
}
function findCustomers(query, limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  return allCustomers().filter(customer =>
    String(customer.name || "").toLowerCase().includes(q) || (digits && phoneKey(customer.phone).includes(digits))
  ).slice(0, limit);
}

/* ---------------------------------------------------------- analytics */
function billsInRange(range) {
  return state.bills.filter(bill => dateInRange(recordDateKey(bill.date), range));
}
function returnsInRange(range) {
  return state.returns.filter(record => dateInRange(recordDateKey(record.date), range));
}
function expensesInRange(range) {
  return sum(state.expenses.filter(expense => dateInRange(expense.date, range)), expense => expense.amount);
}

function salesSummary(range) {
  const bills = billsInRange(range);
  const active = bills.filter(bill => !isCancelled(bill));
  const returns = returnsInRange(range);
  const summary = {
    orders: active.length,
    cancelled: bills.length - active.length,
    gross: 0, promo: 0, legacyDiscount: 0, sales: 0,
    refunds: 0, collected: 0, net: 0,
    cogs: 0, missingCost: 0, items: 0,
    cash: 0, cardBank: 0, byMethod: {},
    pending: 0, pendingCount: 0,
    promoOrders: 0, freeItems: 0,
    returns: returns.length, returnedItems: 0,
    expenses: expensesInRange(range)
  };
  active.forEach(bill => {
    const totals = billTotals(bill);
    summary.gross += totals.subtotal;
    summary.promo += totals.promoDiscount;
    summary.legacyDiscount += totals.itemDiscount + totals.billLevelDiscount;
    summary.sales += totals.total;
    summary.items += billItemCount(bill);
    (bill.items || []).forEach(item => {
      summary.cogs += lineCost(item);
      if (!Number(item.cost ?? productById(item.id)?.costPrice ?? 0)) summary.missingCost += Number(item.qty || 0);
    });
    billPayments(bill).forEach(payment => {
      const method = payment.method === "Bank" ? "Bank Transfer" : payment.method;
      summary.byMethod[method] = (summary.byMethod[method] || 0) + Number(payment.amount || 0);
      if (isCashMethod(method)) summary.cash += Number(payment.amount || 0);
      else summary.cardBank += Number(payment.amount || 0);
    });
    const due = billDue(bill);
    if (due > 0) { summary.pending += due; summary.pendingCount += 1; }
    if (totals.promoDiscount > 0) {
      summary.promoOrders += 1;
      summary.freeItems += sum(bill.items || [], item => item.freeQty || 0);
    }
  });
  returns.forEach(record => {
    if (record.netChange < 0) summary.refunds += -record.netChange;
    else summary.collected += record.netChange;
    summary.returnedItems += sum(record.returned || [], item => item.qty);
    if (record.restock !== false) summary.cogs -= sum(record.returned || [], item => lineCost(item));
    summary.cogs += sum(record.replacement || [], item => lineCost(item));
  });
  summary.net = summary.sales - summary.refunds + summary.collected;
  summary.grossProfit = summary.net - summary.cogs;
  summary.netProfit = summary.grossProfit - summary.expenses;
  return summary;
}

function productSales(range) {
  const map = new Map();
  billsInRange(range).filter(bill => !isCancelled(bill)).forEach(bill => {
    (bill.items || []).forEach(item => {
      const entry = map.get(item.id) || { productId: item.id, name: item.name, sku: item.sku || "", qty: 0, revenue: 0, free: 0 };
      entry.qty += Number(item.qty || 0);
      entry.free += Number(item.freeQty || 0);
      entry.revenue += lineNet(bill, item);
      map.set(item.id, entry);
    });
  });
  returnsInRange(range).forEach(record => {
    (record.returned || []).forEach(item => {
      const entry = map.get(item.id);
      if (entry) entry.qty -= Number(item.qty || 0);
    });
  });
  return [...map.values()].map(entry => {
    const product = productById(entry.productId);
    return { ...entry, image: product?.image || "", sku: product?.sku || entry.sku, name: product?.name || entry.name };
  });
}

/* ------------------------------------------------------------- charts */
const Charts = (() => {
  const instances = new Map();
  function palette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      primary: styles.getPropertyValue("--chart-1").trim() || "#0d2b4f",
      accent: styles.getPropertyValue("--chart-2").trim() || "#f47b20",
      grid: styles.getPropertyValue("--chart-grid").trim() || "rgba(0,0,0,.08)",
      text: styles.getPropertyValue("--muted").trim() || "#667085",
      series: ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"].map(name => styles.getPropertyValue(name).trim())
    };
  }
  function destroy(id) {
    instances.get(id)?.destroy?.();
    instances.delete(id);
  }
  function render(canvas, config) {
    if (!canvas) return;
    destroy(canvas.id);
    if (typeof Chart === "undefined") return fallback(canvas, config);
    const colors = palette();
    const type = config.type || "bar";
    const datasets = config.datasets.map((dataset, index) => {
      const color = dataset.color || colors.series[index] || colors.primary;
      return {
        label: dataset.label,
        data: dataset.data,
        backgroundColor: type === "doughnut" ? config.labels.map((_, i) => colors.series[i % colors.series.length]) : type === "line" ? color + "22" : color,
        borderColor: type === "doughnut" ? "transparent" : color,
        borderWidth: type === "line" ? 2.5 : 0,
        borderRadius: type === "bar" ? 8 : 0,
        maxBarThickness: 46,
        fill: type === "line",
        tension: 0.35,
        pointRadius: type === "line" ? 0 : undefined,
        pointHoverRadius: 5
      };
    });
    const moneyAxis = config.money !== false;
    const chart = new Chart(canvas, {
      type,
      data: { labels: config.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: UI.reducedMotion() ? false : { duration: 500 },
        interaction: { intersect: false, mode: "index" },
        cutout: type === "doughnut" ? "68%" : undefined,
        plugins: {
          legend: { display: type === "doughnut" || datasets.length > 1, position: "bottom", labels: { color: colors.text, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: {
            backgroundColor: "rgba(15,23,42,.92)",
            padding: 10,
            cornerRadius: 10,
            callbacks: { label: context => `${context.dataset.label ? context.dataset.label + ": " : ""}${moneyAxis ? money(context.parsed.y ?? context.parsed) : num(context.parsed.y ?? context.parsed)}` }
          }
        },
        scales: type === "doughnut" ? {} : {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { beginAtZero: true, grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.text, callback: value => moneyAxis ? (value >= 1000 ? `${Math.round(value / 1000)}k` : value) : value } }
        }
      }
    });
    instances.set(canvas.id, chart);
  }
  // Offline fallback when the chart library could not load.
  function fallback(canvas, config) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width = canvas.clientWidth || 600;
    const height = canvas.height = canvas.clientHeight || 240;
    const values = config.datasets[0]?.data || [];
    const max = Math.max(...values, 1);
    const colors = palette();
    ctx.clearRect(0, 0, width, height);
    const slot = (width - 20) / Math.max(values.length, 1);
    values.forEach((value, i) => {
      const barHeight = (value / max) * (height - 40);
      ctx.fillStyle = colors.primary;
      ctx.fillRect(10 + i * slot + slot * 0.2, height - 24 - barHeight, slot * 0.6, barHeight);
    });
    ctx.fillStyle = colors.text;
    ctx.font = "11px sans-serif";
    config.labels.forEach((label, i) => { if (values.length <= 12 || i % 3 === 0) ctx.fillText(String(label).slice(0, 6), 10 + i * slot + slot * 0.2, height - 8); });
  }
  document.addEventListener("themechange", () => instances.forEach(chart => chart.update?.()));
  return { render, destroy };
})();
