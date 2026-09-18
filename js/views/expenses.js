/* Expenses (existing rules kept: staff edit their own, admins edit all). */
Views.expenses = (() => {
  let period = "today";

  const canEdit = expense => isAdmin() || expense.user === currentUser()?.username;

  function render(root) {
    const range = periodRange(period);
    const rows = state.expenses.filter(expense => dateInRange(expense.date, range)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const total = sum(rows, expense => expense.amount);
    root.innerHTML = `
      <div class="page-head">
        <div><h1>Expenses</h1><p>${range.label}: <strong>${money(total)}</strong> across ${rows.length} entr${rows.length === 1 ? "y" : "ies"}</p></div>
        <div class="page-actions"><div class="segmented" id="expPeriod">${[["today", "Today"], ["7days", "7 days"], ["month", "This month"]].map(([id, label]) => `<button class="${period === id ? "active" : ""}" data-period="${id}" type="button">${label}</button>`).join("")}</div></div>
      </div>
      <div class="split-main" style="grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)">
        <div class="card card-pad">
          <form id="expForm" class="form-section">
            <div class="form-section-title">${icon("plus", 18)} Add expense</div>
            <div class="field"><label>Expense name</label><input id="expName" placeholder="Rent, salary, delivery…" list="expList"><datalist id="expList">${[...new Set(state.expenses.map(expense => expense.name).filter(Boolean))].slice(0, 30).map(name => `<option>${esc(name)}</option>`).join("")}</datalist></div>
            <div class="field"><label>Amount (Rs.)</label><input id="expAmount" type="number" min="0" inputmode="decimal" placeholder="0"></div>
            <div class="field"><label>Remarks</label><input id="expRemarks" placeholder="What was it for?"></div>
            <button class="btn btn-primary btn-lg" type="submit">${icon("check", 18)} Add expense</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>${range.label}</h3></div><span class="badge accent">${money(total)}</span></div>
          <div class="card-body">${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Name</th><th class="right">Amount</th><th>Remarks</th><th>Added by</th><th></th></tr></thead><tbody>
            ${rows.map(expense => `<tr data-id="${esc(expense.id)}"><td class="cell-sub">${fmtDate(expense.date)}</td><td class="cell-main">${esc(expense.name || "Expense")}</td><td class="right num cell-main">${money(expense.amount)}</td><td class="cell-sub">${esc(expense.remarks || "")}</td><td>${esc(expense.user || "")}</td>
              <td>${canEdit(expense) ? `<div class="actions"><button class="icon-btn sm" data-act="edit" aria-label="Edit" type="button">${icon("edit", 16)}</button><button class="icon-btn sm danger" data-act="delete" aria-label="Delete" type="button">${icon("trash", 16)}</button></div>` : ""}</td></tr>`).join("")}
          </tbody></table></div>` : UI.empty("expenses", "No expenses in this period")}</div>
        </div>
      </div>`;
    root.querySelector("#expPeriod").addEventListener("click", event => {
      const next = event.target.closest("[data-period]")?.dataset.period;
      if (next) { period = next; render(root); }
    });
    root.querySelector("#expForm").addEventListener("submit", event => {
      event.preventDefault();
      const name = root.querySelector("#expName").value.trim();
      const amount = Number(root.querySelector("#expAmount").value);
      const remarks = root.querySelector("#expRemarks").value.trim();
      if (!name || !(amount > 0) || !remarks) return toast("Expense name, amount and remarks are required.", "warn");
      const expense = { id: uid("e"), date: todayKey(), name, amount, remarks, user: currentUser().username };
      state.expenses.push(expense);
      audit("expense.create", "expense", expense.id, `${name}: ${money(amount)}`);
      save();
      toast("Expense added ✓");
      render(root);
    });
    root.querySelector("tbody")?.addEventListener("click", event => {
      const id = event.target.closest("[data-id]")?.dataset.id;
      const act = event.target.closest("[data-act]")?.dataset.act;
      if (act === "edit") edit(id, root);
      if (act === "delete") remove(id, root);
    });
  }

  function edit(id, root) {
    const expense = state.expenses.find(item => item.id === id);
    if (!expense || !canEdit(expense)) return toast("You can edit only your own expenses.", "error");
    const modal = UI.openModal({
      title: "Edit expense",
      size: "sm",
      body: `<form id="expEdit" class="form-section">
        <div class="field"><label>Name</label><input id="eeName" value="${esc(expense.name || "")}"></div>
        <div class="field"><label>Amount</label><input id="eeAmount" type="number" min="0" value="${esc(expense.amount)}"></div>
        <div class="field"><label>Remarks</label><input id="eeRemarks" value="${esc(expense.remarks || "")}"></div>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" form="expEdit" type="submit">Save</button>`
    });
    modal.el.querySelector("[data-close]")?.addEventListener("click", () => modal.close());
    modal.el.querySelector("#expEdit").addEventListener("submit", event => {
      event.preventDefault();
      const name = modal.el.querySelector("#eeName").value.trim();
      const amount = Number(modal.el.querySelector("#eeAmount").value);
      const remarks = modal.el.querySelector("#eeRemarks").value.trim();
      if (!name || !(amount > 0) || !remarks) return toast("Expense name, amount and remarks are required.", "warn");
      Object.assign(expense, { name, amount, remarks, editedBy: currentUser().username, editedAt: new Date().toISOString() });
      audit("expense.update", "expense", expense.id, `${name}: ${money(amount)}`);
      save();
      modal.close();
      toast("Expense updated ✓");
      render(root);
    });
  }

  async function remove(id, root) {
    const expense = state.expenses.find(item => item.id === id);
    if (!expense || !canEdit(expense)) return toast("You can delete only your own expenses.", "error");
    const ok = await UI.confirm({ title: "Delete this expense?", message: `${esc(expense.name)} · ${money(expense.amount)}`, confirmText: "Delete" });
    if (!ok) return;
    markDeleted("expenses", id);
    state.expenses = state.expenses.filter(item => item.id !== id);
    audit("expense.delete", "expense", id, `${expense.name}: ${money(expense.amount)}`);
    save({ immediate: true });
    toast("Expense deleted", "info");
    render(root);
  }

  return { render };
})();
