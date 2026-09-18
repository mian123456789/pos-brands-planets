/* Attendance (existing rules kept) and Day Close. */
const Attendance = (() => {
  const isCashier = () => currentUser()?.role === "Cashier";
  const today = () => todayKey();
  function hasAttendanceToday(username) {
    return state.attendance.some(record => record.username === username && record.date === today());
  }
  function hasWorkAttendanceToday(username) {
    return state.attendance.some(record => record.username === username && record.date === today() && record.status !== "Absent");
  }
  function isTodayClosed() {
    return state.dayClosings.some(day => day.date === today() && day.status === "Closed");
  }
  function openRecordsToday() {
    return state.attendance.filter(record => record.date === today() && !record.outTime && ["Present", "Late"].includes(record.status || "Present"));
  }
  function required() {
    return isCashier() && !isTodayClosed() && !hasWorkAttendanceToday(currentUser().username);
  }
  function blocksLogout() {
    return isCashier() && openRecordsToday().length > 0;
  }
  function staffOptions() {
    const seen = new Set();
    return (state.staff || []).map(staff => ({ name: String(staff.name || "").trim(), role: staff.role || "Staff" }))
      .filter(staff => staff.name && staff.name.toLowerCase() !== "cashier" && !seen.has(staff.name.toLowerCase()) && seen.add(staff.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function matchesStaff(record, name) {
    return String(record.name || record.username || "").trim().toLowerCase() === String(name || "").trim().toLowerCase();
  }
  async function completeRecords(records, message) {
    if (!records.length) {
      toast("No present staff are waiting to mark out.", "info");
      return false;
    }
    const now = new Date();
    records.forEach(record => {
      record.outTime = now.toLocaleTimeString();
      record.outAt = now.toISOString();
      record.status = "Completed";
    });
    const synced = await save({ immediate: true });
    toast(synced ? message : `${message} Saved on this device; will sync when online.`, synced ? "success" : "warn");
    return true;
  }
  function logoutPrompt(onDone) {
    const records = [...new Map(openRecordsToday().map(record => [record.name || record.username, record])).values()];
    const modal = UI.openModal({
      size: "sm",
      className: "confirm-modal",
      body: `<div class="confirm-body">
        <div class="confirm-icon tone-danger">${icon("attendance", 26)}</div>
        <h3>Attendance must be completed</h3>
        <p>${records.length} staff member${records.length === 1 ? " is" : "s are"} still marked present. Mark everyone out before logging out.</p>
        <div class="stack" style="width:100%;gap:6px;text-align:left">${records.map(record => `<div class="detail"><strong>${esc(record.name || record.username)}</strong><small>In ${esc(record.time || "—")}</small></div>`).join("")}</div>
      </div>`,
      footer: `<button class="btn btn-ghost" data-review type="button">Review attendance</button><button class="btn btn-primary" data-out type="button">Mark out all & log out</button>`
    });
    modal.el.querySelector("[data-review]").addEventListener("click", () => { modal.close(); Shell.go("attendance"); });
    modal.el.querySelector("[data-out]").addEventListener("click", async () => {
      await completeRecords(openRecordsToday(), "Everyone marked out.");
      modal.close();
      onDone();
    });
  }
  return { required, blocksLogout, logoutPrompt, openRecordsToday, staffOptions, matchesStaff, completeRecords, hasWorkAttendanceToday, isTodayClosed };
})();

Views.attendance = (() => {
  let period = "month";
  let selected = sessionStorage.getItem("bp-pos-selected-staff") || "";

  function buildReport() {
    const range = periodRange(period === "week" ? "week" : period);
    const names = Attendance.staffOptions().map(staff => staff.name);
    state.attendance.forEach(record => {
      const name = record.name || record.username;
      if (record.date && dateInRange(record.date, range) && name && !names.includes(name)) names.push(name);
    });
    const rows = [];
    const summary = { present: 0, absent: 0, completed: 0, none: 0 };
    for (let date = range.start; date <= range.end; date = addDaysKey(date, 1)) {
      names.forEach(name => {
        const records = state.attendance.filter(record => (record.name || record.username) === name && record.date === date);
        if (!records.length) { summary.none++; return; }
        records.forEach(record => {
          rows.push(record);
          if (record.status === "Absent") summary.absent++;
          else if (record.outTime || record.status === "Completed") summary.completed++;
          else summary.present++;
        });
      });
    }
    return { rows: rows.reverse(), summary, range };
  }

  function statusOf(record) {
    return record.outTime ? "Completed" : record.status || "Present";
  }

  function render(root) {
    const options = Attendance.staffOptions();
    const current = options.find(staff => staff.name === selected) || options[0] || null;
    selected = current?.name || "";
    const openForSelected = current ? Attendance.openRecordsToday().filter(record => Attendance.matchesStaff(record, current.name)) : [];
    const required = Attendance.required();
    const report = buildReport();
    const admin = isAdmin();
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Attendance</h1><p>Mark staff in and out. ${required ? "<strong>Mark attendance to unlock the POS.</strong>" : ""}</p></div>
        <div class="page-actions"><button class="btn btn-soft" id="attExport" type="button">${icon("download", 18)} Export</button></div>
      </div>
      ${required ? `<div class="promo-banner" style="margin:0 0 16px"><span class="pb-icon">📋</span><div><strong>Attendance required</strong><small>Select the staff person and press Mark Present. Billing unlocks right after.</small></div></div>` : ""}
      <div class="card card-pad" style="margin-bottom:16px">
        <div class="attendance-hero">
          <div class="field"><label for="attStaff">Staff person</label>
            <select id="attStaff" ${options.length ? "" : "disabled"}>${options.length ? options.map(staff => `<option ${staff.name === selected ? "selected" : ""}>${esc(staff.name)}</option>`).join("") : `<option>No staff added — use Staff / Users</option>`}</select>
          </div>
          <div class="row wrap">
            <button class="btn btn-accent btn-lg" data-mark="present" type="button" ${options.length ? "" : "disabled"}>${icon("check", 18)} Mark Present</button>
            <button class="btn btn-soft btn-lg" data-mark="absent" type="button" ${options.length ? "" : "disabled"}>Mark Absent</button>
            <button class="btn btn-soft btn-lg" data-mark="out" type="button" ${openForSelected.length ? "" : "disabled"}>${icon("logout", 18)} Mark Out</button>
          </div>
        </div>
      </div>
      ${admin ? `<div class="card card-pad" style="margin-bottom:16px">
        <div class="form-section-title" style="margin-bottom:12px">${icon("edit", 18)} Manual attendance <span class="badge">Admin</span></div>
        <div class="form-grid form-grid-3">
          <div class="field"><label>Staff person</label><select id="manPerson">${options.map(staff => `<option>${esc(staff.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Date</label><input id="manDate" type="date" value="${todayKey()}"></div>
          <div class="field"><label>Status</label><select id="manStatus">${["Present", "Completed", "Absent", "Late"].map(status => `<option>${status}</option>`).join("")}</select></div>
          <div class="field"><label>In time</label><input id="manIn" type="time"></div>
          <div class="field"><label>Out time</label><input id="manOut" type="time"></div>
          <div class="field"><label>&nbsp;</label><button class="btn btn-primary" id="manSave" type="button">Save attendance</button></div>
        </div>
      </div>` : ""}
      <div class="card">
        <div class="card-head">
          <div><h3>Attendance report</h3><p>${fmtDate(report.range.start)} – ${fmtDate(report.range.end)}</p></div>
          <div class="segmented" id="attPeriod">${[["today", "Today"], ["week", "This Week"], ["month", "This Month"]].map(([id, label]) => `<button class="${period === id ? "active" : ""}" data-period="${id}" type="button">${label}</button>`).join("")}</div>
        </div>
        <div class="card-body">
          <div class="detail-grid" style="margin-bottom:16px">
            ${[["Present", report.summary.present, "good"], ["Completed", report.summary.completed, "info"], ["Absent", report.summary.absent, "bad"], ["No record", report.summary.none, ""]].map(([label, value]) => `<div class="detail"><small>${label}</small><strong>${value}</strong></div>`).join("")}
          </div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Name</th><th>Role</th><th>In</th><th>Out</th><th>Status</th><th>Marked by</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>
            ${report.rows.map(record => {
              const status = statusOf(record);
              const tone = status === "Absent" ? "bad" : status === "Completed" ? "info" : status === "Late" ? "warn" : "good";
              return `<tr><td>${fmtDate(record.date)}</td><td class="cell-main">${esc(record.name || record.username)}</td><td>${esc(record.role || "")}</td><td>${esc(record.time || "—")}</td><td>${esc(record.outTime || "—")}</td><td><span class="badge ${tone}">${status}</span></td><td class="cell-sub">${esc(record.markedBy || record.username || "")}</td>
                ${admin ? `<td><div class="actions"><button class="icon-btn sm" data-edit="${esc(record.id)}" aria-label="Edit">${icon("edit", 16)}</button><button class="icon-btn sm danger" data-del="${esc(record.id)}" aria-label="Delete">${icon("trash", 16)}</button></div></td>` : ""}</tr>`;
            }).join("") || `<tr><td colspan="8">${UI.empty("attendance", "No attendance records in this period")}</td></tr>`}
          </tbody></table></div>
        </div>
      </div>`;

    root.querySelector("#attStaff")?.addEventListener("change", event => {
      selected = event.target.value;
      sessionStorage.setItem("bp-pos-selected-staff", selected);
      render(root);
    });
    root.querySelectorAll("[data-mark]").forEach(button => button.addEventListener("click", () => mark(button.dataset.mark, current, root)));
    root.querySelector("#attPeriod").addEventListener("click", event => {
      const next = event.target.closest("[data-period]")?.dataset.period;
      if (next) { period = next; render(root); }
    });
    root.querySelector("#attExport").addEventListener("click", () => {
      downloadFile(`brands-planets-attendance-${period}.csv`, toCsv([["Date", "Name", "Role", "In Time", "Out Time", "Status", "Marked By"], ...report.rows.slice().reverse().map(record => [record.date, record.name || record.username, record.role, record.time || "", record.outTime || "", statusOf(record), record.markedBy || ""])]));
    });
    root.querySelector("#manSave")?.addEventListener("click", () => manualSave(root));
    root.querySelector("table").addEventListener("click", event => {
      const editId = event.target.closest("[data-edit]")?.dataset.edit;
      const deleteId = event.target.closest("[data-del]")?.dataset.del;
      if (editId) editRecord(editId, root);
      if (deleteId) deleteRecord(deleteId, root);
    });
  }

  async function mark(kind, staff, root) {
    if (!staff) return toast("Select a staff person first.", "warn");
    const user = currentUser();
    if (kind === "out") {
      const records = Attendance.openRecordsToday().filter(record => Attendance.matchesStaff(record, staff.name));
      await Attendance.completeRecords(records, `${staff.name} marked out ✓`);
    } else {
      state.attendance.push({
        id: uid("a"),
        date: todayKey(),
        username: user.username,
        staffUsername: staff.name,
        name: staff.name,
        role: staff.role,
        time: kind === "present" ? new Date().toLocaleTimeString() : "",
        outTime: "",
        status: kind === "present" ? "Present" : "Absent",
        markedBy: user.username
      });
      save();
      toast(`${staff.name} marked ${kind === "present" ? "present" : "absent"} ✓`);
    }
    if (!Attendance.required() && kind === "present" && currentUser().role === "Cashier") {
      Shell.rerender();
      return;
    }
    render(root);
  }

  function manualSave(root) {
    const name = $("#manPerson")?.value;
    const date = $("#manDate").value;
    const inTime = $("#manIn").value;
    const outTime = $("#manOut").value;
    let status = $("#manStatus").value;
    if (!name || !date) return toast("Select staff and date.", "warn");
    if (status !== "Absent" && !inTime) return toast("In time is required unless status is Absent.", "warn");
    if (outTime && status === "Present") status = "Completed";
    const staff = Attendance.staffOptions().find(item => item.name === name);
    state.attendance.push({ id: uid("a"), date, username: currentUser().username, staffUsername: name, name, role: staff?.role || "Staff", time: status === "Absent" ? "" : inTime, outTime: status === "Absent" ? "" : outTime, status, markedBy: currentUser().username, manual: true });
    save();
    toast("Manual attendance saved ✓");
    render(root);
  }

  function editRecord(id, root) {
    const record = state.attendance.find(item => item.id === id);
    if (!record || !isAdmin()) return;
    const modal = UI.openModal({
      title: "Edit attendance",
      size: "sm",
      body: `<form id="attEdit" class="form-section">
        <div class="field"><label>Person name</label><input id="aeName" value="${esc(record.name || record.username)}"></div>
        <div class="field"><label>Date</label><input id="aeDate" type="date" value="${esc(record.date)}"></div>
        <div class="form-grid"><div class="field"><label>In time</label><input id="aeIn" value="${esc(record.time || "")}"></div><div class="field"><label>Out time</label><input id="aeOut" value="${esc(record.outTime || "")}"></div></div>
        <div class="field"><label>Status</label><select id="aeStatus">${["Present", "Completed", "Absent", "Late"].map(status => `<option ${record.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="attEdit" type="submit">Save</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#attEdit").addEventListener("submit", event => {
      event.preventDefault();
      const status = modal.el.querySelector("#aeStatus").value;
      const outTime = modal.el.querySelector("#aeOut").value.trim();
      record.name = modal.el.querySelector("#aeName").value.trim() || record.name;
      record.date = modal.el.querySelector("#aeDate").value || record.date;
      record.time = modal.el.querySelector("#aeIn").value.trim();
      record.outTime = outTime;
      record.status = status === "Absent" ? "Absent" : outTime ? "Completed" : status;
      save();
      modal.close();
      toast("Attendance updated ✓");
      render(root);
    });
  }
  async function deleteRecord(id, root) {
    if (!isAdmin()) return;
    const ok = await UI.confirm({ title: "Delete attendance record?", message: "This can't be undone.", confirmText: "Delete" });
    if (!ok) return;
    markDeleted("attendance", id);
    state.attendance = state.attendance.filter(record => record.id !== id);
    save({ immediate: true });
    toast("Attendance deleted", "info");
    render(root);
  }

  return { render };
})();

Views.dayclose = (() => {
  function render(root) {
    const range = periodRange("today");
    const summary = salesSummary(range);
    const closed = state.dayClosings.find(day => day.date === todayKey() && day.status === "Closed");
    const afterExpense = summary.net - summary.expenses;
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Day Close</h1><p>${fmtDate(todayKey())} · ${closed ? `Closed at ${esc(closed.time)} by ${esc(closed.user)}` : "Business day is open"}</p></div>
        <div class="page-actions">
          ${isAdmin() ? (closed
            ? `<button class="btn btn-soft" id="reopenDay" type="button">${icon("refresh", 18)} Reopen day</button>`
            : `<button class="btn btn-primary" id="closeDay" type="button">${icon("lock", 18)} Close day</button>`) : `<span class="badge">Only an admin can close the day</span>`}
        </div>
      </div>
      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <div class="kpi hero"><div class="kpi-top"><span class="kpi-label">After Expenses</span><span class="kpi-icon">${icon("dayclose", 20)}</span></div><div class="kpi-value" data-count="${afterExpense}" data-format="money">${money(afterExpense)}</div><div class="kpi-sub">Net sales − expenses</div></div>
        ${[["Cash Sales", summary.cash, "cash", "t-good"], ["Card / Bank / Wallet", summary.cardBank, "card", "t-info"], ["Net Sales", summary.net, "sales", "t-accent"], ["Refunds", summary.refunds, "returns", "t-bad"], ["Expenses", summary.expenses, "expenses", "t-warn"]].map(([label, value, ic, tone]) => `<div class="kpi ${tone}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon">${icon(ic, 20)}</span></div><div class="kpi-value" data-count="${value}" data-format="money">${money(value)}</div></div>`).join("")}
      </div>
      <div class="card card-pad" style="margin-top:16px">
        <div class="form-section-title" style="margin-bottom:12px">${icon("sales", 18)} Payment breakdown</div>
        <div class="detail-grid">${Object.entries(summary.byMethod).map(([method, value]) => `<div class="detail"><small>${esc(method)}</small><strong>${money(value)}</strong></div>`).join("") || `<p class="muted">No sales yet today.</p>`}
          <div class="detail"><small>Orders</small><strong>${summary.orders}</strong></div>
          <div class="detail"><small>Pending payments</small><strong>${money(summary.pending)}</strong></div>
        </div>
      </div>`;
    root.querySelector("#closeDay")?.addEventListener("click", async () => {
      const ok = await UI.confirm({ title: "Close today's business day?", message: `Net sales ${money(summary.net)} · expenses ${money(summary.expenses)} · after expenses ${money(afterExpense)}.`, confirmText: "Close day", tone: "primary", iconName: "lock" });
      if (!ok) return;
      state.dayClosings = state.dayClosings.filter(day => day.date !== todayKey());
      state.dayClosings.push({ date: todayKey(), status: "Closed", totalSales: summary.net, cashSales: summary.cash, nonCashSales: summary.cardBank, refunds: summary.refunds, expenses: summary.expenses, afterExpense, remaining: afterExpense, user: currentUser().username, time: new Date().toLocaleString() });
      audit("day.close", "dayClosing", todayKey(), `Closed day · net ${money(summary.net)}`);
      save({ immediate: true });
      toast("Day closed ✓");
      render(root);
    });
    root.querySelector("#reopenDay")?.addEventListener("click", async () => {
      const ok = await UI.confirm({ title: "Reopen today?", message: "The day-close record will be removed.", confirmText: "Reopen" });
      if (!ok) return;
      markDeleted("dayClosings", todayKey());
      state.dayClosings = state.dayClosings.filter(day => day.date !== todayKey());
      audit("day.reopen", "dayClosing", todayKey(), "Reopened day");
      save({ immediate: true });
      toast("Day reopened", "info");
      render(root);
    });
  }
  return { render };
})();
