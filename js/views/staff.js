/* Staff / Users: user accounts & roles, staff roster, activity log. */
Views.staff = (() => {
  let tab = "";
  let auditFilter = { user: "", type: "", period: "7days" };
  const ACTION_LABELS = {
    "sale.create": ["Sale created", "pos", "good"],
    "sale.cancel": ["Sale cancelled", "ban", "bad"],
    "sale.delete": ["Sale deleted", "trash", "bad"],
    "sale.edit": ["Sale edited", "edit", "info"],
    "stock.adjust": ["Stock changed", "inventory", "warn"],
    "product.create": ["Product created", "products", "info"],
    "product.update": ["Product updated", "products", "info"],
    "product.delete": ["Product deleted", "trash", "bad"],
    "product.price_change": ["Price changed", "tag", "warn"],
    "return.create": ["Product returned", "returns", "warn"],
    "exchange.create": ["Exchange", "returns", "warn"],
    "promotion.create": ["Promotion created", "promotions", "accent"],
    "promotion.update": ["Promotion updated", "promotions", "accent"],
    "promotion.delete": ["Promotion deleted", "trash", "bad"],
    "user.created": ["User created", "userPlus", "info"],
    "user.updated": ["User updated", "user", "info"],
    "user.deleted": ["User deleted", "trash", "bad"],
    "user.password_changed": ["Password changed", "lock", "warn"],
    "auth.login": ["Signed in", "user", ""],
    "auth.logout": ["Signed out", "logout", ""],
    "auth.login_failed": ["Failed sign-in", "alert", "bad"],
    "settings.update": ["Settings changed", "settings", "info"],
    "customer.create": ["Customer added", "customers", ""],
    "customer.update": ["Customer updated", "customers", ""],
    "customer.delete": ["Customer deleted", "trash", "bad"],
    "expense.create": ["Expense added", "expenses", ""],
    "expense.update": ["Expense edited", "expenses", ""],
    "expense.delete": ["Expense deleted", "trash", "bad"],
    "day.close": ["Day closed", "dayclose", "info"],
    "day.reopen": ["Day reopened", "dayclose", "warn"]
  };

  function tabs() {
    return [
      can("users") && ["users", "Users & Roles", "shield"],
      can("staff") && ["roster", "Staff Roster", "staff"],
      can("viewAudit") && ["audit", "Activity Log", "history"]
    ].filter(Boolean);
  }

  /* ------------------------------------------------------------ users */
  function usersHtml() {
    const users = state.users.slice().sort((a, b) => Number(BPPermissions.isAdminRole(b.role)) - Number(BPPermissions.isAdminRole(a.role)) || String(a.username).localeCompare(String(b.username)));
    return `<div class="card">
      <div class="card-head"><div><h3>User accounts</h3><p>Passwords are stored securely on the server and never shown.</p></div><button class="btn btn-accent" data-user-new type="button">${icon("userPlus", 18)} Add user</button></div>
      <div class="card-body"><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Access</th><th></th></tr></thead><tbody>
        ${users.map(user => {
          const perms = BPPermissions.effectivePermissions(user);
          return `<tr data-user="${esc(user.id)}">
            <td><div class="product-cell"><span class="avatar ${BPPermissions.isAdminRole(user.role) ? "" : "navy"}" style="width:36px;height:36px">${esc(initials(user.name || user.username))}</span><div><div class="cell-main">${esc(user.username)}${user.id === currentUser().id ? ` <span class="badge">You</span>` : ""}</div><div class="cell-sub">${esc(user.name || "")}</div></div></div></td>
            <td><span class="badge ${BPPermissions.isAdminRole(user.role) ? "accent" : user.role === "Manager" ? "info" : ""}">${esc(BPPermissions.roleLabel(user.role))}</span></td>
            <td>${user.active === false ? `<span class="badge bad">Disabled</span>` : `<span class="badge good"><span class="dot"></span>Active</span>`}</td>
            <td class="cell-sub" style="max-width:360px">${BPPermissions.isAdminRole(user.role) ? "Full access" : esc(perms.map(key => BPPermissions.PERMISSIONS[key]).join(", "))}</td>
            <td><div class="actions"><button class="btn btn-soft btn-sm" data-user-edit type="button">${icon("edit", 15)} Edit</button>${user.id !== currentUser().id ? `<button class="icon-btn sm danger" data-user-delete type="button" aria-label="Delete user">${icon("trash", 16)}</button>` : ""}</div></td>
          </tr>`;
        }).join("")}
      </tbody></table></div></div>
    </div>`;
  }

  function editUser(id) {
    const user = id ? state.users.find(item => item.id === id) : null;
    const role = user ? (BPPermissions.isAdminRole(user.role) ? "Admin" : user.role) : "Cashier";
    let perms = user ? BPPermissions.effectivePermissions(user) : [...BPPermissions.ROLE_DEFAULTS.Cashier];
    const modal = UI.openModal({
      title: user ? `Edit ${esc(user.username)}` : "Add user",
      subtitle: "Choose a role, then fine-tune what this person can do.",
      size: "lg",
      body: `<form id="userForm" class="form-section" autocomplete="off">
        <div class="form-grid">
          <div class="field"><label>Username *</label><input id="uName" value="${esc(user?.username || "")}" autocapitalize="none" autocomplete="off"></div>
          <div class="field"><label>Display name</label><input id="uDisplay" value="${esc(user?.name || "")}"></div>
          <div class="field"><label>Role</label><select id="uRole">${BPPermissions.ROLES.map(item => `<option ${role === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
          <div class="field"><label>${user ? "Reset password" : "Password *"}</label><input id="uPass" type="password" autocomplete="new-password" placeholder="${user ? "Leave blank to keep current" : "At least 6 characters"}"></div>
        </div>
        <label class="check"><span class="switch"><input type="checkbox" id="uActive" ${user?.active === false ? "" : "checked"}><span></span></span> Account active</label>
        <div class="field" id="permBox"><label>Permissions</label><div class="perm-grid" id="permGrid"></div><span class="hint">Cashiers can't change prices, create promotions, delete sales, change settings or see profit unless you tick those boxes.</span></div>
        <div id="userError" class="form-error hidden"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" id="userSave" form="userForm" type="submit">${icon("check", 18)} Save user</button>`
    });
    const el = modal.el;
    el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    const drawPerms = () => {
      const isAdminRole = el.querySelector("#uRole").value === "Admin";
      el.querySelector("#permGrid").innerHTML = Object.entries(BPPermissions.PERMISSIONS).map(([key, label]) => `<label><input type="checkbox" value="${key}" ${isAdminRole || perms.includes(key) ? "checked" : ""} ${isAdminRole ? "disabled" : ""}>${esc(label)}</label>`).join("");
    };
    el.querySelector("#uRole").addEventListener("change", event => {
      perms = [...BPPermissions.ROLE_DEFAULTS[event.target.value]];
      drawPerms();
    });
    el.querySelector("#permGrid").addEventListener("change", event => {
      if (event.target.checked) perms = [...new Set([...perms, event.target.value])];
      else perms = perms.filter(key => key !== event.target.value);
    });
    drawPerms();
    el.querySelector("#userForm").addEventListener("submit", async event => {
      event.preventDefault();
      const error = el.querySelector("#userError");
      error.classList.add("hidden");
      const payload = {
        user: {
          id: user?.id,
          username: el.querySelector("#uName").value.trim(),
          name: el.querySelector("#uDisplay").value.trim(),
          role: el.querySelector("#uRole").value,
          active: el.querySelector("#uActive").checked,
          permissions: perms
        },
        password: el.querySelector("#uPass").value || undefined
      };
      if (!payload.user.username) { error.textContent = "Username is required."; return error.classList.remove("hidden"); }
      const button = el.querySelector("#userSave");
      button.disabled = true;
      try {
        await api("/api/users", { method: "POST", body: payload });
        await pullCloudState();
        modal.close();
        toast(user ? "User updated ✓" : "User created ✓");
        Shell.rerender();
      } catch (err) {
        error.textContent = err.network ? "You're offline. Users can only be managed while connected to the server." : err.message;
        error.classList.remove("hidden");
        button.disabled = false;
      }
    });
  }

  async function deleteUser(id) {
    const user = state.users.find(item => item.id === id);
    if (!user) return;
    const ok = await UI.confirm({ title: `Delete ${user.username}?`, message: "They will be signed out everywhere and can no longer log in. Their past sales stay in reports.", confirmText: "Delete user" });
    if (!ok) return;
    try {
      await api("/api/users/delete", { method: "POST", body: { id } });
      markDeleted("users", id);
      state.users = state.users.filter(item => item.id !== id);
      persistLocal();
      rememberPersistedState();
      await pullCloudState();
      toast("User deleted", "info");
      Shell.rerender();
    } catch (err) {
      toast(err.network ? "You're offline. Try again when connected." : err.message, "error");
    }
  }

  /* ----------------------------------------------------------- roster */
  function rosterHtml() {
    const staff = state.staff || [];
    const today = state.attendance.filter(record => record.date === todayKey());
    return `<div class="split-main" style="grid-template-columns:minmax(0,1fr) minmax(0,1.8fr)">
      <div class="card card-pad"><form id="staffForm" class="form-section">
        <div class="form-section-title">${icon("userPlus", 18)} Add staff member</div>
        <div class="field"><label>Name</label><input id="sName"></div>
        <div class="field"><label>Role</label><select id="sRole">${["Staff", "Cashier", "Manager", "Sales", "Inventory"].map(role => `<option>${role}</option>`).join("")}</select></div>
        <div class="field"><label>Phone</label><input id="sPhone" inputmode="tel"></div>
        <div class="field"><label>Remarks</label><input id="sRemarks" placeholder="Optional"></div>
        <button class="btn btn-primary" type="submit">${icon("plus", 18)} Add staff</button>
        <p class="hint">Staff on this roster appear on the Attendance screen. Staff don't need a login.</p>
      </form></div>
      <div class="card"><div class="card-head"><div><h3>Staff directory</h3><p>${staff.length} people · ${today.filter(record => record.status !== "Absent").length} present today</p></div></div>
        <div class="card-body">${staff.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Today</th><th></th></tr></thead><tbody>
          ${staff.map(member => {
            const record = state.attendance.slice().reverse().find(item => item.date === todayKey() && (item.name || item.username) === member.name);
            const status = record ? (record.status === "Absent" ? "Absent" : record.outTime ? "Completed" : "Present") : "No record";
            return `<tr data-staff="${esc(member.id)}"><td><div class="product-cell"><span class="avatar navy" style="width:34px;height:34px">${esc(initials(member.name))}</span><div><div class="cell-main">${esc(member.name)}</div><div class="cell-sub">${esc(member.remarks || "")}</div></div></div></td><td>${esc(member.role || "Staff")}</td><td>${esc(member.phone || "—")}</td><td><span class="badge ${status === "Present" || status === "Completed" ? "good" : status === "Absent" ? "bad" : ""}">${status}</span></td>
              <td><div class="actions"><button class="icon-btn sm" data-staff-edit type="button" aria-label="Edit">${icon("edit", 16)}</button><button class="icon-btn sm danger" data-staff-delete type="button" aria-label="Delete">${icon("trash", 16)}</button></div></td></tr>`;
          }).join("")}
        </tbody></table></div>` : UI.empty("staff", "No staff added yet")}</div>
      </div>
    </div>`;
  }

  function editStaff(id, root) {
    const member = state.staff.find(item => item.id === id);
    if (!member) return;
    const modal = UI.openModal({
      title: "Edit staff member",
      size: "sm",
      body: `<form id="staffEdit" class="form-section">
        <div class="field"><label>Name</label><input id="seName" value="${esc(member.name)}"></div>
        <div class="field"><label>Role</label><input id="seRole" value="${esc(member.role || "Staff")}"></div>
        <div class="field"><label>Phone</label><input id="sePhone" value="${esc(member.phone || "")}"></div>
        <div class="field"><label>Remarks</label><input id="seRemarks" value="${esc(member.remarks || "")}"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="staffEdit" type="submit">Save</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#staffEdit").addEventListener("submit", event => {
      event.preventDefault();
      const name = modal.el.querySelector("#seName").value.trim();
      if (!name) return toast("Name is required.", "warn");
      if (state.staff.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) return toast("Another staff member has this name.", "warn");
      Object.assign(member, { name, role: modal.el.querySelector("#seRole").value.trim() || "Staff", phone: modal.el.querySelector("#sePhone").value.trim(), remarks: modal.el.querySelector("#seRemarks").value.trim() });
      save({ immediate: true });
      modal.close();
      toast("Staff updated ✓");
      render(root);
    });
  }

  /* ------------------------------------------------------------ audit */
  function auditHtml() {
    const range = periodRange(auditFilter.period);
    const users = [...new Set(state.auditLog.map(entry => entry.user).filter(Boolean))].sort();
    const entries = state.auditLog.filter(entry =>
      dateInRange(recordDateKey(entry.date), range) &&
      (!auditFilter.user || entry.user === auditFilter.user) &&
      (!auditFilter.type || String(entry.action).startsWith(auditFilter.type))
    ).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 400);
    return `<div class="card">
      <div class="toolbar">
        <select class="select" id="auPeriod">${PERIODS.filter(([id]) => id !== "custom").map(([id, label]) => `<option value="${id}" ${auditFilter.period === id ? "selected" : ""}>${label}</option>`).join("")}</select>
        <select class="select" id="auUser"><option value="">All employees</option>${users.map(user => `<option ${auditFilter.user === user ? "selected" : ""}>${esc(user)}</option>`).join("")}</select>
        <select class="select" id="auType"><option value="">All activity</option>${[["sale", "Sales"], ["stock", "Stock changes"], ["product", "Products & prices"], ["return", "Returns"], ["exchange", "Exchanges"], ["promotion", "Promotions"], ["user", "Users"], ["auth", "Sign-ins"], ["settings", "Settings"], ["expense", "Expenses"]].map(([id, label]) => `<option value="${id}" ${auditFilter.type === id ? "selected" : ""}>${label}</option>`).join("")}</select>
        <button class="btn btn-soft" id="auExport" type="button">${icon("download", 18)} Export</button>
      </div>
      <div class="card-body" style="padding-top:0">${entries.length ? entries.map(entry => {
        const [label, ic, tone] = ACTION_LABELS[entry.action] || [entry.action, "info", ""];
        return `<div class="audit-item"><span class="notif-icon" style="background:var(--${tone ? `${tone}-soft` : "surface-3"});color:var(--${tone === "accent" ? "accent-text" : tone || "muted"})">${icon(ic, 18)}</span>
          <div><strong style="font-size:14px">${esc(label)}</strong> <span class="cell-sub">by ${esc(entry.user || "")}${entry.outlet ? ` · ${esc(entry.outlet)}` : ""}</span><div class="cell-sub">${esc(entry.detail || "")}</div></div>
          <span class="cell-sub" style="white-space:nowrap">${fmtDateTime(entry.date)}</span></div>`;
      }).join("") : UI.empty("history", "No activity in this period")}</div>
    </div>`;
  }

  /* ----------------------------------------------------------- render */
  function render(root) {
    const available = tabs();
    if (!available.some(([id]) => id === tab)) tab = available[0]?.[0] || "";
    root.innerHTML = `
      <div class="page-head"><div><h1>Staff / Users</h1><p>Accounts, roles, the staff roster and who did what.</p></div></div>
      <div class="tabs" id="staffTabs" style="margin-bottom:16px">${available.map(([id, label, ic]) => `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}" type="button">${icon(ic, 16)} ${label}</button>`).join("")}</div>
      <div id="staffBody">${tab === "users" ? usersHtml() : tab === "roster" ? rosterHtml() : tab === "audit" ? auditHtml() : ""}</div>`;
    root.querySelector("#staffTabs").addEventListener("click", event => {
      const next = event.target.closest("[data-tab]")?.dataset.tab;
      if (next) { tab = next; render(root); }
    });
    const body = root.querySelector("#staffBody");
    body.addEventListener("click", event => {
      if (event.target.closest("[data-user-new]")) return editUser(null);
      const userId = event.target.closest("[data-user]")?.dataset.user;
      if (userId && event.target.closest("[data-user-edit]")) return editUser(userId);
      if (userId && event.target.closest("[data-user-delete]")) return deleteUser(userId);
      const staffId = event.target.closest("[data-staff]")?.dataset.staff;
      if (staffId && event.target.closest("[data-staff-edit]")) return editStaff(staffId, root);
      if (staffId && event.target.closest("[data-staff-delete]")) {
        const member = state.staff.find(item => item.id === staffId);
        UI.confirm({ title: `Remove ${member.name}?`, message: "Their past attendance stays in reports.", confirmText: "Remove" }).then(ok => {
          if (!ok) return;
          markDeleted("staff", staffId);
          state.staff = state.staff.filter(item => item.id !== staffId);
          save({ immediate: true });
          toast("Staff removed", "info");
          render(root);
        });
      }
    });
    body.querySelector("#staffForm")?.addEventListener("submit", event => {
      event.preventDefault();
      const name = body.querySelector("#sName").value.trim();
      if (!name) return toast("Staff name is required.", "warn");
      if (state.staff.some(item => item.name.toLowerCase() === name.toLowerCase())) return toast("Staff already exists.", "warn");
      const now = new Date().toISOString();
      state.staff.push({ id: uid("s"), name, role: body.querySelector("#sRole").value, phone: body.querySelector("#sPhone").value.trim(), remarks: body.querySelector("#sRemarks").value.trim(), createdAt: now });
      save({ immediate: true });
      toast("Staff added ✓");
      render(root);
    });
    ["auPeriod", "auUser", "auType"].forEach(id => body.querySelector(`#${id}`)?.addEventListener("change", event => {
      auditFilter = { ...auditFilter, [{ auPeriod: "period", auUser: "user", auType: "type" }[id]]: event.target.value };
      render(root);
    }));
    body.querySelector("#auExport")?.addEventListener("click", () => {
      downloadFile("brands-planets-activity-log.csv", toCsv([["Date", "User", "Outlet", "Action", "Detail"], ...state.auditLog.slice().reverse().map(entry => [entry.date, entry.user, entry.outlet || "", entry.action, entry.detail])]));
      toast("Activity log exported ✓");
    });
  }

  return { render };
})();
