const API_BASE = "http://127.0.0.1:8000/api";
let authToken = "";
let loginInProgress = false;

function syncTokenFromStorage() {
  if (!authToken) {
    authToken = localStorage.getItem("entracte_token") || "";
  }
  return authToken;
}
let loadingCount = 0;

function loadingStart(message) {
  loadingCount++;
  const el = document.getElementById("global-loading");
  const text = document.getElementById("loading-text");
  if (text && message) text.textContent = message;
  el?.classList.remove("hidden");
}

function loadingEnd() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) document.getElementById("global-loading")?.classList.add("hidden");
}

function currentLogPage() {
  return window.__currentPage || "login";
}

async function postActivityLog(payload) {
  if (payload.action?.startsWith("POST /activity-logs")) return;
  const page = payload.page || currentLogPage();
  const body = { ...payload, page };

  try {
    if (!authToken && (page === "login" || page === "system")) {
      body.username = body.username || window.__loginUsername || "system";
      await fetch(`${API_BASE}/activity-logs/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        auth: false,
      });
      return;
    }
    if (!authToken) return;
    await fetch(`${API_BASE}/activity-logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${syncTokenFromStorage()}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* never block UI for logging */
  }
}

function logApiStep(method, endpoint, statusCode, errorMessage = null, details = null) {
  if (endpoint.startsWith("/activity-logs")) return;
  postActivityLog({
    action: `${method} ${endpoint}`,
    page: currentLogPage(),
    status_code: statusCode,
    error_message: errorMessage,
    details,
  });
}

async function api(endpoint, options = {}) {
  const silent = options.silent;
  const loadingMessage = options.loadingMessage;
  const skipSessionHandler = options.skipSessionHandler;
  const skipActivityLog = options.skipActivityLog;
  const method = (options.method || "GET").toUpperCase();
  const opts = { ...options };
  delete opts.silent;
  delete opts.loadingMessage;
  delete opts.skipSessionHandler;
  delete opts.skipActivityLog;

  if (!silent) loadingStart(loadingMessage || "Loading...");

  const isPublic = opts.auth === false;
  const headers = { ...opts.headers };
  if (!(opts.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  syncTokenFromStorage();
  const hadToken = !!authToken;
  if (authToken && !isPublic) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const config = { ...opts, headers };
  delete config.auth;

  try {
    if (config.body && typeof config.body === "object" && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    let res;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, config);
    } catch (networkErr) {
      const msg = "Cannot reach server. Wait a few seconds and try again, or restart the app.";
      if (!skipActivityLog) logApiStep(method, endpoint, 0, msg, networkErr.message || null);
      throw new Error(msg);
    }

    if (res.status === 401) {
      const isLogin = endpoint === "/auth/login";
      if (isPublic || isLogin) {
        const err = await res.json().catch(() => ({ detail: "Invalid username or password" }));
        const msg = typeof err.detail === "string" ? err.detail : "Invalid username or password";
        if (!skipActivityLog && isLogin) logApiStep(method, endpoint, 401, msg);
        throw new Error(msg);
      }
      const errBody = await res.json().catch(() => ({}));
      const detail = typeof errBody.detail === "string" ? errBody.detail : "Session expired";
      if (!skipActivityLog) logApiStep(method, endpoint, 401, detail);
      if (hadToken && !loginInProgress && !skipSessionHandler) {
        authToken = "";
        localStorage.removeItem("entracte_token");
        if (typeof window.onSessionExpired === "function") {
          window.onSessionExpired("Session expired. Please sign in again.");
        }
        throw new Error("Session expired. Please sign in again.");
      }
      throw new Error(detail === "Not authenticated" ? "Not signed in. Please log in again." : detail);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      if (res.status === 409 && err.detail && typeof err.detail === "object") {
        const msg = err.detail.message || "Shift does not balance";
        if (!skipActivityLog) logApiStep(method, endpoint, 409, msg);
        const e = new Error(msg);
        e.code = 409;
        e.reconcile = err.detail;
        throw e;
      }
      let msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
      if (res.status === 404) msg = `API not found (${endpoint}). Restart the app to load the latest server.`;
      if (res.status === 500) msg = msg || "Internal server error. Check server logs.";
      if (!skipActivityLog) logApiStep(method, endpoint, res.status, msg || "Request failed");
      throw new Error(msg || "Request failed");
    }

    if (!skipActivityLog) logApiStep(method, endpoint, res.status);

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/csv")) return res.blob();
    if (res.status === 204) return null;
    return res.json();
  } finally {
    if (!silent) loadingEnd();
  }
}

function setToken(token) {
  authToken = token;
  localStorage.setItem("entracte_token", token);
}

function clearToken() {
  authToken = "";
  localStorage.removeItem("entracte_token");
}

async function downloadCsv(endpoint, filename) {
  const blob = await api(endpoint);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

window.entracteAPI = {
  setToken, clearToken, getToken: () => syncTokenFromStorage(),
  setLoginInProgress: (v) => { loginInProgress = !!v; },
  logApiStep,
  login: async (username, password) => {
    loginInProgress = true;
    window.__loginUsername = username;
    try {
      clearToken();
      const res = await api("/auth/login", {
        method: "POST",
        body: { username, password },
        auth: false,
      });
      if (!res?.token) throw new Error("Login failed: server did not return a session token.");
      setToken(res.token);
      await api("/auth/me");
      return res;
    } finally {
      loginInProgress = false;
    }
  },
  me: () => api("/auth/me"),
  updateProfile: (data) => api("/auth/profile", { method: "PUT", body: data, loadingMessage: "Saving profile..." }),
  getCategories: () => api("/categories"),
  getProducts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/products${qs ? "?" + qs : ""}`);
  },
  getProductByBarcode: (barcode) => api(`/products/barcode/${barcode}`),
  createProduct: (data) => api("/products", { method: "POST", body: data }),
  updateProduct: (id, data) => api(`/products/${id}`, { method: "PUT", body: data }),
  deleteProduct: (id) => api(`/products/${id}`, { method: "DELETE" }),
  importCsv: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return api("/products/import-csv", { method: "POST", body: fd });
  },
  exportInventory: () => downloadCsv("/products/export-csv", "inventory.csv"),
  exportOrders: () => downloadCsv("/orders/export-csv", "orders.csv"),
  exportOutOfStock: () => downloadCsv("/out-of-stock/export-csv", "out_of_stock.csv"),
  getOutOfStock: () => api("/out-of-stock"),
  deleteOutOfStock: (id) => api(`/out-of-stock/${id}`, { method: "DELETE" }),
  clearOutOfStock: () => api("/out-of-stock", { method: "DELETE" }),
  getEmployees: () => api("/employees"),
  createEmployee: (data) => api("/employees", { method: "POST", body: data }),
  updateEmployee: (id, data) => api(`/employees/${id}`, { method: "PUT", body: data }),
  resetPassword: (id, password) => api(`/employees/${id}/reset-password`, { method: "POST", body: { password } }),
  deleteEmployee: (id) => api(`/employees/${id}`, { method: "DELETE" }),
  createOrder: (data) => api("/orders", { method: "POST", body: data, loadingMessage: "Processing sale..." }),
  getOrders: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    });
    return api(`/orders${qs.toString() ? `?${qs}` : ""}`);
  },
  getOrder: (id) => api(`/orders/${id}`),
  printOrder: (id) => api(`/orders/${id}/print`, { method: "POST" }),
  getDashboard: () => api("/reports/dashboard"),
  getTopProducts: () => api("/reports/top-products"),
  getSalesByDay: (days = 7) => api(`/reports/sales-by-day?days=${days}`),
  getCashierSales: (days = 30) => api(`/reports/cashier-sales?days=${days}`),
  getShiftReports: (days = 30, employeeId = null) => {
    const qs = new URLSearchParams({ days });
    if (employeeId) qs.set("employee_id", employeeId);
    return api(`/cash-sessions?${qs}`);
  },
  getShops: () => api("/shops"),
  createShop: (data) => api("/shops", { method: "POST", body: data }),
  updateShop: (id, data) => api(`/shops/${id}`, { method: "PUT", body: data }),
  deleteShop: (id) => api(`/shops/${id}`, { method: "DELETE" }),
  getCurrentSession: () => api("/cash-sessions/current", { silent: true, skipSessionHandler: true, skipActivityLog: true }),
  openSession: (data) => api("/cash-sessions/open", { method: "POST", body: data }),
  closeSession: (data) => api("/cash-sessions/close", { method: "POST", body: data }),
  reconcileSession: (closingCash, closingCard = 0, closingMobile = 0) =>
    api(`/cash-sessions/reconcile?closing_cash=${closingCash}&closing_card=${closingCard}&closing_mobile=${closingMobile}`),
  getPrinters: () => api("/printers"),
  getSettings: () => api("/settings"),
  updateSettings: (data) => api("/settings", { method: "PUT", body: data, loadingMessage: "Saving settings..." }),
  previewReceipt: (data) => api("/receipt/preview", { method: "POST", body: data }),
  getQuotations: (limit = 50) => api(`/quotations?limit=${limit}`),
  getQuotation: (id) => api(`/quotations/${id}`),
  createQuotation: (data) => api("/quotations", { method: "POST", body: data, loadingMessage: "Saving quotation..." }),
  updateQuotation: (id, data) => api(`/quotations/${id}`, { method: "PUT", body: data, loadingMessage: "Saving quotation..." }),
  printQuotation: (id) => api(`/quotations/${id}/print`, { method: "POST" }),
  getActivityLogs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/activity-logs${qs ? "?" + qs : ""}`);
  },
  logActivity: (data) => api("/activity-logs", { method: "POST", body: data, silent: true, skipSessionHandler: true, skipActivityLog: true }),
  health: () => api("/health", { auth: false, silent: true, skipActivityLog: true }),
};
