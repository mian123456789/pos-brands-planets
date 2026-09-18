/* Role-based permissions shared by the browser app and server.js (UMD). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BPPermissions = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PERMISSIONS = {
    dashboard: "Dashboard",
    pos: "New Sale / POS (incl. hold & resume)",
    sales: "Sales History",
    customers: "Customers",
    products: "Products",
    inventory: "Inventory",
    returns: "Returns / Exchanges",
    promotions: "Create & Edit Promotions",
    expenses: "Expenses",
    reports: "Reports",
    financialReports: "Sensitive Financials (profit, cost price)",
    attendance: "Attendance",
    dayclose: "Day Close",
    staff: "Staff Roster",
    users: "Users & Roles",
    settings: "System Settings",
    changePrices: "Change Product Prices",
    stockAdjust: "Stock Adjustments",
    editSales: "Edit Sale Payment Details",
    cancelSales: "Cancel Sales",
    deleteSales: "Delete Sales",
    viewAudit: "Activity Log"
  };

  const ROLES = ["Admin", "Manager", "Cashier"];

  const ROLE_DEFAULTS = {
    Admin: Object.keys(PERMISSIONS),
    Manager: [
      "dashboard", "pos", "sales", "customers", "products", "inventory", "returns",
      "expenses", "reports", "financialReports", "attendance",
      "changePrices", "stockAdjust", "editSales", "cancelSales"
    ],
    Cashier: ["dashboard", "pos", "sales", "customers", "attendance", "expenses"]
  };

  // Permission keys used before the redesign, mapped to the new keys so that
  // anything an admin granted a cashier earlier is still granted now.
  const LEGACY_MAP = {
    dashboard: ["dashboard"],
    billing: ["pos", "customers"],
    reports: ["sales", "reports"],
    attendance: ["attendance"],
    expenses: ["expenses"],
    staff: ["staff"],
    inventory: ["inventory", "products", "changePrices", "stockAdjust"],
    dayclose: ["dayclose"]
  };

  function isAdminRole(role) {
    return role === "Admin" || role === "Owner";
  }

  function roleLabel(role) {
    return role === "Owner" ? "Admin" : (role || "Cashier");
  }

  function migrateUserPermissions(user) {
    if (!user || isAdminRole(user.role) || user.permVersion === 2) return false;
    const legacy = Array.isArray(user.permissions) ? user.permissions : null;
    const mapped = legacy
      ? Array.from(new Set(legacy.flatMap(key => LEGACY_MAP[key] || (PERMISSIONS[key] ? [key] : []))))
      : [...(ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.Cashier)];
    user.permissions = mapped;
    user.permVersion = 2;
    return true;
  }

  function effectivePermissions(user) {
    if (!user) return [];
    if (isAdminRole(user.role)) return Object.keys(PERMISSIONS);
    if (user.permVersion === 2 && Array.isArray(user.permissions)) {
      return user.permissions.filter(key => PERMISSIONS[key]);
    }
    const copy = { ...user };
    migrateUserPermissions(copy);
    return copy.permissions;
  }

  function hasPermission(user, key) {
    return effectivePermissions(user).includes(key);
  }

  /*
   * How a synced collection may be written by a session with the given
   * permissions. "full" = create/modify, "append" = only new records,
   * "none" = incoming changes are ignored by the server.
   */
  function collectionPolicy(collection, perms, admin) {
    const has = key => admin || perms.includes(key);
    switch (collection) {
      case "users": return "none"; // only through /api/users
      case "products": return has("products") || has("inventory") ? "full" : "none";
      case "promotions": return has("promotions") ? "full" : "none";
      case "bills": return has("editSales") || has("cancelSales") ? "full" : has("pos") ? "append" : "none";
      case "returns": return has("returns") ? "append" : "none";
      case "stockMoves": return "append"; // filtered per move type below
      case "customers": return has("customers") || has("pos") ? "full" : "none";
      case "heldSales": return has("pos") ? "full" : "none";
      case "expenses": return has("expenses") ? "full" : "none";
      case "staff": return has("staff") ? "full" : "none";
      case "dayClosings": return admin || has("dayclose") ? "full" : "none";
      case "attendance": return "full";
      case "stockHistory":
      case "notifications":
      case "auditLog": return "append";
      default: return "none";
    }
  }

  function stockMoveAllowed(move, perms, admin) {
    if (admin) return true;
    const has = key => perms.includes(key);
    switch (move?.type) {
      case "sale": return has("pos");
      case "cancel": return has("cancelSales");
      case "return":
      case "exchange-in":
      case "exchange-out": return has("returns");
      case "opening":
      case "adjust": return has("stockAdjust") || has("products");
      default: return false;
    }
  }

  const DELETE_PERMISSION = {
    products: "products",
    bills: "deleteSales",
    expenses: "expenses",
    staff: "staff",
    customers: "customers",
    promotions: "promotions",
    heldSales: "pos",
    dayClosings: "dayclose",
    attendance: "__admin__",
    users: "__never__",
    staffNames: "__never__"
  };

  function canDeleteBucket(bucket, perms, admin) {
    const key = DELETE_PERMISSION[bucket];
    if (key === "__never__") return false;
    if (admin) return true;
    if (!key || key === "__admin__") return false;
    return perms.includes(key);
  }

  return {
    PERMISSIONS,
    ROLES,
    ROLE_DEFAULTS,
    isAdminRole,
    roleLabel,
    migrateUserPermissions,
    effectivePermissions,
    hasPermission,
    collectionPolicy,
    stockMoveAllowed,
    canDeleteBucket
  };
});
