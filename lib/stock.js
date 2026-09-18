/*
 * Variant-level stock model (UMD), shared by the browser app and server.js.
 *
 * Stock is not stored as one number that every device overwrites. Instead each
 * change (opening stock, sale, return, exchange, cancellation, adjustment) is
 * an immutable "stock move" with a unique id. Current stock for a size/colour
 * variant is the sum of its moves, so sales made on several tills (or offline)
 * merge without ever losing a decrement.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BPStock = api;
})(typeof self !== "undefined" ? self : this, function () {
  const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const DEFAULT_VARIANT_ID = "v0";

  function openingMoveId(productId, variantId) {
    return `mv-open-${productId}-${variantId}`;
  }

  /**
   * Upgrades a pre-redesign product ({ stock, discount, ... }) to the variant
   * model. Opening move ids are deterministic so that the server and any
   * device migrating the same product produce the same record (no double
   * counting when they sync).
   */
  function migrateProduct(product, nowIso = new Date().toISOString()) {
    if (!product || product.invV2) return { changed: false, moves: [] };
    const hadVariants = Array.isArray(product.variants) && product.variants.length > 0;
    const variants = hadVariants
      ? product.variants.map((variant, index) => ({ ...variant, id: variant.id || `v${index}` }))
      : [{ id: DEFAULT_VARIANT_ID, size: "", color: "", sku: "", barcode: "" }];
    const moves = variants.map(variant => ({
      id: openingMoveId(product.id, variant.id),
      date: nowIso,
      productId: product.id,
      variantId: variant.id,
      qty: Number(hadVariants ? variant.stock : product.stock) || 0,
      type: "opening",
      ref: "upgrade",
      user: "system",
      note: "Opening stock carried over from the previous system"
    }));
    product.variants = variants.map(({ stock, ...variant }) => ({
      size: "", color: "", sku: "", barcode: "", ...variant
    }));
    if (!product.sku) product.sku = product.barcode || "";
    if (product.type === undefined) product.type = "";
    if (product.season === undefined) product.season = "All Season";
    if (product.costPrice === undefined) product.costPrice = 0;
    if (product.lowStockLevel === undefined) product.lowStockLevel = 5;
    if (product.active === undefined) product.active = true;
    product.invV2 = true;
    return { changed: true, moves };
  }

  function variantKey(productId, variantId) {
    return `${productId}::${variantId}`;
  }

  function buildStockIndex(moves) {
    const byVariant = new Map();
    const byProduct = new Map();
    (moves || []).forEach(move => {
      if (!move || !move.productId) return;
      const qty = Number(move.qty) || 0;
      const key = variantKey(move.productId, move.variantId || DEFAULT_VARIANT_ID);
      byVariant.set(key, (byVariant.get(key) || 0) + qty);
      byProduct.set(move.productId, (byProduct.get(move.productId) || 0) + qty);
    });
    return { byVariant, byProduct };
  }

  function variantStock(index, productId, variantId) {
    return index.byVariant.get(variantKey(productId, variantId || DEFAULT_VARIANT_ID)) || 0;
  }

  function productStock(index, product) {
    if (!product) return 0;
    return (product.variants || []).reduce((sum, variant) => sum + variantStock(index, product.id, variant.id), 0);
  }

  function stockStatus(qty, lowLevel) {
    if (qty <= 0) return "out";
    if (qty <= Math.max(0, Number(lowLevel ?? 5))) return "low";
    return "in";
  }

  function variantLabel(variant) {
    return [variant?.size, variant?.color].filter(Boolean).join(" / ");
  }

  return {
    SIZES,
    DEFAULT_VARIANT_ID,
    openingMoveId,
    migrateProduct,
    variantKey,
    buildStockIndex,
    variantStock,
    productStock,
    stockStatus,
    variantLabel
  };
});
