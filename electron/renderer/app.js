const state = {
  user: null,
  settings: null,
  cart: [],
  quoteCart: [],
  quoteView: "list",
  editingQuoteId: null,
  quotePageSize: "a4",
  posView: "grid",
  paymentMethod: "cash",
  cashSession: null,
  products: [],
  categories: [],
  selectedCategory: null,
  productsCache: null,
  ordersShopId: null,
  inventoryShopId: null,
  ordersSort: "date-desc",
};

const ADMIN_NAV = [
  { page: "pos", label: "Checkout", icon: "shopping-cart" },
  { page: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { page: "inventory", label: "Inventory", icon: "package" },
  { page: "out-of-stock", label: "Out of Stock", icon: "package-x" },
  { page: "orders", label: "Orders", icon: "receipt" },
  { page: "quotations", label: "Quotations", icon: "file-text" },
  { page: "shops", label: "Shops", icon: "store" },
  { page: "users", label: "Team", icon: "users" },
  { page: "logs", label: "Logs", icon: "scroll-text" },
  { page: "settings", label: "Settings", icon: "settings" },
];

const CASHIER_NAV = [
  { page: "pos", label: "Checkout", icon: "shopping-cart" },
  { page: "orders", label: "Orders", icon: "receipt" },
  { page: "quotations", label: "Quotations", icon: "file-text" },
  { page: "settings", label: "Settings", icon: "settings" },
];

function isSessionError(err) {
  const msg = err?.message || "";
  return msg.includes("Session expired") || msg.includes("Not authenticated");
}

function forceLogout(message) {
  entracteAPI.clearToken();
  state.user = null;
  state.cart = [];
  state.cashSession = null;
  closeModal();
  document.getElementById("main-app")?.classList.add("hidden");
  document.getElementById("login-screen")?.classList.remove("hidden");
  const errEl = document.getElementById("login-error");
  if (errEl && message) {
    errEl.textContent = message;
    errEl.classList.remove("hidden");
  }
  const btn = document.getElementById("login-btn");
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = "<span>Sign in</span>";
  }
}

window.onSessionExpired = (msg) => forceLogout(msg);

function isAdmin() { return state.user?.role === "admin"; }

function logActivity(action, page, details = null, statusCode = null, errorMessage = null) {
  if (!entracteAPI.getToken() || !state.user) return;
  entracteAPI.logActivity({
    action,
    page,
    details: details || null,
    status_code: statusCode,
    error_message: errorMessage,
  }).catch(() => {});
}

function formatLogStatus(code) {
  if (code === null || code === undefined) return '<span class="log-status log-status-muted">N/A</span>';
  if (code === 0) return '<span class="log-status log-status-offline">0</span>';
  if (code >= 200 && code < 300) return `<span class="log-status log-status-ok">${code}</span>`;
  if (code >= 400 && code < 500) return `<span class="log-status log-status-warn">${code}</span>`;
  if (code >= 500) return `<span class="log-status log-status-err">${code}</span>`;
  return `<span class="log-status log-status-muted">${code}</span>`;
}

function renderLogRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)">No log entries.</td></tr>';
  }
  return rows.map((row) => `
    <tr class="${row.error_message ? "log-row-error" : ""}">
      <td class="logs-time">${escHtml(new Date(row.created_at).toLocaleString())}</td>
      <td><strong>${escHtml(row.user_name || row.username)}</strong><br><span class="logs-user">${escHtml(row.username)}</span></td>
      <td>${escHtml(row.page || "N/A")}</td>
      <td class="logs-action">${escHtml(row.action)}</td>
      <td>${formatLogStatus(row.status_code)}</td>
      <td class="logs-error">${row.error_message ? escHtml(row.error_message) : '<span class="logs-muted">OK</span>'}</td>
      <td class="logs-details">${escHtml(row.details || "")}</td>
    </tr>`).join("");
}

function emptyCell(val) { return val || "N/A"; }

function formatCurrency(amount) {
  return receiptPreview.fmtCurrency(amount, state.settings?.currency || "USD");
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function escAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatPageSize(size) {
  const map = { receipt: "Receipt (80mm)", a4: "A4", letter: "Letter" };
  return map[size] || size || "A4";
}

function applyUserProfile(user) {
  if (!user) return;
  state.quotePageSize = user.quote_page_size || "a4";
  state.posView = user.pos_view || "grid";
  applyTheme(user.theme || state.settings?.theme || "light");
}

async function saveUserProfile(updates) {
  const res = await entracteAPI.updateProfile(updates);
  state.user = res;
  applyUserProfile(res);
  return res;
}

function confirmDialog(message, { title = "Confirm", confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const done = (val) => { closeModal(); resolve(val); };
    showModal(title,
      `<p class="confirm-body">${escHtml(message)}</p>`,
      `<button type="button" class="btn btn-secondary" id="confirm-cancel">Cancel</button>
       <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirm-ok">${escHtml(confirmLabel)}</button>`);
    document.getElementById("confirm-cancel").addEventListener("click", () => done(false));
    document.getElementById("confirm-ok").addEventListener("click", () => done(true));
    icons();
  });
}

function productMatchesSearch(p, term) {
  const t = term.toLowerCase();
  return p.name.toLowerCase().includes(t)
    || (p.description || "").toLowerCase().includes(t)
    || (p.sku || "").toLowerCase().includes(t)
    || (p.barcode && p.barcode.includes(t));
}

function getReceiptContext() {
  const shopName = state.user?.shop_name || state.settings?.store_name;
  const shopAddress = state.user?.shop_address || state.settings?.address;
  return {
    store_name: shopName,
    address: shopAddress,
    settings: { ...state.settings, store_name: shopName, address: shopAddress },
    preparedBy: state.user?.name || "",
  };
}

function validateForm(fields) {
  for (const { id, label, required, type, min } of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    const val = el.value.trim();
    if (required && !val) {
      notify(`${label} is required`, "error");
      el.focus();
      el.classList.add("input-error");
      return false;
    }
    if (type === "number" && val) {
      const n = parseFloat(val);
      if (Number.isNaN(n) || (min !== undefined && n < min)) {
        notify(`${label} must be ${min !== undefined ? `at least ${min}` : "a valid number"}`, "error");
        el.focus();
        el.classList.add("input-error");
        return false;
      }
    }
    if (type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      notify("Enter a valid email address", "error");
      el.focus();
      el.classList.add("input-error");
      return false;
    }
    el.classList.remove("input-error");
  }
  return true;
}

function icons() { if (window.lucide) lucide.createIcons(); }

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
}

function getSettingsFromForm(prefix = "set") {
  return {
    store_name: document.getElementById(`${prefix}-name`)?.value,
    address: document.getElementById(`${prefix}-address`)?.value,
    email: document.getElementById(`${prefix}-email`)?.value,
    receipt_phone: document.getElementById(`${prefix}-phone`)?.value,
    tax_rate: parseFloat(document.getElementById(`${prefix}-tax`)?.value || "0"),
    printer_name: document.getElementById(`${prefix}-printer`)?.value,
    receipt_header: document.getElementById(`${prefix}-header`)?.value,
    receipt_tagline: document.getElementById(`${prefix}-tagline`)?.value,
    receipt_footer: document.getElementById(`${prefix}-footer`)?.value,
    receipt_brand_line: document.getElementById(`${prefix}-brand`)?.value,
    receipt_website: document.getElementById(`${prefix}-website`)?.value,
    quotation_footer: document.getElementById(`${prefix}-quote-footer`)?.value,
    quotation_valid_days: parseInt(document.getElementById(`${prefix}-quote-days`)?.value || "30", 10),
    quote_title: document.getElementById(`${prefix}-quote-title`)?.value,
    quote_fax: document.getElementById(`${prefix}-quote-fax`)?.value,
    quote_terms_text: document.getElementById(`${prefix}-quote-terms`)?.value,
    quote_thank_you: document.getElementById(`${prefix}-quote-thank`)?.value,
    quote_contact_line: document.getElementById(`${prefix}-quote-contact`)?.value,
    quote_show_acceptance: document.getElementById(`${prefix}-quote-acceptance`)?.checked,
    quote_show_prepared_by: document.getElementById(`${prefix}-quote-prepared`)?.checked,
    receipt_show_logo: document.getElementById(`${prefix}-show-logo`)?.checked,
    receipt_show_tax: document.getElementById(`${prefix}-show-tax`)?.checked,
    receipt_show_payment: document.getElementById(`${prefix}-show-payment`)?.checked,
  };
}

function toggleSidebar() {
  const sb = document.getElementById("sidebar");
  const collapsed = sb.classList.toggle("collapsed");
  localStorage.setItem("entracte_sidebar_collapsed", collapsed ? "1" : "0");
  updateSidebarToggle();
}

function updateSidebarToggle() {
  const sb = document.getElementById("sidebar");
  const btn = document.getElementById("sidebar-toggle");
  if (!sb || !btn) return;
  const collapsed = sb.classList.contains("collapsed");
  btn.innerHTML = collapsed ? "" : '<i data-lucide="panel-left-close"></i>';
  btn.style.display = collapsed ? "none" : "flex";
  icons();
}

function initSidebar() {
  const collapsed = localStorage.getItem("entracte_sidebar_collapsed") === "1";
  const sb = document.getElementById("sidebar");
  if (collapsed && sb) sb.classList.add("collapsed");
  document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-brand")?.addEventListener("click", () => {
    if (sb?.classList.contains("collapsed")) {
      sb.classList.remove("collapsed");
      localStorage.setItem("entracte_sidebar_collapsed", "0");
      updateSidebarToggle();
    }
  });
  updateSidebarToggle();
}

async function loadPrinters() {
  try {
    if (window.electronAPI?.getPrinters) {
      return await window.electronAPI.getPrinters();
    }
    const res = await entracteAPI.getPrinters();
    return (res.printers || []).map((name) => ({
      name,
      isDefault: name === res.default,
      pageSize: /receipt|thermal|pos|tm-t/i.test(name) ? "receipt" : "a4",
    }));
  } catch {
    return [];
  }
}

function updateReceiptPreviewPanel(settings, docType = "receipt") {
  const el = document.getElementById("receipt-live-preview");
  if (!el || !window.receiptPreview) return;
  const doc = receiptPreview.sampleReceiptDoc();
  el.innerHTML = receiptPreview.buildDocHtml(doc, settings, docType, state.user?.name || "Admin");
}

function closeModal() { document.getElementById("modal-container").innerHTML = ""; }

function showModal(title, bodyHTML, actionsHTML, options = {}) {
  document.getElementById("modal-container").innerHTML = `
    <div class="modal-overlay${options.blocking ? " modal-blocking" : ""}" id="modal-overlay">
      <div class="modal fade-in${options.wide ? " modal-wide" : ""}">
        <div class="modal-title">${title}</div>
        ${bodyHTML}
        <div class="modal-actions">${actionsHTML}</div>
      </div>
    </div>`;
  if (!options.blocking) {
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
  }
  icons();
}

async function waitForBackend(retries = 20) {
  window.__currentPage = "login";
  let lastErr = "Server not ready. Please wait and try again.";
  for (let i = 0; i < retries; i++) {
    try {
      await entracteAPI.health();
      return true;
    } catch (err) {
      lastErr = err.message || lastErr;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  entracteAPI.logApiStep("GET", "/health", 0, lastErr);
  return false;
}

function buildNav() {
  const nav = document.getElementById("sidebar-nav");
  const items = isAdmin() ? ADMIN_NAV : CASHIER_NAV;
  nav.innerHTML = items.map((n) => `
    <button class="nav-item" data-page="${n.page}" title="${n.label}">
      <i data-lucide="${n.icon}"></i> <span class="nav-label">${n.label}</span>
    </button>`).join("");
  nav.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });
  icons();
}

function navigateTo(page) {
  window.__currentPage = page;
  if (!entracteAPI.getToken()) {
    forceLogout("Please sign in to continue.");
    return;
  }
  if (!isAdmin() && !["pos", "orders", "quotations", "settings"].includes(page)) {
    notify("Access denied", "error");
    return;
  }
  if (page === "logs" && !isAdmin()) {
    notify("Access denied", "error");
    return;
  }
  if (page === "orders" && isAdmin()) state.ordersShopId = null;
  if (page === "inventory" && isAdmin()) state.inventoryShopId = null;
  if (page !== "quotations") {
    state.quoteView = "list";
    state.editingQuoteId = null;
  }
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === page);
  });
  const content = document.getElementById("page-content");
  const pages = {
    pos: renderPOS,
    dashboard: renderDashboard,
    inventory: renderInventory,
    "out-of-stock": renderOutOfStock,
    orders: renderOrders,
    quotations: renderQuotations,
    shops: renderShops,
    users: renderUsers,
    logs: renderLogs,
    settings: (container) => (isAdmin() ? renderSettings(container) : renderCashierSettings(container)),
  };
  runPage(pages[page] || renderPOS, content, page);
  logActivity(`Opened ${page} page`, page);
}

async function runPage(renderFn, container, pageName = "") {
  container.innerHTML = `<div class="page-loading"><div class="spinner" style="margin:60px auto"></div></div>`;
  try {
    await renderFn(container);
  } catch (err) {
    if (isSessionError(err)) return;
    console.error(`Page error [${pageName}]:`, err);
    container.innerHTML = `
      <div class="page-header"><div class="page-title">${escAttr(pageName || "Page")}</div></div>
      <div class="page-body">
        <p style="color:var(--danger);margin-bottom:12px">${escAttr(err.message || "Failed to load page")}</p>
        <p style="color:var(--text-muted);font-size:.875rem;margin-bottom:16px">Try restarting the app if this keeps happening.</p>
        <button class="btn btn-primary btn-sm" id="page-retry">Retry</button>
      </div>`;
    document.getElementById("page-retry")?.addEventListener("click", () => navigateTo(pageName));
    notify(err.message || "Failed to load page", "error");
  }
}

