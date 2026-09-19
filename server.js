const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Permissions = require("./lib/permissions");
const Stock = require("./lib/stock");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const IS_HOSTED_DEPLOYMENT = process.env.PORT || path.basename(ROOT).toLowerCase() === "nodejs";
const LEGACY_STORAGE_DIR = path.resolve(ROOT, "..", "pos-data");
const HOST_HOME_DIR = process.env.HOME && path.isAbsolute(process.env.HOME)
  ? process.env.HOME
  : null;
const DEFAULT_STORAGE_DIR = IS_HOSTED_DEPLOYMENT
  ? path.join(HOST_HOME_DIR || path.resolve(ROOT, "..", ".."), ".brands-planets-pos-data")
  : path.join(ROOT, "data");
const STORAGE_DIR = process.env.POS_DATA_DIR
  ? path.resolve(ROOT, process.env.POS_DATA_DIR)
  : DEFAULT_STORAGE_DIR;
const STORAGE_FILE = path.join(STORAGE_DIR, "pos-state.json");
const STORAGE_TEMP_FILE = path.join(STORAGE_DIR, "pos-state.tmp.json");
const AUTH_FILE = path.join(STORAGE_DIR, "auth.json");
const AUTH_TEMP_FILE = path.join(STORAGE_DIR, "auth.tmp.json");
const BACKUP_DIR = path.join(STORAGE_DIR, "backups");
const INITIAL_PASSWORD_FILE = path.join(STORAGE_DIR, "INITIAL_ADMIN_PASSWORD.txt");

const SCHEMA_VERSION = 2;
const DAILY_BACKUPS_KEPT = 30;
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 16 * 60 * 60 * 1000;
const SESSION_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUDIT_LOG_LIMIT = 5000;

const syncedCollections = [
  "users", "products", "bills", "attendance", "expenses", "staff", "stockHistory", "dayClosings", "notifications",
  "customers", "promotions", "heldSales", "returns", "stockMoves", "auditLog"
];
const deletedBuckets = [
  "products", "bills", "attendance", "expenses", "staff", "staffNames", "dayClosings", "users",
  "customers", "promotions", "heldSales"
];

/* ------------------------------------------------------------------ utils */

function ensurePersistentStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const legacyFile = path.join(LEGACY_STORAGE_DIR, "pos-state.json");
  if (!fs.existsSync(STORAGE_FILE) && LEGACY_STORAGE_DIR !== STORAGE_DIR && fs.existsSync(legacyFile)) {
    fs.copyFileSync(legacyFile, STORAGE_FILE, fs.constants.COPYFILE_EXCL);
  }
}

function noCacheHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "SAMEORIGIN",
    ...extra
  };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...noCacheHeaders()
  });
  res.end(status === 204 ? "" : JSON.stringify(body));
}

function readRequestBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req, limit) {
  const raw = await readRequestBody(req, limit);
  const payload = raw ? JSON.parse(raw) : {};
  if (!payload || typeof payload !== "object") throw new Error("Invalid JSON body");
  return payload;
}

function writeJsonAtomic(file, tempFile, data, mode) {
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tempFile, file);
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const uid = prefix => prefix + crypto.randomBytes(6).toString("hex");

/* --------------------------------------------------------------- backups */

function backupFile(name) {
  if (!fs.existsSync(STORAGE_FILE)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(target)) fs.copyFileSync(STORAGE_FILE, target);
  return target;
}

