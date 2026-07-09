const money = n => "Rs " + Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });
    const todayKey = () => new Date().toISOString().slice(0, 10);
    const monthKey = () => new Date().toISOString().slice(0, 7);
    const yesterdayKey = () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    };
    const uid = prefix => prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    const API_BASE_URL = window.location.origin;
    const API_STATE_URL = `${API_BASE_URL}/api/state`;

    const seed = {
      users: [
        { id: "u-owner", username: "Admin", password: "admin&8687", role: "Owner", active: true },
        { id: "u-cashier", username: "cashier", password: "1234", role: "Cashier", active: true, permissions: ["dashboard", "billing", "reports", "attendance"] }
      ],
      products: [
        { id: uid("p"), name: "Premium Shirt", barcode: "1001", category: "MEN'S", price: 2200, stock: 18, discount: 5, remarks: "New arrival", image: "" },
        { id: uid("p"), name: "Classic Jeans", barcode: "1002", category: "MEN'S", price: 3500, stock: 9, discount: 0, remarks: "", image: "" },
        { id: uid("p"), name: "Leather Wallet", barcode: "1003", category: "MEN'S", price: 1800, stock: 5, discount: 10, remarks: "Low stock watch", image: "" },
        { id: uid("p"), name: "Sports Shoes", barcode: "1004", category: "KID'S", price: 6200, stock: 14, discount: 3, remarks: "", image: "" },
        { id: uid("p"), name: "Perfume Gift Set", barcode: "1005", category: "WOMEN", price: 4100, stock: 4, discount: 0, remarks: "Restock soon", image: "" }
      ],
      bills: [],
      expenses: [],
      attendance: [],
      stockHistory: [],
      dayClosings: [],
      settings: {
        shopName: "Brands Planets",
        phone: "03000000000",
        receiptFooter: "Thank you for shopping with us",
        autoPrint: false,
        logo: "",
        cloudMode: false
      }
    };

    let state = JSON.parse(localStorage.getItem("bp-pos-state") || "null") || seed;
    let currentUser = JSON.parse(sessionStorage.getItem("bp-pos-session") || "null");
    let activeSection = sessionStorage.getItem("bp-pos-active-section") || "dashboard";
    let cart = [];
    let billDiscount = 0;
    let chart;
    let editingProductId = null;
    let lastNotice = "";
    let cloudSaveTimer = null;
    let cloudOnline = false;
    const inventoryCategories = ["MEN'S", "KID'S", "WOMEN"];

    const defaultCashierPermissions = ["dashboard", "billing", "reports", "attendance", "expenses"];
    const permissionLabels = {
      dashboard: "Dashboard",
      billing: "Billing",
      reports: "Reports",
      attendance: "Attendance",
      expenses: "Expenses",
      inventory: "Inventory",
      dayclose: "Day Close"
    };
    const navItems = [
      ["dashboard", "Dashboard"],
      ["inventory", "Inventory"],
      ["billing", "Billing"],
      ["reports", "Reports"],
      ["attendance", "Attendance"],
      ["dayclose", "Day Close"],
      ["expenses", "Expenses"],
      ["users", "Manage Users"],
      ["settings", "Settings"]
    ];

    function save() {
      localStorage.setItem("bp-pos-state", JSON.stringify(state));
      window.dispatchEvent(new Event("storage-lite"));
      queueCloudSave();
    }
    function mergeState(remoteState) {
      if (!remoteState || !Array.isArray(remoteState.users) || !Array.isArray(remoteState.products)) return false;
      state = {
        ...seed,
        ...remoteState,
        settings: { ...seed.settings, ...(remoteState.settings || {}) }
      };
      localStorage.setItem("bp-pos-state", JSON.stringify(state));
      return true;
    }
    async function fetchWithTimeout(url, options = {}, timeout = 4500) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
    async function pullCloudState(showMessage = false) {
      try {
        const response = await fetchWithTimeout(API_STATE_URL, { method: "GET", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Cloud responded ${response.status}`);
        const payload = await response.json();
        const remoteState = payload.state || payload;
        if (!mergeState(remoteState)) throw new Error("Cloud state format is invalid");
        cloudOnline = true;
        if (showMessage) toast("Cloud data loaded from Hostinger.");
        return true;
      } catch (error) {
        cloudOnline = false;
        if (showMessage) toast("Cloud sync unavailable. Using local offline data.");
        return false;
      }
    }
    async function pushCloudState() {
      try {
        const response = await fetchWithTimeout(API_STATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ state, updatedAt: new Date().toISOString() })
        });
        if (!response.ok) throw new Error(`Cloud responded ${response.status}`);
        cloudOnline = true;
        return true;
      } catch (error) {
        cloudOnline = false;
        return false;
      }
    }
    function queueCloudSave() {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = setTimeout(() => pushCloudState(), 700);
    }
    function normalizeInventoryCategories() {
      const replacements = {
        Fashion: "MEN'S",
        Beauty: "WOMEN",
        Accessories: "MEN'S",
        Footwear: "KID'S"
      };
      let changed = false;
      state.products.forEach(product => {
        if (replacements[product.category]) {
          product.category = replacements[product.category];
          changed = true;
        }
      });
      if (changed) localStorage.setItem("bp-pos-state", JSON.stringify(state));
    }
    function normalizeUserPermissions() {
      let changed = false;
      const owner = state.users.find(user => user.role === "Owner" || user.id === "u-owner");
      if (owner && (owner.username !== "Admin" || owner.password !== "admin&8687")) {
        owner.username = "Admin";
        owner.password = "admin&8687";
        owner.role = "Owner";
        owner.active = true;
        changed = true;
      }
      state.users.forEach(user => {
        if (user.role === "Cashier" && !Array.isArray(user.permissions)) {
          user.permissions = [...defaultCashierPermissions];
          changed = true;
        }
      });
      if (changed) localStorage.setItem("bp-pos-state", JSON.stringify(state));
    }
    function normalizeAttendanceRecords() {
      let changed = false;
      state.attendance.forEach(record => {
        if (!record.id) {
          record.id = uid("a");
          changed = true;
        }
      });
      if (changed) localStorage.setItem("bp-pos-state", JSON.stringify(state));
    }
    function can(section) {
      if (currentUser?.role === "Owner") return true;
      if (attendanceRequired() && section === "attendance") return true;
      const user = state.users.find(u => u.username === currentUser?.username);
      return Boolean(user?.permissions?.includes(section));
    }
    function requireOwner() {
      if (currentUser?.role !== "Owner") {
        toast("Owner permission required.");
        return false;
      }
      return true;
    }
    function showSectionMessage(sectionId, text) {
      const section = document.getElementById(sectionId);
      const box = section?.querySelector(".section-message");
      if (box) {
        box.textContent = text;
        box.classList.remove("hidden");
      }
      toast(text);
    }
    function toast(text) {
      lastNotice = text;
    }
    function notifications() {
      const low = state.products.filter(p => Number(p.stock) <= 5).map(p => `Low stock: ${p.name} (${p.stock})`);
      const att = attendanceRequired() ? ["Attendance required before using the POS."] : [];
      const cloud = cloudOnline ? [`Cloud connected: ${API_BASE_URL}`] : ["Cloud offline: using local data."];
      return [...att, ...low, ...cloud].slice(0, 8);
    }

    function init() {
      normalizeInventoryCategories();
      normalizeUserPermissions();
      normalizeAttendanceRecords();
      bindLogin();
      bindGlobal();
      if (currentUser) showApp();
      else document.getElementById("username").focus();
      pullCloudState(false).then(loaded => {
        if (!loaded) return;
        normalizeInventoryCategories();
        normalizeUserPermissions();
        normalizeAttendanceRecords();
        if (currentUser && activeSection !== "billing") {
          renderNav();
          render(activeSection);
        }
      });
      setInterval(() => {
        document.getElementById("liveClock").textContent = new Date().toLocaleString();
        if (currentUser && activeSection !== "billing") render(activeSection);
      }, 30000);
    }
    function bindLogin() {
      const lockedUntil = Number(localStorage.getItem("bp-pos-lock") || 0);
      if (Date.now() < lockedUntil) showLoginMessage("Account locked for 1 minute after 2 wrong attempts.");
      document.getElementById("passwordToggle").addEventListener("click", () => {
        const passwordInput = document.getElementById("password");
        const showing = passwordInput.type === "text";
        passwordInput.type = showing ? "password" : "text";
        document.getElementById("passwordToggle").textContent = showing ? "Show" : "Hide";
        passwordInput.focus();
      });
      ["username", "password"].forEach((id, index, arr) => {
        document.getElementById(id).addEventListener("keydown", e => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (arr[index + 1]) document.getElementById(arr[index + 1]).focus();
            else document.querySelector("#loginForm button").click();
          }
        });
      });
      document.getElementById("loginForm").addEventListener("submit", e => {
        e.preventDefault();
        const locked = Number(localStorage.getItem("bp-pos-lock") || 0);
        if (Date.now() < locked) return showLoginMessage("Account locked. Try again in " + Math.ceil((locked - Date.now()) / 1000) + " seconds.");
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const user = state.users.find(u => u.username === username && u.password === password && u.active);
        if (!user) {
          const attempts = Number(localStorage.getItem("bp-pos-attempts") || 0) + 1;
          localStorage.setItem("bp-pos-attempts", attempts);
          if (attempts >= 2) {
            localStorage.setItem("bp-pos-lock", Date.now() + 60000);
            localStorage.setItem("bp-pos-attempts", "0");
            return showLoginMessage("Account locked for 1 minute after 2 wrong attempts.");
          }
          return showLoginMessage("Invalid username or password. One attempt remaining.");
        }
        localStorage.setItem("bp-pos-attempts", "0");
        localStorage.removeItem("bp-pos-lock");
        currentUser = { username: user.username, role: user.role };
        sessionStorage.setItem("bp-pos-session", JSON.stringify(currentUser));
        showApp();
      });
    }
    function showLoginMessage(text) {
      const msg = document.getElementById("loginMessage");
      msg.textContent = text;
      msg.classList.remove("hidden");
    }
    function bindGlobal() {
      document.getElementById("logoutBtn").onclick = logout;
      document.getElementById("menuBtn").onclick = () => document.getElementById("sidebar").classList.toggle("open");
      document.getElementById("syncBtn").onclick = syncSystem;
      document.getElementById("notifyBtn").onclick = () => {
        const panel = document.getElementById("notificationPanel");
        panel.classList.toggle("hidden");
        panel.innerHTML = `<div class="section-title"><h3>Notifications</h3><button class="btn light icon" onclick="notificationPanel.classList.add('hidden')">x</button></div>` + notifications().map(n => `<div class="notice">${n}</div>`).join("");
      };
      window.addEventListener("storage", () => { state = JSON.parse(localStorage.getItem("bp-pos-state") || "null") || state; if (activeSection !== "billing") render(activeSection); });
      window.addEventListener("storage-lite", () => { if (activeSection !== "billing") render(activeSection); });
      window.addEventListener("beforeunload", e => {
        if (markOutRequired()) {
          e.preventDefault();
          e.returnValue = "Mark out attendance before closing the POS.";
        }
      });
    }
    async function syncSystem() {
      const pulled = await pullCloudState(true);
      if (!pulled) {
        state = JSON.parse(localStorage.getItem("bp-pos-state") || "null") || state;
        await pushCloudState();
      }
      normalizeInventoryCategories();
      normalizeUserPermissions();
      normalizeAttendanceRecords();
      renderNav();
      render(activeSection);
      toast(cloudOnline ? "System synced with Hostinger backend." : "System refreshed locally. Cloud backend unavailable.");
    }
    function logout() {
      if (markOutRequired()) return showMarkOutPrompt();
      performLogout();
    }
    function performLogout() {
      sessionStorage.removeItem("bp-pos-session");
      sessionStorage.removeItem("bp-pos-active-section");
      currentUser = null;
      closeModal();
      document.getElementById("app").classList.add("hidden");
      document.getElementById("loginPage").classList.remove("hidden");
      document.getElementById("password").value = "";
      document.getElementById("username").focus();
    }
    function showApp() {
      document.getElementById("loginPage").classList.add("hidden");
      document.getElementById("app").classList.remove("hidden");
      document.getElementById("signedIn").textContent = `Signed in as ${currentUser.role}`;
      renderNav();
      activeSection = attendanceRequired() ? "attendance" : can(activeSection) ? activeSection : "dashboard";
      showSection(activeSection);
      if (attendanceRequired()) toast("Please mark attendance first.");
    }
    function renderNav() {
      document.getElementById("nav").innerHTML = navItems.filter(([id]) => can(id)).map(([id, label]) =>
        `<button class="${id === activeSection ? "active" : ""}" onclick="showSection('${id}')">${label}</button>`
      ).join("");
    }
    function showSection(id) {
      if (attendanceRequired() && id !== "attendance") return toast("Mark attendance first to continue.");
      if (!can(id)) return toast("You do not have permission for this section.");
      activeSection = id;
      sessionStorage.setItem("bp-pos-active-section", activeSection);
      document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === id));
      document.getElementById("sidebar").classList.remove("open");
      renderNav();
      render(id);
      if (id === "billing") setTimeout(() => document.getElementById("scanInput")?.focus(), 80);
    }
    function render(id) {
      const map = { dashboard: renderDashboard, inventory: renderInventory, billing: renderBilling, reports: renderReports, attendance: renderAttendance, dayclose: renderDayClose, expenses: renderExpenses, users: renderUsers, settings: renderSettings };
      map[id]?.();
    }

    function billTotals(bill) {
      const subtotal = bill.items.reduce((s, i) => s + i.price * i.qty, 0);
      const itemDiscount = bill.items.reduce((s, i) => s + (i.price * i.qty * i.discount / 100), 0);
      const billLevelDiscount = Number(bill.billDiscount || 0);
      const discount = Math.min(subtotal, itemDiscount + billLevelDiscount);
      const total = subtotal - discount;
      return { subtotal, itemDiscount, billLevelDiscount, discount, total, profit: total };
    }
    function billsFor(date) { return state.bills.filter(b => b.date.slice(0, 10) === date); }
    function salesFor(date) { return billsFor(date).reduce((s, b) => s + billTotals(b).total, 0); }
    function expensesFor(date) { return state.expenses.filter(e => e.date === date).reduce((s, e) => s + Number(e.amount), 0); }

    function renderDashboard() {
      const today = todayKey();
      const month = monthKey();
      const todayBills = billsFor(today);
      const monthBills = state.bills.filter(b => b.date.slice(0, 7) === month);
      const profit = todayBills.reduce((s, b) => s + billTotals(b).profit, 0);
      const low = state.products.filter(p => Number(p.stock) <= 5);
      const labels = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(5, 10);
      });
      const values = [...Array(7)].map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i)); return salesFor(d.toISOString().slice(0, 10));
      });
      const weeklyTotal = values.reduce((sum, value) => sum + value, 0);
      const bestDayValue = Math.max(...values, 0);
      const bestDayLabel = labels[values.indexOf(bestDayValue)] || "-";
      document.getElementById("dashboard").innerHTML = `
        <div class="grid stats">
          ${stat("Today Sales", money(salesFor(today)), `${todayBills.length} bills`)}
          ${stat("Yesterday Sales", money(salesFor(yesterdayKey())), "Previous day")}
          ${stat("Monthly Sales", money(monthBills.reduce((s,b)=>s+billTotals(b).total,0)), month)}
          ${stat("Profit Overview", money(profit), "Today profit")}
          ${stat("Expense Overview", money(expensesFor(today)), "Today expenses")}
        </div>
        <div class="grid two-col" style="margin-top:16px">
          <div class="card chart-card">
            <div class="chart-head">
              <div><h3>Sales Graph</h3><p>Last 7 days sales performance</p></div>
              <span class="chart-live">Live</span>
            </div>
            <div class="chart-kpis">
              <div class="chart-kpi"><small>7 Day Sales</small><strong>${money(weeklyTotal)}</strong></div>
              <div class="chart-kpi"><small>Best Day</small><strong>${bestDayLabel} - ${money(bestDayValue)}</strong></div>
              <div class="chart-kpi"><small>Today</small><strong>${money(salesFor(today))}</strong></div>
            </div>
            <div class="chart-wrap"><canvas id="salesChart"></canvas><div id="salesChartTooltip" class="chart-tooltip"></div></div>
          </div>
          <div class="card">
            <div class="section-title"><h3>Low Stock Alerts</h3><span class="badge warn">${low.length}</span></div>
            ${low.length ? low.map(p => `<div class="notice"><strong>${p.name}</strong><br><span class="muted">${p.category} - stock ${p.stock}</span></div>`).join("") : `<p class="muted">All stock levels look healthy.</p>`}
          </div>
        </div>`;
      const canvas = document.getElementById("salesChart");
      if (typeof Chart !== "undefined") {
        if (chart) chart.destroy();
        chart = new Chart(canvas, {
          type: "bar",
          data: { labels, datasets: [{
            label: "Sales",
            data: values,
            borderColor: values.map(v => v > 0 ? "#0d2b4f" : "rgba(13,43,79,0)"),
            backgroundColor: values.map(v => v > 0 ? "#0d2b4f" : "rgba(13,43,79,0)"),
            borderWidth: 0,
            borderRadius: 8,
            borderSkipped: false,
            barPercentage: 0.82,
            categoryPercentage: 0.86,
            maxBarThickness: 86
          }] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: "index" },
            plugins: {
              legend: { display: false },
              tooltip: {
                enabled: false,
                external: context => renderSalesTooltip(context)
              }
            },
            scales: {
              x: { grid: { color: "rgba(13,43,79,0.09)" }, border: { color: "rgba(13,43,79,0.18)" }, ticks: { color: "#6d7788", font: { weight: "800" } } },
              y: { beginAtZero: true, grid: { color: "rgba(13,43,79,0.14)" }, border: { display: false }, ticks: { color: "#6d7788", callback: value => Number(value).toLocaleString("en-PK") } }
            }
          }
        });
      } else {
        drawFallbackChart(canvas, labels, values);
      }
    }
    function stat(label, value, hint) {
      return `<div class="card stat"><small>${label}</small><strong>${value}</strong><em>${hint}</em></div>`;
    }
    function renderSalesTooltip(context) {
      const tooltip = context.tooltip;
      const tooltipEl = document.getElementById("salesChartTooltip");
      if (!tooltipEl) return;
      if (!tooltip || tooltip.opacity === 0) {
        tooltipEl.classList.remove("visible");
        return;
      }
      const point = tooltip.dataPoints?.[0];
      if (!point) return;
      tooltipEl.innerHTML = `<strong>${point.label}</strong><span>Sales: ${money(point.parsed.y)}</span>`;
      tooltipEl.style.left = tooltip.caretX + "px";
      tooltipEl.style.top = tooltip.caretY + "px";
      tooltipEl.classList.add("visible");
    }
    function drawFallbackChart(canvas, labels, values) {
      const ctx = canvas.getContext("2d");
      const width = canvas.width = canvas.clientWidth || 680;
      const height = canvas.height = 230;
      const max = Math.max(...values, 1);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#e6ebf2";
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const y = 24 + i * 45;
        ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(width - 12, y); ctx.stroke();
      }
      const slot = (width - 70) / Math.max(values.length, 1);
      labels.forEach((_, i) => {
        const x = 38 + i * slot + slot / 2;
        ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, height - 28); ctx.stroke();
      });
      const barWidth = Math.min(78, slot * 0.62);
      values.forEach((v, i) => {
        const x = 38 + i * slot + (slot - barWidth) / 2;
        const barHeight = (v / max) * (height - 70);
        const y = height - 34 - barHeight;
        if (v <= 0) return;
        ctx.fillStyle = "#0d2b4f";
        ctx.beginPath();
        roundedRect(ctx, x, y, barWidth, Math.max(barHeight, 4), 8);
        ctx.fill();
      });
      ctx.fillStyle = "#6d7788";
      ctx.font = "12px Inter, sans-serif";
      labels.forEach((label, i) => ctx.fillText(label, 38 + i * slot + slot / 2 - 16, height - 10));
    }
    function roundedRect(ctx, x, y, width, height, radius) {
      const r = Math.min(radius, width / 2, height / 2);
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + width - r, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + r);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function renderInventory() {
      document.getElementById("inventory").innerHTML = `
        <div class="card">
          <div class="section-title"><h3>Inventory</h3><button class="btn orange" onclick="openProductModal()">Add Product</button></div>
          <div class="alert hidden section-message"></div>
          <div class="toolbar">
            <input id="productSearch" placeholder="Search products or barcode" oninput="renderProductTable()">
            <select id="categoryFilter" onchange="renderProductTable()"><option value="">All Categories</option>${inventoryCategories.map(c => `<option>${c}</option>`).join("")}</select>
            <button class="btn light" onclick="exportCSV('inventory')">Export Excel</button>
          </div>
          <div id="productTable"></div>
        </div>
        <div class="card" style="margin-top:16px">
          <div class="section-title"><h3>Stock Adjustment History</h3><span class="badge">${state.stockHistory.length}</span></div>
          <div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Change</th><th>Remarks</th><th>User</th></tr></thead><tbody>
          ${state.stockHistory.slice().reverse().map(h => `<tr><td>${h.date}</td><td>${h.product}</td><td>${h.change}</td><td>${h.remarks || ""}</td><td>${h.user}</td></tr>`).join("") || `<tr><td colspan="5">No adjustments yet.</td></tr>`}
          </tbody></table></div>
        </div>`;
      renderProductTable();
    }
    function renderProductTable() {
      const q = (document.getElementById("productSearch")?.value || "").toLowerCase();
      const cat = document.getElementById("categoryFilter")?.value || "";
      const rows = state.products.filter(p => (!cat || p.category === cat) && [p.name, p.barcode, p.category].join(" ").toLowerCase().includes(q));
      document.getElementById("productTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Image</th><th>Name</th><th>Barcode</th><th>Category</th><th>Price</th><th>Stock</th><th>Disc</th><th>Remarks</th><th>Actions</th></tr></thead><tbody>
        ${rows.map(p => `<tr>
          <td>${p.image ? `<img class="thumb" src="${p.image}">` : `<div class="thumb">${p.name[0] || "P"}</div>`}</td>
          <td><strong>${p.name}</strong></td><td>${p.barcode}</td><td>${p.category}</td><td>${money(p.price)}</td>
          <td><span class="badge ${p.stock <= 5 ? "warn" : "good"}">${p.stock}</span></td><td>${p.discount}%</td><td>${p.remarks || ""}</td>
          <td><button class="btn light" onclick="openProductModal('${p.id}')">Edit</button> <button class="btn danger" onclick="deleteProduct('${p.id}')">Delete</button></td>
        </tr>`).join("") || `<tr><td colspan="9">No products found.</td></tr>`}
      </tbody></table></div>`;
    }
    function openProductModal(id = null) {
      if (!can("inventory")) return showSectionMessage("inventory", "You do not have permission to add or edit inventory.");
      editingProductId = id;
      const p = state.products.find(x => x.id === id) || { name:"", barcode:"", category:"", price:"", stock:"", discount:"0", remarks:"", image:"" };
      document.getElementById("modalRoot").innerHTML = `<div class="modal"><div class="modal-panel">
        <div class="section-title"><h3>${id ? "Edit" : "Add"} Product</h3><button class="btn light icon" onclick="closeModal()">x</button></div>
        <form id="productForm" class="form-grid">
          ${field("Product Name", "name", p.name, "text")}
          ${field("Barcode", "barcode", p.barcode, "text")}
          <div class="field"><label>Category</label><select id="category">${inventoryCategories.map(c => `<option ${p.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          ${field("Price", "price", p.price, "number")}
          ${field("Stock Quantity", "stock", p.stock, "number")}
          ${field("Discount %", "discount", p.discount, "number")}
          <div class="field"><label>Product Image</label><input id="imageFile" type="file" accept="image/*"></div>
          <div class="field wide"><label>Remarks</label><textarea id="remarks">${p.remarks || ""}</textarea></div>
          <div id="productFormMessage" class="alert hidden wide"></div>
          <div class="field wide"><button class="btn orange" type="submit">Save Product</button></div>
        </form>
      </div></div>`;
      document.getElementById("productForm").onsubmit = saveProduct;
    }
    function field(label, id, value = "", type = "text", attrs = "") {
      return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${value ?? ""}" ${attrs}></div>`;
    }
    function saveProduct(e) {
      e.preventDefault();
      const message = document.getElementById("productFormMessage");
      const showProductError = text => {
        message.textContent = text;
        message.classList.remove("hidden");
        toast(text);
      };
      message.classList.add("hidden");
      const file = document.getElementById("imageFile").files[0];
      const finish = image => {
        const old = state.products.find(p => p.id === editingProductId);
        const productName = document.getElementById("name").value.trim();
        const productBarcode = document.getElementById("barcode").value.trim();
        const productCategory = document.getElementById("category").value;
        const productPrice = Number(document.getElementById("price").value);
        const productStock = Number(document.getElementById("stock").value);
        const productDiscount = Number(document.getElementById("discount").value || 0);
        const productRemarks = document.getElementById("remarks").value.trim();
        const product = {
          id: editingProductId || uid("p"),
          name: productName,
          barcode: productBarcode,
          category: productCategory,
          price: productPrice,
          stock: productStock,
          discount: productDiscount,
          remarks: productRemarks,
          image: image || old?.image || ""
        };
        if (!product.name || !product.barcode) return showProductError("Product name and barcode are required.");
        if (!Number.isFinite(product.price) || product.price < 0) return showProductError("Valid product price is required.");
        if (!Number.isFinite(product.stock) || product.stock < 0) return showProductError("Stock quantity cannot be negative.");
        if (state.products.some(p => p.id !== product.id && p.barcode === product.barcode)) return showProductError("This barcode already exists.");
        if (old) {
          state.stockHistory.push({ date: new Date().toLocaleString(), product: product.name, change: product.stock - old.stock, remarks: "Product edit", user: currentUser.username });
          Object.assign(old, product);
        } else {
          state.products.push(product);
          state.stockHistory.push({ date: new Date().toLocaleString(), product: product.name, change: product.stock, remarks: "Initial stock", user: currentUser.username });
        }
        save(); closeModal(); renderInventory();
      };
      if (file) {
        const reader = new FileReader();
        reader.onload = () => finish(reader.result);
        reader.readAsDataURL(file);
      } else finish("");
    }
    function deleteProduct(id) {
      if (!can("inventory")) return showSectionMessage("inventory", "You do not have permission to delete inventory.");
      if (!confirm("Delete this product?")) return;
      state.products = state.products.filter(p => p.id !== id);
      save(); renderInventory();
    }
    function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }

    function renderBilling() {
      const mustAttend = currentUser.role === "Cashier" && !hasAttendanceToday(currentUser.username);
      document.getElementById("billing").innerHTML = `
        ${mustAttend ? `<div class="alert">Cashier must mark attendance first before creating bills.</div>` : ""}
        <div class="pos-grid">
          <div class="card pos-panel">
            <div class="pos-panel-head"><h3>Billing Screen</h3><span class="badge">Barcode Optimized</span></div>
            <div class="pos-panel-body">
              <div class="customer-first">
                <div class="customer-first-head"><strong>1. Customer Details</strong><span class="badge">Required</span></div>
                <div class="customer-fields">
                  ${field("Customer Name", "customerName", "", "text")}
                  ${field("Phone Number", "customerPhone", "", "tel", 'maxlength="11" pattern="[0-9]{11}"')}
                </div>
              </div>
              <div class="scan-zone">
                <div class="customer-first-head"><strong>2. Scan or Select Product</strong><span class="badge">After customer</span></div>
                <input id="scanInput" class="scan-input" placeholder="Scan barcode or search item name" oninput="renderProductResults()" onkeydown="scanKey(event)">
              </div>
              <div style="height:14px"></div>
              <div id="productResults" class="product-results"></div>
            </div>
          </div>
          <div class="card pos-panel">
            <div class="pos-panel-head"><h3>Current Bill</h3><button class="btn light" onclick="clearCart()">Clear</button></div>
            <div class="pos-panel-body">
            <div id="cartList" class="cart-list" style="margin-top:0"></div>
            <div class="payment-fields">
              <div class="field"><label>Sale Mode</label><select id="saleMode" onchange="saleModeChanged()"><option>In Store</option><option>Online Store</option><option>Exchange Item</option></select></div>
              <div class="field"><label>Payment Method</label><select id="paymentMethod" onchange="paymentMethodChanged()"><option>Cash</option><option>Bank</option></select></div>
              <div class="field"><label>Bank Reference</label><input id="bankRef" placeholder="Write bank/reference details"></div>
              ${field("Received Amount", "receivedAmount", "", "number")}
              ${field("Discount", "totalDiscount", billDiscount, "number", 'min="0"')}
            </div>
            <div id="billSummary" class="summary"></div>
            <button type="button" class="btn orange checkout-btn" ${mustAttend ? "disabled" : ""} onclick="saveBill(true)">Save & Print</button>
            </div>
          </div>
        </div>`;
      renderProductResults();
      renderCart();
      bindBillingEnterFlow();
    }
    function bindBillingEnterFlow() {
      const order = ["customerName", "customerPhone", "scanInput", "saleMode", "paymentMethod", "bankRef", "receivedAmount", "totalDiscount"];
      order.forEach((id, index) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.enterBound) return;
        el.dataset.enterBound = "true";
        el.addEventListener("keydown", e => {
          if (e.key !== "Enter") return;
          if (id === "scanInput") return scanKey(e);
          e.preventDefault();
          e.stopPropagation();
          const next = document.getElementById(order[index + 1] || "scanInput");
          if (next) next.focus();
        }, true);
      });
    }
    function scanKey(e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const q = e.target.value.trim().toLowerCase();
      const found = state.products.find(p => p.barcode.toLowerCase() === q) || state.products.find(p => p.name.toLowerCase().includes(q));
      if (found) { addToCart(found.id); e.target.value = ""; renderProductResults(); }
    }
    function renderProductResults() {
      const q = (document.getElementById("scanInput")?.value || "").toLowerCase();
      const rows = state.products.filter(p => !q || [p.name, p.barcode, p.category].join(" ").toLowerCase().includes(q)).slice(0, 30);
      document.getElementById("productResults").innerHTML = rows.map(p => `<button class="product-tile" onclick="addToCart('${p.id}')">
        ${p.image ? `<img class="thumb" src="${p.image}">` : `<div class="thumb">${p.name[0] || "P"}</div>`}
        <strong>${p.name}</strong><small>${p.barcode} - ${money(p.price)}</small><small>Stock ${p.stock} - Discount ${p.discount}%</small>
      </button>`).join("") || `<p class="muted">No matching products.</p>`;
    }
    function customerDetailsReady() {
      const customerName = document.getElementById("customerName")?.value.trim();
      const customerPhone = document.getElementById("customerPhone")?.value.trim();
      return Boolean(customerName && /^\d{11}$/.test(customerPhone || ""));
    }
    function addToCart(id) {
      if (!customerDetailsReady()) {
        toast("Enter customer name and 11 digit phone number before adding products.");
        document.getElementById("customerName")?.focus();
        return;
      }
      const p = state.products.find(x => x.id === id);
      if (!p || p.stock <= 0) return toast("Product is out of stock.");
      const item = cart.find(i => i.id === id);
      if (item) item.qty = Math.min(item.qty + 1, p.stock);
      else cart.push({ id: p.id, name: p.name, price: p.price, qty: 1, discount: Number(p.discount || 0), stock: p.stock });
      renderCart();
      document.getElementById("scanInput")?.focus();
    }
    function currentCartTotals() {
      billDiscount = Number(document.getElementById("totalDiscount")?.value || billDiscount || 0);
      const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const itemDiscount = cart.reduce((s, i) => s + i.price * i.qty * i.discount / 100, 0);
      const discount = Math.min(subtotal, itemDiscount + billDiscount);
      return { subtotal, itemDiscount, discount, total: subtotal - discount };
    }
    function applyBankReferenceAmount() {
      const bankRef = document.getElementById("bankRef");
      const paymentMethod = document.getElementById("paymentMethod");
      const receivedAmount = document.getElementById("receivedAmount");
      if (!bankRef || !receivedAmount || !bankRef.value.trim()) return;
      if (paymentMethod) paymentMethod.value = "Bank";
      receivedAmount.value = currentCartTotals().total;
    }
    function paymentMethodChanged() {
      const paymentMethod = document.getElementById("paymentMethod");
      const bankRef = document.getElementById("bankRef");
      if (paymentMethod?.value === "Cash" && bankRef) bankRef.value = "";
      updateBillSummary();
    }
    function updateBillSummary() {
      applyBankReferenceAmount();
      const { subtotal, discount, total } = currentCartTotals();
      const received = Number(document.getElementById("receivedAmount")?.value || 0);
      document.getElementById("billSummary").innerHTML = `
        <div><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
        <div><span>Discount</span><strong>${money(discount)}</strong></div>
        <div class="total"><span>Grand Total</span><strong>${money(total)}</strong></div>
        <div><span>Received</span><strong>${money(received)}</strong></div>
        <div><span>Remaining</span><strong>${money(total - received)}</strong></div>`;
    }
    function bindBillingAmountInputs() {
      [["receivedAmount", updateBillSummary], ["totalDiscount", updateBillSummary], ["bankRef", updateBillSummary], ["paymentMethod", paymentMethodChanged]].forEach(([id, handler]) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.amountBound) return;
        el.dataset.amountBound = "true";
        el.addEventListener("input", handler);
      });
    }
    function renderCart() {
      const editable = document.getElementById("saleMode")?.value === "Online Store";
      billDiscount = Number(document.getElementById("totalDiscount")?.value || billDiscount || 0);
      document.getElementById("cartList").innerHTML = cart.map(i => `<div class="cart-item">
        <div class="cart-row"><div class="cart-title"><strong>${i.name}</strong><small>${money(i.price)} each</small></div><button class="btn light icon" onclick="removeCart('${i.id}')">x</button></div>
        <div class="cart-controls">
          <span class="qty"><button onclick="changeQty('${i.id}',-1)">-</button><strong>${i.qty}</strong><button onclick="changeQty('${i.id}',1)">+</button></span>
          <span>${editable ? `<input class="cart-price-input" type="number" value="${i.price}" onchange="editCartPrice('${i.id}',this.value)">` : money(i.price * i.qty)}</span>
          <div class="cart-discount"><label>Disc %</label><input type="number" min="0" max="100" value="${i.discount}" onchange="editCartDiscount('${i.id}',this.value)" oninput="editCartDiscount('${i.id}',this.value)"></div>
        </div>
      </div>`).join("") || `<p class="muted">Scan or select products to add items.</p>`;
      bindBillingAmountInputs();
      updateBillSummary();
    }
    function saleModeChanged() {
      if (document.getElementById("saleMode").value === "Online Store") document.getElementById("paymentMethod").value = "Bank";
      renderCart();
    }
    function changeQty(id, step) {
      const item = cart.find(i => i.id === id);
      if (!item) return;
      item.qty = Math.max(1, Math.min(item.stock, item.qty + step));
      renderCart();
    }
    function editCartPrice(id, value) {
      const item = cart.find(i => i.id === id);
      if (item) item.price = Number(value);
      renderCart();
    }
    function editCartDiscount(id, value) {
      const item = cart.find(i => i.id === id);
      if (item) item.discount = Math.max(0, Math.min(100, Number(value || 0)));
      renderCart();
    }
    function removeCart(id) { cart = cart.filter(i => i.id !== id); renderCart(); }
    function clearCart() { cart = []; billDiscount = 0; const totalInput = document.getElementById("totalDiscount"); if (totalInput) totalInput.value = 0; renderCart(); }
    function saveBill(print = false) {
      if (currentUser.role === "Cashier" && !hasAttendanceToday(currentUser.username)) return toast("Mark attendance before billing.");
      const customerName = document.getElementById("customerName").value.trim();
      const customerPhone = document.getElementById("customerPhone").value.trim();
      if (!customerName || !/^\d{11}$/.test(customerPhone)) return toast("Customer name and 11 digit phone number are required.");
      if (!cart.length) return toast("Add at least one item.");
      const bill = {
        id: uid("b"), date: new Date().toISOString(), cashier: currentUser.username, customerName, customerPhone,
        saleMode: document.getElementById("saleMode").value, paymentMethod: document.getElementById("paymentMethod").value,
        bankRef: document.getElementById("bankRef").value, received: Number(document.getElementById("receivedAmount").value || 0),
        billDiscount: Number(document.getElementById("totalDiscount").value || 0),
        items: cart.map(i => ({ ...i }))
      };
      bill.items.forEach(item => {
        const p = state.products.find(x => x.id === item.id);
        if (p) {
          p.stock -= item.qty;
          state.stockHistory.push({ date: new Date().toLocaleString(), product: p.name, change: -item.qty, remarks: "Bill " + bill.id, user: currentUser.username });
        }
      });
      state.bills.push(bill);
      save();
      cart = [];
      billDiscount = 0;
      if (print || state.settings.autoPrint) printReceipt(bill);
      renderBilling();
      toast("Bill saved successfully.");
    }
    function printReceipt(bill) {
      const settings = state.settings;
      const t = billTotals(bill);
      const receiptHtml = copy => `<div class="receipt">
        ${settings.logo ? `<img src="${settings.logo}">` : ""}
        <h1>${settings.shopName}</h1>
        <div class="center">${settings.phone}<br>${copy}</div>
        <div class="line"></div>
        <div class="receipt-meta">
          <div><span>Bill</span><strong>${bill.id}</strong></div>
          <div><span>Date</span><span>${new Date(bill.date).toLocaleString()}</span></div>
          <div><span>Cashier</span><span>${bill.cashier}</span></div>
          <div><span>Customer</span><span>${bill.customerName}</span></div>
          <div><span>Phone</span><span>${bill.customerPhone}</span></div>
          <div><span>Mode</span><strong>${bill.saleMode || "In Store"}</strong></div>
        </div>
        <div class="line"></div>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Amt</th></tr></thead><tbody>
        ${bill.items.map(i => `<tr><td>${i.name}<br>${i.discount}% off</td><td>${i.qty}</td><td>${money(i.price * i.qty * (1 - i.discount/100))}</td></tr>`).join("")}
        </tbody></table>
        <div class="line"></div>
        <div class="receipt-total-box">
          <div><span>Subtotal</span><strong>${money(t.subtotal)}</strong></div>
          <div><span>Discount</span><strong>${money(t.discount)}</strong></div>
          <div class="receipt-grand"><span>Grand Total</span><strong>${money(t.total)}</strong></div>
          <div><span>Received</span><strong>${money(bill.received)}</strong></div>
          <div><span>Remaining</span><strong>${money(t.total - bill.received)}</strong></div>
        </div>
        <div class="line"></div>
        <div class="receipt-meta"><div><span>Payment</span><strong>${bill.paymentMethod} ${bill.bankRef || ""}</strong></div></div>
        <div class="line"></div><div class="center">${settings.receiptFooter}</div>
      </div>`;
      document.getElementById("printArea").innerHTML = receiptHtml("Customer Copy") + receiptHtml("Cashier Copy");
      document.getElementById("printArea").classList.remove("hidden");
      setTimeout(() => { window.print(); document.getElementById("printArea").classList.add("hidden"); }, 120);
    }

    function renderReports() {
      const daily = salesFor(todayKey());
      const monthlyBills = state.bills.filter(b => b.date.slice(0, 7) === monthKey());
      const monthly = monthlyBills.reduce((s,b)=>s+billTotals(b).total,0);
      const payment = ["Cash", "Bank"].map(m => [m, state.bills.filter(b => b.paymentMethod === m).reduce((s,b)=>s+billTotals(b).total,0)]);
      document.getElementById("reports").innerHTML = `<div class="grid stats">
        ${stat("Daily Sales", money(daily), todayKey())}
        ${stat("Monthly Sales", money(monthly), monthKey())}
        ${stat("Expenses", money(expensesFor(todayKey())), "Today")}
        ${stat("Net Sales", money(daily - expensesFor(todayKey())), "After expenses")}
        ${stat("Cash vs Bank", money(payment[0][1]) + " / " + money(payment[1][1]), "Comparison")}
      </div>
      <div class="card" style="margin-top:16px">
        <div class="section-title"><h3>Bill Reports</h3><button class="btn light" onclick="exportCSV('bills')">Export Excel</button></div>
        <div class="toolbar"><input id="billSearch" placeholder="Search bills, customer, phone" oninput="renderBillTable()"></div>
        <div id="billTable"></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="section-title"><h3>Payment Method Breakdown</h3></div>
        <div class="grid stats">${payment.map(([m,v]) => stat(m, money(v), m === "Bank" ? "Typed references" : "Total")).join("")}</div>
      </div>`;
      renderBillTable();
    }
    function renderBillTable() {
      const q = (document.getElementById("billSearch")?.value || "").toLowerCase();
      const rows = state.bills.filter(b => [b.id,b.customerName,b.customerPhone,b.cashier,b.saleMode,b.paymentMethod,b.bankRef].join(" ").toLowerCase().includes(q)).slice().reverse();
      document.getElementById("billTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Bill</th><th>Customer</th><th>Cashier</th><th>Payment</th><th>Total</th><th>Actions</th></tr></thead><tbody>
      ${rows.map(b => `<tr><td>${new Date(b.date).toLocaleString()}</td><td>${b.id}</td><td>${b.customerName}<br>${b.customerPhone}</td><td>${b.cashier}</td><td><span class="badge">${b.saleMode || "In Store"}</span><br>${b.paymentMethod} ${b.bankRef || ""}</td><td>${money(billTotals(b).total)}</td><td><button class="btn light" onclick="printReceiptById('${b.id}')">Reprint</button> ${currentUser.role === "Owner" ? `<button class="btn danger" onclick="deleteBill('${b.id}')">Delete</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7">No bills found.</td></tr>`}
      </tbody></table></div>`;
    }
    function printReceiptById(id) { const b = state.bills.find(x => x.id === id); if (b) printReceipt(b); }
    function deleteBill(id) {
      if (!requireOwner() || !confirm("Delete bill? Stock will not be restored automatically.")) return;
      state.bills = state.bills.filter(b => b.id !== id);
      save(); renderReports();
    }

    function hasAttendanceToday(username) {
      return state.attendance.some(a => a.username === username && a.date === todayKey());
    }
    function todayAttendance(username) {
      return state.attendance.find(a => a.username === username && a.date === todayKey());
    }
    function isTodayClosed() {
      return state.dayClosings.some(d => d.date === todayKey() && d.status === "Closed");
    }
    function attendanceRequired() {
      return currentUser?.role === "Cashier" && !isTodayClosed() && !hasAttendanceToday(currentUser.username);
    }
    function markOutRequired() {
      const record = currentUser?.role === "Cashier" ? todayAttendance(currentUser.username) : null;
      return Boolean(record && !record.outTime);
    }
    function renderAttendance() {
      const monthRows = state.attendance.filter(a => a.date.slice(0, 7) === monthKey());
      const needsMark = attendanceRequired();
      const needsOut = markOutRequired();
      const cashierName = currentUser?.username || "User";
      const currentRecord = todayAttendance(cashierName);
      const canManage = currentUser?.role === "Owner";
      document.getElementById("attendance").innerHTML = `<div class="card">
        <div class="section-title"><h3>Attendance</h3><div class="user-actions">${needsOut ? `<button class="btn light" onclick="markOutAttendance()">Mark Out</button>` : ""}</div></div>
        <div class="attendance-user-card">
          <small>${needsMark ? "Mark attendance first" : "Mark another attendance"}</small>
          <strong>${cashierName}</strong>
          <span>${currentRecord ? `Last in: ${currentRecord.name || currentRecord.username} at ${currentRecord.time}` : "Type person name and mark present"}</span>
          <div class="form-grid" style="margin-top:10px">
            <div class="field wide"><label>Person Name</label><input id="attendancePersonName" placeholder="Enter person name" onkeydown="attendanceNameKey(event)"></div>
            <div class="field"><label>&nbsp;</label><button class="btn orange" onclick="markAttendance()">Mark Present</button></div>
          </div>
        </div>
        ${needsMark ? `<div class="alert">Please type the person name and click Mark Present first. Billing and other POS sections will unlock after attendance is marked.</div>` : `<p class="muted">Attendance stays ready so another person can be marked present whenever this tab is opened.</p>`}
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>User</th><th>Role</th><th>In Time</th><th>Out Time</th><th>Status</th>${canManage ? "<th>Actions</th>" : ""}</tr></thead><tbody>
        ${monthRows.slice().reverse().map(a => attendanceRow(a, canManage)).join("") || `<tr><td colspan="${canManage ? 7 : 6}">No attendance for this month.</td></tr>`}
        </tbody></table></div>
        <button class="btn light" style="margin-top:14px" onclick="exportCSV('attendance')">Export Attendance to Excel</button>
      </div>`;
      setTimeout(() => document.getElementById("attendancePersonName")?.focus(), 50);
    }
    function attendanceRow(record, canManage) {
      return `<tr>
        <td>${record.date}</td>
        <td><strong>${record.name || record.username}</strong></td>
        <td>${record.role}</td>
        <td>${record.time || "-"}</td>
        <td>${record.outTime || "-"}</td>
        <td><span class="badge ${record.outTime || record.status === "Completed" ? "good" : "warn"}">${record.outTime ? "Completed" : record.status}</span></td>
        ${canManage ? `<td><button class="btn light" onclick="openAttendanceModal('${record.id}')">Edit</button> <button class="btn danger" onclick="deleteAttendance('${record.id}')">Delete</button></td>` : ""}
      </tr>`;
    }
    function markAttendance() {
      const personName = document.getElementById("attendancePersonName")?.value.trim();
      if (!personName) {
        toast("Enter person name first.");
        document.getElementById("attendancePersonName")?.focus();
        return;
      }
      state.attendance.push({ id: uid("a"), date: todayKey(), username: currentUser.username, name: personName, role: currentUser.role, time: new Date().toLocaleTimeString(), status: "Present" });
      save();
      renderNav();
      renderAttendance();
      toast(`${personName} marked present.`);
    }
    function attendanceNameKey(event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      markAttendance();
    }
    function openAttendanceModal(id) {
      if (!requireOwner()) return;
      const record = state.attendance.find(a => a.id === id);
      if (!record) return toast("Attendance record not found.");
      const cashierUsers = state.users.filter(user => user.role === "Cashier");
      if (!cashierUsers.some(user => user.username === record.username)) {
        cashierUsers.push({ username: record.username, role: record.role || "Cashier" });
      }
      document.getElementById("modalRoot").innerHTML = `<div class="modal"><div class="modal-panel small-modal">
        <div class="section-title"><h3>Edit Attendance</h3><button class="btn light icon" onclick="closeModal()">x</button></div>
        <form id="attendanceEditForm" class="form-grid">
          <div class="field wide"><label>Cashier</label><select id="attendanceUser">${cashierUsers.map(user => `<option value="${user.username}" ${record.username === user.username ? "selected" : ""}>${user.username}</option>`).join("")}</select></div>
          ${field("Date", "attendanceDate", record.date, "date")}
          ${field("In Time", "attendanceIn", record.time || "", "text")}
          ${field("Out Time", "attendanceOut", record.outTime || "", "text")}
          <div class="field"><label>Status</label><select id="attendanceStatus">${["Present", "Completed", "Absent", "Late"].map(status => `<option ${record.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
          <div id="attendanceFormMessage" class="alert hidden wide"></div>
          <div class="field wide"><button class="btn orange" type="submit">Save Attendance</button></div>
        </form>
      </div></div>`;
      document.getElementById("attendanceEditForm").onsubmit = event => saveAttendanceEdit(event, id);
    }
    function saveAttendanceEdit(event, id) {
      event.preventDefault();
      if (!requireOwner()) return;
      const record = state.attendance.find(a => a.id === id);
      if (!record) return toast("Attendance record not found.");
      const message = document.getElementById("attendanceFormMessage");
      const username = document.getElementById("attendanceUser").value.trim();
      const date = document.getElementById("attendanceDate").value;
      const inTime = document.getElementById("attendanceIn").value.trim();
      const outTime = document.getElementById("attendanceOut").value.trim();
      const status = document.getElementById("attendanceStatus").value;
      if (!username || !date || !inTime) {
        message.textContent = "Cashier, date, and in time are required.";
        message.classList.remove("hidden");
        return;
      }
      const cashier = state.users.find(user => user.username === username);
      record.username = username;
      record.name = username;
      record.role = cashier?.role || "Cashier";
      record.date = date;
      record.time = inTime;
      record.outTime = outTime;
      record.status = outTime ? "Completed" : status;
      if (outTime && !record.outAt) record.outAt = new Date().toISOString();
      if (!outTime) delete record.outAt;
      save();
      closeModal();
      renderAttendance();
      toast("Attendance updated.");
    }
    function deleteAttendance(id) {
      if (!requireOwner()) return;
      if (!confirm("Delete this attendance record?")) return;
      state.attendance = state.attendance.filter(record => record.id !== id);
      save();
      renderAttendance();
      toast("Attendance deleted.");
    }
    function markOutAttendance(skipToast = false) {
      const record = todayAttendance(currentUser?.username);
      if (!record) {
        if (!skipToast) toast("Mark attendance first.");
        return false;
      }
      if (record.outTime) {
        if (!skipToast) toast("Out attendance already marked.");
        return false;
      }
      record.outTime = new Date().toLocaleTimeString();
      record.outAt = new Date().toISOString();
      record.status = "Completed";
      save();
      if (activeSection === "attendance") renderAttendance();
      if (!skipToast) toast("Out attendance marked.");
      return true;
    }
    function showMarkOutPrompt() {
      document.getElementById("modalRoot").innerHTML = `<div class="modal"><div class="modal-panel small-modal">
        <div class="section-title"><h3>Mark Out Attendance</h3><button class="btn light icon" onclick="closeModal()">x</button></div>
        <p class="muted">Before closing the POS, mark your out attendance for today.</p>
        <div class="modal-actions">
          <button class="btn orange" onclick="markOutAttendance(true); performLogout();">Mark Out & Logout</button>
          <button class="btn ghost" onclick="performLogout()">Logout Without Mark Out</button>
          <button class="btn light" onclick="closeModal()">Cancel</button>
        </div>
      </div></div>`;
    }

    function renderDayClose() {
      const today = todayKey();
      const cash = state.bills.filter(b => b.date.slice(0,10) === today && b.paymentMethod === "Cash").reduce((s,b)=>s+billTotals(b).total,0);
      const bank = state.bills.filter(b => b.date.slice(0,10) === today && b.paymentMethod === "Bank").reduce((s,b)=>s+billTotals(b).total,0);
      const totalSales = cash + bank;
      const exp = expensesFor(today);
      const afterExpense = totalSales - exp;
      const closed = state.dayClosings.find(d => d.date === today && d.status === "Closed");
      document.getElementById("dayclose").innerHTML = `<div class="day-close-layout">
        <div class="card close-panel">
          <div class="close-hero">
            <div class="close-status-row"><h3>Day Close</h3><span class="badge">${closed ? "Closed" : "Open"}</span></div>
            <div class="close-net">
              <div><small>After Expense Amount</small><strong>${money(afterExpense)}</strong><span>Total sales minus today expenses</span></div>
              <div class="close-date"><small>${closed ? "Closed at" : "Business date"}</small><strong>${closed ? closed.time : today}</strong></div>
            </div>
          </div>
          <div class="close-metrics">
            ${closeMetric("Cash Sales", money(cash), "Cash")}
            ${closeMetric("Bank Sales", money(bank), "Bank")}
            ${closeMetric("Total Sales", money(totalSales), "Cash + Bank")}
            ${closeMetric("Expenses", money(exp), "Today expenses")}
          </div>
          <input id="remainingBalance" type="hidden" value="${afterExpense}">
          <div class="close-actions">
            <button class="btn orange" onclick="closeDay()">Close Day</button>
            <button class="btn light" onclick="reopenDay()">Reopen Day</button>
          </div>
        </div>
        <div class="card close-side-card">
          <div class="section-title"><h3>Expense Summary</h3><button class="btn light" onclick="showSection('expenses')">Open Expenses</button></div>
          <div class="close-breakdown">
            <div><span>Total Sales</span><strong>${money(totalSales)}</strong></div>
            <div><span>Expense Amount</span><strong>${money(exp)}</strong></div>
            <div class="net"><span>After Expense</span><strong>${money(afterExpense)}</strong></div>
          </div>
          <p class="muted">Add and review expense entries from the separate Expenses tab.</p>
        </div>
      </div>`;
    }
    function closeMetric(label, value, hint = "") {
      return `<div class="close-metric"><small>${label}</small><strong>${value}</strong>${hint ? `<span>${hint}</span>` : ""}</div>`;
    }
    function renderExpenses() {
      if (!can("expenses")) return toast("You do not have permission for expenses.");
      const today = todayKey();
      const todayExpenses = state.expenses.filter(e => e.date === today);
      const total = expensesFor(today);
      document.getElementById("expenses").innerHTML = `<div class="settings-layout">
        <div class="card settings-card">
          <div class="settings-head"><h3>Add Expense</h3><span class="badge">${money(total)}</span></div>
          <div class="settings-body">
            <div class="expense-form">
              <div class="field"><label>Expense Name</label><input id="expenseName" placeholder="Rent, salary, delivery"></div>
              <div class="field"><label>Amount</label><input id="expenseAmount" type="number" placeholder="0"></div>
              <div class="field full"><label>Remarks</label><input id="expenseRemarks" placeholder="Write expense remarks"></div>
            </div>
            <button class="btn orange" onclick="addExpense()">Add Expense</button>
          </div>
        </div>
        <div class="card settings-card">
          <div class="settings-head"><h3>Today Expenses</h3><span class="badge">${todayExpenses.length} entries</span></div>
          <div class="table-wrap expense-table"><table><thead><tr><th>Name</th><th>Amount</th><th>Remarks</th><th>Added By</th><th>Action</th></tr></thead><tbody>
          ${todayExpenses.map(e => expenseRow(e)).join("") || `<tr><td colspan="5"><div class="expense-empty">No expenses added today.</div></td></tr>`}
          </tbody></table></div>
        </div>
      </div>`;
    }
    function canEditExpense(expense) {
      return currentUser?.role === "Owner" || expense.user === currentUser?.username;
    }
    function expenseRow(expense) {
      const actions = canEditExpense(expense)
        ? `<div class="user-actions"><button class="btn light" onclick="editExpense('${expense.id}')">Edit</button><button class="btn danger" onclick="deleteExpense('${expense.id}')">Delete</button></div>`
        : `<span class="muted">No access</span>`;
      return `<tr><td><strong>${expense.name || "Expense"}</strong></td><td>${money(expense.amount)}</td><td>${expense.remarks || ""}</td><td>${expense.user || ""}</td><td>${actions}</td></tr>`;
    }
    function addExpense() {
      if (!can("expenses")) return toast("You do not have permission for expenses.");
      const name = document.getElementById("expenseName").value.trim();
      const amount = Number(document.getElementById("expenseAmount").value);
      const remarks = document.getElementById("expenseRemarks").value.trim();
      if (!name || !amount || !remarks) return toast("Expense name, amount, and remarks are required.");
      state.expenses.push({ id: uid("e"), date: todayKey(), name, amount, remarks, user: currentUser.username });
      save();
      if (activeSection === "expenses") renderExpenses();
      else renderDayClose();
    }
    function editExpense(id) {
      const expense = state.expenses.find(e => e.id === id);
      if (!expense || !canEditExpense(expense)) return toast("You can edit only your own expenses.");
      const name = prompt("Expense name", expense.name || "");
      if (name === null) return;
      const amountText = prompt("Expense amount", expense.amount);
      if (amountText === null) return;
      const remarks = prompt("Expense remarks", expense.remarks || "");
      if (remarks === null) return;
      const amount = Number(amountText);
      if (!name.trim() || !amount || !remarks.trim()) return toast("Expense name, amount, and remarks are required.");
      expense.name = name.trim();
      expense.amount = amount;
      expense.remarks = remarks.trim();
      expense.editedBy = currentUser.username;
      expense.editedAt = new Date().toLocaleString();
      save();
      renderExpenses();
      toast("Expense updated.");
    }
    function deleteExpense(id) {
      const expense = state.expenses.find(e => e.id === id);
      if (!expense || !canEditExpense(expense)) return toast("You can delete only your own expenses.");
      if (!confirm("Delete this expense?")) return;
      state.expenses = state.expenses.filter(e => e.id !== id);
      save();
      renderExpenses();
      toast("Expense deleted.");
    }
    function closeDay() {
      if (!requireOwner()) return;
      const today = todayKey();
      const cash = state.bills.filter(b => b.date.slice(0,10) === today && b.paymentMethod === "Cash").reduce((s,b)=>s+billTotals(b).total,0);
      const bank = state.bills.filter(b => b.date.slice(0,10) === today && b.paymentMethod === "Bank").reduce((s,b)=>s+billTotals(b).total,0);
      const totalSales = cash + bank;
      const expenses = expensesFor(today);
      const afterExpense = totalSales - expenses;
      state.dayClosings = state.dayClosings.filter(d => d.date !== todayKey());
      state.dayClosings.push({ date: todayKey(), status: "Closed", totalSales, expenses, afterExpense, remaining: afterExpense, user: currentUser.username, time: new Date().toLocaleString() });
      save(); renderDayClose(); toast("Day closed.");
    }
    function reopenDay() {
      if (!requireOwner()) return;
      state.dayClosings = state.dayClosings.filter(d => d.date !== todayKey());
      save(); renderDayClose(); toast("Day reopened.");
    }

    function renderSettings() {
      if (!requireOwner()) return;
      document.getElementById("settings").innerHTML = `<div class="store-settings-layout">
        <div class="settings-preview">
          <div>
            <div class="settings-preview-logo">${state.settings.logo ? `<img src="${state.settings.logo}">` : "BP"}</div>
            <h3>${state.settings.shopName}</h3>
            <p>${state.settings.phone}</p>
          </div>
          <div class="receipt-preview">
            <strong>Receipt Footer</strong>
            <span>${state.settings.receiptFooter}</span>
          </div>
        </div>
        <div class="card settings-form-card">
          <div class="settings-head"><h3>Store Settings</h3><span class="badge">Receipt Setup</span></div>
          <div class="settings-body">
            <div class="settings-form-grid">
              ${field("Shop Name", "setShop", state.settings.shopName)}
              ${field("Phone Number", "setPhone", state.settings.phone, "tel")}
              <div class="field full"><label>Receipt Footer</label><input id="setFooter" value="${state.settings.receiptFooter}"></div>
              <div class="field"><label>Receipt Settings</label><select id="setAutoPrint"><option value="false">Manual Print</option><option value="true">Auto Print</option></select></div>
              <div class="field"><label>Upload Logo</label><input id="setLogo" type="file" accept="image/*"></div>
            </div>
            <div class="settings-actions"><button class="btn orange" onclick="saveSettings()">Save Settings</button></div>
          </div>
        </div>
      </div>`;
      document.getElementById("setAutoPrint").value = String(state.settings.autoPrint);
    }
    function saveSettings() {
      const file = document.getElementById("setLogo").files[0];
      const finish = logo => {
        state.settings.shopName = document.getElementById("setShop").value;
        state.settings.phone = document.getElementById("setPhone").value;
        state.settings.receiptFooter = document.getElementById("setFooter").value;
        state.settings.autoPrint = document.getElementById("setAutoPrint").value === "true";
        if (logo) state.settings.logo = logo;
        save(); toast("Settings saved.");
      };
      if (file) { const r = new FileReader(); r.onload = () => finish(r.result); r.readAsDataURL(file); }
      else finish("");
    }
    function renderUsers() {
      if (!requireOwner()) return;
      document.getElementById("users").innerHTML = `<div class="card settings-card">
        <div class="settings-head"><h3>Manage Users</h3><span class="badge">${state.users.length} users</span></div>
        <div class="user-create">
          ${field("Username", "newUser", "")}
          ${field("Password", "newPass", "", "password")}
          <button class="btn light" onclick="addUser()">Add Cashier</button>
          <div class="permission-picker">
            ${Object.entries(permissionLabels).map(([key, label]) => `<label><input type="checkbox" class="newPermission" value="${key}" ${defaultCashierPermissions.includes(key) ? "checked" : ""}>${label}</label>`).join("")}
          </div>
        </div>
        <div class="table-wrap users-table"><table><thead><tr><th>User Login</th><th>Role</th><th>Status</th><th>Permissions</th><th>Action</th></tr></thead><tbody>
        ${state.users.map(u => userRow(u)).join("")}
        </tbody></table></div>
      </div>`;
    }
    function userRow(user) {
      if (user.role === "Owner") {
        return `<tr><td><strong>${user.username}</strong></td><td>${user.role}</td><td><span class="badge good">Active</span></td><td><div class="permission-text">Full access to reports, users, exports, day close, billing, and settings.</div></td><td><span class="muted">Protected</span></td></tr>`;
      }
      const selected = user.permissions || defaultCashierPermissions;
      return `<tr>
        <td><div class="user-edit-fields"><input id="userName_${user.id}" value="${user.username}"><input id="userPass_${user.id}" value="${user.password}" type="password" placeholder="Password"></div></td>
        <td>${user.role}</td>
        <td><span class="badge ${user.active ? "good" : "warn"}">${user.active ? "Active" : "Disabled"}</span></td>
        <td><div class="user-permission-edit">${Object.entries(permissionLabels).map(([key, label]) => `<label><input type="checkbox" class="editPermission_${user.id}" value="${key}" ${selected.includes(key) ? "checked" : ""}>${label}</label>`).join("")}</div></td>
        <td><div class="user-actions"><button class="btn light" onclick="saveUser('${user.id}')">Save</button><button class="btn danger" onclick="removeUser('${user.id}')">Delete</button></div></td>
      </tr>`;
    }
    function addUser() {
      const username = document.getElementById("newUser").value.trim();
      const password = document.getElementById("newPass").value;
      const selectedPermissions = [...document.querySelectorAll(".newPermission:checked")].map(input => input.value);
      if (!username || !password) return toast("Enter username and password.");
      if (!selectedPermissions.length) return toast("Select at least one cashier permission.");
      state.users.push({ id: uid("u"), username, password, role: "Cashier", active: true, permissions: selectedPermissions });
      save(); renderUsers();
    }
    function saveUser(id) {
      const user = state.users.find(u => u.id === id && u.role === "Cashier");
      if (!user) return toast("Cashier not found.");
      const username = document.getElementById(`userName_${id}`).value.trim();
      const password = document.getElementById(`userPass_${id}`).value;
      const selectedPermissions = [...document.querySelectorAll(`.editPermission_${id}:checked`)].map(input => input.value);
      if (!username || !password) return toast("Username and password are required.");
      if (!selectedPermissions.length) return toast("Select at least one permission.");
      user.username = username;
      user.password = password;
      user.permissions = selectedPermissions;
      save(); renderUsers(); toast("Cashier updated.");
    }
    function removeUser(id) {
      if (!confirm("Delete this cashier?")) return;
      state.users = state.users.filter(u => u.id !== id);
      save(); renderUsers();
    }

    function exportCSV(type) {
      let rows = [];
      if (type === "inventory") rows = [["Name","Barcode","Category","Price","Stock","Discount","Remarks"], ...state.products.map(p => [p.name,p.barcode,p.category,p.price,p.stock,p.discount,p.remarks])];
      if (type === "bills") rows = [["Date","Bill","Customer","Phone","Cashier","Sale Mode","Payment","Bank","Discount","Total"], ...state.bills.map(b => [b.date,b.id,b.customerName,b.customerPhone,b.cashier,b.saleMode || "In Store",b.paymentMethod,b.bankRef,billTotals(b).discount,billTotals(b).total])];
      if (type === "attendance") rows = [["Date","User","Role","In Time","Out Time","Status"], ...state.attendance.map(a => [a.date,a.username,a.role,a.time,a.outTime || "",a.status])];
      const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `brands-planets-${type}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    init();
