const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const IS_HOSTED_DEPLOYMENT = process.env.PORT || path.basename(ROOT).toLowerCase() === "nodejs";
const DEFAULT_STORAGE_DIR = IS_HOSTED_DEPLOYMENT
  ? path.resolve(ROOT, "..", "pos-data")
  : path.join(ROOT, "data");
const STORAGE_DIR = process.env.POS_DATA_DIR
  ? path.resolve(ROOT, process.env.POS_DATA_DIR)
  : DEFAULT_STORAGE_DIR;
const STORAGE_FILE = path.join(STORAGE_DIR, "pos-state.json");
const STORAGE_TEMP_FILE = path.join(STORAGE_DIR, "pos-state.tmp.json");

function noCacheHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Surrogate-Control": "no-store",
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
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    ...noCacheHeaders()
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const syncedCollections = ["users", "products", "bills", "attendance", "expenses", "staff", "stockHistory", "dayClosings", "notifications"];
const deletedBuckets = ["products", "bills", "attendance", "expenses", "staff", "staffNames", "dayClosings", "users"];

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

function mergeDeletedRecords(storedDeleted = {}, incomingDeleted = {}) {
  const merged = {};
  deletedBuckets.forEach(bucket => {
    merged[bucket] = Array.from(new Set([...(storedDeleted[bucket] || []), ...(incomingDeleted[bucket] || [])].map(String)));
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
    dayClosings: "dayClosings"
  };
  Object.entries(bucketByCollection).forEach(([collection, bucket]) => {
    target[collection] = (target[collection] || []).filter(item => !deleted[bucket].includes(syncRecordKey(collection, item)));
  });
  target.deleted = deleted;
  return target;
}

function mergePosStates(storedState, incomingState, updatedAt) {
  if (!storedState) return applyDeletedRecords({ ...incomingState, updatedAt });
  const storedSettingsTime = recordTimestamp(storedState.settings);
  const incomingSettingsTime = recordTimestamp(incomingState.settings);
  const merged = {
    ...incomingState,
    ...storedState,
    updatedAt,
    deleted: mergeDeletedRecords(storedState.deleted, incomingState.deleted),
    settings: incomingSettingsTime > storedSettingsTime
      ? { ...(storedState.settings || {}), ...(incomingState.settings || {}) }
      : { ...(incomingState.settings || {}), ...(storedState.settings || {}) }
  };
  syncedCollections.forEach(collection => {
    merged[collection] = mergeRecordCollection(collection, storedState[collection], incomingState[collection]);
  });
  merged.notifications = (merged.notifications || []).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 100);
  return applyDeletedRecords(merged);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, noCacheHeaders({
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    }));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.url.split("?")[0] === "/api/health") {
    let storageReady = true;
    let storageError = "";
    try {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
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

  if (req.url.split("?")[0] === "/api/state") {
    if (req.method === "GET") {
      try {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
        if (!fs.existsSync(STORAGE_FILE)) {
          return sendJson(res, 200, { state: null, updatedAt: null });
        }
        const storedState = fs.readFileSync(STORAGE_FILE);
        res.writeHead(200, noCacheHeaders({
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }));
        return res.end(storedState);
      } catch (error) {
        console.error("State read failed:", error);
        return sendJson(res, 500, {
          error: "Persistent POS storage is unavailable.",
          detail: error.message
        });
      }
    }

    if (req.method === "POST") {
      try {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
        const payload = JSON.parse(await readRequestBody(req));
        if (!payload || typeof payload !== "object" || !payload.state || typeof payload.state !== "object") {
          return sendJson(res, 400, { error: "Invalid state payload" });
        }
        const updatedAt = new Date().toISOString();
        let storedState = null;
        if (fs.existsSync(STORAGE_FILE)) {
          const storedPayload = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8"));
          storedState = storedPayload.state || storedPayload;
        }
        const mergedState = mergePosStates(storedState, payload.state, updatedAt);
        const storedPayload = {
          state: mergedState,
          updatedAt
        };
        fs.writeFileSync(STORAGE_TEMP_FILE, JSON.stringify(storedPayload, null, 2));
        fs.renameSync(STORAGE_TEMP_FILE, STORAGE_FILE);
        return sendJson(res, 200, { ok: true, updatedAt, state: mergedState });
      } catch (error) {
        if (fs.existsSync(STORAGE_TEMP_FILE)) fs.rmSync(STORAGE_TEMP_FILE, { force: true });
        console.error("State save failed:", error);
        return sendJson(res, 400, { error: error.message });
      }
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Brands Planets POS running on http://${HOST}:${PORT}`);
  console.log(`Persistent POS state: ${STORAGE_FILE}`);
});
