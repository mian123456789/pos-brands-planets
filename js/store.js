/*
 * Local state, cloud sync and authentication.
 *
 * Data model is the same JSON state the POS has always used (users, products,
 * bills, attendance, expenses, staff, stockHistory, dayClosings,
 * notifications, settings) plus: customers, promotions, heldSales, returns,
 * stockMoves (variant stock ledger) and auditLog. Records merge by id and
 * `updatedAt` exactly as before, so offline work syncs without duplicates.
 */
const API_BASE_URL = window.location.origin;
const SYNCED_COLLECTIONS = [
  "users", "products", "bills", "attendance", "expenses", "staff", "stockHistory", "dayClosings", "notifications",
  "customers", "promotions", "heldSales", "returns", "stockMoves", "auditLog"
];
const DELETED_BUCKETS = [
  "products", "bills", "attendance", "expenses", "staff", "staffNames", "dayClosings", "users",
  "customers", "promotions", "heldSales"
];
const DEFAULT_SETTINGS = {
  shopName: "Brands Planets",
  phone: "",
  address: "",
  email: "",
  receiptFooter: "Thank you for shopping with Brands Planets.",
  receiptFooterAlign: "center",
  receiptFooterDivider: true,
  receiptFooterEnabled: true,
  autoPrint: false,
  logo: "",
  cloudMode: false,
  outlets: [{ id: "main", name: "Brands Planets" }],
  sessionTimeoutMinutes: 30,
  lowStockDefault: 5
};
const LS = {
  state: "bp-pos-state",
  localUpdatedAt: "bp-pos-local-updated-at",
  session: "bp-session",
  offlineAuth: "bp-offline-auth",
  dirty: "bp-dirty-records",
  fullPushDone: "bp-full-push-v2",
  remoteUpdatedAt: "bp-remote-updated-at",
  outlet: "bp-outlet",
  deviceCode: "bp-device-code",
  invoiceSeq: "bp-invoice-seq",
  rememberUser: "bp-remember-user"
};

function blankState() {
  const target = { settings: { ...DEFAULT_SETTINGS }, deleted: {} };
  SYNCED_COLLECTIONS.forEach(collection => { target[collection] = []; });
  DELETED_BUCKETS.forEach(bucket => { target.deleted[bucket] = []; });
  return target;
}

function readJson(storage, key, fallback = null) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

let state = readJson(localStorage, LS.state) || blankState();
let session = readJson(localStorage, LS.session) || readJson(sessionStorage, LS.session);
let persistedStateSnapshot = null;

/* ------------------------------------------------------ normalization */
function normalizeDeletedRecords(target = state) {
  target.deleted = target.deleted || {};
  DELETED_BUCKETS.forEach(bucket => {
    target.deleted[bucket] = bucket === "staffNames"
      ? []
      : Array.from(new Set((target.deleted[bucket] || []).map(String)));
  });
  return target.deleted;
}
function recordKey(item) {
  return String(item?.id || item?.date || "");
}
function applyDeletedRecords(target = state) {
  const deleted = normalizeDeletedRecords(target);
  ["products", "bills", "attendance", "expenses", "staff", "dayClosings", "users", "customers", "promotions", "heldSales"].forEach(collection => {
    if (Array.isArray(target[collection])) target[collection] = target[collection].filter(item => !deleted[collection].includes(recordKey(item)));
  });
}
function markDeleted(bucket, value) {
  if (!value) return;
  const deleted = normalizeDeletedRecords(state);
  if (!deleted[bucket].includes(String(value))) deleted[bucket].push(String(value));
}

/**
 * Brings any state (local cache, older version, or server) into the current
 * shape. Never removes business records. Migration output is not stamped with
 * `updatedAt`, so the server's own (identical) migration always wins a merge.
 */
