const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");

// A data file in the pre-redesign format (plaintext passwords, product-level stock).
const legacyState = {
  users: [
    { id: "u-owner", username: "Admin", password: "owner-secret", role: "Owner", active: true },
    { id: "u-cashier", username: "cashier", password: "1234", role: "Cashier", active: true, permissions: ["dashboard", "billing", "reports", "attendance"] }
  ],
  products: [{ id: "p1", name: "Shirt", barcode: "1001", category: "MEN'S", price: 2500, stock: 7, discount: 10, image: "" }],
  bills: [{ id: "b1", date: "2026-01-01T10:00:00Z", cashier: "cashier", customerName: "Ali", customerPhone: "03001234567", items: [{ id: "p1", name: "Shirt", price: 2500, qty: 1, discount: 10 }], received: 2250, paymentMethod: "Cash" }],
  expenses: [], staff: [], attendance: [], stockHistory: [], dayClosings: [], notifications: [],
  deleted: {},
  settings: { shopName: "Brands Planets" }
};

async function startServer(dataDir, port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", POS_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => { if (String(chunk).includes("running on")) resolve(); });
    child.on("exit", code => reject(new Error(`server exited ${code}`)));
  });
  return child;
}

test("legacy data upgrades safely and the API is locked down", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-pos-test-"));
  fs.writeFileSync(path.join(dataDir, "pos-state.json"), JSON.stringify({ state: legacyState, updatedAt: "2026-01-01T00:00:00Z" }));
  const port = 3900 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer(dataDir, port);
  try {
    // Backup exists before migration and still holds the original data.
    const backups = fs.readdirSync(path.join(dataDir, "backups"));
    const before = backups.find(name => name.startsWith("pos-state-before-v2"));
    assert.ok(before, "pre-upgrade backup written");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "backups", before), "utf8")).state.bills.length, 1);

    // No plaintext passwords remain on disk in the synced state.
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "pos-state.json"), "utf8")).state;
    assert.ok(stored.users.every(user => user.password === undefined));
    assert.equal(stored.bills.length, 1, "sales kept");
    assert.equal(stored.products[0].invV2, true);
    assert.equal(stored.stockMoves.find(move => move.id === "mv-open-p1-v0").qty, 7, "stock carried over");

    // Unauthenticated access is refused; source files and data are not served.
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/data/pos-state.json`)).status, 404);
    assert.equal((await fetch(`${base}/.git/config`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200);

    // Existing passwords still work after hashing.
    const bad = await fetch(`${base}/api/auth/login`, { method: "POST", body: JSON.stringify({ username: "cashier", password: "nope" }) });
    assert.equal(bad.status, 401);
    const login = async (username, password) => (await (await fetch(`${base}/api/auth/login`, { method: "POST", body: JSON.stringify({ username, password }) })).json());
    const cashier = await login("cashier", "1234");
    assert.ok(cashier.token);
    assert.ok(cashier.user.permissions.includes("pos"));
    const admin = await login("admin", "owner-secret");
    assert.ok(admin.user.isAdmin);

    const get = token => fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    const post = (token, state) => fetch(`${base}/api/state`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ state }) }).then(r => r.json());

    const cashierView = await get(cashier.token);
    assert.ok(cashierView.state.users.every(user => user.password === undefined));
    assert.ok(cashierView.state.products.every(product => product.costPrice === undefined), "cost hidden from cashier");

    // Cashier cannot change prices, promotions, users, or delete sales...
    const tampered = JSON.parse(JSON.stringify(cashierView.state));
    tampered.products[0].price = 1;
    tampered.products[0].updatedAt = new Date(Date.now() + 60000).toISOString();
    tampered.promotions.push({ id: "promo-x", type: "bxgy", buyQty: 1, freeQty: 9 });
    tampered.users[1].role = "Admin";
    tampered.users[1].updatedAt = new Date(Date.now() + 60000).toISOString();
    tampered.deleted.bills = ["b1"];
    // ...but can record a sale with its stock move.
    tampered.bills.push({ id: "BP-TEST-1", v: 2, date: new Date().toISOString(), items: [{ id: "p1", variantId: "v0", name: "Shirt", price: 2500, qty: 1 }], total: 2500 });
    tampered.stockMoves.push({ id: "mv-sale-1", productId: "p1", variantId: "v0", qty: -1, type: "sale", ref: "BP-TEST-1" });
    tampered.stockMoves.push({ id: "mv-adj-1", productId: "p1", variantId: "v0", qty: 500, type: "adjust" });
    const afterCashier = (await post(cashier.token, tampered)).state;
    assert.equal(afterCashier.products[0].price, 2500);
    assert.equal(afterCashier.promotions.length, 0);
    assert.equal(afterCashier.users.find(user => user.id === "u-cashier").role, "Cashier");
    assert.ok(afterCashier.bills.some(bill => bill.id === "b1"), "sale not deleted");
    assert.ok(afterCashier.bills.some(bill => bill.id === "BP-TEST-1"), "new sale accepted");
    assert.ok(afterCashier.stockMoves.some(move => move.id === "mv-sale-1"));
    assert.ok(!afterCashier.stockMoves.some(move => move.id === "mv-adj-1"), "cashier stock adjustment rejected");

    // Re-sending the same sale (e.g. after reconnecting) never duplicates it.
    const again = (await post(cashier.token, tampered)).state;
    assert.equal(again.bills.filter(bill => bill.id === "BP-TEST-1").length, 1);
    assert.equal(again.stockMoves.filter(move => move.id === "mv-sale-1").length, 1);

    // Admin can create a user; the password is never returned.
    const created = await fetch(`${base}/api/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ user: { username: "manager1", role: "Manager" }, password: "manager-pass" })
    }).then(r => r.json());
    assert.equal(created.user.password, undefined);
    assert.ok((await login("manager1", "manager-pass")).token);

    // Cashier cannot create users.
    const denied = await fetch(`${base}/api/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cashier.token}` },
      body: JSON.stringify({ user: { username: "x", role: "Admin" }, password: "123456" })
    });
    assert.equal(denied.status, 403);

    // Logout invalidates the token.
    await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${cashier.token}` } });
    assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${cashier.token}` } })).status, 401);

    // Audit trail records logins.
    const audit = (await get(admin.token)).state.auditLog;
    assert.ok(audit.some(entry => entry.action === "auth.login" && entry.user === "cashier"));
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