function dailyBackup() {
  try {
    if (!backupFile(`pos-state-${localDateKey()}.json`)) return;
    const daily = fs.readdirSync(BACKUP_DIR).filter(name => /^pos-state-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    daily.slice(0, Math.max(0, daily.length - DAILY_BACKUPS_KEPT)).forEach(name => fs.rmSync(path.join(BACKUP_DIR, name), { force: true }));
  } catch (error) {
    console.error("Daily backup failed:", error.message);
  }
}

/* ------------------------------------------------------------ state file */

function readStoredState() {
  ensurePersistentStorage();
  if (!fs.existsSync(STORAGE_FILE)) return null;
  const payload = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8"));
  return payload.state || payload;
}

function writeStoredState(state) {
  ensurePersistentStorage();
  dailyBackup();
  writeJsonAtomic(STORAGE_FILE, STORAGE_TEMP_FILE, { state, updatedAt: state.updatedAt });
}

/* ------------------------------------------------------------- auth file */

function readAuth() {
  ensurePersistentStorage();
  if (!fs.existsSync(AUTH_FILE)) return { credentials: {}, sessions: {} };
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  return { credentials: auth.credentials || {}, sessions: auth.sessions || {} };
}

function writeAuth(auth) {
  const now = Date.now();
  Object.entries(auth.sessions).forEach(([key, session]) => {
    if (session.expiresAt < now || now - session.lastSeen > SESSION_IDLE_MS) delete auth.sessions[key];
  });
  writeJsonAtomic(AUTH_FILE, AUTH_TEMP_FILE, auth, 0o600);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash, algo: "scrypt", updatedAt: new Date().toISOString() };
}