function normalizeState(target = state) {
  SYNCED_COLLECTIONS.forEach(collection => {
    if (!Array.isArray(target[collection])) target[collection] = [];
  });
  normalizeDeletedRecords(target);
  applyDeletedRecords(target);
  target.settings = { ...DEFAULT_SETTINGS, ...(target.settings || {}) };
  if (!Array.isArray(target.settings.outlets) || !target.settings.outlets.length) {
    target.settings.outlets = [{ id: "main", name: target.settings.shopName || "Brands Planets" }];
  }
  target.users.forEach(user => {
    delete user.password;
    delete user.passwordHash;
    BPPermissions.migrateUserPermissions(user);
  });
  const moveIds = new Set(target.stockMoves.map(move => move.id));
  target.products.forEach(product => {
    const { moves } = BPStock.migrateProduct(product);
    moves.forEach(move => {
      if (!moveIds.has(move.id)) { target.stockMoves.push(move); moveIds.add(move.id); }
    });
  });
  target.notifications = target.notifications.filter(item => item && item.id).slice(0, 100);
  target.staff = target.staff.filter(staff => staff.id !== "s-cashier" && !["Default staff", "Cashier login"].includes(staff.remarks));
  target.attendance.forEach(record => { if (!record.id) record.id = uid("a"); });
  return target;
}

/* ------------------------------------------------------------ caches */
let caches = {};
function invalidateCaches() { caches = {}; }
function stockIndex() {
  if (!caches.stock) caches.stock = BPStock.buildStockIndex(state.stockMoves);
  return caches.stock;
}
function productMap() {
  if (!caches.products) caches.products = new Map(state.products.map(product => [product.id, product]));
  return caches.products;
}
const productById = id => productMap().get(id);
const variantStock = (productId, variantId) => BPStock.variantStock(stockIndex(), productId, variantId);
const productStock = product => BPStock.productStock(stockIndex(), product);
function barcodeMap() {
  if (!caches.barcodes) {
    const map = new Map();
    state.products.forEach(product => {
      if (product.active === false) return;
      (product.variants || []).forEach(variant => {
        [variant.barcode, variant.sku].filter(Boolean).forEach(code => map.set(String(code).toLowerCase(), { product, variant }));
      });
      const first = (product.variants || [])[0];
      [product.barcode, product.sku].filter(Boolean).forEach(code => {
        const key = String(code).toLowerCase();
        if (!map.has(key)) map.set(key, { product, variant: null, fallback: first });
      });
    });
    caches.barcodes = map;
  }
  return caches.barcodes;
}

/* ------------------------------------------------------- permissions */
const currentUser = () => session?.user || null;
function isAdmin() {
  return BPPermissions.isAdminRole(currentUser()?.role);
}
function can(key) {
  const user = currentUser();
  if (!user) return false;
  const stored = state.users.find(item => item.id === user.id);
  return BPPermissions.hasPermission(stored || user, key);
}

/* ------------------------------------------------------------- audit */
function audit(action, entity, entityId, detail) {
  const now = new Date().toISOString();
  state.auditLog.push({
    id: uid("al"),
    date: now,
    user: currentUser()?.username || "system",
    userId: currentUser()?.id || "",
    outlet: currentOutlet().name,
    action,
    entity,
    entityId: String(entityId || ""),
    detail
  });
  if (state.auditLog.length > 5000) state.auditLog = state.auditLog.slice(-5000);
}
function addAdminNotification(notification) {
  state.notifications.unshift({ id: uid("n"), audience: "Owner", read: false, date: new Date().toISOString(), ...notification });
  state.notifications = state.notifications.slice(0, 100);
}

/* ----------------------------------------------------------- outlets */
function currentOutlet() {
  const outlets = state.settings?.outlets?.length ? state.settings.outlets : DEFAULT_SETTINGS.outlets;
  const saved = UI.safeGet(LS.outlet);
  return outlets.find(outlet => outlet.id === saved) || outlets[0];
}
function setCurrentOutlet(id) {
  UI.safeSet(LS.outlet, id);
  document.dispatchEvent(new CustomEvent("outletchange"));
}

/* ---------------------------------------------------- invoice numbers */
function deviceCode() {
  let code = UI.safeGet(LS.deviceCode);
  if (!code) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    code = Array.from(crypto.getRandomValues(new Uint8Array(2)), byte => alphabet[byte % alphabet.length]).join("");
    UI.safeSet(LS.deviceCode, code);
  }
  return code;
}
/** Human-friendly and unique across tills without a network round-trip: BP-260918-K7-004 */
function nextInvoiceId() {
  const day = todayKey();
  const seq = readJson(localStorage, LS.invoiceSeq, {});
  let n = seq.date === day ? Number(seq.n || 0) : 0;
  const ids = new Set(state.bills.map(bill => bill.id));
  let id;
  do {
    n += 1;
    id = `BP-${day.slice(2).replaceAll("-", "")}-${deviceCode()}-${String(n).padStart(3, "0")}`;
  } while (ids.has(id));
  UI.safeSet(LS.invoiceSeq, JSON.stringify({ date: day, n }));
  return id;
}

