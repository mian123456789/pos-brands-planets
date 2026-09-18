/* UI kit: toasts, modals, confirmation dialogs, animated numbers, theme. */
const UI = (() => {
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("lite");

  /* ---------------------------------------------------------- toasts */
  const TOAST_ICONS = { success: "check", error: "alert", info: "info", promo: "sparkles", warn: "alert" };
  function toast(message, type = "success", timeout = 2600) {
    const root = document.getElementById("toasts");
    if (!root) return;
    // Repeated messages (e.g. scanning several items) refresh one toast instead of stacking.
    const last = root.lastElementChild;
    if (last && last.dataset.message === `${type}:${message}` && !last.classList.contains("leaving")) {
      clearTimeout(Number(last.dataset.timer));
      const count = Number(last.dataset.count || 1) + 1;
      last.dataset.count = count;
      last.querySelector(".toast-text").textContent = `${message} ×${count}`;
      pulse(last);
      last.dataset.timer = setTimeout(() => last.click(), timeout);
      return;
    }
    const item = document.createElement("div");
    item.dataset.message = `${type}:${message}`;
    item.className = `toast toast-${type}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    item.innerHTML = `<span class="toast-icon">${icon(TOAST_ICONS[type] || "info", 18)}</span><span class="toast-text">${esc(message)}</span>`;
    root.appendChild(item);
    while (root.children.length > 4) root.firstElementChild.remove();
    const dismiss = () => {
      item.classList.add("leaving");
      setTimeout(() => item.remove(), 220);
    };
    item.addEventListener("click", dismiss);
    item.dataset.timer = setTimeout(dismiss, type === "error" ? Math.max(timeout, 4200) : timeout);
  }

  /* ---------------------------------------------------------- modals */
  const stack = [];
  function openModal({ title = "", subtitle = "", body = "", footer = "", size = "md", onClose = null, dismissible = true, className = "" } = {}) {
    const root = document.getElementById("modalRoot");
    const wrap = document.createElement("div");
    wrap.className = `modal-backdrop ${className}`;
    wrap.innerHTML = `<div class="modal modal-${size}" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ""}>
      ${title ? `<div class="modal-head"><div><h3>${title}</h3>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${dismissible ? `<button class="icon-btn" data-close aria-label="Close">${icon("x", 20)}</button>` : ""}</div>` : ""}
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
    </div>`;
    const entry = { wrap, onClose, dismissible, lastFocus: document.activeElement };
    entry.close = (result) => closeEntry(entry, result);
    wrap.addEventListener("mousedown", event => {
      if (event.target === wrap && dismissible) entry.close();
    });
    wrap.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => entry.close()));
    root.appendChild(wrap);
    stack.push(entry);
    requestAnimationFrame(() => {
      wrap.classList.add("open");
      const focusTarget = wrap.querySelector("[autofocus]") || wrap.querySelector("input:not([type=hidden]):not([readonly]), select, textarea");
      if (focusTarget && window.matchMedia("(pointer: fine)").matches) focusTarget.focus();
    });
    return { el: wrap.querySelector(".modal"), close: entry.close };
  }
  function closeEntry(entry, result) {
    const index = stack.indexOf(entry);
    if (index === -1) return;
    stack.splice(index, 1);
    entry.wrap.classList.remove("open");
    entry.wrap.classList.add("closing");
    setTimeout(() => entry.wrap.remove(), 180);
    if (entry.onClose) entry.onClose(result);
    if (entry.lastFocus && document.contains(entry.lastFocus)) entry.lastFocus.focus?.({ preventScroll: true });
  }
  function closeTop() {
    const top = stack[stack.length - 1];
    if (top && top.dismissible) { top.close(); return true; }
    return false;
  }
  function closeAll() {
    stack.slice().reverse().forEach(entry => entry.close());
  }
  const hasModal = () => stack.length > 0;
  const topModal = () => stack[stack.length - 1]?.wrap || null;

  /**
   * Confirmation modal. Resolves true/false, or the entered text when
   * `input` is given (null when cancelled).
   */
  function confirm({ title = "Are you sure?", message = "", confirmText = "Confirm", cancelText = "Cancel", tone = "danger", iconName, input = null, details = "" } = {}) {
    return new Promise(resolve => {
      let settled = false;
      const done = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const inputHtml = input ? `<div class="field"><label for="confirmInput">${esc(input.label || "")}</label>
        ${input.options
          ? `<select id="confirmInput">${input.options.map(option => `<option>${esc(option)}</option>`).join("")}</select>`
          : `<input id="confirmInput" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}" autocomplete="off">`}
        </div>` : "";
      const modal = openModal({
        size: "sm",
        className: "confirm-modal",
        body: `<div class="confirm-body">
          <div class="confirm-icon tone-${tone}">${icon(iconName || (tone === "danger" ? "alert" : "info"), 26)}</div>
          <h3>${esc(title)}</h3>
          ${message ? `<p>${message}</p>` : ""}
          ${details}
          ${inputHtml}
        </div>`,
        footer: `<button class="btn btn-ghost" data-cancel>${esc(cancelText)}</button>
          <button class="btn ${tone === "danger" ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>`,
        onClose: () => done(input ? null : false)
      });
      const ok = modal.el.querySelector("[data-ok]");
      const field = modal.el.querySelector("#confirmInput");
      const submit = () => {
        if (input) {
          const value = field.value.trim();
          if (input.required && !value) {
            field.classList.add("invalid");
            field.focus();
            return;
          }
          done(value);
        } else done(true);
        modal.close(true);
      };
      ok.addEventListener("click", submit);
      modal.el.querySelector("[data-cancel]").addEventListener("click", () => modal.close());
      modal.el.addEventListener("keydown", event => {
        if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
          event.preventDefault();
          submit();
        }
      });
      setTimeout(() => (field || ok).focus(), 30);
    });
  }

  /* ------------------------------------------------ animated numbers */
  function animateNumber(el, to, format = num, duration = 650) {
    if (!el) return;
    const target = Number(to) || 0;
    const from = Number(el.dataset.value || 0);
    el.dataset.value = String(target);
    if (reducedMotion() || from === target) {
      el.textContent = format(target);
      return;
    }
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(from + (target - from) * eased);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function animateCounters(root = document) {
    root.querySelectorAll("[data-count]").forEach(el => {
      const format = el.dataset.format === "money" ? money : num;
      animateNumber(el, Number(el.dataset.count), format);
    });
  }

  /* ---------------------------------------------------------- effects */
  function celebrate(target) {
    if (!target || reducedMotion()) return;
    const rect = target.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    layer.style.left = `${rect.left + rect.width / 2}px`;
    layer.style.top = `${rect.top + rect.height / 2}px`;
    const colors = ["#f47b20", "#0d2b4f", "#ffb347", "#2fbf71", "#6c8cff"];
    for (let i = 0; i < 16; i++) {
      const piece = document.createElement("i");
      const angle = (Math.PI * 2 * i) / 16;
      const distance = 60 + Math.random() * 50;
      piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      piece.style.setProperty("--dy", `${Math.sin(angle) * distance - 20}px`);
      piece.style.background = colors[i % colors.length];
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1000);
  }
  function pulse(el) {
    if (!el || reducedMotion()) return;
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }

  /* ------------------------------------------------------------ theme */
  function safeGet(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  }
  function themePref() {
    return safeGet("bp-theme", "system");
  }
  function applyTheme(pref = themePref()) {
    safeSet("bp-theme", pref);
    const root = document.documentElement;
    if (pref === "light" || pref === "dark") root.dataset.theme = pref;
    else delete root.dataset.theme;
    root.classList.toggle("lite", safeGet("bp-effects", "full") === "lite");
    document.dispatchEvent(new CustomEvent("themechange"));
  }
  function isDark() {
    const pref = themePref();
    if (pref === "dark") return true;
    if (pref === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function setEffects(mode) {
    safeSet("bp-effects", mode);
    applyTheme();
  }

  function skeleton(rows = 4) {
    return `<div class="skeleton-list">${Array.from({ length: rows }, () => `<div class="skeleton-row"><span class="sk sk-circle"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span></div>`).join("")}</div>`;
  }
  function empty(iconName, title, text = "", action = "") {
    return `<div class="empty-state">${icon(iconName, 34)}<strong>${esc(title)}</strong>${text ? `<p>${text}</p>` : ""}${action}</div>`;
  }

  return {
    toast, openModal, closeTop, closeAll, hasModal, topModal, confirm,
    animateNumber, animateCounters, celebrate, pulse,
    applyTheme, themePref, isDark, setEffects, safeGet, safeSet,
    skeleton, empty, reducedMotion
  };
})();
const toast = UI.toast;
/* Each screen registers itself here: Views.pos = { render(root, params), refresh?() } */
const Views = {};