// --- Auth ---
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");
  errEl.classList.add("hidden");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  const ready = await waitForBackend();
  if (!ready) {
    errEl.textContent = "Server not ready. Please wait and try again.";
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.innerHTML = "<span>Sign In</span>";
    return;
  }

  try {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    if (!username || !password) {
      errEl.textContent = "Username and password are required.";
      errEl.classList.remove("hidden");
      btn.disabled = false;
      btn.innerHTML = "<span>Sign In</span>";
      return;
    }
    const res = await entracteAPI.login(username, password);
    if (!entracteAPI.getToken()) {
      throw new Error("Login failed: no session token. Restart the app and try again.");
    }
    state.user = res.employee;
    try {
      state.settings = await entracteAPI.getSettings();
    } catch (settingsErr) {
      if (isSessionError(settingsErr) || !entracteAPI.getToken()) throw settingsErr;
      state.settings = { store_name: "Entracte POS", currency: "USD", tax_rate: 0 };
    }
    if (!entracteAPI.getToken()) {
      throw new Error("Session was lost during login. Please try again.");
    }
    await showApp();
    notify(`Welcome, ${state.user.name}`, "success");
  } catch (err) {
    entracteAPI.clearToken();
    forceLogout("");
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
  btn.disabled = false;
  btn.innerHTML = "<span>Sign In</span>";
});

async function tryAutoLogin() {
  // App always starts at login — session is not restored automatically.
}

async function requireCashierShift() {
  let shops = [];
  try { shops = await entracteAPI.getShops(); } catch { /* ignore */ }
  const activeShops = shops.filter((s) => s.is_active !== false);
  const assignedShop = state.user.shop_id ? activeShops.find((s) => s.id === state.user.shop_id) : null;

  const shopField = assignedShop
    ? `<div class="form-group"><label>Shop</label><input id="shift-shop" value="${escAttr(`${assignedShop.name}${assignedShop.address ? `, ${assignedShop.address}` : ""}`)}" readonly></div>`
    : activeShops.length
      ? `<div class="form-group"><label>Shop</label>
         <select id="shift-shop-id">${activeShops.map((s) => `<option value="${s.id}">${escAttr(s.name)}</option>`).join("")}</select></div>`
      : `<div class="form-group"><label>Shop</label><input id="shift-shop" value="${escAttr(state.settings?.store_name || "Main store")}" readonly></div>`;

  return new Promise((resolve) => {
    showModal("Opening float required",
      `<p style="font-size:.875rem;color:var(--text-secondary);margin-bottom:16px">Before you can use the till, declare how much cash is in your drawer.</p>
       ${shopField}
       <div class="form-group"><label>Cashier</label><input value="${escAttr(state.user.name)}" readonly></div>
       <div class="form-group"><label>Opening cash in drawer</label><input type="number" id="shift-opening" step="0.01" min="0" placeholder="0.00" autofocus></div>`,
      `<button class="btn btn-primary" id="shift-open">Start shift</button>`,
      { blocking: true });

    const startBtn = document.getElementById("shift-open");
    const onStart = async () => {
      if (!validateForm([{ id: "shift-opening", label: "Opening cash", required: true, type: "number", min: 0 }])) return;
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      const shopSelect = document.getElementById("shift-shop-id");
      try {
        state.cashSession = await entracteAPI.openSession({
          opening_float: parseFloat(document.getElementById("shift-opening").value),
          shop_id: assignedShop?.id || (shopSelect ? parseInt(shopSelect.value, 10) : null) || state.user.shop_id || null,
        });
        closeModal();
        updateShiftUI();
        notify("Shift started", "success");
        logActivity("Started shift", "pos", `float=${state.cashSession.opening_float}`);
        resolve(state.cashSession);
      } catch (e) {
        notify(e.message, "error");
        startBtn.disabled = false;
        startBtn.textContent = "Start shift";
      }
    };
    startBtn.addEventListener("click", onStart);
    document.getElementById("shift-opening")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onStart();
    });
  });
}

async function syncCashSession() {
  if (isAdmin()) {
    state.cashSession = null;
    return null;
  }
  try {
    state.cashSession = await entracteAPI.getCurrentSession();
  } catch {
    state.cashSession = null;
  }
  return state.cashSession;
}

function updateShiftUI() {
  const statusEl = document.getElementById("shift-status");
  const endBtn = document.getElementById("sidebar-end-shift");
  if (!statusEl || !endBtn) return;
  if (isAdmin() || !state.cashSession) {
    statusEl.classList.add("hidden");
    endBtn.classList.add("hidden");
    return;
  }
  const opened = state.cashSession.opened_at ? new Date(state.cashSession.opened_at).toLocaleString() : "N/A";
  statusEl.classList.remove("hidden");
  endBtn.classList.remove("hidden");
  statusEl.innerHTML = `<strong>Shift open</strong><br>Float ${formatCurrency(state.cashSession.opening_float || 0)} · ${opened}`;
  icons();
}

async function ensureCashierShift() {
  if (isAdmin()) return;
  await syncCashSession();
  if (state.cashSession) {
    const opened = state.cashSession.opened_at ? new Date(state.cashSession.opened_at) : new Date();
    const isToday = opened.toDateString() === new Date().toDateString();
    if (!isToday) {
      const endOld = await confirmDialog(
        `You still have an open shift from ${opened.toLocaleDateString()} with ${formatCurrency(state.cashSession.opening_float)} opening float. End it and start a new shift?`,
        { title: "Previous shift still open", confirmLabel: "End old shift" },
      );
      if (endOld) {
        await showEndShiftModal();
        if (state.cashSession) {
          updateShiftUI();
          return;
        }
        await requireCashierShift();
      } else {
        await new Promise((resolve) => {
          showModal("Shift in progress",
            `<p style="font-size:.875rem;color:var(--text-secondary);margin-bottom:12px">Continuing your open shift.</p>
             <div class="shift-reconcile-panel">
               <div class="reconcile-row"><span>Opening float</span><strong>${formatCurrency(state.cashSession.opening_float)}</strong></div>
               <div class="reconcile-row"><span>Opened</span><strong>${opened.toLocaleString()}</strong></div>
             </div>`,
            `<button class="btn btn-primary" id="shift-ack">Continue shift</button>`,
            { blocking: true });
          document.getElementById("shift-ack").addEventListener("click", () => { closeModal(); resolve(); });
        });
      }
    } else {
      await new Promise((resolve) => {
        showModal("Opening float",
          `<p style="font-size:.875rem;color:var(--text-secondary);margin-bottom:12px">Your shift is active. Confirm the cash in your drawer to continue.</p>
           <div class="shift-reconcile-panel">
             <div class="reconcile-row"><span>Opening float</span><strong>${formatCurrency(state.cashSession.opening_float)}</strong></div>
             <div class="reconcile-row"><span>Opened</span><strong>${opened.toLocaleString()}</strong></div>
           </div>`,
          `<button class="btn btn-primary" id="shift-ack">Continue</button>`,
          { blocking: true });
        document.getElementById("shift-ack").addEventListener("click", () => { closeModal(); resolve(); });
      });
    }
    updateShiftUI();
    return;
  }
  await requireCashierShift();
  updateShiftUI();
}

async function promptOpenShift() {
  await ensureCashierShift();
}

async function showEndShiftModal() {
  if (isAdmin()) return;
  await syncCashSession();
  if (!state.cashSession) {
    notify("No open shift. Enter your opening float first.", "warning");
    await requireCashierShift();
    if (!state.cashSession) return;
  }

  const opening = state.cashSession.opening_float || 0;
  let reconcileData = null;

  const renderReconcile = (data) => {
    const el = document.getElementById("shift-reconcile");
    if (!el || !data) return;
    const cashFromSales = Math.max(0, (data.expected_cash || 0) - opening);
    const hasShortage = (data.total_shortage || 0) > 0;
    el.innerHTML = `
      <div class="reconcile-row"><span>Opening float</span><strong>${formatCurrency(opening)}</strong></div>
      <div class="reconcile-row"><span>Cash sales this shift</span><strong>${formatCurrency(cashFromSales)}</strong></div>
      <div class="reconcile-row"><span>Expected cash in drawer</span><strong>${formatCurrency(data.expected_cash)}</strong></div>
      <div class="reconcile-row"><span>Expected card total</span><strong>${formatCurrency(data.expected_card)}</strong></div>
      <div class="reconcile-row"><span>Expected mobile total</span><strong>${formatCurrency(data.expected_mobile)}</strong></div>
      <div class="reconcile-row"><span>Orders completed</span><strong>${data.order_count || 0}</strong></div>
      ${hasShortage
        ? `<div class="shortage-warn">Shortage: ${formatCurrency(data.total_shortage)}. Recount or report below.</div>`
        : `<div class="balanced-ok">Counts match expected totals</div>`}`;
  };

  const refreshReconcile = debounce(async () => {
    const cashEl = document.getElementById("close-cash");
    if (!cashEl || cashEl.value === "") {
      if (reconcileData) renderReconcile(reconcileData);
      return;
    }
    try {
      const prev = reconcileData || {};
      reconcileData = await entracteAPI.reconcileSession(
        parseFloat(cashEl.value) || 0,
        prev.expected_card || 0,
        prev.expected_mobile || 0,
      );
      renderReconcile(reconcileData);
    } catch { /* ignore preview errors */ }
  }, 300);

  const loadExpected = async () => {
    const panel = document.getElementById("shift-reconcile");
    try {
      reconcileData = await entracteAPI.reconcileSession(opening, 0, 0);
      reconcileData = { ...reconcileData, total_shortage: 0, cash_shortage: 0 };
      renderReconcile(reconcileData);
    } catch (e) {
      if (panel) {
        panel.innerHTML = `<p style="color:var(--danger);font-size:.875rem">${escHtml(e.message || "Could not load shift totals")}</p>`;
      }
    }
  };

  const finishClose = async (acknowledgeShortage = false) => {
    if (!validateForm([{ id: "close-cash", label: "Cash in drawer", required: true, type: "number", min: 0 }])) return;
    const closingCash = parseFloat(document.getElementById("close-cash").value);
    const closingCard = reconcileData?.expected_card || 0;
    const closingMobile = reconcileData?.expected_mobile || 0;
    try {
      const report = await entracteAPI.closeSession({
        closing_cash: closingCash,
        closing_card: closingCard,
        closing_mobile: closingMobile,
        notes: document.getElementById("close-notes").value.trim() || null,
        acknowledge_shortage: acknowledgeShortage,
      });
      state.cashSession = null;
      closeModal();
      updateShiftUI();
      const html = receiptPreview.buildShiftReportHtml(report, getReceiptContext().settings);
      showModal("Shift closed",
        `<div class="receipt-preview-wrap">${html}</div>`,
        `<button class="btn btn-secondary" id="modal-print">Print report</button>
         <button class="btn btn-primary" id="modal-done">Done</button>`);
      if (report.total_shortage > 0) notify(`Shortage reported: ${formatCurrency(report.total_shortage)}`, "warning", 8000);
      else notify("Shift balanced successfully", "success");
      logActivity("Closed shift", "pos", `cash=${closingCash}, shortage=${report.total_shortage || 0}`);
      document.getElementById("modal-print")?.addEventListener("click", () => receiptPreview.printHtml(html, "End of shift report"));
      document.getElementById("modal-done")?.addEventListener("click", closeModal);
    } catch (e) {
      if (e.code === 409 && e.reconcile) {
        const r = e.reconcile;
        showModal("Cash shortage detected",
          `<p style="margin-bottom:12px">Your count does not match system records.</p>
           <div class="shift-reconcile-panel">
             <div class="reconcile-row"><span>Expected cash</span><strong>${formatCurrency(r.expected_cash)}</strong></div>
             <div class="reconcile-row"><span>You counted</span><strong>${formatCurrency(closingCash)}</strong></div>
             <div class="reconcile-row"><span>Cash shortage</span><strong style="color:var(--danger)">${formatCurrency(r.cash_shortage)}</strong></div>
             ${r.card_shortage > 0 ? `<div class="reconcile-row"><span>Card shortage</span><strong style="color:var(--danger)">${formatCurrency(r.card_shortage)}</strong></div>` : ""}
             ${r.mobile_shortage > 0 ? `<div class="reconcile-row"><span>Mobile shortage</span><strong style="color:var(--danger)">${formatCurrency(r.mobile_shortage)}</strong></div>` : ""}
             <div class="reconcile-row" style="margin-top:8px"><span>Total shortage</span><strong style="color:var(--danger)">${formatCurrency(r.total_shortage)}</strong></div>
           </div>
           <p style="font-size:.875rem;color:var(--text-secondary)">Recount your drawer, or report the shortage to admin.</p>`,
          `<button class="btn btn-secondary" id="recount-shift">Recount</button>
           <button class="btn btn-danger" id="ack-shortage">Report shortage to admin</button>`);
        document.getElementById("recount-shift").addEventListener("click", () => showEndShiftModal());
        document.getElementById("ack-shortage").addEventListener("click", () => finishClose(true));
        return;
      }
      notify(e.message, "error");
    }
  };

  showModal("End shift",
    `<p style="font-size:.875rem;color:var(--text-secondary);margin-bottom:16px">Count all cash in your drawer and enter the total below. The system compares it to opening float plus cash sales.</p>
     <div id="shift-reconcile" class="shift-reconcile-panel"><div class="spinner" style="margin:8px auto"></div></div>
     <div class="form-group"><label>Cash in drawer now</label><input type="number" id="close-cash" step="0.01" min="0" placeholder="Total physical cash"></div>
     <div class="form-group"><label>Notes (optional)</label><textarea id="close-notes" rows="2" placeholder="Explain any variance..."></textarea></div>`,
    `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
     <button class="btn btn-primary" id="close-shift">Close shift</button>`);

  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("close-cash").addEventListener("input", refreshReconcile);
  document.getElementById("close-shift").addEventListener("click", () => finishClose(false));
  loadExpected();
}