/* -------------------------------------------------------------- sync */
const Sync = {
  status: navigator.onLine ? "synced" : "offline",
  lastSyncAt: null,
  saveTimer: null,
  pullInFlight: false,
  pushInFlight: false,
  pushQueued: false
};
function setSyncStatus(status) {
  if (Sync.status === status) return;
  Sync.status = status;
  document.dispatchEvent(new CustomEvent("syncchange", { detail: status }));
}

function comparableValue(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const copy = Array.isArray(value) ? value.map(item => ({ ...item })) : { ...value };
  if (!Array.isArray(copy)) delete copy.updatedAt;
  else copy.forEach(item => { if (item && typeof item === "object") delete item.updatedAt; });
  return JSON.stringify(copy);
}
function syncRecordKey(collection, item) {
  if (!item) return "";
  if (item.id) return String(item.id);
  if (collection === "dayClosings") return String(item.date || "");
  if (collection === "stockHistory") return [item.date, item.product, item.change, item.user, item.remarks].join("|");
  return String(item.date || "");
}
function recordTimestamp(item) {
  const value = item?.updatedAt || item?.editedAt || (String(item?.id || "").startsWith("n") ? item.date : "");
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
function rememberPersistedState() {
  persistedStateSnapshot = JSON.parse(JSON.stringify(state));
}
/*
 * Records changed on this device since the last successful push. Tracked
 * explicitly (not by timestamp) so clock differences between tills and the
 * server can never cause missed or endlessly repeated uploads.
 */
let dirty = readJson(localStorage, LS.dirty, {});
let dirtyCounter = Date.now();
function markDirty(collection, key) {
  dirty[collection] = dirty[collection] || {};
  dirty[collection][key] = ++dirtyCounter;
}
function stampChangedRecords(now) {
  SYNCED_COLLECTIONS.forEach(collection => {
    const previous = new Map((persistedStateSnapshot?.[collection] || []).map(item => [syncRecordKey(collection, item), item]));
    (state[collection] || []).forEach(item => {
      const key = syncRecordKey(collection, item);
      const oldItem = previous.get(key);
      if (!oldItem || comparableValue(oldItem) !== comparableValue(item)) {
        item.updatedAt = now;
        markDirty(collection, key);
      }
    });
  });
  if (comparableValue(persistedStateSnapshot?.settings || {}) !== comparableValue(state.settings || {})) {
    state.settings.updatedAt = now;
    markDirty("__settings", "settings");
  }
  if (comparableValue(persistedStateSnapshot?.deleted || {}) !== comparableValue(state.deleted || {})) {
    markDirty("__deleted", "deleted");
  }
}
function mergeRecordCollection(collection, localRows = [], remoteRows = []) {
  const merged = new Map();
  remoteRows.forEach(item => merged.set(syncRecordKey(collection, item), item));
  localRows.forEach(localItem => {
    const key = syncRecordKey(collection, localItem);
    if (!key || !merged.has(key)) {
      if (key) merged.set(key, localItem);
      return;
    }
    const remoteItem = merged.get(key);
    const localTime = recordTimestamp(localItem);
    const remoteTime = recordTimestamp(remoteItem);
    if (localTime && (!remoteTime || localTime > remoteTime)) merged.set(key, localItem);
  });
  return [...merged.values()];
}
function persistLocal() {
  try {
    localStorage.setItem(LS.dirty, JSON.stringify(dirty));
    localStorage.setItem(LS.state, JSON.stringify(state));
    localStorage.setItem(LS.localUpdatedAt, state.updatedAt || "");
  } catch (error) {
    console.error("Local save failed", error);
    toast("This device's storage is full. Stay online so sales keep syncing to the server.", "error");
  }
}

function save({ immediate = false } = {}) {
  normalizeDeletedRecords(state);
  applyDeletedRecords(state);
  const now = new Date().toISOString();
  stampChangedRecords(now);
  state.updatedAt = now;
  persistLocal();
  rememberPersistedState();
  invalidateCaches();
  document.dispatchEvent(new CustomEvent("statechange", { detail: { local: true } }));
  if (immediate) return pushCloudState();
  queueCloudSave();
  return Promise.resolve(true);
}
function queueCloudSave() {
  clearTimeout(Sync.saveTimer);
  setSyncStatus(navigator.onLine && session?.token ? "syncing" : Sync.status === "auth" ? "auth" : "offline");
  Sync.saveTimer = setTimeout(() => {
    Sync.saveTimer = null;
    pushCloudState();
  }, 700);
}

function mergeState(remoteState) {
  if (!remoteState || !Array.isArray(remoteState.users) || !Array.isArray(remoteState.products)) return false;
  normalizeState(remoteState);
  const remoteSettingsTime = recordTimestamp(remoteState.settings);
  const localSettingsTime = recordTimestamp(state.settings);
  const merged = {
    ...remoteState,
    settings: localSettingsTime > remoteSettingsTime
      ? { ...DEFAULT_SETTINGS, ...(remoteState.settings || {}), ...(state.settings || {}) }
      : { ...DEFAULT_SETTINGS, ...(state.settings || {}), ...(remoteState.settings || {}) },
    deleted: {},
    updatedAt: [state.updatedAt, remoteState.updatedAt].filter(Boolean).sort().pop() || new Date().toISOString()
  };
  SYNCED_COLLECTIONS.forEach(collection => {
    merged[collection] = mergeRecordCollection(collection, state[collection], remoteState[collection]);
  });
  merged.notifications = merged.notifications.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 100);
  DELETED_BUCKETS.forEach(bucket => {
    merged.deleted[bucket] = Array.from(new Set([...(state.deleted?.[bucket] || []), ...(remoteState.deleted?.[bucket] || [])].map(String)));
  });
  applyDeletedRecords(merged);
  state = merged;
  persistLocal();
  rememberPersistedState();
  invalidateCaches();
  return true;
}