function verifyPassword(password, credential) {
  if (!credential?.salt || !credential?.hash) return false;
  const expected = Buffer.from(credential.hash, "hex");
  const actual = crypto.scryptSync(String(password), credential.salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const tokenKey = token => crypto.createHash("sha256").update(String(token)).digest("hex");

/* ------------------------------------------------------------- migration */

function emptyState() {
  const state = { updatedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, deleted: {}, settings: {} };
  syncedCollections.forEach(collection => { state[collection] = []; });
  deletedBuckets.forEach(bucket => { state.deleted[bucket] = []; });
  return state;
}

function publicUser(user) {
  if (!user) return null;
  const { password, passwordHash, ...rest } = user;
  return rest;
}

function appendAudit(state, entry) {
  state.auditLog = state.auditLog || [];
  const now = new Date().toISOString();
  state.auditLog.push({ id: uid("al"), date: now, updatedAt: now, source: "server", ...entry });
  if (state.auditLog.length > AUDIT_LOG_LIMIT) state.auditLog = state.auditLog.slice(-AUDIT_LOG_LIMIT);
}

/**
 * Upgrades stored data in place. Never deletes sales, customers or inventory;
 * a full backup is written before anything is changed.
 * Returns true when the state or auth store changed.
 */
function migrateStoredState(state, auth) {
  let changed = false;
  const now = new Date().toISOString();
  syncedCollections.forEach(collection => {
    if (!Array.isArray(state[collection])) { state[collection] = []; changed = true; }
  });
  state.deleted = state.deleted || {};
  deletedBuckets.forEach(bucket => {
    if (!Array.isArray(state.deleted[bucket])) { state.deleted[bucket] = []; changed = true; }
  });
  state.settings = state.settings || {};

  // Passwords move out of the synced state into a hashed credential store.
  state.users.forEach(user => {
    if (!user.id) { user.id = uid("u"); user.updatedAt = now; changed = true; }
    if (user.password !== undefined || user.passwordHash !== undefined) {
      if (user.password && !auth.credentials[user.id]) auth.credentials[user.id] = hashPassword(user.password);
      delete user.password;
      delete user.passwordHash;
      user.updatedAt = now;
      changed = true;
    }
    if (Permissions.migrateUserPermissions(user)) { user.updatedAt = now; changed = true; }
  });

  // Products move to the size/colour variant model with opening stock moves.
  const moveIds = new Set(state.stockMoves.map(move => move.id));
  state.products.forEach(product => {
    const { changed: productChanged, moves } = Stock.migrateProduct(product, now);
    if (!productChanged) return;
    product.updatedAt = now;
    moves.forEach(move => {
      if (!moveIds.has(move.id)) { state.stockMoves.push(move); moveIds.add(move.id); }
    });
    changed = true;
  });

  if (!Array.isArray(state.settings.outlets) || !state.settings.outlets.length) {
    state.settings.outlets = [{ id: "main", name: state.settings.shopName || "Brands Planets" }];
    state.settings.updatedAt = now;
    changed = true;
  }

  if (state.schemaVersion !== SCHEMA_VERSION) {
    state.schemaVersion = SCHEMA_VERSION;
    changed = true;
  }
  if (changed) state.updatedAt = now;
  return changed;
}

function ensureAdminAccess(state, auth) {
  const admins = state.users.filter(user => Permissions.isAdminRole(user.role) && user.active !== false);
  if (admins.some(user => auth.credentials[user.id])) return false;
  const password = process.env.POS_ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  let admin = admins[0];
  if (!admin) {
    const now = new Date().toISOString();
    admin = { id: "u-owner", username: "Admin", role: "Admin", active: true, createdAt: now, updatedAt: now };
    state.users.push(admin);
    state.updatedAt = now;
  }
  auth.credentials[admin.id] = hashPassword(password);
  if (!process.env.POS_ADMIN_PASSWORD) {
    fs.writeFileSync(INITIAL_PASSWORD_FILE, `Username: ${admin.username}\nPassword: ${password}\n\nSign in and change this password under Settings > Security, then delete this file.\n`, { mode: 0o600 });
    console.log(`Initial admin login written to ${INITIAL_PASSWORD_FILE}`);
  }
  return true;
}

function bootstrapStorage() {
  ensurePersistentStorage();
  const auth = readAuth();
  let state = readStoredState();
  const isNew = !state;
  if (isNew) state = emptyState();
  const needsMigration = !isNew && (state.schemaVersion !== SCHEMA_VERSION ||
    (state.users || []).some(user => user.password !== undefined || user.passwordHash !== undefined));
  if (needsMigration) {
    const backup = backupFile(`pos-state-before-v${SCHEMA_VERSION}-${Date.now()}.json`);
    if (backup) console.log(`Backup written before upgrade: ${backup}`);
  }
  const migrated = migrateStoredState(state, auth);
  const adminCreated = ensureAdminAccess(state, auth);
  if (isNew || migrated || adminCreated) writeStoredState(state);
  writeAuth(auth);
  if (migrated && !isNew) console.log("Stored POS data upgraded to schema version", SCHEMA_VERSION);
}

/* ------------------------------------------------------------- sessions */

function sessionFromRequest(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const auth = readAuth();
  const key = tokenKey(match[1].trim());
  const session = auth.sessions[key];
  const now = Date.now();
  if (!session || session.expiresAt < now || now - session.lastSeen > SESSION_IDLE_MS) return null;
  const state = readStoredState();
  const user = state?.users.find(item => item.id === session.userId);
  if (!user || user.active === false) return null;
  if (now - session.lastSeen > 5 * 60 * 1000) {
    session.lastSeen = now;
    writeAuth(auth);
  }
  const admin = Permissions.isAdminRole(user.role);
  return { key, user, admin, perms: Permissions.effectivePermissions(user) };
}

const loginAttempts = new Map();

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function loginLocked(key) {
  const entry = loginAttempts.get(key);
  return entry && entry.lockedUntil > Date.now() ? entry.lockedUntil : 0;
}

function recordLoginFailure(key) {
  const entry = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 30 * 1000;
    entry.count = 0;
  }
  loginAttempts.set(key, entry);
  return 5 - entry.count;
}

/* ----------------------------------------------------------- state merge */

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

function mergeRecordCollection(collection, storedRows = [], incomingRows = []) {
  const merged = new Map();
  storedRows.forEach(item => merged.set(syncRecordKey(collection, item), item));
  incomingRows.forEach(incomingItem => {
    const key = syncRecordKey(collection, incomingItem);
    if (!key || !merged.has(key)) {
      if (key) merged.set(key, incomingItem);
      return;
    }
    const storedItem = merged.get(key);
    const incomingTime = recordTimestamp(incomingItem);
    const storedTime = recordTimestamp(storedItem);
    if (incomingTime && (!storedTime || incomingTime > storedTime)) merged.set(key, incomingItem);
  });
  return [...merged.values()];
}

function appendOnly(collection, storedRows = [], incomingRows = [], accept = () => true) {
  const keys = new Set(storedRows.map(item => syncRecordKey(collection, item)));
  const merged = storedRows.slice();
  incomingRows.forEach(item => {
    const key = syncRecordKey(collection, item);
    if (!key || keys.has(key) || !accept(item)) return;
    keys.add(key);
    merged.push(item);
  });
  return merged;
}

function mergeDeletedRecords(storedDeleted = {}, incomingDeleted = {}, session = null) {
  const merged = {};
  deletedBuckets.forEach(bucket => {
    const allowed = !session || Permissions.canDeleteBucket(bucket, session.perms, session.admin);
    const incoming = allowed ? (incomingDeleted[bucket] || []) : [];
    merged[bucket] = bucket === "staffNames"
      ? []
      : Array.from(new Set([...(storedDeleted[bucket] || []), ...incoming].map(String)));
  });
  return merged;
}

function applyDeletedRecords(target) {
  const deleted = mergeDeletedRecords(target.deleted, {});
  const bucketByCollection = {
    users: "users",
    products: "products",
    bills: "bills",
    attendance: "attendance",
    expenses: "expenses",
    staff: "staff",
    dayClosings: "dayClosings",
    customers: "customers",
    promotions: "promotions",
    heldSales: "heldSales"
  };
  Object.entries(bucketByCollection).forEach(([collection, bucket]) => {
    target[collection] = (target[collection] || []).filter(item => !deleted[bucket].includes(syncRecordKey(collection, item)));
  });
  target.deleted = deleted;
  return target;
}

function stampBillCosts(state) {
  const costs = new Map(state.products.map(product => [product.id, Number(product.costPrice || 0)]));
  state.bills.forEach(bill => {
    if (bill.v !== 2 || !Array.isArray(bill.items)) return;
    bill.items.forEach(item => {
      if (item.cost === undefined && costs.has(item.id)) item.cost = costs.get(item.id);
    });
  });
}

function mergePosStates(storedState, incomingState, updatedAt, session) {
  const stored = storedState || emptyState();
  const merged = { ...stored, updatedAt };
  syncedCollections.forEach(collection => {
    const storedRows = stored[collection] || [];
    const incomingRows = Array.isArray(incomingState[collection]) ? incomingState[collection] : [];
    const policy = Permissions.collectionPolicy(collection, session.perms, session.admin);
    if (policy === "full") {
      merged[collection] = mergeRecordCollection(collection, storedRows, incomingRows);
    } else if (policy === "append") {
      const accept = collection === "stockMoves"
        ? move => Permissions.stockMoveAllowed(move, session.perms, session.admin) && move.productId
        : () => true;
      merged[collection] = appendOnly(collection, storedRows, incomingRows, accept);
    } else {
      merged[collection] = storedRows;
    }
  });
  merged.deleted = mergeDeletedRecords(stored.deleted, incomingState.deleted, session);
  if (session.admin || session.perms.includes("settings")) {
    const storedSettingsTime = recordTimestamp(stored.settings);
    const incomingSettingsTime = recordTimestamp(incomingState.settings);
    merged.settings = incomingSettingsTime > storedSettingsTime
      ? { ...(stored.settings || {}), ...(incomingState.settings || {}) }
      : { ...(incomingState.settings || {}), ...(stored.settings || {}) };
  } else {
    merged.settings = stored.settings || {};
  }
  merged.notifications = (merged.notifications || []).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 100);
  if (merged.auditLog.length > AUDIT_LOG_LIMIT) merged.auditLog = merged.auditLog.slice(-AUDIT_LOG_LIMIT);
  stampBillCosts(merged);
  return applyDeletedRecords(merged);
}

