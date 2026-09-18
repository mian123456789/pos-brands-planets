/* Settings: store & receipt, outlets, security, appearance, data. */
Views.settings = (() => {
  let tab = "";

  function tabs() {
    const admin = can("settings");
    return [
      admin && ["store", "Store & Receipt", "store"],
      admin && ["outlets", "Outlets", "layers"],
      ["security", "Security", "lock"],
      ["appearance", "Appearance", "sun"],
      ["data", "Sync & Data", "refresh"]
    ].filter(Boolean);
  }

  function storeHtml() {
    const s = state.settings;
    return `<div class="split-main">
      <div class="card card-pad"><form id="storeForm">
        <div class="form-section">
          <div class="form-section-title">${icon("store", 18)} Store details</div>
          <div class="form-grid">
            <div class="field"><label>Shop name</label><input id="stName" value="${esc(s.shopName)}"></div>
            <div class="field"><label>Phone</label><input id="stPhone" value="${esc(s.phone)}"></div>
            <div class="field"><label>Email</label><input id="stEmail" type="email" value="${esc(s.email || "")}"></div>
            <div class="field"><label>Default low-stock alert</label><input id="stLow" type="number" min="0" value="${esc(s.lowStockDefault ?? 5)}"></div>
            <div class="field span-2"><label>Address</label><textarea id="stAddress" rows="2">${esc(s.address || "")}</textarea></div>
          </div>
          <div class="image-drop">
            <span class="thumb" id="stLogoPreview">${s.logo ? `<img class="thumb" src="${s.logo}" alt="">` : icon("image", 26)}</span>
            <div class="grow"><strong>Receipt logo</strong><div class="muted" style="font-size:13px">Printed at the top of receipts.</div></div>
            <label class="btn btn-soft btn-sm">Upload<input type="file" id="stLogo" accept="image/*" hidden></label>
            <button class="btn btn-ghost btn-sm ${s.logo ? "" : "hidden"}" id="stLogoRemove" type="button">Remove</button>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">${icon("file", 18)} Receipt</div>
          <div class="field"><label>Receipt footer <span class="faint" id="stFooterCount"></span></label><textarea id="stFooter" rows="3" maxlength="350">${esc(s.receiptFooter || "")}</textarea></div>
          <div class="row wrap">
            ${["Thank you for shopping with Brands Planets.", "Exchange is allowed within 7 days with the original receipt.", "No refund. Exchange only with original receipt within 7 days."].map(text => `<button class="chip sm" data-footer="${esc(text)}" type="button">${esc(text.split(".")[0])}</button>`).join("")}
          </div>
          <div class="form-grid form-grid-3">
            <div class="field"><label>Footer alignment</label><select id="stAlign">${["center", "left", "right"].map(value => `<option value="${value}" ${s.receiptFooterAlign === value ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></div>
            <div class="field"><label>Footer divider</label><select id="stDivider"><option value="true">Show line</option><option value="false" ${s.receiptFooterDivider === false ? "selected" : ""}>No line</option></select></div>
            <div class="field"><label>Footer</label><select id="stFooterOn"><option value="true">Print footer</option><option value="false" ${s.receiptFooterEnabled === false ? "selected" : ""}>Hide footer</option></select></div>
          </div>
          <label class="check"><span class="switch"><input type="checkbox" id="stAuto" ${s.autoPrint ? "checked" : ""}><span></span></span> Print the receipt automatically after every sale</label>
        </div>
        <div class="row" style="margin-top:20px"><button class="btn btn-primary btn-lg" type="submit">${icon("check", 18)} Save settings</button></div>
      </form></div>
      <div class="card card-pad"><div class="form-section-title" style="margin-bottom:12px">${icon("eye", 18)} Receipt preview</div><div class="invoice-preview" id="stPreview"></div></div>
    </div>`;
  }

  function previewBill() {
    return {
      id: "BP-PREVIEW-001", v: 2, date: new Date().toISOString(), cashier: currentUser().username, customerName: "Walk-in Customer", customerPhone: "",
      items: [
        { key: "a", id: "a", name: "Classic Shirt", sku: "SKU-1", size: "L", color: "Navy", price: 2500, qty: 1, freeQty: 0 },
        { key: "b", id: "b", name: "Graphic T-Shirt", sku: "SKU-2", size: "M", color: "Black", price: 2000, qty: 1, freeQty: 0 },
        { key: "c", id: "c", name: "Chino Trouser", sku: "SKU-3", size: "32", color: "Beige", price: 1800, qty: 1, freeQty: 1 }
      ],
      promoDiscount: 1800,
      promotions: [{ promoId: "p", name: "Summer Deal", buyQty: 2, freeQty: 1, freeCount: 1, saving: 1800, freeItems: [{ name: "Chino Trouser", size: "32", color: "Beige", qty: 1 }] }],
      payments: [{ method: "Cash", amount: 4500, tendered: 5000 }], received: 5000, change: 500, paymentStatus: "Paid"
    };
  }

  function outletsHtml() {
    return `<div class="card card-pad" style="max-width:720px">
      <div class="form-section-title" style="margin-bottom:12px">${icon("layers", 18)} Outlets</div>
      <p class="muted" style="font-size:13.5px;margin-bottom:14px">Each till chooses its outlet from the top bar. Sales, promotions and reports record the outlet.</p>
      <div class="stack" style="gap:8px" id="outletList">${state.settings.outlets.map(outlet => `<div class="row" data-outlet="${esc(outlet.id)}"><input class="input" value="${esc(outlet.name)}" data-outlet-name><button class="icon-btn danger" data-outlet-remove type="button" ${state.settings.outlets.length <= 1 ? "disabled" : ""} aria-label="Remove outlet">${icon("trash", 18)}</button></div>`).join("")}</div>
      <div class="row" style="margin-top:14px"><button class="btn btn-soft" id="outletAdd" type="button">${icon("plus", 18)} Add outlet</button><button class="btn btn-primary" id="outletSave" type="button">${icon("check", 18)} Save outlets</button></div>
    </div>`;
  }

  function securityHtml() {
    return `<div class="grid grid-2" style="align-items:start">
      <div class="card card-pad"><form id="pwForm" class="form-section" autocomplete="off">
        <div class="form-section-title">${icon("lock", 18)} Change my password</div>
        <div class="field"><label>Current password</label><input id="pwCurrent" type="password" autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input id="pwNew" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
        <div class="field"><label>Confirm new password</label><input id="pwConfirm" type="password" autocomplete="new-password"></div>
        <div id="pwError" class="form-error hidden"></div>
        <button class="btn btn-primary" type="submit">Update password</button>
        <p class="hint">Other devices signed in as you will be signed out.</p>
      </form></div>
      ${can("settings") ? `<div class="card card-pad"><div class="form-section">
        <div class="form-section-title">${icon("clock", 18)} Automatic logout</div>
        <div class="field"><label>Sign out after inactivity</label><select id="secTimeout">${[[0, "Never"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [120, "2 hours"]].map(([value, label]) => `<option value="${value}" ${Number(state.settings.sessionTimeoutMinutes) === value ? "selected" : ""}>${label}</option>`).join("")}</select><span class="hint">Open carts are held automatically before signing out.</span></div>
        <button class="btn btn-primary" id="secSave" type="button">Save</button>
        <div class="summary-box" style="margin-top:6px">
          <div class="sum-row"><span>Passwords</span><strong>Hashed on server (scrypt)</strong></div>
          <div class="sum-row"><span>Sessions</span><strong>Signed tokens, revoked at logout</strong></div>
          <div class="sum-row"><span>Sign-in lockout</span><strong>30s after 5 failed tries</strong></div>
          <div class="sum-row"><span>Activity log</span><strong>${state.auditLog.length} entries</strong></div>
        </div>
      </div></div>` : ""}
    </div>`;
  }

  function appearanceHtml() {
    const pref = UI.themePref();
    const lite = UI.safeGet("bp-effects", "full") === "lite";
    return `<div class="card card-pad" style="max-width:720px"><div class="form-section">
      <div class="form-section-title">${icon("sun", 18)} Theme</div>
      <div class="pay-methods" id="themePick">${[["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "monitor", "System default"]].map(([id, ic, label]) => `<button class="pay-method ${pref === id ? "active" : ""}" data-theme-pick="${id}" type="button">${icon(ic, 24)}<span>${label}</span></button>`).join("")}</div>
      <p class="hint">Saved on this device.</p>
      <div class="form-section-title" style="margin-top:12px">${icon("sparkles", 18)} Effects</div>
      <label class="check"><span class="switch"><input type="checkbox" id="liteMode" ${lite ? "checked" : ""}><span></span></span> Reduce effects (turn off animations and glass blur — best for older tablets)</label>
      <div class="form-section-title" style="margin-top:12px">${icon("keyboard", 18)} Keyboard shortcuts</div>
      <button class="btn btn-soft" onclick="Shell.showShortcuts()" type="button">Show shortcuts</button>
    </div></div>`;
  }

  function dataHtml() {
    const statusText = { synced: "All changes synced", syncing: "Syncing…", offline: "Offline — changes saved on this device", auth: "Sign in again to sync" }[Sync.status];
    return `<div class="grid grid-2" style="align-items:start">
      <div class="card card-pad"><div class="form-section">
        <div class="form-section-title">${icon("refresh", 18)} Sync</div>
        <div class="summary-box">
          <div class="sum-row"><span>Status</span><strong>${statusText}</strong></div>
          <div class="sum-row"><span>Last sync</span><strong>${Sync.lastSyncAt ? timeAgo(Sync.lastSyncAt) : "—"}</strong></div>
          <div class="sum-row"><span>This device</span><strong>Till ${esc(deviceCode())}</strong></div>
          <div class="sum-row"><span>Outlet</span><strong>${esc(currentOutlet().name)}</strong></div>
        </div>
        <button class="btn btn-primary" id="syncBtn" type="button">${icon("refresh", 18)} Sync now</button>
        <p class="hint">Sales are identified by unique invoice numbers, so syncing again after a connection drop never creates duplicates.</p>
      </div></div>
      ${can("settings") ? `<div class="card card-pad"><div class="form-section">
        <div class="form-section-title">${icon("download", 18)} Backup</div>
        <p class="muted" style="font-size:13.5px">Download a copy of all products, stock, sales, customers and settings. The server also keeps automatic daily backups.</p>
        <button class="btn btn-soft" id="backupBtn" type="button">${icon("download", 18)} Download backup (JSON)</button>
        <div class="summary-box">
          <div class="sum-row"><span>Products</span><strong>${state.products.length}</strong></div>
          <div class="sum-row"><span>Sales</span><strong>${state.bills.length}</strong></div>
          <div class="sum-row"><span>Customers</span><strong>${allCustomers().length}</strong></div>
          <div class="sum-row"><span>Stock movements</span><strong>${state.stockMoves.length}</strong></div>
        </div>
      </div></div>` : ""}
    </div>`;
  }

  function render(root) {
    const available = tabs();
    if (!available.some(([id]) => id === tab)) tab = available[0][0];
    root.innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><p>${can("settings") ? "Store, receipts, security and appearance." : "Your password and appearance."}</p></div></div>
      <div class="tabs" id="setTabs" style="margin-bottom:16px">${available.map(([id, label, ic]) => `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}" type="button">${icon(ic, 16)} ${label}</button>`).join("")}</div>
      <div id="setBody">${{ store: storeHtml, outlets: outletsHtml, security: securityHtml, appearance: appearanceHtml, data: dataHtml }[tab]()}</div>`;
    root.querySelector("#setTabs").addEventListener("click", event => {
      const next = event.target.closest("[data-tab]")?.dataset.tab;
      if (next) { tab = next; render(root); }
    });
    ({ store: bindStore, outlets: bindOutlets, security: bindSecurity, appearance: bindAppearance, data: bindData }[tab])(root);
  }

  function bindStore(root) {
    let logo = state.settings.logo || "";
    const updatePreview = () => {
      const draft = readStore(root, logo);
      const saved = state.settings;
      state.settings = { ...saved, ...draft };
      root.querySelector("#stPreview").innerHTML = Receipt.html(previewBill());
      state.settings = saved;
      root.querySelector("#stFooterCount").textContent = `${root.querySelector("#stFooter").value.length} / 350`;
    };
    root.querySelector("#storeForm").addEventListener("input", debounce(updatePreview, 150));
    root.querySelector("#storeForm").addEventListener("change", updatePreview);
    root.querySelectorAll("[data-footer]").forEach(button => button.addEventListener("click", () => { root.querySelector("#stFooter").value = button.dataset.footer; updatePreview(); }));
    root.querySelector("#stLogo").addEventListener("change", async event => {
      const file = event.target.files[0];
      if (!file) return;
      logo = await readImageFile(file, 320);
      root.querySelector("#stLogoPreview").innerHTML = `<img class="thumb" src="${logo}" alt="">`;
      root.querySelector("#stLogoRemove").classList.remove("hidden");
      updatePreview();
    });
    root.querySelector("#stLogoRemove").addEventListener("click", event => {
      logo = "";
      root.querySelector("#stLogoPreview").innerHTML = icon("image", 26);
      event.target.classList.add("hidden");
      updatePreview();
    });
    root.querySelector("#storeForm").addEventListener("submit", event => {
      event.preventDefault();
      Object.assign(state.settings, readStore(root, logo));
      audit("settings.update", "settings", "store", "Updated store & receipt settings");
      save({ immediate: true });
      toast("Settings saved ✓");
    });
    updatePreview();
  }
  function readStore(root, logo) {
    return {
      shopName: root.querySelector("#stName").value.trim() || "Brands Planets",
      phone: root.querySelector("#stPhone").value.trim(),
      email: root.querySelector("#stEmail").value.trim(),
      address: root.querySelector("#stAddress").value.trim(),
      lowStockDefault: Math.max(0, Math.round(Number(root.querySelector("#stLow").value || 0))),
      receiptFooter: root.querySelector("#stFooter").value.trim(),
      receiptFooterAlign: root.querySelector("#stAlign").value,
      receiptFooterDivider: root.querySelector("#stDivider").value === "true",
      receiptFooterEnabled: root.querySelector("#stFooterOn").value === "true",
      autoPrint: root.querySelector("#stAuto").checked,
      logo
    };
  }

  function bindOutlets(root) {
    root.querySelector("#outletAdd").addEventListener("click", () => {
      state.settings.outlets.push({ id: uid("o"), name: `Outlet ${state.settings.outlets.length + 1}` });
      render(root);
    });
    root.querySelector("#outletList").addEventListener("click", async event => {
      const row = event.target.closest("[data-outlet]");
      if (!row || !event.target.closest("[data-outlet-remove]")) return;
      const ok = await UI.confirm({ title: "Remove this outlet?", message: "Past sales keep the outlet name.", confirmText: "Remove" });
      if (!ok) return;
      state.settings.outlets = state.settings.outlets.filter(outlet => outlet.id !== row.dataset.outlet);
      render(root);
    });
    root.querySelector("#outletSave").addEventListener("click", () => {
      $$("[data-outlet]", root).forEach(row => {
        const outlet = state.settings.outlets.find(item => item.id === row.dataset.outlet);
        if (outlet) outlet.name = row.querySelector("[data-outlet-name]").value.trim() || outlet.name;
      });
      audit("settings.update", "settings", "outlets", `Outlets: ${state.settings.outlets.map(outlet => outlet.name).join(", ")}`);
      save({ immediate: true });
      toast("Outlets saved ✓");
      Shell.rerender();
    });
  }

  function bindSecurity(root) {
    root.querySelector("#pwForm").addEventListener("submit", async event => {
      event.preventDefault();
      const error = root.querySelector("#pwError");
      const fail = text => { error.textContent = text; error.classList.remove("hidden"); };
      error.classList.add("hidden");
      const currentPassword = root.querySelector("#pwCurrent").value;
      const newPassword = root.querySelector("#pwNew").value;
      if (newPassword.length < 6) return fail("New password must be at least 6 characters.");
      if (newPassword !== root.querySelector("#pwConfirm").value) return fail("The new passwords don't match.");
      try {
        await api("/api/auth/password", { method: "POST", body: { currentPassword, newPassword } });
        rememberOfflineLogin(currentUser().username, newPassword, currentUser()).catch(() => {});
        root.querySelector("#pwForm").reset();
        toast("Password updated ✓");
      } catch (err) {
        fail(err.network ? "You're offline. Passwords can only be changed while connected." : err.message);
      }
    });
    root.querySelector("#secSave")?.addEventListener("click", () => {
      state.settings.sessionTimeoutMinutes = Number(root.querySelector("#secTimeout").value);
      audit("settings.update", "settings", "security", `Auto logout: ${state.settings.sessionTimeoutMinutes || "never"} min`);
      save({ immediate: true });
      toast("Security settings saved ✓");
    });
  }

  function bindAppearance(root) {
    root.querySelector("#themePick").addEventListener("click", event => {
      const pref = event.target.closest("[data-theme-pick]")?.dataset.themePick;
      if (!pref) return;
      UI.applyTheme(pref);
      toast(`Theme: ${pref === "system" ? "System default" : pref[0].toUpperCase() + pref.slice(1)}`, "info", 1400);
      Shell.rerender();
    });
    root.querySelector("#liteMode").addEventListener("change", event => {
      UI.setEffects(event.target.checked ? "lite" : "full");
      toast(event.target.checked ? "Effects reduced" : "Full effects on", "info", 1400);
    });
  }

  function bindData(root) {
    root.querySelector("#syncBtn").addEventListener("click", async () => {
      await syncNow();
      render(root);
    });
    root.querySelector("#backupBtn")?.addEventListener("click", () => {
      downloadFile(`brands-planets-backup-${todayKey()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: currentUser().username, state }, null, 2), "application/json");
      audit("settings.backup", "settings", "backup", "Downloaded a data backup");
      save();
      toast("Backup downloaded ✓");
    });
  }

  return { render };
})();
