/*
 * Promotion engine (UMD) shared by the POS, returns/exchanges and tests.
 *
 * Supported type: "bxgy" (Buy X Get Y Free). Every eligible unit in the cart
 * is counted; for each complete group of (buy + free) units, `free` units
 * become free. The free units are always the CHEAPEST eligible units in the
 * whole cart, so an expensive product can never be made free while a cheaper
 * eligible one is paid for.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BPPromotions = api;
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_TIME_ZONE = "Asia/Karachi";

  function lower(value) {
    return String(value || "").trim().toLowerCase();
  }

  function localParts(date, timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA-u-ca-gregory", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).map(part => [part.type, part.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}:${parts.second}`
    };
  }

  function normalizeTime(value, fallback) {
    const text = String(value || "").trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return fallback;
    return text.length === 5 ? `${text}:00` : text;
  }

  /** "live" | "scheduled" | "expired" | "inactive" */
  function promotionStatus(promo, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    if (!promo || promo.active === false) return "inactive";
    const current = localParts(now, timeZone);
    const stamp = `${current.date} ${current.time}`;
    if (promo.startDate) {
      const start = `${promo.startDate} ${normalizeTime(promo.startTime, "00:00:00")}`;
      if (stamp < start) return "scheduled";
    }
    if (promo.endDate) {
      const end = `${promo.endDate} ${normalizeTime(promo.endTime, "23:59:59")}`;
      if (stamp > end) return "expired";
    }
    return "live";
  }

  function promotionAppliesToOutlet(promo, outletId) {
    const outlets = Array.isArray(promo?.outletIds) ? promo.outletIds.filter(Boolean) : [];
    return !outlets.length || !outletId || outlets.includes(outletId);
  }

  /** item: { productId, category, type, season } */
  function isEligible(promo, item) {
    if (!promo || !item) return false;
    if ((promo.excludeProductIds || []).includes(item.productId)) return false;
    const scope = promo.scope || { mode: "all" };
    if (scope.mode !== "filter") return true;
    if ((scope.productIds || []).includes(item.productId)) return true;
    if ((scope.departments || []).includes(item.category)) return true;
    if ((scope.types || []).map(lower).includes(lower(item.type))) return true;
    if ((scope.seasons || []).map(lower).includes(lower(item.season))) return true;
    return false;
  }

  function validBxgy(promo) {
    const buy = Math.floor(Number(promo?.buyQty));
    const free = Math.floor(Number(promo?.freeQty));
    return promo?.type === "bxgy" && buy >= 1 && free >= 1;
  }

  function orderPromotions(promotions) {
    return promotions.slice().sort((a, b) =>
      (Number(a.priority || 0) - Number(b.priority || 0)) ||
      String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
      String(a.id || "").localeCompare(String(b.id || "")));
  }

  function livePromotions(promotions, options = {}) {
    const now = options.now || new Date();
    const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
    return orderPromotions((promotions || []).filter(promo =>
      validBxgy(promo) &&
      (options.ignoreSchedule || (promotionStatus(promo, now, timeZone) === "live" && promotionAppliesToOutlet(promo, options.outletId)))
    ));
  }

  /**
   * lines: [{ key, productId, name, price, qty, category, type, season, size, color }]
   * Returns totals plus which units are free and hints for the cashier.
   */
  function applyPromotions(lines, promotions, options = {}) {
    const cleanLines = (lines || []).map(line => ({
      ...line,
      price: Math.max(0, Number(line.price || 0)),
      qty: Math.max(0, Math.floor(Number(line.qty || 0)))
    }));
    const subtotal = cleanLines.reduce((sum, line) => sum + line.price * line.qty, 0);
    const remaining = new Map(cleanLines.map(line => [line.key, line.qty]));
    const lineFree = {};
    const applied = [];
    const hints = [];
    const eligibleKeys = new Set();

    for (const promo of livePromotions(promotions, options)) {
      const buy = Math.floor(Number(promo.buyQty));
      const free = Math.floor(Number(promo.freeQty));
      const group = buy + free;
      const maxFree = Math.max(0, Math.floor(Number(promo.maxFreePerInvoice || 0)));
      const minPurchase = Math.max(0, Number(promo.minPurchase || 0));

      const units = [];
      cleanLines.forEach(line => {
        if (!isEligible(promo, line)) return;
        eligibleKeys.add(line.key);
        const available = remaining.get(line.key) || 0;
        for (let i = 0; i < available; i++) units.push(line);
      });
      if (!units.length) continue;

      if (minPurchase && subtotal < minPurchase) {
        hints.push({ promoId: promo.id, name: promo.name, kind: "minPurchase", needed: minPurchase - subtotal });
        continue;
      }

      // Most expensive first; ties broken by line key so results are stable.
      units.sort((a, b) => (b.price - a.price) || String(a.key).localeCompare(String(b.key)));
      const count = units.length;
      let sets = Math.floor(count / group);
      let freeCount = sets * free;
      let capped = false;
      if (maxFree && freeCount >= maxFree) {
        capped = true;
        if (freeCount > maxFree) {
          freeCount = maxFree;
          sets = Math.ceil(maxFree / free);
        }
      }

      if (freeCount > 0) {
        const freeUnits = units.slice(count - freeCount);
        const buyUnits = units.slice(0, sets * buy);
        [...buyUnits, ...freeUnits].forEach(unit => remaining.set(unit.key, remaining.get(unit.key) - 1));
        const freeByLine = new Map();
        freeUnits.forEach(unit => {
          lineFree[unit.key] = (lineFree[unit.key] || 0) + 1;
          const entry = freeByLine.get(unit.key) || { key: unit.key, productId: unit.productId, name: unit.name, size: unit.size || "", color: unit.color || "", price: unit.price, qty: 0 };
          entry.qty += 1;
          freeByLine.set(unit.key, entry);
        });
        applied.push({
          promoId: promo.id,
          name: promo.name,
          type: promo.type,
          buyQty: buy,
          freeQty: free,
          sets,
          freeCount,
          saving: freeUnits.reduce((sum, unit) => sum + unit.price, 0),
          freeItems: [...freeByLine.values()]
        });
      }

      if (!capped) {
        const leftover = count - Math.floor(count / group) * group;
        if (leftover > 0) {
          hints.push({ promoId: promo.id, name: promo.name, kind: "moreItems", needed: group - leftover, unlocked: sets });
        }
      }
    }

    const discount = applied.reduce((sum, promo) => sum + promo.saving, 0);
    return {
      subtotal,
      discount,
      total: Math.max(0, subtotal - discount),
      applied,
      hints,
      lineFree,
      eligibleKeys: [...eligibleKeys]
    };
  }

  function promoLabel(promo) {
    if (!promo) return "";
    return `BUY ${Math.floor(Number(promo.buyQty || 0))} GET ${Math.floor(Number(promo.freeQty || 0))} FREE`;
  }

  return {
    DEFAULT_TIME_ZONE,
    promotionStatus,
    promotionAppliesToOutlet,
    isEligible,
    livePromotions,
    applyPromotions,
    promoLabel
  };
});