/** State as a given session may see it: never credentials, and no cost data without financial access. */
function publicState(state, session) {
  const financial = session.admin || session.perms.includes("financialReports");
  const view = { ...state, users: state.users.map(publicUser) };
  if (!financial) {
    view.products = state.products.map(({ costPrice, ...product }) => product);
    view.bills = state.bills.map(bill => Array.isArray(bill.items) && bill.v === 2
      ? { ...bill, items: bill.items.map(({ cost, ...item }) => item) }
      : bill);
  }
  return view;
}

/* -------------------------------------------------------------- handlers */

function sessionUserPayload(user) {
  return {
    ...publicUser(user),
    permissions: Permissions.effectivePermissions(user),
    isAdmin: Permissions.isAdminRole(user.role)
  };
}

async function handleLogin(req, res) {
  const { username, password, remember } = await readJsonBody(req, 64 * 1024);
  const cleanName = String(username || "").trim();
  const attemptKey = `${clientIp(req)}|${cleanName.toLowerCase()}`;
  const lockedUntil = loginLocked(attemptKey);
  if (lockedUntil) {
    return sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.` });
  }
  const state = readStoredState();
  const auth = readAuth();
  const user = state?.users.find(item => String(item.username || "").toLowerCase() === cleanName.toLowerCase());
  const valid = user && user.active !== false && verifyPassword(password || "", auth.credentials[user.id]);
  if (!valid) {
    const left = recordLoginFailure(attemptKey);
    if (state && user) {
      appendAudit(state, { user: cleanName, action: "auth.login_failed", entity: "user", entityId: user.id, detail: "Wrong password" });
      state.updatedAt = new Date().toISOString();
      writeStoredState(state);
    }
    return sendJson(res, 401, {
      error: loginLocked(attemptKey)
        ? "Account locked for 30 seconds after 5 wrong attempts."
        : `Invalid username or password. ${left} attempts remaining.`
    });
  }
  loginAttempts.delete(attemptKey);
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + (remember ? SESSION_REMEMBER_TTL_MS : SESSION_TTL_MS);
  auth.sessions[tokenKey(token)] = { userId: user.id, createdAt: now, lastSeen: now, expiresAt, ip: clientIp(req) };
  writeAuth(auth);
  appendAudit(state, { user: user.username, action: "auth.login", entity: "user", entityId: user.id, detail: `Signed in from ${clientIp(req)}` });
  state.updatedAt = new Date().toISOString();
  writeStoredState(state);
  return sendJson(res, 200, { token, expiresAt, user: sessionUserPayload(user) });
}

async function handleLogout(req, res, session) {
  const auth = readAuth();
  delete auth.sessions[session.key];
  writeAuth(auth);
  const state = readStoredState();
  appendAudit(state, { user: session.user.username, action: "auth.logout", entity: "user", entityId: session.user.id, detail: "Signed out" });
  state.updatedAt = new Date().toISOString();
  writeStoredState(state);
  return sendJson(res, 200, { ok: true });
}

async function handlePasswordChange(req, res, session) {
  const { userId, currentPassword, newPassword } = await readJsonBody(req, 64 * 1024);
  const targetId = userId || session.user.id;
  const auth = readAuth();
  const state = readStoredState();
  const target = state.users.find(user => user.id === targetId);
  if (!target) return sendJson(res, 404, { error: "User not found." });
  if (String(newPassword || "").length < 6) return sendJson(res, 400, { error: "New password must be at least 6 characters." });
  if (targetId === session.user.id) {
    if (!verifyPassword(currentPassword || "", auth.credentials[targetId])) return sendJson(res, 403, { error: "Current password is incorrect." });
  } else if (!(session.admin || session.perms.includes("users"))) {
    return sendJson(res, 403, { error: "You do not have permission to change other users' passwords." });
  } else if (Permissions.isAdminRole(target.role) && !session.admin) {
    return sendJson(res, 403, { error: "Only an admin can change an admin password." });
  }
  auth.credentials[targetId] = hashPassword(newPassword);
  // Sign the user out everywhere else.
  Object.entries(auth.sessions).forEach(([key, item]) => {
    if (item.userId === targetId && key !== session.key) delete auth.sessions[key];
  });
  writeAuth(auth);
  appendAudit(state, { user: session.user.username, action: "user.password_changed", entity: "user", entityId: targetId, detail: `Password changed for ${target.username}` });
  state.updatedAt = new Date().toISOString();
  writeStoredState(state);
  return sendJson(res, 200, { ok: true });
}

async function handleUserUpsert(req, res, session) {
  if (!(session.admin || session.perms.includes("users"))) return sendJson(res, 403, { error: "You do not have permission to manage users." });
  const { user: input, password } = await readJsonBody(req, 64 * 1024);
  const state = readStoredState();
  const auth = readAuth();
  const username = String(input?.username || "").trim();
  const role = Permissions.ROLES.includes(input?.role) ? input.role : "Cashier";
  if (!username) return sendJson(res, 400, { error: "Username is required." });
  if (state.users.some(user => user.id !== input.id && String(user.username).toLowerCase() === username.toLowerCase())) {
    return sendJson(res, 409, { error: "This username already exists." });
  }
  const existing = input.id ? state.users.find(user => user.id === input.id) : null;
  if (!existing && String(password || "").length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters." });
  if (password && String(password).length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters." });
  if (!session.admin && (role === "Admin" || Permissions.isAdminRole(existing?.role))) {
    return sendJson(res, 403, { error: "Only an admin can create or edit admin users." });
  }
  const activeAdmins = state.users.filter(user => Permissions.isAdminRole(user.role) && user.active !== false);
  const demotingLastAdmin = existing && Permissions.isAdminRole(existing.role) && activeAdmins.length === 1 &&
    (!Permissions.isAdminRole(role) || input.active === false);
  if (demotingLastAdmin) return sendJson(res, 400, { error: "At least one active admin is required." });

  const now = new Date().toISOString();
  const permissions = Array.isArray(input.permissions)
    ? input.permissions.filter(key => Permissions.PERMISSIONS[key])
    : [...Permissions.ROLE_DEFAULTS[role]];
  const record = {
    ...(existing || { id: uid("u"), createdAt: now, createdBy: session.user.username }),
    username,
    name: String(input.name || "").trim(),
    role: existing?.role === "Owner" && role === "Admin" ? "Owner" : role,
    active: input.active !== false,
    permissions,
    permVersion: 2,
    updatedAt: now
  };
  delete record.password;
  if (existing) Object.assign(existing, record);
  else state.users.push(record);
  state.deleted.users = (state.deleted.users || []).filter(id => id !== record.id);
  if (password) auth.credentials[record.id] = hashPassword(password);
  if (record.active === false) {
    Object.entries(auth.sessions).forEach(([key, item]) => { if (item.userId === record.id) delete auth.sessions[key]; });
  }
  writeAuth(auth);
  appendAudit(state, {
    user: session.user.username,
    action: existing ? "user.updated" : "user.created",
    entity: "user",
    entityId: record.id,
    detail: `${existing ? "Updated" : "Created"} ${Permissions.roleLabel(record.role)} "${username}"${record.active ? "" : " (disabled)"}${password && existing ? ", password reset" : ""}`
  });
  state.updatedAt = now;
  writeStoredState(state);
  return sendJson(res, 200, { ok: true, user: publicUser(record) });
}

async function handleUserDelete(req, res, session) {
  if (!(session.admin || session.perms.includes("users"))) return sendJson(res, 403, { error: "You do not have permission to manage users." });
  const { id } = await readJsonBody(req, 16 * 1024);
  const state = readStoredState();
  const target = state.users.find(user => user.id === id);
  if (!target) return sendJson(res, 404, { error: "User not found." });
  if (target.id === session.user.id) return sendJson(res, 400, { error: "You cannot delete your own account." });
  if (Permissions.isAdminRole(target.role)) {
    if (!session.admin) return sendJson(res, 403, { error: "Only an admin can delete an admin." });
    if (state.users.filter(user => Permissions.isAdminRole(user.role) && user.active !== false).length <= 1) {
      return sendJson(res, 400, { error: "At least one active admin is required." });
    }
  }
  const auth = readAuth();
  delete auth.credentials[id];
  Object.entries(auth.sessions).forEach(([key, item]) => { if (item.userId === id) delete auth.sessions[key]; });
  writeAuth(auth);
  state.deleted.users = Array.from(new Set([...(state.deleted.users || []), id]));
  state.users = state.users.filter(user => user.id !== id);
  appendAudit(state, { user: session.user.username, action: "user.deleted", entity: "user", entityId: id, detail: `Deleted user "${target.username}"` });
  state.updatedAt = new Date().toISOString();
  writeStoredState(state);
  return sendJson(res, 200, { ok: true });
}

async function handleStateGet(req, res, session) {
  const state = readStoredState();
  if (!state) return sendJson(res, 200, { state: null, updatedAt: null });
  const since = new URL(req.url, "http://local").searchParams.get("since");
  if (since && since === state.updatedAt) return sendJson(res, 200, { unchanged: true, updatedAt: state.updatedAt });
  const view = publicState(applyDeletedRecords(state), session);
  return sendJson(res, 200, { state: view, updatedAt: state.updatedAt });
}

async function handleStatePost(req, res, session) {
  const payload = await readJsonBody(req);
  if (!payload.state || typeof payload.state !== "object") return sendJson(res, 400, { error: "Invalid state payload" });
  const updatedAt = new Date().toISOString();
  const merged = mergePosStates(readStoredState(), payload.state, updatedAt, session);
  writeStoredState(merged);
  return sendJson(res, 200, { ok: true, updatedAt, state: publicState(merged, session) });
}

/* ---------------------------------------------------------------- static */

const PUBLIC_FILES = new Set(["/index.html", "/favicon.ico"]);
const PUBLIC_DIRS = ["/css/", "/js/", "/lib/", "/assets/"];

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const allowed = PUBLIC_FILES.has(requested) || PUBLIC_DIRS.some(dir => requested.startsWith(dir));
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!allowed || !filePath.startsWith(ROOT + path.sep) || requested.includes("..")) {
    res.writeHead(404, noCacheHeaders());
    return res.end("Not found");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, noCacheHeaders());
      res.end("Not found");
      return;
    }
    res.writeHead(200, noCacheHeaders({
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    }));
    res.end(data);
  });
}

/* ---------------------------------------------------------------- server */

const routes = {
  "POST /api/auth/logout": handleLogout,
  "GET /api/auth/me": (req, res, session) => sendJson(res, 200, { user: sessionUserPayload(session.user) }),
  "POST /api/auth/password": handlePasswordChange,
  "POST /api/users": handleUserUpsert,
  "POST /api/users/delete": handleUserDelete,
  "GET /api/state": handleStateGet,
  "POST /api/state": handleStatePost
};

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
  try {
    if (req.method === "OPTIONS") return sendJson(res, 204, {});

    if (pathname === "/api/health") {
      let storageReady = true;
      let storageError = "";
      try {
        ensurePersistentStorage();
        fs.accessSync(STORAGE_DIR, fs.constants.R_OK | fs.constants.W_OK);
      } catch (error) {
        storageReady = false;
        storageError = error.message;
      }
      return sendJson(res, 200, {
        ok: true,
        app: "Brands Planets POS",
        time: new Date().toISOString(),
        storageReady,
        dataFileExists: fs.existsSync(STORAGE_FILE),
        storageError
      });
    }

    if (pathname === "/api/auth/login" && req.method === "POST") return await handleLogin(req, res);

    const handler = routes[`${req.method} ${pathname}`];
    if (handler) {
      const session = sessionFromRequest(req);
      if (!session) return sendJson(res, 401, { error: "Please sign in again." });
      return await handler(req, res, session);
    }
    if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    return serveStatic(req, res);
  } catch (error) {
    [STORAGE_TEMP_FILE, AUTH_TEMP_FILE].forEach(file => { if (fs.existsSync(file)) fs.rmSync(file, { force: true }); });
    console.error(`${req.method} ${pathname} failed:`, error);
    return sendJson(res, error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? "Invalid JSON" : "Server error. Please try again." });
  }
});

// Start unconditionally: Hostinger's Node.js hosting loads this file through its own
// wrapper, so a `require.main === module` guard would stop the server from listening.
bootstrapStorage();
server.listen(PORT, HOST, () => {
  console.log(`Brands Planets POS running on http://${HOST}:${PORT}`);
  console.log(`Persistent POS state: ${STORAGE_FILE}`);
});