async function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");
  document.getElementById("user-name").textContent = state.user.name;
  document.getElementById("user-role").textContent = state.user.role;
  document.getElementById("user-avatar").textContent = state.user.name[0].toUpperCase();
  const shopDisplay = state.user.shop_name || state.settings.store_name;
  document.getElementById("store-name-display").textContent = shopDisplay;
  applyUserProfile(state.user);
  if (window.electronAPI?.getAssetDataUrl) {
    window.electronAPI.getAssetDataUrl("ES.png").then((url) => {
      if (url) receiptPreview.setLogoDataUrl(url);
    });
  }
  buildNav();
  if (!isAdmin()) {
    await ensureCashierShift();
  } else {
    state.cashSession = null;
    updateShiftUI();
  }
  navigateTo("pos");
  icons();
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  if (!isAdmin() && state.cashSession) {
    const endFirst = await confirmDialog(
      "You have an open shift. End shift and count your drawer before signing out?",
      { title: "End shift?", confirmLabel: "End shift" },
    );
    if (endFirst) {
      await showEndShiftModal();
      if (state.cashSession) return;
    } else {
      const force = await confirmDialog(
        "Sign out without closing your shift? Your drawer balance will not be recorded.",
        { title: "Sign out anyway?", confirmLabel: "Sign out", danger: true },
      );
      if (!force) return;
    }
  }
  logActivity("Signed out", "login");
  entracteAPI.clearToken();
  state.user = null;
  state.cart = [];
  state.cashSession = null;
  document.getElementById("main-app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-username").value = "";
  document.getElementById("login-password").value = "";
  notify("Signed out", "info");
});

// --- POS ---
async function renderPOS(container) {
  container.innerHTML = `<div class="pos-layout" id="pos-root"><div style="padding:40px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div></div>`;
  const [products, categories] = await Promise.all([
    entracteAPI.getProducts(),
    entracteAPI.getCategories(),
  ]);
  state.products = products;
  state.categories = categories;
  state.productsCache = products;

  container.innerHTML = `
    <div class="pos-layout page-enter">
      <div class="pos-left">
        <div class="pos-toolbar">
          <div class="search-wrap">
            <i data-lucide="search"></i>
            <input id="pos-search" placeholder="Search or scan barcode..." autofocus>
          </div>
          <div class="view-toggle">
            <button class="view-btn ${state.posView === "grid" ? "active" : ""}" data-view="grid" title="Grid view"><i data-lucide="layout-grid"></i></button>
            <button class="view-btn ${state.posView === "list" ? "active" : ""}" data-view="list" title="List view"><i data-lucide="list"></i></button>
          </div>
        </div>
        <div class="cat-tabs" id="category-tabs">
          <button class="cat-tab active" data-cat="">All items</button>
          ${categories.map((c) => `<button class="cat-tab" data-cat="${c.id}">${c.name}</button>`).join("")}
        </div>
        <div class="${state.posView === "list" ? "product-list" : "product-grid"}" id="product-grid"></div>
      </div>
      <div class="pos-cart" id="pos-cart"></div>
    </div>`;

  renderProductGrid();
  renderCart();
  icons();

  const doSearch = debounce((val) => {
    if (val.length >= 8 && /^\d+$/.test(val)) {
      entracteAPI.getProductByBarcode(val).then((p) => {
        addToCart(p);
        document.getElementById("pos-search").value = "";
        notify(`Added ${p.name}`, "success", 2000);
      }).catch(() => renderProductGrid(val));
    } else {
      renderProductGrid(val);
    }
  }, 200);

  document.getElementById("pos-search").addEventListener("input", (e) => doSearch(e.target.value.trim()));
  document.getElementById("category-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".cat-tab");
    if (!tab) return;
    document.querySelectorAll(".cat-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.selectedCategory = tab.dataset.cat || null;
    renderProductGrid(document.getElementById("pos-search").value.trim());
  });
  container.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.posView = btn.dataset.view;
      saveUserProfile({ pos_view: state.posView }).catch(() => {});
      const grid = document.getElementById("product-grid");
      if (grid) grid.className = state.posView === "list" ? "product-list" : "product-grid";
      container.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === state.posView));
      renderProductGrid(document.getElementById("pos-search").value.trim());
      icons();
    });
  });
}

function renderProductGrid(search = "") {
  const grid = document.getElementById("product-grid");
  if (!grid) return;
  let filtered = state.products;
  if (state.selectedCategory) filtered = filtered.filter((p) => p.category_id === Number(state.selectedCategory));
  if (search) filtered = filtered.filter((p) => productMatchesSearch(p, search));

  const isList = state.posView === "list";
  grid.innerHTML = filtered.length === 0
    ? '<div class="cart-empty">No products found</div>'
    : filtered.map((p) => isList ? `
      <div class="product-row ${p.stock_quantity <= 0 ? "disabled" : ""}" data-id="${p.id}">
        <div class="product-row-info">
          <div class="product-tile-name">${p.name}</div>
          ${p.description ? `<div class="product-row-desc">${p.description}</div>` : ""}
        </div>
        <div class="product-row-stock ${p.is_low_stock ? "low" : ""}">${p.stock_quantity <= 0 ? "Out of stock" : `${p.stock_quantity} in stock`}</div>
        <div class="product-tile-price">${formatCurrency(p.price)}</div>
      </div>` : `
      <div class="product-tile ${p.stock_quantity <= 0 ? "disabled" : ""}" data-id="${p.id}">
        <div class="product-tile-name">${p.name}</div>
        ${p.description ? `<div class="product-tile-desc">${p.description}</div>` : ""}
        <div class="product-tile-price">${formatCurrency(p.price)}</div>
        <div class="product-tile-stock ${p.is_low_stock ? "low" : ""}">${p.stock_quantity <= 0 ? "Out of stock" : `${p.stock_quantity} in stock`}</div>
      </div>`).join("");

  grid.querySelectorAll(".product-tile, .product-row").forEach((tile) => {
    tile.addEventListener("click", () => {
      const p = state.products.find((x) => x.id === Number(tile.dataset.id));
      if (p) {
        addToCart(p);
        tile.classList.add("tap-pop");
        setTimeout(() => tile.classList.remove("tap-pop"), 200);
      }
    });
  });
}

function addToCart(product) {
  const ex = state.cart.find((c) => c.product_id === product.id);
  if (ex) {
    if (ex.quantity >= product.stock_quantity) { notify("Not enough stock", "warning"); return; }
    ex.quantity++;
  } else {
    if (product.stock_quantity <= 0) return;
    state.cart.push({ product_id: product.id, name: product.name, price: product.price, quantity: 1 });
  }
  renderCart();
}

function renderCart() {
  const el = document.getElementById("pos-cart");
  if (!el) return;
  const taxRate = (state.settings?.tax_rate || 0) / 100;
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  el.innerHTML = `
    <div class="cart-head">
      <h2>Current sale</h2>
      ${state.cart.length ? '<button class="btn btn-ghost btn-sm" id="clear-cart">Clear</button>' : ""}
    </div>
    <div class="cart-items">
      ${state.cart.length === 0 ? '<div class="cart-empty">Tap items to add to sale</div>' :
        state.cart.map((item, idx) => `
          <div class="cart-row cart-row-enter">
            <div class="cart-row-info">
              <div class="cart-row-name">${item.name}</div>
              <div class="cart-row-price">${formatCurrency(item.price)} each</div>
            </div>
            <div class="qty-group">
              <button class="qty-btn" data-action="dec" data-idx="${idx}">−</button>
              <span class="qty-val">${item.quantity}</span>
              <button class="qty-btn" data-action="inc" data-idx="${idx}">+</button>
            </div>
            <div class="cart-row-total">${formatCurrency(item.price * item.quantity)}</div>
            <button class="cart-remove" data-idx="${idx}" title="Remove item">×</button>
          </div>`).join("")}
    </div>
    <div class="cart-footer">
      <div class="summary-line"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
      ${taxRate > 0 ? `<div class="summary-line"><span>Tax</span><span>${formatCurrency(tax)}</span></div>` : ""}
      <div class="summary-line total"><span>Total</span><span>${formatCurrency(total)}</span></div>
      <div class="pay-methods">
        <button class="pay-chip ${state.paymentMethod === "cash" ? "active" : ""}" data-pay="cash">Cash</button>
        <button class="pay-chip ${state.paymentMethod === "card" ? "active" : ""}" data-pay="card">Card</button>
        <button class="pay-chip ${state.paymentMethod === "mobile" ? "active" : ""}" data-pay="mobile">Mobile</button>
      </div>
      <div class="cart-actions">
        <button class="btn btn-secondary flex-1" id="quote-btn" ${state.cart.length === 0 ? "disabled" : ""}>
          <i data-lucide="file-text"></i> Quotation
        </button>
        <button class="btn btn-primary flex-1" id="checkout-btn" ${state.cart.length === 0 ? "disabled" : ""}>
          Charge ${formatCurrency(total)}
        </button>
      </div>
      ${!isAdmin() ? '<button class="btn btn-ghost btn-sm w-full" id="end-shift-btn" style="margin-top:8px"><i data-lucide="log-out"></i> End shift</button>' : ""}
    </div>`;

  document.getElementById("clear-cart")?.addEventListener("click", () => { state.cart = []; renderCart(); });
  el.querySelectorAll(".cart-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cart.splice(Number(btn.dataset.idx), 1);
      renderCart();
    });
  });
  el.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.action === "inc") {
        const p = state.products.find((x) => x.id === state.cart[idx].product_id);
        if (p && state.cart[idx].quantity < p.stock_quantity) state.cart[idx].quantity++;
      } else {
        state.cart[idx].quantity--;
        if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
      }
      renderCart();
    });
  });
  el.querySelectorAll(".pay-chip").forEach((btn) => {
    btn.addEventListener("click", () => { state.paymentMethod = btn.dataset.pay; renderCart(); });
  });
  document.getElementById("checkout-btn")?.addEventListener("click", () => checkout(total));
  document.getElementById("quote-btn")?.addEventListener("click", () => createQuotation(total));
  document.getElementById("end-shift-btn")?.addEventListener("click", showEndShiftModal);
  icons();
}

async function checkout(total) {
  if (!isAdmin() && !state.cashSession) {
    await requireCashierShift();
  }
  showModal("Complete payment",
    `<div class="form-group"><label>Amount received</label>
     <input type="number" id="amount-paid" value="${total.toFixed(2)}" step="0.01" min="${total.toFixed(2)}"></div>
     <div class="summary-line total"><span>Total due</span><span>${formatCurrency(total)}</span></div>`,
    `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
     <button class="btn btn-primary" id="confirm-pay">Complete sale</button>`);

  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("confirm-pay").addEventListener("click", async () => {
    const amountPaid = parseFloat(document.getElementById("amount-paid").value);
    if (amountPaid < total) { notify("Insufficient payment", "error"); return; }
    try {
      const order = await entracteAPI.createOrder({
        items: state.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
        payment_method: state.paymentMethod,
        amount_paid: amountPaid,
      });
      closeModal();
      state.cart = [];
      state.products = await entracteAPI.getProducts();
      renderCart();
      logActivity("Completed sale", "pos", `order=${order.order_number}, total=${order.total}`);
      try {
        await entracteAPI.printOrder(order.id);
        notify(`Sale complete. Receipt printed (#${order.order_number})`, "success");
      } catch (printErr) {
        notify(`Sale complete but print failed: ${printErr.message}`, "warning", 6000);
        showReceiptPreview(order);
      }
    } catch (err) {
      notify(err.message, "error");
    }
  });
}

function showDocPreview(doc, docType = "receipt") {
  const ctx = getReceiptContext();
  const pageSize = docType === "quotation"
    ? (state.quotePageSize || "a4")
    : (state.user?.printer_page_size || "receipt");
  const html = receiptPreview.buildDocHtml(doc, ctx.settings, docType, ctx.preparedBy, pageSize);
  const title = docType === "quotation" ? (doc.quote_number || "Quotation") : "Receipt";
  const fileTitle = docType === "quotation" ? `Quotation-${doc.quote_number || doc.id || "preview"}` : `Receipt-${doc.order_number || doc.id || "preview"}`;
  showModal(docType === "quotation" ? "Quotation" : "Receipt",
    `<div class="receipt-preview-wrap">${html}</div>`,
    `<button class="btn btn-secondary" id="modal-save-pdf"><i data-lucide="file-down"></i> Save PDF</button>
     <button class="btn btn-secondary" id="modal-save-word"><i data-lucide="file-text"></i> Save Word</button>
     <button class="btn btn-secondary" id="modal-print">Print</button>
     <button class="btn btn-primary" id="modal-done">Done</button>`,
    docType === "quotation" ? { wide: true } : {});
  icons();
  document.getElementById("modal-save-pdf")?.addEventListener("click", () => receiptPreview.saveDocument(receiptPreview.applyLogo(html), fileTitle, pageSize, docType));
  document.getElementById("modal-save-word")?.addEventListener("click", () => receiptPreview.saveWord(receiptPreview.applyLogo(html), fileTitle, pageSize, docType));
  document.getElementById("modal-print")?.addEventListener("click", () => receiptPreview.printHtml(receiptPreview.applyLogo(html), title, pageSize, docType));
  document.getElementById("modal-done")?.addEventListener("click", closeModal);
}

