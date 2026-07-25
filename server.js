const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "data");
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
    return sendJson(res, 200, {
      ok: true,
      app: "Brands Planets POS",
      time: new Date().toISOString()
    });
  }

  if (req.url.split("?")[0] === "/api/state") {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    if (req.method === "GET") {
      if (!fs.existsSync(STORAGE_FILE)) {
        return sendJson(res, 200, { state: null, updatedAt: null });
      }
      res.writeHead(200, noCacheHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }));
      return fs.createReadStream(STORAGE_FILE).pipe(res);
    }

    if (req.method === "POST") {
      try {
        const payload = JSON.parse(await readRequestBody(req));
        if (!payload || typeof payload !== "object" || !payload.state || typeof payload.state !== "object") {
          return sendJson(res, 400, { error: "Invalid state payload" });
        }
        const updatedAt = new Date().toISOString();
        const storedPayload = {
          state: { ...payload.state, updatedAt },
          updatedAt
        };
        fs.writeFileSync(STORAGE_TEMP_FILE, JSON.stringify(storedPayload, null, 2));
        fs.renameSync(STORAGE_TEMP_FILE, STORAGE_FILE);
        return sendJson(res, 200, { ok: true, updatedAt });
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
});