async function api(path, { method = "GET", body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Server responded ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (!error.status) error.network = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function handleSyncError(error) {
  if (error.status === 401) {
    setSyncStatus("auth");
    document.dispatchEvent(new CustomEvent("sessionexpired"));
  } else {
    setSyncStatus("offline");
  }
}

function buildPushPayload() {
  const full = UI.safeGet(LS.fullPushDone) !== session?.user?.id;
  const sent = JSON.parse(JSON.stringify(dirty));
  const delta = { updatedAt: state.updatedAt, deleted: state.deleted };
  SYNCED_COLLECTIONS.forEach(collection => {
    const keys = sent[collection] || {};
    delta[collection] = full ? state[collection] : state[collection].filter(item => keys[syncRecordKey(collection, item)]);
  });
  delta.settings = full || sent.__settings ? state.settings : {};
  return { delta, full, sent };
}
function clearSentDirty(sent) {
  Object.entries(sent).forEach(([collection, keys]) => {
    Object.entries(keys).forEach(([key, counter]) => {
      if (dirty[collection]?.[key] === counter) delete dirty[collection][key];
    });
    if (dirty[collection] && !Object.keys(dirty[collection]).length) delete dirty[collection];
  });
  UI.safeSet(LS.dirty, JSON.stringify(dirty));
}

async function pushCloudState() {
  if (!session?.token) {
    setSyncStatus(session?.offline ? "auth" : "offline");
    return false;
  }
  if (Sync.pushInFlight) {
    Sync.pushQueued = true;
    return false;
  }
  Sync.pushInFlight = true;
  setSyncStatus("syncing");
  try {
    const { delta, full, sent } = buildPushPayload();
    const payload = await api("/api/state", { method: "POST", body: { state: delta }, timeout: 30000 });
    clearSentDirty(sent);
    if (full) UI.safeSet(LS.fullPushDone, session.user.id);
    if (payload.state) {
      mergeState(payload.state);
      UI.safeSet(LS.remoteUpdatedAt, payload.updatedAt || "");
    }
    Sync.lastSyncAt = new Date().toISOString();
    setSyncStatus("synced");
    document.dispatchEvent(new CustomEvent("statechange", { detail: { remote: true } }));
    return true;
  } catch (error) {
    handleSyncError(error);
    return false;
  } finally {
    Sync.pushInFlight = false;
    if (Sync.pushQueued) {
      Sync.pushQueued = false;
      queueCloudSave();
    }
  }
}

async function pullCloudState() {
  if (!session?.token || Sync.pullInFlight || Sync.pushInFlight || Sync.saveTimer) return false;
  Sync.pullInFlight = true;
  try {
    const since = UI.safeGet(LS.remoteUpdatedAt);
    const payload = await api(`/api/state${since ? `?since=${encodeURIComponent(since)}` : ""}`);
    Sync.lastSyncAt = new Date().toISOString();
    if (payload.unchanged) {
      setSyncStatus(hasUnsyncedChanges() ? "syncing" : "synced");
      if (hasUnsyncedChanges()) queueCloudSave();
      return false;
    }
    if (!payload.state) {
      setSyncStatus("synced");
      return false;
    }
    mergeState(payload.state);
    UI.safeSet(LS.remoteUpdatedAt, payload.updatedAt || "");
    setSyncStatus("synced");
    if (hasUnsyncedChanges()) queueCloudSave();
    document.dispatchEvent(new CustomEvent("statechange", { detail: { remote: true } }));
    return true;
  } catch (error) {
    handleSyncError(error);
    return false;
  } finally {
    Sync.pullInFlight = false;
  }
}
function hasUnsyncedChanges() {
  if (UI.safeGet(LS.fullPushDone) !== session?.user?.id) return true;
  return Object.keys(dirty).length > 0;
}
async function syncNow() {
  setSyncStatus("syncing");
  const pushed = await pushCloudState();
  if (pushed) toast("Synced ✓", "success");
  else toast(Sync.status === "auth" ? "Sign in again to sync." : "Offline. Sales are saved on this device and will sync automatically.", "warn");
  return pushed;
}

/* -------------------------------------------------------------- auth */
function persistSession() {
  localStorage.removeItem(LS.session);
  sessionStorage.removeItem(LS.session);
  if (!session) return;
  (session.remember ? localStorage : sessionStorage).setItem(LS.session, JSON.stringify(session));
}
async function derivePasswordHash(password, saltHex) {
  const encoder = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/../g).map(hex => parseInt(hex, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 }, key, 256);
  return [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function rememberOfflineLogin(username, password, user) {
  if (!crypto.subtle) return;
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const hash = await derivePasswordHash(password, salt);
  const store = readJson(localStorage, LS.offlineAuth, {});
  store[username.toLowerCase()] = { salt, hash, user, savedAt: new Date().toISOString() };
  localStorage.setItem(LS.offlineAuth, JSON.stringify(store));
}
async function verifyOfflineLogin(username, password) {
  const entry = readJson(localStorage, LS.offlineAuth, {})[username.toLowerCase()];
  if (!entry || !crypto.subtle) return null;
  const hash = await derivePasswordHash(password, entry.salt);
  if (hash !== entry.hash) return null;
  const localUser = state.users.find(user => user.id === entry.user.id);
  if (localUser && localUser.active === false) return null;
  return { ...entry.user, ...(localUser || {}), permissions: BPPermissions.effectivePermissions(localUser || entry.user) };
}

async function login(username, password, remember) {
  try {
    const payload = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password, remember })
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || "Sign in failed.");
        error.status = response.status;
        throw error;
      }
      return body;
    });
    session = { token: payload.token, user: payload.user, remember: Boolean(remember), loginAt: new Date().toISOString() };
    persistSession();
    rememberOfflineLogin(username, password, payload.user).catch(() => {});
    return { ok: true };
  } catch (error) {
    if (error.status) return { ok: false, error: error.message };
    // Server unreachable: allow users who signed in on this device before.
    const offlineUser = await verifyOfflineLogin(username, password);
    if (!offlineUser) return { ok: false, error: "Can't reach the server, and this user hasn't signed in on this device before." };
    session = { token: null, offline: true, user: offlineUser, remember: false, loginAt: new Date().toISOString() };
    persistSession();
    return { ok: true, offline: true };
  }
}
async function reauthenticate(password) {
  const user = currentUser();
  const result = await login(user.username, password, session?.remember);
  if (result.ok && !result.offline) {
    setSyncStatus("syncing");
    pushCloudState();
  }
  return result;
}
async function logout() {
  if (session?.token) {
    try { await api("/api/auth/logout", { method: "POST", timeout: 4000 }); } catch { /* offline: token expires on the server */ }
  }
  session = null;
  persistSession();
}
async function refreshSessionUser() {
  if (!session?.token) return;
  try {
    const { user } = await api("/api/auth/me");
    session.user = user;
    persistSession();
  } catch (error) {
    if (error.status === 401) handleSyncError(error);
  }
}

normalizeState(state);
rememberPersistedState();