async function createQuotation(total) {
  const validDays = state.settings?.quotation_valid_days || 30;
  showModal("Create quotation",
    `<div class="form-group"><label>Customer name</label><input id="q-name"></div>
     <div class="form-group"><label>Phone</label><input id="q-phone"></div>
     <div class="form-group"><label>Email</label><input id="q-email" type="email"></div>
     <div class="form-group"><label>Page size</label>
       <select id="q-page-size">
         <option value="a4" ${state.quotePageSize === "a4" ? "selected" : ""}>A4</option>
         <option value="letter" ${state.quotePageSize === "letter" ? "selected" : ""}>Letter</option>
         <option value="receipt" ${state.quotePageSize === "receipt" ? "selected" : ""}>Receipt (narrow)</option>
       </select></div>
     <div class="form-group"><label>Valid for (days)</label><input type="number" id="q-days" value="${validDays}" min="1"></div>
     <div class="form-group"><label>Notes</label><textarea id="q-notes" rows="2"></textarea></div>
     <div class="summary-line total"><span>Quote total</span><span>${formatCurrency(total)}</span></div>`,
    `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
     <button class="btn btn-primary" id="confirm-quote">Save &amp; print</button>`);

  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("confirm-quote").addEventListener("click", async () => {
    if (!validateForm([{ id: "q-days", label: "Valid days", required: true, type: "number", min: 1 }])) return;
    state.quotePageSize = document.getElementById("q-page-size").value;
    saveUserProfile({ quote_page_size: state.quotePageSize }).catch(() => {});
    try {
      const quote = await entracteAPI.createQuotation({
        items: state.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
        customer_name: document.getElementById("q-name").value.trim() || null,
        customer_phone: document.getElementById("q-phone").value.trim() || null,
        customer_email: document.getElementById("q-email").value.trim() || null,
        valid_days: parseInt(document.getElementById("q-days").value, 10),
        notes: document.getElementById("q-notes").value.trim() || null,
      });
      closeModal();
      state.cart = [];
      renderCart();
      try {
        await entracteAPI.printQuotation(quote.id);
        notify(`Quotation ${quote.quote_number} saved & printed`, "success");
      } catch (printErr) {
        notify(`Quotation saved but print failed: ${printErr.message}`, "warning", 6000);
        showDocPreview(quote, "quotation");
      }
    } catch (err) {
      notify(err.message, "error");
    }
  });
}

function showReceiptPreview(order) {
  showDocPreview(order, "receipt");
}

// --- Dashboard ---
async function renderDashboard(container) {
  container.innerHTML = `<div class="page-body"><div class="spinner" style="margin:40px auto"></div></div>`;
  try {
    const [statsR, topR, salesR, cashierR, sessionsR] = await Promise.allSettled([
      entracteAPI.getDashboard(),
      entracteAPI.getTopProducts(),
      entracteAPI.getSalesByDay(7),
      entracteAPI.getCashierSales(30),
      entracteAPI.getShiftReports(30),
    ]);
    const stats = statsR.status === "fulfilled" ? statsR.value : {
      today_sales: 0, today_orders: 0, week_sales: 0, month_sales: 0,
      low_stock_count: 0, out_of_stock_count: 0,
    };
    const topProducts = topR.status === "fulfilled" ? topR.value : [];
    const salesByDay = salesR.status === "fulfilled" ? salesR.value : [];
    const cashierSales = cashierR.status === "fulfilled" ? cashierR.value : [];
    const shiftReports = (sessionsR.status === "fulfilled" ? sessionsR.value : [])
      .filter((r) => r.status === "closed");
    const maxSales = Math.max(...salesByDay.map((d) => d.sales), 1);
    const maxCashier = Math.max(...cashierSales.map((c) => c.total_sales), 1);

    container.innerHTML = `
    <div class="page-header"><div class="page-title">Dashboard</div></div>
    <div class="page-body fade-in page-enter">
      <div class="stats-row">
        <div class="stat-card stat-enter"><div class="stat-label">Today</div><div class="stat-value blue">${formatCurrency(stats.today_sales)}</div></div>
        <div class="stat-card stat-enter"><div class="stat-label">Orders today</div><div class="stat-value">${stats.today_orders}</div></div>
        <div class="stat-card stat-enter"><div class="stat-label">This week</div><div class="stat-value green">${formatCurrency(stats.week_sales)}</div></div>
        <div class="stat-card stat-enter"><div class="stat-label">This month</div><div class="stat-value">${formatCurrency(stats.month_sales)}</div></div>
        <div class="stat-card stat-enter"><div class="stat-label">Low stock</div><div class="stat-value orange">${stats.low_stock_count}</div></div>
        <div class="stat-card stat-enter"><div class="stat-label">Out of stock</div><div class="stat-value orange">${stats.out_of_stock_count}</div></div>
      </div>
      <div class="charts-grid">
        <div class="card"><div class="card-title">Sales · last 7 days</div>
          <div class="bar-chart">${salesByDay.map((d) => `
            <div class="bar-col"><div class="bar-fill" style="height:${(d.sales / maxSales) * 100}%"></div>
            <div class="bar-label">${d.date.slice(5)}</div></div>`).join("")}
          </div></div>
        <div class="card"><div class="card-title">Cashier sales ranking (30 days)</div>
          ${cashierSales.length === 0 ? '<p style="color:var(--text-muted);font-size:.875rem">No sales data yet</p>' : `
            <div class="cashier-chart">${cashierSales.map((c, i) => `
              <div class="cashier-bar-row">
                <span class="cashier-bar-name">${i + 1}. ${c.employee_name}</span>
                <div class="cashier-bar-track"><div class="cashier-bar-fill" style="width:${(c.total_sales / maxCashier) * 100}%"></div></div>
                <span class="cashier-bar-val">${formatCurrency(c.total_sales)}</span>
              </div>`).join("")}
            </div>`}
        </div>
        <div class="card"><div class="card-title">Top products</div>
          ${topProducts.length === 0 ? '<p style="color:var(--text-muted);font-size:.875rem">No sales yet</p>' :
            topProducts.map((p, i) => `
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:.875rem">
                <span>${i + 1}. ${p.product_name}</span><span>${p.quantity_sold} sold</span></div>`).join("")}
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-title">Shift reports · by cashier &amp; day</div>
        ${shiftReports.length === 0 ? '<p style="color:var(--text-muted);font-size:.875rem">No shift reports yet</p>' : `
          <table class="data-table">
            <thead><tr><th>Date</th><th>Cashier</th><th>Shop</th><th>Orders</th><th>Cash</th><th>Card</th><th>Mobile</th><th>Shortage</th><th></th></tr></thead>
            <tbody>${shiftReports.map((r) => `
              <tr>
                <td>${new Date(r.opened_at).toLocaleDateString()}</td>
                <td><strong>${r.employee_name || "N/A"}</strong></td>
                <td>${r.shop_name || "N/A"}</td>
                <td>${r.order_count}</td>
                <td>${formatCurrency(r.expected_cash || 0)}</td>
                <td>${formatCurrency(r.expected_card || 0)}</td>
                <td>${formatCurrency(r.expected_mobile || 0)}</td>
                <td>${r.total_shortage > 0 ? `<span class="badge badge-danger">${formatCurrency(r.total_shortage)}</span>` : '<span class="badge badge-success">Balanced</span>'}</td>
                <td><button class="btn btn-outline btn-sm view-shift" data-id="${r.id}">View</button></td>
              </tr>`).join("")}
            </tbody>
          </table>`}
      </div>
    </div>`;

    container.querySelectorAll(".view-shift").forEach((btn) => {
      btn.addEventListener("click", () => {
        const report = shiftReports.find((r) => r.id === Number(btn.dataset.id));
        if (!report) return;
        const html = receiptPreview.buildShiftReportHtml(report, getReceiptContext().settings);
        showModal("Shift report", `<div class="receipt-preview-wrap">${html}</div>`,
          `<button class="btn btn-secondary" id="modal-print">Print</button>
           <button class="btn btn-primary" id="modal-done">Done</button>`);
        document.getElementById("modal-print")?.addEventListener("click", () => receiptPreview.printHtml(html, "Shift report"));
        document.getElementById("modal-done")?.addEventListener("click", closeModal);
      });
    });
  } catch (err) {
    container.innerHTML = `
      <div class="page-header"><div class="page-title">Dashboard</div></div>
      <div class="page-body"><p style="color:var(--danger)">Could not load dashboard: ${escAttr(err.message)}</p>
        <button class="btn btn-primary btn-sm" id="retry-dash" style="margin-top:12px">Retry</button></div>`;
    document.getElementById("retry-dash")?.addEventListener("click", () => renderDashboard(container));
  }
}

// --- Shop picker ---
function renderShopPickerPage(container, shops, { title, onSelect, showShared = false }) {
  container.innerHTML = `
    <div class="page-header"><div class="page-title">${title}</div></div>
    <div class="page-body fade-in page-enter">
      <p style="color:var(--text-secondary);margin-bottom:16px;font-size:.875rem">Select a shop to view its records.</p>
      <div class="shop-picker-grid">
        <div class="shop-picker-card" data-shop="all">
          <div class="shop-picker-icon"><i data-lucide="layers"></i></div>
          <h3>All shops</h3><p>View everything</p>
        </div>
        ${showShared ? `
        <div class="shop-picker-card" data-shop="shared">
          <div class="shop-picker-icon"><i data-lucide="package"></i></div>
          <h3>Shared stock</h3><p>Available at all shops</p>
        </div>` : ""}
        ${shops.filter((s) => s.is_active !== false).map((s) => `
          <div class="shop-picker-card" data-shop="${s.id}">
            <div class="shop-picker-icon"><i data-lucide="store"></i></div>
            <h3>${escAttr(s.name)}</h3>
            <p>${escAttr(s.address || "No address listed")}</p>
          </div>`).join("")}
      </div>
    </div>`;
  icons();
  container.querySelectorAll(".shop-picker-card").forEach((card) => {
    card.addEventListener("click", () => {
      const v = card.dataset.shop;
      if (v === "all") onSelect("all");
      else if (v === "shared") onSelect("shared");
      else onSelect(Number(v));
    });
  });
}

// --- Inventory ---
async function renderInventory(container) {
  const shops = isAdmin() ? await entracteAPI.getShops() : [];
  if (isAdmin() && state.inventoryShopId === null) {
    renderShopPickerPage(container, shops, {
      title: "Inventory by shop",
      showShared: true,
      onSelect: (id) => { state.inventoryShopId = id; renderInventory(container); },
    });
    return;
  }

  const shopFilter = state.inventoryShopId;
  const productParams = { include_inactive: "true" };
  if (typeof shopFilter === "number") productParams.shop_id = shopFilter;
  const [products, categories] = await Promise.all([
    entracteAPI.getProducts(productParams),
    entracteAPI.getCategories(),
  ]);

  const shopLabel = shopFilter === "all" ? "All shops"
    : shopFilter === "shared" ? "Shared stock"
    : shops.find((s) => s.id === shopFilter)?.name || "Shop";

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Inventory · ${escAttr(shopLabel)}</div>
      <div class="page-actions">
        ${isAdmin() ? '<button class="btn btn-secondary btn-sm" id="inv-back-shops"><i data-lucide="arrow-left"></i> Shops</button>' : ""}
        <label class="btn btn-secondary btn-sm" style="cursor:pointer">
          <i data-lucide="upload"></i> Import CSV
          <input type="file" accept=".csv" id="csv-import" hidden>
        </label>
        <button class="btn btn-secondary btn-sm" id="csv-export"><i data-lucide="download"></i> Export</button>
        <button class="btn btn-primary btn-sm" id="add-product"><i data-lucide="plus"></i> Add item</button>
      </div>
    </div>
    <div class="page-body fade-in">
      <div class="toolbar" style="margin-bottom:16px">
        <div class="search-wrap" style="max-width:280px">
          <i data-lucide="search"></i>
          <input id="inv-search" placeholder="Search inventory...">
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Product</th><th>Description</th><th>Shop</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
        <tbody id="inv-body"></tbody>
      </table>
    </div>`;
  icons();

  function renderTable(search = "") {
    let f = products;
    if (shopFilter === "shared") f = f.filter((p) => !p.shop_id);
    if (search) f = f.filter((p) => productMatchesSearch(p, search));
    document.getElementById("inv-body").innerHTML = f.length === 0
      ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">No items found</td></tr>`
      : f.map((p) => `
      <tr>
        <td><strong>${p.name}</strong></td><td>${p.description || "N/A"}</td>
        <td>${p.shop_name || '<span style="color:var(--text-muted)">All shops</span>'}</td>
        <td>${p.category_name || "N/A"}</td><td>${formatCurrency(p.price)}</td>
        <td>${p.stock_quantity}</td>
        <td>${!p.is_active || p.stock_quantity <= 0 ? '<span class="badge badge-danger">Out of stock</span>' :
          p.is_low_stock ? '<span class="badge badge-warning">Low</span>' : '<span class="badge badge-success">In stock</span>'}</td>
        <td>
          <button class="btn btn-outline btn-sm edit-p" data-id="${p.id}">Edit</button>
          <button class="btn btn-outline btn-sm btn-danger-outline del-p" data-id="${p.id}">Delete</button>
        </td>
      </tr>`).join("");

    document.querySelectorAll(".edit-p").forEach((b) => {
      b.addEventListener("click", () => showProductForm(products.find((p) => p.id === Number(b.dataset.id)), categories, shops, () => renderInventory(container)));
    });
    document.querySelectorAll(".del-p").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!await confirmDialog("Delete this product?", { title: "Delete product", confirmLabel: "Delete", danger: true })) return;
        try {
          await entracteAPI.deleteProduct(Number(b.dataset.id));
          notify("Product deleted", "success");
          renderInventory(container);
        } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
      });
    });
  }

  renderTable();
  document.getElementById("inv-search").addEventListener("input", debounce((e) => renderTable(e.target.value), 200));
  document.getElementById("inv-back-shops")?.addEventListener("click", () => {
    state.inventoryShopId = null;
    renderInventory(container);
  });
  document.getElementById("add-product").addEventListener("click", () => {
    const defaultShop = typeof shopFilter === "number" ? shopFilter : null;
    showProductForm(null, categories, shops, () => renderInventory(container), defaultShop);
  });
  document.getElementById("csv-export").addEventListener("click", async () => {
    try { await entracteAPI.exportInventory(); notify("Inventory exported", "success"); }
    catch (e) { notify(e.message, "error"); }
  });
  document.getElementById("csv-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = await entracteAPI.importCsv(file);
      notify(`Imported ${res.success_count} items${res.error_count ? ` (${res.error_count} errors)` : ""}`, res.error_count ? "warning" : "success");
      renderInventory(container);
    } catch (err) { notify(err.message, "error"); }
    e.target.value = "";
  });
}

