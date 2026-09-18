const test = require("node:test");
const assert = require("node:assert/strict");
const stock = require("../lib/stock");
const perms = require("../lib/permissions");

test("legacy product migrates to one default variant with an opening move", () => {
  const product = { id: "p1", name: "Shirt", barcode: "1001", stock: 12, discount: 10 };
  const { changed, moves } = stock.migrateProduct(product);
  assert.equal(changed, true);
  assert.equal(product.invV2, true);
  assert.equal(product.variants.length, 1);
  assert.equal(product.sku, "1001");
  assert.equal(moves[0].id, "mv-open-p1-v0");
  assert.equal(moves[0].qty, 12);
  assert.equal(stock.migrateProduct(product).changed, false);
});

test("stock is the sum of moves per variant", () => {
  const product = { id: "p", variants: [{ id: "m" }, { id: "l" }] };
  const index = stock.buildStockIndex([
    { productId: "p", variantId: "m", qty: 10 },
    { productId: "p", variantId: "l", qty: 15 },
    { productId: "p", variantId: "m", qty: -2 },
    { productId: "p", variantId: "l", qty: -1 },
    { productId: "p", variantId: "m", qty: 1 }
  ]);
  assert.equal(stock.variantStock(index, "p", "m"), 9);
  assert.equal(stock.variantStock(index, "p", "l"), 14);
  assert.equal(stock.productStock(index, product), 23);
  assert.equal(stock.stockStatus(0, 5), "out");
  assert.equal(stock.stockStatus(3, 5), "low");
  assert.equal(stock.stockStatus(9, 5), "in");
});

test("legacy cashier permissions map onto the new keys", () => {
  const user = { role: "Cashier", permissions: ["dashboard", "billing", "reports", "attendance"] };
  perms.migrateUserPermissions(user);
  assert.equal(user.permVersion, 2);
  for (const key of ["dashboard", "pos", "customers", "sales", "reports", "attendance"]) {
    assert.ok(user.permissions.includes(key), key);
  }
  assert.ok(!user.permissions.includes("changePrices"));
  assert.ok(!user.permissions.includes("financialReports"));
  assert.ok(!user.permissions.includes("deleteSales"));
});

test("owner is always a full admin", () => {
  assert.ok(perms.hasPermission({ role: "Owner" }, "settings"));
  assert.ok(perms.hasPermission({ role: "Admin" }, "promotions"));
  assert.ok(!perms.hasPermission({ role: "Cashier", permVersion: 2, permissions: ["pos"] }, "promotions"));
});

test("server write policy protects prices, users and sale deletion", () => {
  const cashier = perms.ROLE_DEFAULTS.Cashier;
  assert.equal(perms.collectionPolicy("users", cashier, false), "none");
  assert.equal(perms.collectionPolicy("products", cashier, false), "none");
  assert.equal(perms.collectionPolicy("promotions", cashier, false), "none");
  assert.equal(perms.collectionPolicy("bills", cashier, false), "append");
  assert.equal(perms.canDeleteBucket("bills", cashier, false), false);
  assert.equal(perms.stockMoveAllowed({ type: "sale" }, cashier, false), true);
  assert.equal(perms.stockMoveAllowed({ type: "adjust" }, cashier, false), false);
  assert.equal(perms.collectionPolicy("promotions", [], true), "full");
});
