const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "data");
const STORAGE_FILE = path.join(STORAGE_DIR, "pos-state.json");

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
    "Access-Control-Allow-Headers": "Content-Type, Accept"
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
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600"
    });
    res.end(data);
  });
}

async function sendSmsViaProvider({ to, sender, message }) {
  const smsApiUrl = process.env.SMS_API_URL;
  if (!smsApiUrl) {
    return { ok: false, skipped: true, error: "SMS_API_URL is not configured" };
  }

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  if (process.env.SMS_API_TOKEN) headers.Authorization = `Bearer ${process.env.SMS_API_TOKEN}`;
  if (process.env.SMS_API_KEY) headers["x-api-key"] = process.env.SMS_API_KEY;

  const providerPayload = {
    to,
    from: process.env.SMS_SENDER || sender || "Brands Planets",
    sender: process.env.SMS_SENDER || sender || "Brands Planets",
    message
  };

  const response = await fetch(smsApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(providerPayload)
  });
  const providerText = await response.text();
  if (!response.ok) {
    throw new Error(`SMS provider failed with status ${response.status}: ${providerText.slice(0, 200)}`);
  }
  return { ok: true, status: response.status };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.url.split("?")[0] === "/api/send-sms") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

    try {
      const payload = JSON.parse(await readRequestBody(req));
      const to = String(payload.to || payload.phone || "").trim();
      const sender = String(payload.sender || "Brands Planets").trim();
      const message = String(payload.message || "").trim();
      if (!to || !message) return sendJson(res, 400, { error: "Phone number and message are required" });

      const result = await sendSmsViaProvider({ to, sender, message });
      if (result.skipped) return sendJson(res, 501, { error: result.error });
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.url.split("?")[0] === "/api/state") {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });

    if (req.method === "GET") {
      if (!fs.existsSync(STORAGE_FILE)) {
        return sendJson(res, 200, { state: null, updatedAt: null });
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      return fs.createReadStream(STORAGE_FILE).pipe(res);
    }

    if (req.method === "POST") {
      try {
        const payload = JSON.parse(await readRequestBody(req));
        if (!payload || typeof payload !== "object" || !payload.state || typeof payload.state !== "object") {
          return sendJson(res, 400, { error: "Invalid state payload" });
        }
        payload.updatedAt = payload.updatedAt || new Date().toISOString();
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(payload, null, 2));
        return sendJson(res, 200, { ok: true, updatedAt: payload.updatedAt });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Brands Planets POS running on http://localhost:${PORT}`);
});