function showProductForm(product, categories, shops, onSave, defaultShopId = null) {
  const isEdit = !!product;
  const shopOptions = `<option value="">Shared (all shops)</option>
    ${shops.map((s) => `<option value="${s.id}" ${(product?.shop_id || defaultShopId) === s.id ? "selected" : ""}>${escAttr(s.name)}</option>`).join("")}`;
  showModal(isEdit ? "Edit item" : "Add item",
    `<div class="form-group"><label>Name</label><input id="pf-name" value="${escAttr(product?.name || "")}"></div>
     <div class="form-group"><label>Description</label><textarea id="pf-desc" rows="2">${escAttr(product?.description || "")}</textarea></div>
     <div class="form-group"><label>Shop</label>
       <select id="pf-shop">${shopOptions}</select>
       <small style="color:var(--text-muted)">Assign to a shop or leave shared for all locations</small>
     </div>
     <div class="form-group"><label>Barcode</label><input id="pf-barcode" value="${escAttr(product?.barcode || "")}"></div>
     <div class="form-group"><label>Price</label><input type="number" id="pf-price" value="${product?.price ?? ""}" step="0.01" min="0"></div>
     <div class="form-group"><label>Stock</label><input type="number" id="pf-stock" value="${product?.stock_quantity ?? 0}" min="0"></div>
     <div class="form-group"><label>Category</label>
       <select id="pf-category"><option value="">None</option>
       ${categories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
       </select></div>`,
    `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
     <button class="btn btn-primary" id="pf-save">${isEdit ? "Update" : "Create"}</button>`);

  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("pf-save").addEventListener("click", async () => {
    if (!validateForm([
      { id: "pf-name", label: "Name", required: true },
      { id: "pf-price", label: "Price", required: true, type: "number", min: 0 },
      { id: "pf-stock", label: "Stock", required: true, type: "number", min: 0 },
    ])) return;
    const data = {
      name: document.getElementById("pf-name").value.trim(),
      description: document.getElementById("pf-desc").value.trim() || null,
      barcode: document.getElementById("pf-barcode").value.trim() || null,
      price: parseFloat(document.getElementById("pf-price").value),
      stock_quantity: parseInt(document.getElementById("pf-stock").value, 10),
      category_id: parseInt(document.getElementById("pf-category").value, 10) || null,
      shop_id: parseInt(document.getElementById("pf-shop").value, 10) || null,
    };
    try {
      if (isEdit) await entracteAPI.updateProduct(product.id, data);
      else await entracteAPI.createProduct(data);
      closeModal();
      notify(isEdit ? "Item updated" : "Item created", "success");
      onSave();
    } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
  });
}

