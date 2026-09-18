/* App shell: login, navigation, topbar, routing, shortcuts, scanner, idle timeout. */
const Shell = (() => {
  const NAV = [
    { section: "Sell" },
    { id: "dashboard", label: "Dashboard", icon: "dashboard", allowed: () => can("dashboard") },
    { id: "pos", label: "New Sale / POS", icon: "pos", allowed: () => can("pos"), className: "pos-link" },
    { id: "sales", label: "Sales", icon: "sales", allowed: () => can("sales") },
    { id: "customers", label: "Customers", icon: "customers", allowed: () => can("customers") },
    { id: "returns", label: "Exchanges", icon: "returns", allowed: () => can("returns") },
    { section: "Catalogue" },
    { id: "products", label: "Products", icon: "products", allowed: () => can("products") },
    { id: "inventory", label: "Inventory", icon: "inventory", allowed: () => can("inventory"), badge: () => stockAlerts().length || "" },
    { id: "promotions", label: "Promotions", icon: "promotions", allowed: () => can("promotions") || can("pos") },
    { section: "Business" },
    { id: "expenses", label: "Expenses", icon: "expenses", allowed: () => can("expenses") },
    { id: "reports", label: "Reports", icon: "reports", allowed: () => can("reports") },
    { id: "attendance", label: "Attendance", icon: "attendance", allowed: () => can("attendance") || Attendance.required() },
    { id: "dayclose", label: "Day Close", icon: "dayclose", allowed: () => can("dayclose") },
    { section: "Admin" },
    { id: "staff", label: "Staff / Users", icon: "staff", allowed: () => can("users") || can("staff") || can("viewAudit") },
    { id: "settings", label: "Settings", icon: "settings", allowed: () => true }
  ];
  const TITLES = Object.fromEntries(NAV.filter(item => item.id).map(item => [item.id, item.label]));

  let route = "";
  let params = {};
  let timers = [];
  let lastActivity = Date.now();
  let idleWarning = null;

  /* ------------------------------------------------------------ login */
  function bindLogin() {
    const form = $("#loginForm");
    const toggle = $("#passwordToggle");
    const password = $("#password");
    const username = $("#username");
    toggle.innerHTML = icon("eye", 20);
    toggle.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      toggle.innerHTML = icon(showing ? "eye" : "eyeOff", 20);
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      password.focus();
    });
    password.addEventListener("keyup", event => $("#capsHint").classList.toggle("hidden", !event.getModifierState?.("CapsLock")));
    // Enter moves from username to password, and signs in from the password field.
    username.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); password.focus(); }
    });
    password.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
    });
    const remembered = UI.safeGet(LS.rememberUser);
    if (remembered) {
      username.value = remembered;
      $("#rememberMe").checked = true;
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const message = $("#loginMessage");
      message.classList.add("hidden");
      const name = username.value.trim();
      if (!name || !password.value) {
        message.textContent = "Enter your username and password.";
        message.classList.remove("hidden");
        return;
      }
      const button = $("#loginSubmit");
      button.disabled = true;
      button.textContent = "Signing in…";
      const remember = $("#rememberMe").checked;
      const result = await login(name, password.value, remember);
      button.disabled = false;
      button.textContent = "Sign in";
      if (!result.ok) {
        message.textContent = result.error;
        message.classList.remove("hidden");
        $(".login-card").animate?.([{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(0)" }], { duration: 280 });
        return;
      }
      if (remember) UI.safeSet(LS.rememberUser, name);
      else localStorage.removeItem(LS.rememberUser);
      password.value = "";
      showApp();
      const resuming = Attendance.resumingAfterAutoLogout();
      toast(result.offline ? "Signed in offline — sales will sync when the connection is back."
        : resuming ? `Welcome back, ${currentUser().name || currentUser().username} — continuing your shift ✓`
        : `Welcome, ${currentUser().name || currentUser().username} ✓`, result.offline ? "warn" : "success");
    });

    // Subtle 3D parallax on pointer devices only.
    const shell = $("#loginPage");
    if (window.matchMedia("(pointer: fine)").matches) {
      shell.addEventListener("mousemove", event => {
        if (UI.reducedMotion()) return;
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        $(".login-card").style.transform = `rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`;
        $("#loginScene").style.transform = `translate3d(${x * -18}px, ${y * -18}px, 0)`;
      });
      shell.addEventListener("mouseleave", () => {
        $(".login-card").style.transform = "";
        $("#loginScene").style.transform = "";
      });
    }
  }
  function showLogin(message = "") {
    $("#app").classList.add("hidden");
    $("#loginPage").classList.remove("hidden");
    UI.closeAll();
    const box = $("#loginMessage");
    box.textContent = message;
    box.classList.toggle("hidden", !message);
    setTimeout(() => ($("#username").value ? $("#password") : $("#username")).focus(), 50);
  }

  /* ------------------------------------------------------------ chrome */
  function renderSidebar() {
    const html = [];
    let pendingSection = null;
    NAV.forEach(item => {
      if (item.section) { pendingSection = item.section; return; }
      if (!item.allowed()) return;
      if (pendingSection) { html.push(`<div class="nav-label">${pendingSection}</div>`); pendingSection = null; }
      const badge = item.badge?.();
      html.push(`<a class="nav-item ${item.className || ""} ${item.id === route ? "active" : ""}" href="#/${item.id}" title="${esc(item.label)}" data-nav="${item.id}">
        ${icon(item.icon, 20)}<span>${esc(item.label)}</span>${badge ? `<em class="nav-badge">${badge}</em><i class="nav-dot"></i>` : ""}
      </a>`);
    });
    $("#sidebar").innerHTML = `<div class="side-head">
        <div class="side-logo"><img src="assets/logo-64.png" alt=""></div>
        <div class="side-brand"><strong>Brands Planets</strong><span>Retail POS</span></div>
      </div>
      <nav class="nav">${html.join("")}</nav>
      <div class="side-foot">
        <button class="nav-item collapse-btn" id="collapseBtn" type="button" title="Collapse sidebar">${icon("chevronLeft", 20)}<span>Collapse</span></button>
        <button class="nav-item" id="logoutBtn" type="button" title="Logout">${icon("logout", 20)}<span>Logout</span></button>
      </div>`;
    $("#collapseBtn").addEventListener("click", () => {
      const collapsed = !$("#app").classList.contains("collapsed");
      $("#app").classList.toggle("collapsed", collapsed);
      UI.safeSet("bp-sidebar", collapsed ? "collapsed" : "open");
    });
    $("#logoutBtn").addEventListener("click", requestLogout);
    $("#sidebar").querySelectorAll("[data-nav]").forEach(link => link.addEventListener("click", () => $("#app").classList.remove("menu-open")));
  }

  function clockText() {
    const now = new Date();
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: POS_TIME_ZONE, weekday: "short", day: "2-digit", month: "short" }).format(now)} · ${fmtTime(now)}`;
  }
  const SYNC_LABEL = { synced: "Synced", syncing: "Syncing…", offline: "Offline", auth: "Sign in to sync" };
  function renderTopbar() {
    const user = currentUser();
    const outlets = state.settings.outlets || [];
    $("#topbar").innerHTML = `
      <button class="icon-btn mobile-menu" id="menuBtn" type="button" aria-label="Open menu">${icon("menu", 22)}</button>
      <div class="top-title" id="topTitle">${esc(TITLES[route] || "")}</div>
      <div class="global-search">
        ${icon("search", 18)}
        <input id="globalSearch" placeholder="Search products, invoices, customers…" autocomplete="off" aria-label="Global search">
        <kbd>Ctrl K</kbd>
        <div class="search-results hidden" id="globalResults"></div>
      </div>
      <div class="top-spacer"></div>
      <div class="top-meta">
        <label class="top-pill hide-md" title="Current outlet">${icon("store", 17)}
          <select id="outletSelect" aria-label="Current outlet">${outlets.map(outlet => `<option value="${esc(outlet.id)}" ${outlet.id === currentOutlet().id ? "selected" : ""}>${esc(outlet.name)}</option>`).join("")}</select>
        </label>
        <span class="top-pill hide-lg" title="Current cashier">${icon("user", 16)} <strong>${esc(user.name || user.username)}</strong></span>
        <span class="top-pill hide-md" id="clockPill">${icon("clock", 16)} <span>${clockText()}</span></span>
        <button class="top-pill sync-pill" id="syncPill" data-status="${Sync.status}" type="button" title="Sync now"><span class="sync-dot"></span><span class="sync-label">${SYNC_LABEL[Sync.status]}</span></button>
        <button class="icon-btn" id="notifyBtn" type="button" aria-label="Notifications">${icon("bell", 21)}<span class="notify-count hidden" id="notifyCount"></span></button>
        <button class="profile-btn" id="profileBtn" type="button" aria-label="Profile menu">
          <span class="avatar">${esc(initials(user.name || user.username))}</span>
          <span class="profile-copy"><strong>${esc(user.name || user.username)}</strong><small>${esc(BPPermissions.roleLabel(user.role))}</small></span>
        </button>
      </div>`;
    $("#menuBtn").addEventListener("click", () => $("#app").classList.toggle("menu-open"));
    $("#outletSelect").addEventListener("change", event => {
      setCurrentOutlet(event.target.value);
      toast(`Outlet: ${currentOutlet().name}`, "info");
      rerender();
    });
    $("#syncPill").addEventListener("click", () => {
      if (Sync.status === "auth") return reauthPrompt();
      syncNow();
    });
    $("#notifyBtn").addEventListener("click", event => { event.stopPropagation(); toggleNotifications(); });
    $("#profileBtn").addEventListener("click", event => { event.stopPropagation(); toggleProfile(); });
    bindGlobalSearch();
    updateNotifyCount();
  }
  function updateSyncPill() {
    const pill = $("#syncPill");
    if (pill) {
      pill.dataset.status = Sync.status;
      pill.querySelector(".sync-label").textContent = SYNC_LABEL[Sync.status];
    }
    renderBanner();
  }
  function renderBanner() {
    const banner = $("#banner");
    if (!banner) return;
    if (Sync.status === "offline") {
      banner.innerHTML = `<div class="offline-banner">${icon("wifiOff", 18)} Internet connection lost. Keep selling — sales are saved on this device and will sync automatically (no duplicates). <button class="btn" type="button" id="retrySync">Retry now</button></div>`;
      $("#retrySync").addEventListener("click", syncNow);
    } else if (Sync.status === "auth") {
      banner.innerHTML = `<div class="offline-banner auth">${icon("lock", 18)} ${session?.offline ? "Signed in offline." : "Your session expired."} Sales are saved on this device. <button class="btn" type="button" id="reauthBtn">Sign in to sync</button></div>`;
      $("#reauthBtn").addEventListener("click", reauthPrompt);
    } else {
      banner.innerHTML = "";
    }
  }

  function closePopovers() {
    $$(".dropdown").forEach(item => item.remove());
  }
  function toggleProfile() {
    if ($("#profileMenu")) return closePopovers();
    closePopovers();
    const user = currentUser();
    const pref = UI.themePref();
    const menu = document.createElement("div");
    menu.className = "dropdown";
    menu.id = "profileMenu";
    menu.innerHTML = `<div class="role-card" style="padding:10px 12px">
        <span class="avatar">${esc(initials(user.name || user.username))}</span>
        <div><strong>${esc(user.name || user.username)}</strong><div class="muted" style="font-size:12.5px">${esc(BPPermissions.roleLabel(user.role))} · ${esc(currentOutlet().name)}</div></div>
      </div>
      <div class="theme-switch" role="group" aria-label="Theme">
        ${[["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "monitor", "System"]].map(([id, ic, label]) => `<button class="${pref === id ? "active" : ""}" data-theme-pick="${id}" type="button">${icon(ic, 18)}${label}</button>`).join("")}
      </div>
      <div class="dropdown-sep"></div>
      <button class="dropdown-item" data-go="settings" type="button">${icon("settings", 18)} Settings & password</button>
      <button class="dropdown-item" data-shortcuts type="button">${icon("keyboard", 18)} Keyboard shortcuts</button>
      <div class="dropdown-sep"></div>
      <button class="dropdown-item danger" data-logout type="button">${icon("logout", 18)} Logout</button>`;
    document.body.appendChild(menu);
    menu.addEventListener("click", event => {
      event.stopPropagation();
      const theme = event.target.closest("[data-theme-pick]")?.dataset.themePick;
      if (theme) {
        UI.applyTheme(theme);
        menu.querySelectorAll("[data-theme-pick]").forEach(button => button.classList.toggle("active", button.dataset.themePick === theme));
        rerender();
      }
      if (event.target.closest("[data-go]")) { closePopovers(); go("settings"); }
      if (event.target.closest("[data-shortcuts]")) { closePopovers(); showShortcuts(); }
      if (event.target.closest("[data-logout]")) { closePopovers(); requestLogout(); }
    });
  }

  function notificationItems() {
    const items = [];
    if (Sync.status === "offline") items.push({ tone: "bad", icon: "wifiOff", title: "Offline", detail: "Sales are being saved on this device and will sync automatically." });
    if (Sync.status === "auth") items.push({ tone: "warn", icon: "lock", title: "Sign in to sync", detail: "Your session needs a password to resume syncing." });
    if (Attendance.required()) items.push({ tone: "warn", icon: "attendance", title: "Attendance required", detail: "Mark attendance before using the POS.", go: "attendance" });
    const alerts = stockAlerts();
    const out = alerts.filter(alert => alert.status === "out");
    const low = alerts.filter(alert => alert.status === "low");
    if (out.length) items.push({ tone: "bad", icon: "inventory", title: `${out.length} product(s) out of stock`, detail: out.slice(0, 3).map(alert => alert.product.name).join(", "), go: can("inventory") ? "inventory" : "" });
    if (low.length) items.push({ tone: "warn", icon: "inventory", title: `${low.length} product(s) running low`, detail: low.slice(0, 3).map(alert => `${alert.product.name} (${alert.qty})`).join(", "), go: can("inventory") ? "inventory" : "" });
    if (state.heldSales.length && can("pos")) items.push({ tone: "info", icon: "pause", title: `${state.heldSales.length} held sale(s)`, detail: "Press F9 on the POS to resume.", go: "pos" });
    const live = BPPromotions.livePromotions(state.promotions, { outletId: currentOutlet().id });
    if (live.length) items.push({ tone: "accent", icon: "promotions", title: `${live.length} promotion(s) live`, detail: live.map(promo => promo.name).join(", "), go: "promotions" });
    if (isAdmin()) {
      state.notifications.filter(item => item.audience === "Owner").slice(0, 8).forEach(item => items.push({
        tone: "info", icon: "info", title: item.title, detail: item.detail + (item.bill ? ` · ${item.bill.id} · ${money(item.bill.total)}` : ""), date: item.date
      }));
    }
    return items;
  }
  function updateNotifyCount() {
    const count = notificationItems().filter(item => item.tone !== "info" || item.date).length;
    const badge = $("#notifyCount");
    if (!badge) return;
    badge.textContent = count > 9 ? "9+" : count;
    badge.classList.toggle("hidden", !count);
  }
  function toggleNotifications() {
    if ($("#notifPanel")) return closePopovers();
    closePopovers();
    const items = notificationItems();
    const panel = document.createElement("div");
    panel.className = "dropdown notif-panel";
    panel.id = "notifPanel";
    const toneBg = { bad: "var(--bad-soft);color:var(--bad)", warn: "var(--warn-soft);color:var(--warn)", info: "var(--info-soft);color:var(--info)", accent: "var(--accent-soft);color:var(--accent-text)" };
    panel.innerHTML = `<div class="row between" style="padding:8px 10px"><strong>Notifications</strong><span class="badge">${items.length}</span></div>` +
      (items.length ? items.map(item => `<button class="notif-item" style="width:100%;text-align:left" ${item.go ? `data-go="${item.go}"` : ""} type="button">
        <span class="notif-icon" style="background:${toneBg[item.tone] || toneBg.info}">${icon(item.icon, 18)}</span>
        <span><strong>${esc(item.title)}</strong><p>${esc(item.detail || "")}</p>${item.date ? `<small>${timeAgo(item.date)}</small>` : ""}</span>
      </button>`).join("") : UI.empty("bell", "You're all caught up"));
    document.body.appendChild(panel);
    panel.addEventListener("click", event => {
      event.stopPropagation();
      const target = event.target.closest("[data-go]")?.dataset.go;
      if (target) { closePopovers(); go(target); }
    });
  }

  /* ----------------------------------------------------- global search */
  function bindGlobalSearch() {
    const input = $("#globalSearch");
    const box = $("#globalResults");
    let active = 0;
    const renderResults = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.classList.add("hidden"); return; }
      const products = state.products.filter(product => [product.name, product.sku, product.barcode, product.type].join(" ").toLowerCase().includes(q)).slice(0, 5);
      const bills = can("sales") ? state.bills.filter(bill => [bill.id, bill.customerName, bill.customerPhone].join(" ").toLowerCase().includes(q)).slice(-5).reverse() : [];
      const customers = can("customers") ? findCustomers(q, 4) : [];
      const groups = [];
      if (products.length) groups.push(`<div class="search-group">Products</div>` + products.map(product => `<button class="search-item" data-kind="product" data-id="${esc(product.id)}" type="button">${product.image ? `<img class="thumb sm" src="${product.image}" alt="">` : `<span class="thumb sm">${esc(initials(product.name))}</span>`}<span><strong>${esc(product.name)}</strong><small>${esc(product.sku || "")} · ${money(product.price)} · ${num(productStock(product))} in stock</small></span></button>`).join(""));
      if (bills.length) groups.push(`<div class="search-group">Invoices</div>` + bills.map(bill => `<button class="search-item" data-kind="bill" data-id="${esc(bill.id)}" type="button"><span class="thumb sm">${icon("sales", 16)}</span><span><strong>${esc(bill.id)}</strong><small>${esc(bill.customerName || "Walk-in")} · ${money(billTotals(bill).total)} · ${fmtDate(bill.date)}</small></span></button>`).join(""));
      if (customers.length) groups.push(`<div class="search-group">Customers</div>` + customers.map(customer => `<button class="search-item" data-kind="customer" data-id="${esc(customer.id)}" type="button"><span class="thumb sm">${esc(initials(customer.name))}</span><span><strong>${esc(customer.name)}</strong><small>${esc(customer.phone)}</small></span></button>`).join(""));
      box.innerHTML = groups.join("") || `<div class="empty-state" style="padding:18px">No results for “${esc(input.value)}”</div>`;
      box.classList.remove("hidden");
      active = 0;
      box.querySelector(".search-item")?.classList.add("active");
    };
    const openResult = button => {
      if (!button) return;
      const { kind, id } = button.dataset;
      input.value = "";
      box.classList.add("hidden");
      input.blur();
      if (kind === "product") {
        if (route === "pos") {
          const product = productById(id);
          const variant = product?.variants?.find(item => variantStock(product.id, item.id) > 0);
          if (variant) Views.pos.addVariant(product.id, variant.id);
          else toast("Out of stock.", "error");
        } else if (can("products")) Views.products.edit(id);
        else if (can("pos")) go("pos");
      }
      if (kind === "bill") Views.sales.openInvoice(id);
      if (kind === "customer") Views.customers.openCustomer(id);
    };
    input.addEventListener("input", debounce(renderResults, 90));
    input.addEventListener("keydown", event => {
      const items = $$(".search-item", box);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[active]?.classList.remove("active");
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
        items[active]?.classList.add("active");
      }
      if (event.key === "Enter") { event.preventDefault(); openResult(items[active]); }
      if (event.key === "Escape") { input.value = ""; box.classList.add("hidden"); input.blur(); event.stopPropagation(); }
    });
    input.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 160));
    box.addEventListener("mousedown", event => event.preventDefault());
    box.addEventListener("click", event => openResult(event.target.closest(".search-item")));
  }

  /* ------------------------------------------------------------ routing */
  function parseHash() {
    const [path, queryString] = location.hash.replace(/^#\/?/, "").split("?");
    return { id: path || "", params: Object.fromEntries(new URLSearchParams(queryString || "")) };
  }
  function firstAllowed() {
    return NAV.find(item => item.id && item.allowed())?.id || "settings";
  }
  function go(id, query = {}) {
    const qs = new URLSearchParams(query).toString();
    const hash = `#/${id}${qs ? `?${qs}` : ""}`;
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  }
  function renderRoute() {
    if (!currentUser()) return;
    let { id, params: query } = parseHash();
    const item = NAV.find(entry => entry.id === id);
    if (!item || !Views[id]) id = can("pos") && !isAdmin() ? "pos" : firstAllowed();
    else if (!item.allowed()) {
      toast("You don't have permission for that section.", "error");
      id = firstAllowed();
    }
    if (Attendance.required() && !["attendance", "settings"].includes(id)) {
      if (route !== "attendance") toast("Please mark attendance first.", "warn");
      id = "attendance";
    }
    if (`#/${id}` !== location.hash.split("?")[0]) history.replaceState(null, "", `#/${id}`);
    route = id;
    params = query;
    closePopovers();
    $("#content").classList.toggle("pos-mode", id === "pos");
    const old = $("#view");
    const fresh = document.createElement("div");
    fresh.id = "view";
    fresh.className = "view";
    old.replaceWith(fresh);
    $$("#sidebar [data-nav]").forEach(link => link.classList.toggle("active", link.dataset.nav === id));
    const title = $("#topTitle");
    if (title) title.textContent = TITLES[id] || "";
    document.title = `${TITLES[id] || "POS"} · Brands Planets`;
    try {
      Views[id].render(fresh, query);
      UI.animateCounters(fresh);
    } catch (error) {
      console.error(error);
      fresh.innerHTML = UI.empty("alert", "Something went wrong on this screen", esc(error.message));
    }
    window.scrollTo({ top: 0 });
  }
  function rerender() {
    if (!currentUser()) return;
    renderSidebar();
    renderTopbar();
    renderRoute();
  }
  /** Re-render after data synced from another device, without disturbing the user. */
  function onRemoteChange() {
    if (!currentUser()) return;
    renderSidebar();
    updateNotifyCount();
    const view = Views[route];
    if (view?.refresh) return view.refresh();
    const active = document.activeElement;
    const typing = active && $("#view")?.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (!UI.hasModal() && !typing) renderRoute();
  }

  /* ----------------------------------------------------------- session */
  async function requestLogout() {
    if (Attendance.blocksLogout()) return Attendance.logoutPrompt(() => finishLogout());
    const hasCart = Views.pos.hasItems();
    const ok = await UI.confirm({
      title: "Log out?",
      message: hasCart ? "The current cart will be held so it can be resumed later." : "You'll need your password to sign back in.",
      confirmText: "Log out",
      tone: "primary",
      iconName: "logout"
    });
    if (ok) finishLogout();
  }
  async function finishLogout(reason = "", automatic = false) {
    // Automatic logout keeps the shift open (no attendance on re-login); a manual logout ends it.
    if (automatic) Attendance.rememberAutoLogout();
    else Attendance.clearAutoLogout();
    if (Views.pos.hasItems()) Views.pos.autoHold(automatic ? "Auto-held after inactivity" : "Held at logout");
    if (Sync.saveTimer) {
      clearTimeout(Sync.saveTimer);
      Sync.saveTimer = null;
      await pushCloudState();
    }
    await logout();
    stopTimers();
    route = "";
    history.replaceState(null, "", location.pathname);
    showLogin(reason);
  }
  function reauthPrompt() {
    const user = currentUser();
    const modal = UI.openModal({
      title: "Sign in to resume syncing",
      subtitle: `Signed in as ${esc(user.username)}. Your work on this device is safe.`,
      size: "sm",
      body: `<form id="reauthForm" class="form-section">
        <div class="field"><label for="reauthPass">Password</label><input id="reauthPass" type="password" autocomplete="current-password" autofocus></div>
        <div id="reauthError" class="form-error hidden"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Later</button><button class="btn btn-primary" form="reauthForm" type="submit">Sign in</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#reauthForm").addEventListener("submit", async event => {
      event.preventDefault();
      const result = await reauthenticate(modal.el.querySelector("#reauthPass").value);
      if (result.ok && !result.offline) {
        modal.close();
        toast("Signed in — syncing ✓");
      } else {
        const box = modal.el.querySelector("#reauthError");
        box.textContent = result.offline ? "Still offline. Try again when the connection is back." : result.error;
        box.classList.remove("hidden");
      }
    });
  }

  /* ---------------------------------------------------------- shortcuts */
  function showShortcuts() {
    const rows = [["F2", "New sale"], ["F4", "Product search"], ["F6", "Customer search"], ["F8", "Hold sale"], ["F9", "Resume sale"], ["F10", "Checkout"], ["Esc", "Close popup"], ["Enter", "Confirm"], ["Ctrl + K", "Global search"], ["Scanner", "Adds item instantly"]];
    UI.openModal({
      title: "Keyboard shortcuts",
      subtitle: "Barcode scanners work anywhere on the POS — no clicking needed.",
      size: "md",
      body: `<div class="shortcut-grid">${rows.map(([key, label]) => `<div><span>${label}</span><kbd>${key}</kbd></div>`).join("")}</div>`
    });
  }
  function requirePos() {
    if (!can("pos")) { toast("You don't have access to the POS.", "error"); return false; }
    return true;
  }
  function withPos(fn) {
    if (!requirePos()) return;
    if (route !== "pos") {
      go("pos");
      setTimeout(fn, 80);
    } else fn();
  }
  function onKeydown(event) {
    if (!currentUser() || $("#app").classList.contains("hidden")) return;
    lastActivity = Date.now();
    const key = event.key;
    if (key === "Escape") {
      if ($(".dropdown")) { closePopovers(); return; }
      if (UI.closeTop()) { event.preventDefault(); return; }
      $("#posRight")?.classList.remove("open");
      $("#app").classList.remove("menu-open");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "k") {
      event.preventDefault();
      $("#globalSearch")?.focus();
      return;
    }
    const fKeys = ["F2", "F4", "F6", "F8", "F9", "F10"];
    if (!fKeys.includes(key)) return;
    event.preventDefault();
    if (UI.hasModal() && key !== "F10") return;
    if (key === "F2") withPos(() => Views.pos.newSale());
    if (key === "F4") withPos(() => Views.pos.focusSearch());
    if (key === "F6") withPos(() => Views.pos.focusCustomer());
    if (key === "F8") withPos(() => Views.pos.hold());
    if (key === "F9") withPos(() => Views.pos.openHeld());
    if (key === "F10" && !UI.hasModal()) withPos(() => Views.pos.checkout());
  }

  /*
   * Barcode scanners type very fast and finish with Enter. When no text field
   * has focus, capture those keystrokes so scanning works without clicking.
   */
  const scan = { buffer: "", last: 0 };
  function onScannerKey(event) {
    if (!currentUser() || UI.hasModal()) return;
    const target = event.target;
    const typingField = target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable);
    if (typingField) return;
    const now = performance.now();
    if (event.key === "Enter") {
      if (scan.buffer.length >= 3 && now - scan.last < 80) {
        event.preventDefault();
        const code = scan.buffer;
        scan.buffer = "";
        handleScan(code);
      }
      scan.buffer = "";
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (now - scan.last > 80) scan.buffer = "";
    scan.buffer += event.key;
    scan.last = now;
  }
  function handleScan(code) {
    const view = Views[route];
    if (view?.handleBarcode) return view.handleBarcode(code);
    if (!can("pos")) return toast(`Scanned ${code}`, "info");
    go("pos");
    setTimeout(() => Views.pos.handleBarcode(code), 80);
  }

  /* ------------------------------------------------------------- timers */
  function stopTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }
  function startTimers() {
    stopTimers();
    timers.push(setInterval(() => {
      const pill = $("#clockPill span");
      if (pill) pill.textContent = clockText();
    }, 20000));
    timers.push(setInterval(() => {
      if (document.visibilityState === "visible") pullCloudState();
    }, 15000));
    timers.push(setInterval(checkIdle, 15000));
  }
  function checkIdle() {
    const minutes = Number(state.settings.sessionTimeoutMinutes || 0);
    if (!minutes || !currentUser()) return;
    const idleMs = Date.now() - lastActivity;
    const limit = minutes * 60000;
    if (idleMs >= limit) {
      idleWarning?.close();
      idleWarning = null;
      finishLogout("Signed out after inactivity. Sign in to continue your shift — any open cart was held (F9 to resume).", true);
    } else if (idleMs >= limit - 60000 && !idleWarning) {
      idleWarning = UI.openModal({
        title: "Still there?",
        subtitle: "For security you'll be signed out in about a minute.",
        size: "sm",
        body: `<p class="muted">Any items in the cart will be held automatically.</p>`,
        footer: `<button class="btn btn-primary" data-stay type="button">Stay signed in</button>`,
        onClose: () => { idleWarning = null; lastActivity = Date.now(); }
      });
      idleWarning.el.querySelector("[data-stay]").addEventListener("click", () => idleWarning?.close());
    }
  }

  /* --------------------------------------------------------------- boot */
  function showApp() {
    $("#loginPage").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#app").classList.toggle("collapsed", UI.safeGet("bp-sidebar") === "collapsed");
    lastActivity = Date.now();
    if (session?.offline) setSyncStatus("auth");
    else if (!navigator.onLine) setSyncStatus("offline");
    renderSidebar();
    renderTopbar();
    renderBanner();
    renderRoute();
    startTimers();
    if (session?.token) {
      refreshSessionUser().then(() => { renderSidebar(); });
      pullCloudState().then(() => { if (hasUnsyncedChanges()) pushCloudState(); });
    }
  }

  function boot() {
    UI.applyTheme();
    bindLogin();
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keydown", onScannerKey, true);
    ["pointerdown", "touchstart", "wheel"].forEach(type => document.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true }));
    document.addEventListener("click", () => closePopovers());
    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("online", () => {
      toast("Back online — syncing…", "info");
      pushCloudState();
    });
    window.addEventListener("offline", () => {
      setSyncStatus("offline");
      toast("Internet connection lost. Sales will be saved on this device.", "warn", 5000);
    });
    window.addEventListener("storage", event => {
      if (event.key === LS.state && event.newValue) {
        try {
          mergeState(JSON.parse(event.newValue));
          onRemoteChange();
        } catch { /* ignore partial writes */ }
      }
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (UI.themePref() === "system") rerender(); });
    document.addEventListener("syncchange", () => { updateSyncPill(); updateNotifyCount(); });
    document.addEventListener("statechange", event => {
      if (event.detail?.remote) onRemoteChange();
      else { renderSidebarBadges(); updateNotifyCount(); }
    });
    document.addEventListener("sessionexpired", renderBanner);
    if (currentUser()) showApp();
    else showLogin();
  }
  function renderSidebarBadges() {
    const link = $("#sidebar [data-nav=inventory]");
    if (!link) return;
    const count = stockAlerts().length;
    let badge = link.querySelector(".nav-badge");
    if (!count) { badge?.remove(); link.querySelector(".nav-dot")?.remove(); return; }
    if (!badge) {
      link.insertAdjacentHTML("beforeend", `<em class="nav-badge"></em><i class="nav-dot"></i>`);
      badge = link.querySelector(".nav-badge");
    }
    badge.textContent = count;
  }

  return { boot, go, current: () => route, params: () => params, rerender, requestLogout, showShortcuts, reauthPrompt };
})();

document.addEventListener("DOMContentLoaded", Shell.boot);
