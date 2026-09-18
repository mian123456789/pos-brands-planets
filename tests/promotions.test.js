const test = require("node:test");
const assert = require("node:assert/strict");
const { applyPromotions, promotionStatus, isEligible } = require("../lib/promotions");

const b2g1 = {
  id: "promo-1",
  name: "Brands Planets Summer Deal",
  type: "bxgy",
  buyQty: 2,
  freeQty: 1,
  active: true,
  scope: { mode: "all" }
};
const always = { ignoreSchedule: true };

function line(key, price, qty = 1, extra = {}) {
  return { key, productId: key, name: key, price, qty, category: "MEN'S", type: "Shirts", season: "Summer", ...extra };
}

test("spec example: cheapest of three is free", () => {
  const result = applyPromotions([
    line("shirt", 2500),
    line("tshirt", 2000),
    line("trouser", 1800)
  ], [b2g1], always);
  assert.equal(result.subtotal, 6300);
  assert.equal(result.discount, 1800);
  assert.equal(result.total, 4500);
  assert.deepEqual(result.lineFree, { trouser: 1 });
  assert.equal(result.applied[0].freeItems[0].name, "trouser");
});

test("two eligible items: no discount, hint asks for one more", () => {
  const result = applyPromotions([line("a", 2500), line("b", 2000)], [b2g1], always);
  assert.equal(result.discount, 0);
  assert.equal(result.hints[0].needed, 1);
});

test("multiple sets: 3/6/9/12 items give 1/2/3/4 free", () => {
  for (const [count, freeExpected] of [[3, 1], [6, 2], [9, 3], [12, 4]]) {
    const lines = Array.from({ length: count }, (_, i) => line(`p${i}`, 1000 + i * 100));
    const result = applyPromotions(lines, [b2g1], always);
    assert.equal(result.applied[0].freeCount, freeExpected, `${count} items`);
  }
});

test("free units are always the globally cheapest eligible units", () => {
  const prices = [100, 90, 80, 70, 60, 50];
  const result = applyPromotions(prices.map((price, i) => line(`p${i}`, price)), [b2g1], always);
  // The two cheapest (60 + 50) are free, never the 80.
  assert.equal(result.discount, 110);
  assert.deepEqual(Object.keys(result.lineFree).sort(), ["p4", "p5"]);
});

test("quantity on one line counts as separate units", () => {
  const result = applyPromotions([line("jeans", 3000, 2), line("tee", 1500, 1)], [b2g1], always);
  assert.equal(result.discount, 1500);
  const same = applyPromotions([line("tee", 1500, 3)], [b2g1], always);
  assert.equal(same.discount, 1500);
  assert.deepEqual(same.lineFree, { tee: 1 });
});

test("ineligible and excluded products never become free", () => {
  const promo = { ...b2g1, scope: { mode: "filter", seasons: ["Summer"] }, excludeProductIds: ["excluded"] };
  const result = applyPromotions([
    line("a", 2500),
    line("b", 2000),
    line("winter", 500, 1, { season: "Winter" }),
    line("excluded", 400)
  ], [promo], always);
  assert.equal(result.discount, 0);
  const withThird = applyPromotions([
    line("a", 2500), line("b", 2000), line("c", 1900),
    line("winter", 500, 1, { season: "Winter" })
  ], [promo], always);
  assert.equal(withThird.discount, 1900);
});

test("max free products per invoice caps the discount", () => {
  const promo = { ...b2g1, maxFreePerInvoice: 1 };
  const result = applyPromotions(Array.from({ length: 6 }, (_, i) => line(`p${i}`, 1000 + i)), [promo], always);
  assert.equal(result.applied[0].freeCount, 1);
  assert.equal(result.discount, 1000);
  assert.equal(result.hints.length, 0);
});

test("minimum purchase value gates the deal", () => {
  const promo = { ...b2g1, minPurchase: 10000 };
  const result = applyPromotions([line("a", 2500), line("b", 2000), line("c", 1800)], [promo], always);
  assert.equal(result.discount, 0);
  assert.equal(result.hints[0].kind, "minPurchase");
  assert.equal(result.hints[0].needed, 3700);
});

test("schedule: dates and times in Karachi time", () => {
  const promo = { ...b2g1, startDate: "2026-06-01", startTime: "10:00", endDate: "2026-06-30", endTime: "22:00" };
  assert.equal(promotionStatus(promo, new Date("2026-06-01T04:59:00Z")), "scheduled"); // 09:59 PKT
  assert.equal(promotionStatus(promo, new Date("2026-06-01T05:00:00Z")), "live");      // 10:00 PKT
  assert.equal(promotionStatus(promo, new Date("2026-06-30T17:01:00Z")), "expired");   // 22:01 PKT
  assert.equal(promotionStatus({ ...promo, active: false }, new Date("2026-06-10T05:00:00Z")), "inactive");
  const lines = [line("a", 1), line("b", 1), line("c", 1)];
  assert.equal(applyPromotions(lines, [promo], { now: new Date("2026-07-02T05:00:00Z") }).discount, 0);
  assert.equal(applyPromotions(lines, [promo], { now: new Date("2026-06-02T05:00:00Z") }).discount, 1);
});

test("outlet selection", () => {
  const promo = { ...b2g1, outletIds: ["outlet-a"] };
  const lines = [line("a", 3), line("b", 2), line("c", 1)];
  assert.equal(applyPromotions(lines, [promo], { outletId: "outlet-b" }).discount, 0);
  assert.equal(applyPromotions(lines, [promo], { outletId: "outlet-a" }).discount, 1);
});

test("a unit is never used by two promotions", () => {
  const second = { ...b2g1, id: "promo-2", createdAt: "2099" };
  const result = applyPromotions([line("a", 300), line("b", 200), line("c", 100)], [b2g1, second], always);
  assert.equal(result.discount, 100);
  assert.equal(result.applied.length, 1);
});

test("eligibility by department, type and specific product", () => {
  const promo = { scope: { mode: "filter", departments: ["WOMEN"], types: ["jeans"], productIds: ["x"] } };
  assert.equal(isEligible(promo, { productId: "1", category: "WOMEN" }), true);
  assert.equal(isEligible(promo, { productId: "2", category: "MEN'S", type: "Jeans" }), true);
  assert.equal(isEligible(promo, { productId: "x", category: "MEN'S" }), true);
  assert.equal(isEligible(promo, { productId: "3", category: "MEN'S", type: "Shirts" }), false);
});