// --- Out of Stock ---
async function renderOutOfStock(container) {
  const records = await entracteAPI.getOutOfStock();
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Out of stock</div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" id="oos-export"><i data-lucide="download"></i> Export CSV</button>
        ${records.length ? '<button class="btn btn-danger btn-sm" id="oos-clear">Clear all</button>' : ""}
      </div>
    </div>
    <div class="page-body fade-in">
      ${records.length === 0 ? '<p style="color:var(--text-muted);text-align:center;padding:40px">No out of stock items</p>' : `
        <table class="data-table">
          <thead><tr><th>Product</th><th>Description</th><th>Price</th><th>Category</th><th>Date</th><th></th></tr></thead>
          <tbody>${records.map((r) => `
            <tr>
              <td><strong>${r.name}</strong></td><td>${r.sku || "N/A"}</td>
              <td>${formatCurrency(r.price)}</td><td>${r.category_name || "N/A"}</td>
              <td>${new Date(r.date_out).toLocaleString()}</td>
              <td><button class="btn btn-outline btn-sm btn-danger-outline oos-del" data-id="${r.id}">Remove</button></td>
            </tr>`).join("")}
          </tbody>
        </table>`}
    </div>`;
  icons();
  document.getElementById("oos-export")?.addEventListener("click", async () => {
    try { await entracteAPI.exportOutOfStock(); notify("Exported", "success"); }
    catch (e) { notify(e.message, "error"); }
  });
  document.getElementById("oos-clear")?.addEventListener("click", async () => {
    if (!await confirmDialog("Clear all out of stock records?", { title: "Clear records", confirmLabel: "Clear all", danger: true })) return;
    try { await entracteAPI.clearOutOfStock(); notify("Cleared", "success"); renderOutOfStock(container); }
    catch (e) { notify(e.message, "error"); }
  });
  document.querySelectorAll(".oos-del").forEach((b) => {
    b.addEventListener("click", async () => {
      try { await entracteAPI.deleteOutOfStock(Number(b.dataset.id)); notify("Removed", "success"); renderOutOfStock(container); }
      catch (e) { notify(e.message, "error"); }
    });
  });
}

// --- Orders ---
async function renderOrders(container) {
  const shops = isAdmin() ? await entracteAPI.getShops() : [];
  if (isAdmin() && state.ordersShopId === null) {
    renderShopPickerPage(container, shops, {
      title: "Orders by shop",
      onSelect: (id) => { state.ordersShopId = id; renderOrders(container); },
    });
    return;
  }

  const orderParams = { limit: 1000 };
  if (typeof state.ordersShopId === "number") orderParams.shop_id = state.ordersShopId;
  const orders = await entracteAPI.getOrders(orderParams);

  const shopLabel = state.ordersShopId === "all" ? "All shops"
    : shops.find((s) => s.id === state.ordersShopId)?.name || (isAdmin() ? "Shop" : (state.user.shop_name || "Orders"));

  const sortOrders = (list) => {
    const sorted = [...list];
    sorted.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return state.ordersSort === "date-asc" ? da - db : db - da;
    });
    return sorted;
  };

  const sortIcon = state.ordersSort === "date-asc" ? "arrow-up" : "arrow-down";

  const renderTable = (search = "") => {
    const t = search.toLowerCase().trim();
    let filtered = orders.filter((o) => !t
      || o.order_number.toLowerCase().includes(t)
      || (o.payment_method || "").toLowerCase().includes(t)
      || (o.shop_name || "").toLowerCase().includes(t)
      || String(o.total).includes(t));
    filtered = sortOrders(filtered);
    const tbody = document.getElementById("orders-tbody");
    if (!tbody) return;
    tbody.innerHTML = filtered.length === 0
      ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px">${t ? "No orders match your search" : "No orders yet"}</td></tr>`
      : filtered.map((o) => `
            <tr>
              <td><strong>${o.order_number}</strong></td>
              <td>${new Date(o.created_at).toLocaleString()}</td>
              <td>${o.shop_name || "N/A"}</td>
              <td>${o.items.length}</td>
              <td>${formatCurrency(o.total)}</td>
              <td style="text-transform:capitalize">${o.payment_method}</td>
              <td>
                <button class="btn btn-outline btn-sm view-o" data-id="${o.id}">View</button>
                <button class="btn btn-outline btn-sm print-o" data-id="${o.id}">Print</button>
              </td>
            </tr>`).join("");
    tbody.querySelectorAll(".view-o").forEach((b) => {
      b.addEventListener("click", async () => {
        const order = await entracteAPI.getOrder(Number(b.dataset.id));
        showReceiptPreview(order);
      });
    });
    tbody.querySelectorAll(".print-o").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await entracteAPI.printOrder(Number(b.dataset.id));
          notify("Receipt printed", "success");
        } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
      });
    });
  };

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Orders · ${escAttr(shopLabel)}</div>
      <div class="page-actions" style="display:flex;gap:10px;align-items:center">
        ${isAdmin() ? '<button class="btn btn-secondary btn-sm" id="orders-back-shops"><i data-lucide="arrow-left"></i> Shops</button>' : ""}
        <div class="search-wrap" style="max-width:260px">
          <i data-lucide="search"></i>
          <input id="orders-search" placeholder="Search orders...">
        </div>
        ${isAdmin() ? '<button class="btn btn-secondary btn-sm" id="orders-export"><i data-lucide="download"></i> Export CSV</button>' : ""}
      </div>
    </div>
    <div class="page-body fade-in">
      <table class="data-table">
        <thead><tr>
          <th>Order</th>
          <th class="sortable-th" id="orders-sort-date" title="Sort by date & time">Date <i data-lucide="${sortIcon}"></i></th>
          <th>Shop</th><th>Items</th><th>Total</th><th>Payment</th><th></th>
        </tr></thead>
        <tbody id="orders-tbody"></tbody>
      </table>
    </div>`;
  icons();
  renderTable();
  document.getElementById("orders-search")?.addEventListener("input", debounce((e) => renderTable(e.target.value), 200));
  document.getElementById("orders-sort-date")?.addEventListener("click", () => {
    state.ordersSort = state.ordersSort === "date-desc" ? "date-asc" : "date-desc";
    renderOrders(container);
  });
  document.getElementById("orders-back-shops")?.addEventListener("click", () => {
    state.ordersShopId = null;
    renderOrders(container);
  });
  document.getElementById("orders-export")?.addEventListener("click", async () => {
    try { await entracteAPI.exportOrders(); notify("Orders exported", "success"); }
    catch (e) { notify(e.message, "error"); }
  });
}

// --- Shops ---
async function renderShops(container) {
  const [shops, employees] = await Promise.all([
    entracteAPI.getShops(),
    entracteAPI.getEmployees(),
  ]);

  const renderTable = (search = "") => {
    const t = search.toLowerCase().trim();
    const filtered = shops.filter((s) => !t
      || s.name.toLowerCase().includes(t)
      || (s.address || "").toLowerCase().includes(t)
      || (s.phone || "").toLowerCase().includes(t)
      || employees.some((e) => e.shop_id === s.id && e.name.toLowerCase().includes(t)));
    const tbody = document.getElementById("shops-tbody");
    if (!tbody) return;
    tbody.innerHTML = filtered.length === 0
      ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">${t ? "No shops match your search" : "No shops"}</td></tr>`
      : filtered.map((s) => {
        const staff = employees.filter((e) => e.shop_id === s.id);
        return `
            <tr>
              <td><strong>${escAttr(s.name)}</strong></td>
              <td>${escAttr(s.address || "N/A")}</td>
              <td>${escAttr(s.phone || "N/A")}</td>
              <td>${staff.length ? staff.map((e) => escAttr(e.name)).join(", ") : '<span style="color:var(--text-muted)">None</span>'}</td>
              <td>${s.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-outline btn-sm assign-shop" data-id="${s.id}">Assign staff</button>
                <button class="btn btn-outline btn-sm edit-shop" data-id="${s.id}">Edit</button>
                <button class="btn btn-outline btn-sm btn-danger-outline del-shop" data-id="${s.id}">Delete</button>
              </td>
            </tr>`;
      }).join("");
    bindShopRowActions();
  };

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Shops</div>
      <div class="page-actions" style="display:flex;gap:10px;align-items:center">
        ${shops.length ? `<div class="search-wrap" style="max-width:260px">
          <i data-lucide="search"></i>
          <input id="shops-search" placeholder="Search shops...">
        </div>` : ""}
        <button class="btn btn-primary btn-sm" id="add-shop"><i data-lucide="plus"></i> Add shop</button>
      </div>
    </div>
    <div class="page-body fade-in page-enter">
      ${shops.length === 0 ? `
        <div class="empty-state">
          <i data-lucide="store"></i>
          <h3>No shops yet</h3>
          <p>Add your first shop, then assign cashiers from Team or use Assign staff here.</p>
          <button class="btn btn-primary" id="add-shop-empty">Add shop</button>
        </div>` : `
        <table class="data-table">
          <thead><tr><th>Name</th><th>Address</th><th>Phone</th><th>Staff</th><th>Status</th><th></th></tr></thead>
          <tbody id="shops-tbody"></tbody>
        </table>`}
    </div>`;
  icons();
  if (shops.length) {
    renderTable();
    document.getElementById("shops-search")?.addEventListener("input", debounce((e) => renderTable(e.target.value), 200));
  }

  function bindShopRowActions() {
    container.querySelectorAll(".edit-shop").forEach((b) => {
      b.addEventListener("click", () => showShopForm(shops.find((s) => s.id === Number(b.dataset.id))));
    });
    container.querySelectorAll(".assign-shop").forEach((b) => {
      b.addEventListener("click", () => showAssignStaff(shops.find((s) => s.id === Number(b.dataset.id))));
    });
    container.querySelectorAll(".del-shop").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!await confirmDialog("Delete this shop? Products and orders will be unlinked from this shop. Assigned cashiers will be unlinked.", { title: "Delete shop", confirmLabel: "Delete shop", danger: true })) return;
        try {
          await entracteAPI.deleteShop(Number(b.dataset.id));
          notify("Shop deleted", "success");
          await renderShops(container);
        } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
      });
    });
  }

  const showShopForm = (shop) => {
    showModal(shop ? "Edit shop" : "Add shop",
      `<div class="form-group"><label>Shop name</label><input id="sf-name" value="${escAttr(shop?.name || "")}" autofocus></div>
       <div class="form-group"><label>Address</label><textarea id="sf-address" rows="2">${escAttr(shop?.address || "")}</textarea></div>
       <div class="form-group"><label>Phone</label><input id="sf-phone" value="${escAttr(shop?.phone || "")}"></div>
       ${shop ? `<label class="form-check"><input type="checkbox" id="sf-active" ${shop.is_active ? "checked" : ""}> Active</label>` : ""}`,
      `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
       <button class="btn btn-primary" id="sf-save">${shop ? "Update" : "Create"}</button>`);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("sf-save").addEventListener("click", async () => {
      if (!validateForm([{ id: "sf-name", label: "Shop name", required: true }])) return;
      const payload = {
        name: document.getElementById("sf-name").value.trim(),
        address: document.getElementById("sf-address").value.trim() || null,
        phone: document.getElementById("sf-phone").value.trim() || null,
      };
      if (shop) payload.is_active = document.getElementById("sf-active").checked;
      try {
        if (shop) await entracteAPI.updateShop(shop.id, payload);
        else await entracteAPI.createShop(payload);
        closeModal();
        notify(shop ? "Shop updated" : "Shop created", "success");
        await renderShops(container);
      } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
    });
  };

  const showAssignStaff = (shop) => {
    const cashiers = employees.filter((e) => e.role === "cashier" || e.role === "admin");
    showModal(`Assign staff · ${shop.name}`,
      `<p style="font-size:.875rem;color:var(--text-secondary);margin-bottom:12px">Select users to work at this shop.</p>
       <div class="assign-staff-list">
         ${cashiers.length === 0 ? '<p style="color:var(--text-muted)">No users found. Add team members first.</p>' :
           cashiers.map((e) => `
             <label class="form-check assign-staff-row">
               <input type="checkbox" class="assign-emp" data-id="${e.id}" ${e.shop_id === shop.id ? "checked" : ""}>
               <span><strong>${escAttr(e.name)}</strong> <span style="color:var(--text-muted)">(${escAttr(e.username)})</span></span>
               ${e.shop_id && e.shop_id !== shop.id ? `<span class="badge badge-warning">Other shop</span>` : ""}
             </label>`).join("")}
       </div>`,
      `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
       <button class="btn btn-primary" id="assign-save">Save assignments</button>`);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("assign-save").addEventListener("click", async () => {
      const checked = [...document.querySelectorAll(".assign-emp:checked")].map((el) => Number(el.dataset.id));
      try {
        for (const emp of cashiers) {
          const shouldAssign = checked.includes(emp.id);
          const newShopId = shouldAssign ? shop.id : (emp.shop_id === shop.id ? null : emp.shop_id);
          if (newShopId !== emp.shop_id) {
            await entracteAPI.updateEmployee(emp.id, { shop_id: newShopId });
          }
        }
        closeModal();
        notify("Staff assignments saved", "success");
        await renderShops(container);
      } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
    });
  };

  container.querySelector("#add-shop")?.addEventListener("click", () => showShopForm(null));
  container.querySelector("#add-shop-empty")?.addEventListener("click", () => showShopForm(null));
}

// --- Users ---
async function renderUsers(container) {
  const [employees, shops] = await Promise.all([entracteAPI.getEmployees(), entracteAPI.getShops()]);
  const shopOptions = shops.map((s) => `<option value="${s.id}">${escAttr(s.name)}</option>`).join("");

  const renderTable = (search = "") => {
    const t = search.toLowerCase().trim();
    const filtered = employees.filter((e) => !t
      || e.name.toLowerCase().includes(t)
      || e.username.toLowerCase().includes(t)
      || (e.email || "").toLowerCase().includes(t)
      || (e.phone || "").toLowerCase().includes(t)
      || (e.shop_name || "").toLowerCase().includes(t)
      || (e.role || "").toLowerCase().includes(t));
    const tbody = document.getElementById("users-tbody");
    if (!tbody) return;
    tbody.innerHTML = filtered.length === 0
      ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">${t ? "No team members match your search" : "No users"}</td></tr>`
      : filtered.map((e) => `
          <tr>
            <td><strong>${e.name}</strong></td><td>${e.username}</td>
            <td>${e.shop_name || "N/A"}</td>
            <td>${e.email || "N/A"}</td><td>${e.phone || "N/A"}</td>
            <td><span class="badge ${e.role === "admin" ? "badge-admin" : "badge-success"}">${e.role}</span></td>
            <td>${e.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Inactive</span>'}</td>
            <td>
              <button class="btn btn-outline btn-sm edit-u" data-id="${e.id}">Edit</button>
              <button class="btn btn-outline btn-sm reset-p" data-id="${e.id}">Reset password</button>
              ${e.id !== state.user.id ? `<button class="btn btn-outline btn-sm btn-danger-outline del-u" data-id="${e.id}">Delete</button>` : ""}
            </td>
          </tr>`).join("");
    bindUserRowActions();
  };

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Team</div>
      <div class="page-actions" style="display:flex;gap:10px;align-items:center">
        <div class="search-wrap" style="max-width:260px">
          <i data-lucide="search"></i>
          <input id="users-search" placeholder="Search team...">
        </div>
        <button class="btn btn-primary btn-sm" id="add-user"><i data-lucide="user-plus"></i> Add user</button>
      </div>
    </div>
    <div class="page-body fade-in page-enter">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Username</th><th>Shop</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody id="users-tbody"></tbody>
      </table>
    </div>`;
  icons();
  renderTable();
  document.getElementById("users-search")?.addEventListener("input", debounce((e) => renderTable(e.target.value), 200));

  function bindUserRowActions() {
    container.querySelectorAll(".edit-u").forEach((b) => {
      b.addEventListener("click", () => {
        const emp = employees.find((x) => x.id === Number(b.dataset.id));
        if (!emp) return;
        showModal("Edit team member",
          `<div class="form-group"><label>Full name</label><input id="eu-name" value="${escAttr(emp.name)}"></div>
           <div class="form-group"><label>Username</label><input id="eu-username" value="${escAttr(emp.username)}"></div>
           <div class="form-group"><label>Shop</label>
             <select id="eu-shop"><option value="">No shop</option>
             ${shops.map((s) => `<option value="${s.id}" ${emp.shop_id === s.id ? "selected" : ""}>${escAttr(s.name)}</option>`).join("")}
             </select></div>
           <div class="form-group"><label>Email</label><input id="eu-email" value="${escAttr(emp.email || "")}"></div>
           <div class="form-group"><label>Phone</label><input id="eu-phone" value="${escAttr(emp.phone || "")}"></div>
           <div class="form-group"><label>Role</label>
             <select id="eu-role"><option value="cashier" ${emp.role === "cashier" ? "selected" : ""}>Cashier</option>
             <option value="admin" ${emp.role === "admin" ? "selected" : ""}>Admin</option></select></div>
           <label class="form-check"><input type="checkbox" id="eu-active" ${emp.is_active ? "checked" : ""}> Active</label>`,
          `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
           <button class="btn btn-primary" id="eu-save">Save changes</button>`);
        document.getElementById("modal-cancel").addEventListener("click", closeModal);
        document.getElementById("eu-save").addEventListener("click", async () => {
          if (!validateForm([
            { id: "eu-name", label: "Full name", required: true },
            { id: "eu-username", label: "Username", required: true },
          ])) return;
          try {
            await entracteAPI.updateEmployee(emp.id, {
              name: document.getElementById("eu-name").value.trim(),
              username: document.getElementById("eu-username").value.trim(),
              email: document.getElementById("eu-email").value.trim() || null,
              phone: document.getElementById("eu-phone").value.trim() || null,
              role: document.getElementById("eu-role").value,
              shop_id: parseInt(document.getElementById("eu-shop").value, 10) || null,
              is_active: document.getElementById("eu-active").checked,
            });
            closeModal();
            notify("User updated", "success");
            renderUsers(container);
          } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
        });
      });
    });

    container.querySelectorAll(".reset-p").forEach((b) => {
      b.addEventListener("click", () => {
        const id = Number(b.dataset.id);
        showModal("Reset password",
          `<div class="form-group"><label>New password</label><input type="password" id="new-password"></div>`,
          `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
           <button class="btn btn-primary" id="do-reset">Reset</button>`);
        document.getElementById("modal-cancel").addEventListener("click", closeModal);
        document.getElementById("do-reset").addEventListener("click", async () => {
          try {
            await entracteAPI.resetPassword(id, document.getElementById("new-password").value);
            closeModal();
            notify("Password reset", "success");
          } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
        });
      });
    });

    container.querySelectorAll(".del-u").forEach((b) => {
      b.addEventListener("click", async () => {
        if (!await confirmDialog("Delete this team member?", { title: "Delete user", confirmLabel: "Delete", danger: true })) return;
        try {
          await entracteAPI.deleteEmployee(Number(b.dataset.id));
          notify("User deleted", "success");
          renderUsers(container);
        } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
      });
    });
  }

  document.getElementById("add-user").addEventListener("click", () => {
    showModal("Register user",
      `<div class="form-group"><label>Full name</label><input id="uf-name"></div>
       <div class="form-group"><label>Username</label><input id="uf-username"></div>
       <div class="form-group"><label>Password</label><input type="password" id="uf-password"></div>
       <div class="form-group"><label>Shop</label>
         <select id="uf-shop"><option value="">No shop</option>${shopOptions}</select>
       </div>
       <div class="form-group"><label>Role</label>
         <select id="uf-role"><option value="cashier">Cashier</option><option value="admin">Admin</option></select>
       </div>`,
      `<button class="btn btn-secondary" id="modal-cancel">Cancel</button>
       <button class="btn btn-primary" id="uf-save">Create</button>`);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("uf-save").addEventListener("click", async () => {
      if (!validateForm([
        { id: "uf-name", label: "Full name", required: true },
        { id: "uf-username", label: "Username", required: true },
        { id: "uf-password", label: "Password", required: true },
      ])) return;
      try {
        await entracteAPI.createEmployee({
          name: document.getElementById("uf-name").value.trim(),
          username: document.getElementById("uf-username").value.trim(),
          password: document.getElementById("uf-password").value,
          role: document.getElementById("uf-role").value,
          shop_id: parseInt(document.getElementById("uf-shop").value, 10) || null,
        });
        closeModal();
        notify("User created", "success");
        renderUsers(container);
      } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
    });
  });
}

// --- Quotations ---
function quoteCartToPayload() {
  return state.quoteCart.map((c) => {
    if (c.product_id) {
      return { product_id: c.product_id, quantity: c.quantity, unit_price: c.price };
    }
    return { product_name: c.name, unit_price: c.price, quantity: c.quantity };
  });
}

function buildQuoteDocFromForm() {
  const taxRate = (state.settings?.tax_rate || 0) / 100;
  const subtotal = state.quoteCart.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = state.settings?.receipt_show_tax !== false ? subtotal * taxRate : 0;
  const discount = parseFloat(document.getElementById("qb-discount")?.value || "0");
  const other = parseFloat(document.getElementById("qb-other")?.value || "0");
  const total = subtotal + tax - discount + other;
  const expiryInput = document.getElementById("qb-expiry")?.value;
  const defaultDays = state.settings?.quotation_valid_days || 30;
  const validUntil = expiryInput
    ? new Date(expiryInput + "T23:59:59").toISOString()
    : new Date(Date.now() + defaultDays * 86400000).toISOString();
  return {
    quote_number: "QTE-PREVIEW",
    items: state.quoteCart.map((i) => ({
      product_name: i.name, quantity: i.quantity, unit_price: i.price, line_total: i.price * i.quantity,
    })),
    subtotal, tax_amount: tax, discount_amount: discount, other_charges: other, total,
    customer_name: document.getElementById("qb-cust-name")?.value || "",
    customer_company: document.getElementById("qb-cust-company")?.value || "",
    customer_address: document.getElementById("qb-cust-address")?.value || "",
    customer_phone: document.getElementById("qb-cust-phone")?.value || "",
    customer_email: document.getElementById("qb-cust-email")?.value || "",
    notes: document.getElementById("qb-desc")?.value || "",
    description_of_work: document.getElementById("qb-desc")?.value || "",
    valid_until: validUntil,
    created_at: new Date().toISOString(),
  };
}

function getQuoteExpiryDefault() {
  const days = state.settings?.quotation_valid_days || 30;
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function refreshQuoteBuilderPreview() {
  const el = document.getElementById("quote-live-preview");
  if (!el) return;
  const ctx = getReceiptContext();
  el.innerHTML = receiptPreview.buildQuotationHtml(buildQuoteDocFromForm(), ctx.settings, ctx.preparedBy, state.quotePageSize);
}

async function renderQuoteBuilder(container) {
  if (!state.products.length) state.products = await entracteAPI.getProducts();
  const products = state.products;
  const isEdit = !!state.editingQuoteId;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">${isEdit ? "Edit quotation" : "New quotation"}</div>
      <div class="page-actions">
        <select id="qb-page-size" class="btn btn-secondary btn-sm" style="font-family:inherit">
          <option value="a4" ${state.quotePageSize === "a4" ? "selected" : ""}>A4</option>
          <option value="letter" ${state.quotePageSize === "letter" ? "selected" : ""}>Letter</option>
          <option value="receipt" ${state.quotePageSize === "receipt" ? "selected" : ""}>Receipt</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="qb-back"><i data-lucide="arrow-left"></i> Back</button>
        <button class="btn btn-primary btn-sm" id="qb-save"><i data-lucide="save"></i> ${isEdit ? "Update" : "Save"}</button>
      </div>
    </div>
    <div class="quote-builder page-fill">
      <div class="quote-builder-left">
        <div class="quote-form-section">
          <h3>Customer</h3>
          <div class="form-group"><label>Name</label><input id="qb-cust-name"></div>
          <div class="form-group"><label>Company</label><input id="qb-cust-company"></div>
          <div class="form-group"><label>Address</label><textarea id="qb-cust-address" rows="2"></textarea></div>
          <div class="form-group"><label>Phone</label><input id="qb-cust-phone"></div>
          <div class="form-group"><label>Email</label><input id="qb-cust-email"></div>
        </div>
        <div class="quote-form-section">
          <h3>Quote details</h3>
          <div class="form-group"><label>Valid until</label><input type="date" id="qb-expiry" value="${getQuoteExpiryDefault()}"></div>
          <div class="form-group"><label>Description of work</label><textarea id="qb-desc" rows="4" placeholder="Describe the work, services, or products..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="form-group"><label>Discount</label><input type="number" id="qb-discount" value="0" step="0.01" min="0"></div>
            <div class="form-group"><label>Other charges</label><input type="number" id="qb-other" value="0" step="0.01" min="0"></div>
          </div>
        </div>
        <div class="quote-form-section">
          <h3>Add from inventory</h3>
          <div class="search-wrap" style="margin-bottom:10px">
            <i data-lucide="search"></i>
            <input id="qb-search" placeholder="Search products...">
          </div>
          <div class="product-grid" id="qb-product-grid" style="max-height:200px;overflow-y:auto"></div>
        </div>
        <div class="quote-form-section">
          <h3>Line items</h3>
          <button type="button" class="btn btn-secondary btn-sm" id="qb-add-custom" style="margin-bottom:8px"><i data-lucide="plus"></i> Add custom line</button>
          <table class="quote-line-items"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th></th></tr></thead>
          <tbody id="qb-lines">${state.quoteCart.length === 0 ? '<tr><td colspan="5" style="color:var(--text-muted);padding:12px">Add products from inventory</td></tr>' : ""}</tbody></table>
        </div>
      </div>
      <div class="quote-builder-right">
        <div class="settings-preview-head">Live preview</div>
        <div class="receipt-preview-wrap" style="min-height:auto"><div id="quote-live-preview"></div></div>
      </div>
    </div>`;

  icons();
  const grid = document.getElementById("qb-product-grid");
  const renderGrid = (search = "") => {
    const t = search.toLowerCase();
    const filtered = products.filter((p) => p.is_active !== false && (!t || productMatchesSearch(p, t)));
    grid.innerHTML = filtered.slice(0, 24).map((p) => `
      <div class="product-tile" data-id="${p.id}" style="padding:10px">
        <div class="product-tile-name">${p.name}</div>
        <div class="product-tile-price">${formatCurrency(p.price)}</div>
      </div>`).join("");
    grid.querySelectorAll(".product-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const p = products.find((x) => x.id === Number(tile.dataset.id));
        if (!p) return;
        const ex = state.quoteCart.find((c) => c.product_id === p.id);
        if (ex) ex.quantity++; else state.quoteCart.push({ product_id: p.id, name: p.name, price: p.price, quantity: 1 });
        renderQuoteLines();
        refreshQuoteBuilderPreview();
      });
    });
  };

  const renderQuoteLines = () => {
    const tbody = document.getElementById("qb-lines");
    if (!state.quoteCart.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted);padding:12px">Add products from inventory</td></tr>';
      return;
    }
    tbody.innerHTML = state.quoteCart.map((item, idx) => `
      <tr>
        <td>${item.product_id ? item.name : `<input type="text" value="${escAttr(item.name)}" data-idx="${idx}" class="qb-name" style="width:100%;padding:4px">`}</td>
        <td><input type="number" min="1" value="${item.quantity}" data-idx="${idx}" class="qb-qty" style="width:60px;padding:4px"></td>
        <td><input type="number" min="0" step="0.01" value="${item.price}" data-idx="${idx}" class="qb-price" style="width:80px;padding:4px"></td>
        <td>${formatCurrency(item.price * item.quantity)}</td>
        <td><button class="btn btn-ghost btn-sm qb-rm" data-idx="${idx}">×</button></td>
      </tr>`).join("");
    tbody.querySelectorAll(".qb-name").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.quoteCart[Number(inp.dataset.idx)].name = inp.value.trim() || "Item";
        refreshQuoteBuilderPreview();
      });
    });
    tbody.querySelectorAll(".qb-qty").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.quoteCart[Number(inp.dataset.idx)].quantity = Math.max(1, parseInt(inp.value, 10));
        renderQuoteLines();
        refreshQuoteBuilderPreview();
      });
    });
    tbody.querySelectorAll(".qb-price").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.quoteCart[Number(inp.dataset.idx)].price = Math.max(0, parseFloat(inp.value) || 0);
        renderQuoteLines();
        refreshQuoteBuilderPreview();
      });
    });
    tbody.querySelectorAll(".qb-rm").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.quoteCart.splice(Number(btn.dataset.idx), 1);
        renderQuoteLines();
        refreshQuoteBuilderPreview();
      });
    });
  };

  renderGrid();
  renderQuoteLines();
  refreshQuoteBuilderPreview();

  document.getElementById("qb-add-custom").addEventListener("click", () => {
    state.quoteCart.push({ name: "Custom item", price: 0, quantity: 1 });
    renderQuoteLines();
    refreshQuoteBuilderPreview();
    icons();
  });

  document.getElementById("qb-search").addEventListener("input", debounce((e) => renderGrid(e.target.value.trim()), 150));
  container.querySelectorAll("#qb-cust-name,#qb-cust-company,#qb-cust-address,#qb-cust-phone,#qb-cust-email,#qb-expiry,#qb-desc,#qb-discount,#qb-other").forEach((el) => {
    el.addEventListener("input", debounce(refreshQuoteBuilderPreview, 150));
  });

  document.getElementById("qb-page-size").addEventListener("change", (e) => {
    state.quotePageSize = e.target.value;
    saveUserProfile({ quote_page_size: state.quotePageSize }).catch(() => {});
    refreshQuoteBuilderPreview();
  });

  document.getElementById("qb-back").addEventListener("click", () => {
    state.quoteView = "list";
    state.editingQuoteId = null;
    runPage(renderQuotations, container, "quotations");
  });
  document.getElementById("qb-save").addEventListener("click", async () => {
    if (!state.quoteCart.length) { notify("Add at least one item", "warning"); return; }
    try {
      const doc = buildQuoteDocFromForm();
      const expiryVal = document.getElementById("qb-expiry")?.value;
      const payload = {
        items: quoteCartToPayload(),
        customer_name: doc.customer_name || null,
        customer_company: doc.customer_company || null,
        customer_address: doc.customer_address || null,
        customer_phone: doc.customer_phone || null,
        customer_email: doc.customer_email || null,
        notes: doc.notes || null,
        description_of_work: doc.description_of_work || null,
        other_charges: doc.other_charges,
        discount_amount: doc.discount_amount,
        valid_until: expiryVal ? new Date(expiryVal + "T23:59:59").toISOString() : null,
      };
      const wasEdit = !!state.editingQuoteId;
      const quote = state.editingQuoteId
        ? await entracteAPI.updateQuotation(state.editingQuoteId, payload)
        : await entracteAPI.createQuotation(payload);
      state.quoteCart = [];
      state.quoteView = "list";
      state.editingQuoteId = null;
      notify(`Quotation ${quote.quote_number} ${wasEdit ? "updated" : "saved"}`, "success");
      showDocPreview(quote, "quotation");
      await runPage(renderQuotations, container, "quotations");
    } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
  });
}

async function renderQuotations(container) {
  if (state.quoteView === "builder") {
    await renderQuoteBuilder(container);
    return;
  }
  const quotes = await entracteAPI.getQuotations();
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Quotations</div>
      <div class="page-actions">
        <button class="btn btn-primary btn-sm" id="new-quote"><i data-lucide="plus"></i> New quotation</button>
      </div>
    </div>
    <div class="page-body fade-in">
      <table class="data-table">
        <thead><tr><th>Quote #</th><th>Customer</th><th>Total</th><th>Valid until</th><th>Date</th><th></th></tr></thead>
        <tbody>${quotes.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">No quotations yet. Create one to get started.</td></tr>' :
          quotes.map((q) => `
            <tr>
              <td><strong>${q.quote_number}</strong></td>
              <td>${q.customer_name || q.customer_company || "N/A"}</td>
              <td>${formatCurrency(q.total)}</td>
              <td>${q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "N/A"}</td>
              <td>${new Date(q.created_at).toLocaleString()}</td>
              <td>
                <button class="btn btn-outline btn-sm edit-q" data-id="${q.id}">Edit</button>
                <button class="btn btn-outline btn-sm view-q" data-id="${q.id}">View</button>
                <button class="btn btn-outline btn-sm print-q" data-id="${q.id}">Print</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  icons();

  document.getElementById("new-quote").addEventListener("click", () => {
    state.quoteView = "builder";
    state.editingQuoteId = null;
    state.quoteCart = [];
    runPage(renderQuotations, container, "quotations");
  });

  container.querySelectorAll(".edit-q").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        const q = await entracteAPI.getQuotation(Number(b.dataset.id));
        state.editingQuoteId = q.id;
        state.quoteView = "builder";
        state.quoteCart = q.items.map((i) => ({
          product_id: i.product_id, name: i.product_name, price: i.unit_price, quantity: i.quantity,
        }));
        await runPage(renderQuotations, container, "quotations");
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
        setVal("qb-cust-name", q.customer_name);
        setVal("qb-cust-company", q.customer_company);
        setVal("qb-cust-address", q.customer_address);
        setVal("qb-cust-phone", q.customer_phone);
        setVal("qb-cust-email", q.customer_email);
        setVal("qb-desc", q.description_of_work || q.notes);
        setVal("qb-discount", q.discount_amount);
        setVal("qb-other", q.other_charges);
        if (q.valid_until) {
          setVal("qb-expiry", new Date(q.valid_until).toISOString().slice(0, 10));
        }
        refreshQuoteBuilderPreview();
      } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
    });
  });

  document.querySelectorAll(".view-q").forEach((b) => {
    b.addEventListener("click", async () => {
      showDocPreview(await entracteAPI.getQuotation(Number(b.dataset.id)), "quotation");
    });
  });
  document.querySelectorAll(".print-q").forEach((b) => {
    b.addEventListener("click", async () => {
      const q = await entracteAPI.getQuotation(Number(b.dataset.id));
      const ctx = getReceiptContext();
      const html = receiptPreview.buildQuotationHtml(q, ctx.settings, ctx.preparedBy, state.quotePageSize);
      receiptPreview.printHtml(receiptPreview.applyLogo(html), `Quotation ${q.quote_number}`, state.quotePageSize, "quotation");
    });
  });
}

// --- Settings ---
async function renderCashierSettings(container) {
  const printers = await loadPrinters();
  const user = state.user || {};
  const selectedPrinter = user.printer_name || printers.find((p) => p.isDefault)?.name || printers[0]?.name || "";
  const selected = printers.find((p) => p.name === selectedPrinter) || printers.find((p) => p.isDefault) || printers[0];
  const pageSize = user.printer_page_size || selected?.pageSize || "receipt";
  const theme = user.theme || "light";

  const printerOptions = printers.length
    ? printers.map((p) => `<option value="${escAttr(p.name)}" ${p.name === selectedPrinter ? "selected" : ""}>${escAttr(p.name)}${p.isDefault ? " (system default)" : ""}</option>`).join("")
    : `<option value="">No printers detected</option>`;

  container.innerHTML = `
    <div class="page-header"><div class="page-title">My settings</div></div>
    <div class="page-body fade-in" style="max-width:560px">
      <p style="color:var(--text-secondary);font-size:.875rem;margin-bottom:20px">These preferences are saved to your profile only and do not affect other users.</p>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <div class="theme-toggle-row">
          <div><strong>Dark theme</strong>
            <div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px">Your personal display preference</div>
          </div>
          <button type="button" class="theme-switch ${theme === "dark" ? "on" : ""}" id="cashier-theme" aria-label="Toggle dark theme"></button>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div class="form-group">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <label style="margin:0"><strong>Receipt printer</strong></label>
            <button type="button" class="btn btn-secondary btn-sm" id="cashier-refresh-printers">Refresh</button>
          </div>
          <select id="cashier-printer" style="width:100%">${printerOptions}</select>
          <p style="font-size:.8rem;color:var(--text-muted);margin-top:8px">Choose the printer you use at this workstation.</p>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label><strong>Detected page size</strong></label>
          <div id="cashier-page-size" class="profile-page-size-badge">${formatPageSize(pageSize)}</div>
          <p style="font-size:.8rem;color:var(--text-muted);margin-top:8px">Auto-detected from the selected printer driver.</p>
        </div>
      </div>
    </div>`;

  const updatePageSizeLabel = (printerName, list) => {
    const p = list.find((x) => x.name === printerName);
    const detected = p?.pageSize || "receipt";
    document.getElementById("cashier-page-size").textContent = formatPageSize(detected);
    return detected;
  };

  document.getElementById("cashier-theme").addEventListener("click", async (e) => {
    e.currentTarget.classList.toggle("on");
    const newTheme = e.currentTarget.classList.contains("on") ? "dark" : "light";
    applyTheme(newTheme);
    try {
      await saveUserProfile({ theme: newTheme });
      notify("Theme saved to your profile", "success");
    } catch (err) { notify(err.message, "error"); }
  });

  document.getElementById("cashier-printer").addEventListener("change", async (e) => {
    const name = e.target.value;
    if (!name) return;
    const detected = updatePageSizeLabel(name, printers);
    try {
      await saveUserProfile({ printer_name: name, printer_page_size: detected });
      notify("Printer saved to your profile", "success");
    } catch (err) { notify(err.message, "error"); }
  });

  document.getElementById("cashier-refresh-printers").addEventListener("click", async () => {
    const list = await loadPrinters();
    const sel = document.getElementById("cashier-printer");
    const current = sel.value;
    sel.innerHTML = list.length
      ? list.map((p) => `<option value="${escAttr(p.name)}" ${p.name === current ? "selected" : ""}>${escAttr(p.name)}${p.isDefault ? " (system default)" : ""}</option>`).join("")
      : `<option value="">No printers detected</option>`;
    if (current) updatePageSizeLabel(current, list);
    notify(list.length ? `Found ${list.length} printer(s)` : "No printers detected", list.length ? "success" : "warning");
  });
}

async function renderLogs(container) {
  const logs = await entracteAPI.getActivityLogs({ limit: 500 });
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Activity logs</div>
      <div class="toolbar" style="margin:0">
        <div class="search-wrap" style="min-width:240px">
          <i data-lucide="search"></i>
          <input id="logs-search" placeholder="Search action, user, error, page...">
        </div>
        <button class="btn btn-secondary btn-sm" id="logs-refresh"><i data-lucide="refresh-cw"></i> Refresh</button>
      </div>
    </div>
    <div class="page-body fade-in">
      <div class="card" style="padding:0;overflow:hidden">
        <div class="logs-table-wrap">
          <table class="data-table logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Page</th>
                <th>Step</th>
                <th>Status</th>
                <th>Error</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody id="logs-tbody">${renderLogRows(logs)}</tbody>
          </table>
        </div>
      </div>
      <p style="font-size:.8rem;color:var(--text-muted);margin-top:12px">Each API step is logged with HTTP status. Errors show the exact message returned. Latest ${logs.length} entries.</p>
    </div>`;
  icons();

  const filterLogs = debounce(async () => {
    const search = document.getElementById("logs-search")?.value.trim() || "";
    const rows = await entracteAPI.getActivityLogs({ limit: 500, search: search || undefined });
    const tbody = document.getElementById("logs-tbody");
    if (!tbody) return;
    tbody.innerHTML = renderLogRows(rows);
  }, 300);

  document.getElementById("logs-search")?.addEventListener("input", filterLogs);
  document.getElementById("logs-refresh")?.addEventListener("click", () => runPage(renderLogs, container, "logs"));
}

async function renderSettings(container) {
  const s = await entracteAPI.getSettings();
  state.settings = s;
  const printers = await loadPrinters();
  let previewDocType = "receipt";
  const printerOptions = printers.length
    ? printers.map((p) => `<option value="${escAttr(p.name)}" ${p.name === s.printer_name || p.isDefault ? "selected" : ""}>${escAttr(p.name)}${p.isDefault ? " (default)" : ""}</option>`).join("")
    : `<option value="${escAttr(s.printer_name)}">${escAttr(s.printer_name)}</option>`;

  container.innerHTML = `
    <div class="page-header"><div class="page-title">Settings</div></div>
    <div class="page-body fade-in settings-layout">
      <div class="settings-form">
        <div class="settings-tabs">
          <button class="settings-tab active" data-tab="general">General</button>
          <button class="settings-tab" data-tab="appearance">Appearance</button>
          <button class="settings-tab" data-tab="receipt">Receipt</button>
          <button class="settings-tab" data-tab="quotation">Quotation</button>
        </div>

        <div class="settings-panel active" id="panel-general">
          <div class="form-group"><label>Store name</label><input id="set-name" value="${escAttr(s.store_name)}"></div>
          <div class="form-group"><label>Address</label><input id="set-address" value="${escAttr(s.address)}"></div>
          <div class="form-group"><label>Email</label><input id="set-email" value="${escAttr(s.email)}"></div>
          <div class="form-group"><label>Phone</label><input id="set-phone" value="${escAttr(s.receipt_phone || "")}"></div>
          <div class="form-group"><label>Tax rate (%)</label><input type="number" id="set-tax" value="${s.tax_rate}" step="0.01"></div>
          <div class="form-group"><label>Currency</label><input id="set-currency" value="${escAttr(s.currency)}"></div>
          <div class="form-group"><label>Receipt printer</label>
            <div style="display:flex;gap:8px">
              <select id="set-printer" style="flex:1">${printerOptions}</select>
              <button type="button" class="btn btn-secondary btn-sm" id="refresh-printers">Detect</button>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="panel-appearance">
          <div class="theme-toggle-row">
            <div><strong>Dark theme</strong><div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px">Your personal display preference (does not affect other users)</div></div>
            <button type="button" class="theme-switch ${(state.user?.theme || "light") === "dark" ? "on" : ""}" id="set-theme-dark" aria-label="Toggle dark theme"></button>
          </div>
        </div>

        <div class="settings-panel" id="panel-receipt">
          <div class="form-group"><label>Tagline</label><input id="set-tagline" value="${escAttr(s.receipt_tagline || "")}"></div>
          <div class="form-group"><label>Header text</label><textarea id="set-header" rows="2">${escAttr(s.receipt_header || "")}</textarea></div>
          <div class="form-group"><label>Footer</label><textarea id="set-footer" rows="2">${escAttr(s.receipt_footer)}</textarea></div>
          <div class="form-group"><label>Brand line</label><input id="set-brand" value="${escAttr(s.receipt_brand_line || "")}"></div>
          <div class="form-group"><label>Website</label><input id="set-website" value="${escAttr(s.receipt_website || "")}"></div>
          <label class="form-check"><input type="checkbox" id="set-show-logo" ${s.receipt_show_logo !== false ? "checked" : ""}> Show logo</label>
          <label class="form-check"><input type="checkbox" id="set-show-tax" ${s.receipt_show_tax !== false ? "checked" : ""}> Show tax line</label>
          <label class="form-check"><input type="checkbox" id="set-show-payment" ${s.receipt_show_payment !== false ? "checked" : ""}> Show payment details</label>
        </div>

        <div class="settings-panel" id="panel-quotation">
          <div class="form-group"><label>Document title</label><input id="set-quote-title" value="${escAttr(s.quote_title || "QUOTATION")}"></div>
          <div class="form-group"><label>Fax</label><input id="set-quote-fax" value="${escAttr(s.quote_fax || "")}"></div>
          <div class="form-group"><label>Valid for (days)</label><input type="number" id="set-quote-days" value="${s.quotation_valid_days || 30}" min="1"></div>
          <div class="form-group"><label>Thank you line</label><input id="set-quote-thank" value="${escAttr(s.quote_thank_you || "Thank you for your business!")}"></div>
          <div class="form-group"><label>Terms / disclaimer</label><textarea id="set-quote-terms" rows="3">${escAttr(s.quote_terms_text || "")}</textarea></div>
          <div class="form-group"><label>Footer note</label><textarea id="set-quote-footer" rows="2">${escAttr(s.quotation_footer || "")}</textarea></div>
          <div class="form-group"><label>Contact line</label><input id="set-quote-contact" value="${escAttr(s.quote_contact_line || "")}"></div>
          <label class="form-check"><input type="checkbox" id="set-quote-acceptance" ${s.quote_show_acceptance !== false ? "checked" : ""}> Show customer acceptance block</label>
          <label class="form-check"><input type="checkbox" id="set-quote-prepared" ${s.quote_show_prepared_by !== false ? "checked" : ""}> Show prepared by</label>
        </div>

        <button class="btn btn-primary" id="save-settings" style="margin-top:20px">Save settings</button>
      </div>

      <div class="settings-preview-sticky">
        <div class="settings-preview-head">Live preview</div>
        <div class="preview-type-toggle">
          <button class="preview-type-btn active" data-preview="receipt">Receipt</button>
          <button class="preview-type-btn" data-preview="quotation">Quotation</button>
        </div>
        <div class="receipt-preview-wrap"><div id="receipt-live-preview"></div></div>
      </div>
    </div>`;

  function currentPreviewSettings() {
    return { ...s, ...getSettingsFromForm("set"), currency: document.getElementById("set-currency")?.value || s.currency };
  }

  function refreshPreview() {
    const el = document.getElementById("receipt-live-preview");
    if (!el) return;
    const doc = receiptPreview.sampleReceiptDoc();
    el.innerHTML = receiptPreview.buildDocHtml(doc, currentPreviewSettings(), previewDocType, state.user?.name || "Admin");
  }

  container.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("active"));
      container.querySelectorAll(".settings-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
      if (tab.dataset.tab === "receipt") previewDocType = "receipt";
      if (tab.dataset.tab === "quotation") previewDocType = "quotation";
      container.querySelectorAll(".preview-type-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.preview === previewDocType);
      });
      refreshPreview();
    });
  });

  container.querySelectorAll(".preview-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".preview-type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      previewDocType = btn.dataset.preview;
      refreshPreview();
    });
  });

  document.getElementById("set-theme-dark").addEventListener("click", async (e) => {
    e.currentTarget.classList.toggle("on");
    const newTheme = e.currentTarget.classList.contains("on") ? "dark" : "light";
    applyTheme(newTheme);
    try {
      await saveUserProfile({ theme: newTheme });
      notify("Theme saved to your profile", "success");
    } catch (err) { notify(err.message, "error"); }
  });

  document.getElementById("refresh-printers").addEventListener("click", async () => {
    const list = await loadPrinters();
    const sel = document.getElementById("set-printer");
    sel.innerHTML = list.length
      ? list.map((p) => `<option value="${escAttr(p.name)}" ${p.isDefault ? "selected" : ""}>${escAttr(p.name)}${p.isDefault ? " (default)" : ""}</option>`).join("")
      : `<option value="">No printers found</option>`;
    notify(list.length ? `Found ${list.length} printer(s)` : "No printers detected", list.length ? "success" : "warning");
  });

  container.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("input", debounce(refreshPreview, 150));
    el.addEventListener("change", refreshPreview);
  });

  refreshPreview();

  document.getElementById("save-settings").addEventListener("click", async () => {
    try {
      const payload = getSettingsFromForm("set");
      payload.currency = document.getElementById("set-currency").value;
      payload.printer_name = document.getElementById("set-printer").value;
      state.settings = await entracteAPI.updateSettings(payload);
      document.getElementById("store-name-display").textContent = state.settings.store_name;
      refreshPreview();
      notify("Settings saved", "success");
      logActivity("Saved settings", "settings");
    } catch (e) {
      if (isSessionError(e)) return;
      notify(e.message, "error");
    }
  });
}

document.getElementById("toggle-password")?.addEventListener("click", () => {
  const input = document.getElementById("login-password");
  const btn = document.getElementById("toggle-password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.innerHTML = show ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  icons();
});

document.getElementById("clear-session-btn")?.addEventListener("click", () => {
  entracteAPI.clearToken();
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  errEl.textContent = "";
  notify("Saved session cleared. Sign in again.", "info");
});

// Init — always start at login screen
document.addEventListener("DOMContentLoaded", () => {
  entracteAPI.clearToken();
  window.__currentPage = "login";
  document.documentElement.setAttribute("data-theme", "dark");
  initSidebar();
  document.getElementById("sidebar-end-shift")?.addEventListener("click", () => showEndShiftModal());
  icons();
});
