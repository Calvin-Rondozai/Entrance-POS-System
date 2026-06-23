function currencySym(currency) {
  const map = { USD: "$", EUR: "€", GBP: "£", ZAR: "R", ZWL: "Z$" };
  return map[currency] || currency || "$";
}

function fmtCurrency(amount, currency) {
  const cur = currency || "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(Number(amount || 0));
  } catch {
    return `${currencySym(cur)}${Number(amount || 0).toFixed(2)}`;
  }
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(amount, currency) {
  const n = Number(amount || 0);
  const formatted = fmtCurrency(Math.abs(n), currency);
  return n < 0 ? `(${formatted})` : formatted;
}

let logoSrc = "ES.png";
function setLogoDataUrl(url) {
  if (url) logoSrc = url;
}
function applyLogo(html) {
  let out = String(html);
  if (logoSrc && logoSrc !== "ES.png") {
    out = out.replace(/src="ES\.png"/g, `src="${logoSrc}"`);
    out = out.replace(/src='ES\.png'/g, `src='${logoSrc}'`);
  }
  return out;
}

const PREVIEW_SCOPE = ".doc-preview-root";

function receiptCssText() {
  const s = PREVIEW_SCOPE;
  return `
    ${s} { width: 100%; display: flex; justify-content: center; }
    ${s} .receipt-paper {
      font-family: "Courier New", Courier, monospace; background: #fff; color: #1a1a1a;
      border: 1px solid #ddd; padding: 20px 16px; width: 320px; max-width: 100%;
      font-size: 12px; line-height: 1.5; box-sizing: border-box;
    }
    ${s} .rcpt-logo { text-align: center; margin-bottom: 8px; }
    ${s} .rcpt-logo img { width: 120px; height: auto; object-fit: contain; }
    ${s} .q-logo-top { text-align: center; margin-bottom: 12px; }
    ${s} .q-logo-top img { max-height: 64px; max-width: 180px; object-fit: contain; }
    ${s} .rcpt-title { text-align: center; font-weight: 700; font-size: 15px; margin-bottom: 2px; }
    ${s} .rcpt-muted { text-align: center; color: #555; font-size: 11px; }
    ${s} .rcpt-line { font-size: 11px; }
    ${s} .rcpt-divider { height: 6px; }
    ${s} .rcpt-rule { border-top: 1px dashed #bbb; margin: 8px 0; }
    ${s} .rcpt-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
    ${s} .rcpt-double { text-align: center; font-weight: 700; font-size: 14px; margin: 8px 0; border-top: 2px solid #333; border-bottom: 2px solid #333; padding: 6px 0; }
    ${s} .rcpt-footer { text-align: center; margin-top: 12px; font-size: 11px; white-space: pre-wrap; }
    ${s} .rcpt-note { margin-top: 8px; font-size: 11px; font-style: italic; }
    ${s} .balanced { color: #16a34a; } ${s} .shortage { color: #dc2626; }
    @media print { ${s} .receipt-paper { box-shadow: none; } }
  `;
}

function wrapReceiptDocument(html) {
  return `<div class="doc-preview-root"><style>${receiptCssText()}</style>${applyLogo(html)}</div>`;
}

function buildExportDocument(html, docType = "receipt", pageSize = "a4") {
  const isQuote = docType === "quotation" || html.includes("quote-document");
  const wrapped = isQuote ? wrapQuotationDocument(html, pageSize) : wrapReceiptDocument(html);
  const pageCss = isQuote ? pageSizeStyles(pageSize) : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12mm;background:#fff}${pageCss}</style></head><body>${wrapped}</body></html>`;
}

function buildReceiptHtml(doc, settings, cashierName = "") {
  const currency = settings.currency || "USD";
  const showLogo = settings.receipt_show_logo !== false;
  const showTax = settings.receipt_show_tax !== false;
  const showPayment = settings.receipt_show_payment !== false;
  const parts = [];

  if (showLogo) parts.push(`<div class="rcpt-logo"><img src="${logoSrc}" alt="Logo"></div>`);
  parts.push(`<div class="rcpt-title">${esc(settings.store_name || "Store")}</div>`);
  if (settings.receipt_tagline) parts.push(`<div class="rcpt-muted">${esc(settings.receipt_tagline)}</div>`);
  if (settings.address) parts.push(`<div class="rcpt-muted">${esc(settings.address)}</div>`);
  if (settings.receipt_phone) parts.push(`<div class="rcpt-muted">${esc(settings.receipt_phone)}</div>`);
  if (settings.email) parts.push(`<div class="rcpt-muted">${esc(settings.email)}</div>`);
  if (settings.receipt_header) {
    settings.receipt_header.split("\n").forEach((l) => {
      if (l.trim()) parts.push(`<div class="rcpt-muted">${esc(l.trim())}</div>`);
    });
  }

  const now = doc.created_at ? new Date(doc.created_at) : new Date();
  parts.push(`<div class="rcpt-divider"></div>`);
  parts.push(`<div class="rcpt-line">${now.toLocaleDateString()}  ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>`);
  parts.push(`<div class="rcpt-line">Ticket: #${doc.id || "N/A"}</div>`);
  parts.push(`<div class="rcpt-line">Order: ${esc(doc.order_number || "PREVIEW")}</div>`);
  if (cashierName) parts.push(`<div class="rcpt-line">Cashier: ${esc(cashierName)}</div>`);
  if (doc.shop_name) parts.push(`<div class="rcpt-line">Shop: ${esc(doc.shop_name)}</div>`);
  parts.push(`<div class="rcpt-rule"></div>`);

  (doc.items || []).forEach((item) => {
    parts.push(`<div class="rcpt-row"><span>${esc(`${item.quantity} x ${item.product_name}`)}</span><span>${fmtMoney(item.line_total, currency)}</span></div>`);
  });

  parts.push(`<div class="rcpt-rule"></div>`);
  parts.push(`<div class="rcpt-row"><span>SUBTOTAL</span><span>${fmtMoney(doc.subtotal || 0, currency)}</span></div>`);
  if (showTax && doc.tax_amount > 0) parts.push(`<div class="rcpt-row"><span>TAX</span><span>${fmtMoney(doc.tax_amount, currency)}</span></div>`);
  if (doc.discount_amount > 0) parts.push(`<div class="rcpt-row"><span>DISCOUNT</span><span>${fmtMoney(-doc.discount_amount, currency)}</span></div>`);
  parts.push(`<div class="rcpt-double">TOTAL: ${fmtMoney(doc.total || 0, currency)}</div>`);

  if (showPayment) {
    parts.push(`<div class="rcpt-rule"></div>`);
    parts.push(`<div class="rcpt-row"><span>${(doc.payment_method || "cash").toUpperCase()}</span><span>${fmtMoney(doc.amount_paid || 0, currency)}</span></div>`);
    parts.push(`<div class="rcpt-row"><span>CHANGE</span><span>${fmtMoney(doc.change_given || 0, currency)}</span></div>`);
  }

  if (doc.notes) parts.push(`<div class="rcpt-line rcpt-note">Note: ${esc(doc.notes)}</div>`);
  if (settings.receipt_footer) parts.push(`<div class="rcpt-footer">${esc(settings.receipt_footer)}</div>`);
  if (settings.receipt_brand_line) parts.push(`<div class="rcpt-muted">${esc(settings.receipt_brand_line)}</div>`);
  if (settings.receipt_website) parts.push(`<div class="rcpt-muted">${esc(settings.receipt_website)}</div>`);

  return `<div class="receipt-paper">${parts.join("")}</div>`;
}

function fmtDateShort(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

function quotationCssText(pageSize = "a4") {
  const maxW = pageSize === "letter" ? "8.5in" : pageSize === "receipt" ? "320px" : "210mm";
  const fs = pageSize === "receipt" ? "9px" : "11px";
  const s = PREVIEW_SCOPE;
  return `
    ${s} { width: 100%; display: flex; justify-content: center; }
    ${s} .quote-document {
      background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif;
      font-size: ${fs}; line-height: 1.45; padding: 24px; max-width: ${maxW}; width: 100%;
      box-sizing: border-box;
    }
    ${s} .q-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; }
    ${s} .q-company { font-size: ${fs}; line-height: 1.5; }
    ${s} .q-company strong { font-size: ${pageSize === "receipt" ? "11px" : "12px"}; }
    ${s} .q-title { font-size: ${pageSize === "receipt" ? "20px" : "28px"}; font-weight: 700; letter-spacing: .04em; color: #333; text-align: right; }
    ${s} .q-meta { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: ${pageSize === "receipt" ? "8px" : "10px"}; }
    ${s} .q-meta th, ${s} .q-meta td { border: 1px solid #999; padding: 6px 8px; text-align: center; }
    ${s} .q-meta th { background: #d9d9d9; font-weight: 700; }
    ${s} .q-info-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; align-items: flex-start; }
    ${s} .q-info-block { flex: 1; min-width: 0; }
    ${s} .q-section-head { background: #d9d9d9; font-weight: 700; padding: 5px 8px; font-size: ${pageSize === "receipt" ? "8px" : "10px"}; border: 1px solid #999; border-bottom: none; }
    ${s} .q-info-body { border: 1px solid #999; padding: 10px; min-height: 72px; font-size: ${fs}; }
    ${s} .q-prepared { font-size: ${fs}; padding-top: 24px; white-space: nowrap; font-style: italic; }
    ${s} .q-desc-box { border: 1px solid #999; min-height: 80px; padding: 10px; margin-bottom: 12px; white-space: pre-wrap; font-size: ${fs}; }
    ${s} .q-items { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: ${fs}; }
    ${s} .q-items th, ${s} .q-items td { border: 1px solid #999; padding: 6px 8px; }
    ${s} .q-items th { background: #d9d9d9; font-weight: 700; text-align: left; }
    ${s} .q-num { text-align: right; white-space: nowrap; }
    ${s} .q-label { text-align: right; font-weight: 600; }
    ${s} .q-thank { font-style: italic; vertical-align: middle; }
    ${s} .q-total-row td { font-weight: 700; background: #f5f5f5; }
    ${s} .q-terms, ${s} .q-contact, ${s} .q-footer { font-size: ${pageSize === "receipt" ? "8px" : "10px"}; margin: 10px 0; line-height: 1.5; color: #000; }
    ${s} .q-accept { margin-top: 16px; font-size: ${fs}; }
    ${s} .q-accept-title { font-weight: 700; margin-bottom: 10px; background: #d9d9d9; padding: 5px 8px; border: 1px solid #999; }
    ${s} .q-accept-row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 12px; }
    ${s} .q-accept-line { flex: 1; border-bottom: 1px solid #333; height: 20px; }
    ${s} .q-accept-line.q-short { max-width: 120px; }
    ${s} .q-accept-lbl { font-size: ${pageSize === "receipt" ? "8px" : "10px"}; color: #333; white-space: nowrap; }
    ${s} .q-logo-top { text-align: center; margin-bottom: 12px; }
    ${s} .q-logo-top img { max-height: 56px; max-width: 160px; object-fit: contain; }
    @media print { ${s} .quote-document { box-shadow: none; border: none; } }
  `;
}

function wrapQuotationDocument(html, pageSize = "a4") {
  return `<div class="doc-preview-root"><style>${quotationCssText(pageSize)}</style>${applyLogo(html)}</div>`;
}

function buildQuotationHtml(doc, settings, preparedBy = "", pageSize = "a4") {
  const currency = settings.currency || "USD";
  const now = doc.created_at ? new Date(doc.created_at) : new Date();
  const validUntil = doc.valid_until ? new Date(doc.valid_until) : new Date(Date.now() + (settings.quotation_valid_days || 30) * 86400000);
  const items = doc.items || [];
  const rows = items.map((item) => `
    <tr>
      <td>${esc(item.product_name)}</td>
      <td class="q-num">${item.quantity}</td>
      <td class="q-num">${fmtMoney(item.unit_price, currency)}</td>
      <td class="q-num">${fmtMoney(item.line_total, currency)}</td>
    </tr>`).join("");

  const discountRow = doc.discount_amount > 0
    ? `<tr><td>Discount</td><td class="q-num"></td><td class="q-num"></td><td class="q-num">${fmtMoney(-doc.discount_amount, currency)}</td></tr>` : "";

  const acceptance = settings.quote_show_acceptance !== false ? `
    <div class="q-accept">
      <div class="q-accept-title">Customer Acceptance</div>
      <div class="q-accept-row"><span>X</span><div class="q-accept-line"></div><span class="q-accept-lbl">Signature</span></div>
      <div class="q-accept-row"><div class="q-accept-line"></div><span class="q-accept-lbl">Printed Name</span></div>
      <div class="q-accept-row"><div class="q-accept-line q-short"></div><span class="q-accept-lbl">Date</span></div>
    </div>` : "";

  const prepared = settings.quote_show_prepared_by !== false
    ? `<div class="q-prepared"><strong>Prepared By:</strong> ${esc(preparedBy || "N/A")}</div>` : "";

  const showLogo = settings.receipt_show_logo !== false;
  const descText = doc.description_of_work || doc.notes || "";

  return `<div class="quote-document page-${pageSize}">
    ${showLogo ? `<div class="q-logo-top"><img src="${logoSrc}" alt="Logo"></div>` : ""}
    <div class="q-header">
      <div class="q-company">
        <strong>${esc(settings.store_name || "Company Name")}</strong><br>
        ${settings.address ? `${esc(settings.address)}<br>` : "[Street Address]<br>[City, ST ZIP]<br>"}
        ${settings.receipt_phone ? `Phone: ${esc(settings.receipt_phone)}<br>` : "Phone: (000) 000-0000<br>"}
        ${settings.quote_fax ? `Fax: ${esc(settings.quote_fax)}<br>` : ""}
        ${settings.email ? `${esc(settings.email)}` : "[E-mail Address]"}
      </div>
      <div class="q-title">${esc(settings.quote_title || "QUOTATION")}</div>
    </div>
    <table class="q-meta">
      <tr>
        <th>QUOTE #</th><th>DATE</th><th>CUSTOMER ID</th><th>VALID UNTIL</th>
      </tr>
      <tr>
        <td>${esc(doc.quote_number || "PREVIEW")}</td>
        <td>${fmtDateShort(now)}</td>
        <td>${esc(doc.customer_id || doc.id || "N/A")}</td>
        <td>${fmtDateShort(validUntil)}</td>
      </tr>
    </table>
    <div class="q-info-row">
      <div class="q-info-block">
        <div class="q-section-head">CUSTOMER INFO</div>
        <div class="q-info-body">
          ${doc.customer_name ? `${esc(doc.customer_name)}<br>` : "[Name]<br>"}
          ${doc.customer_company ? `${esc(doc.customer_company)}<br>` : ""}
          ${doc.customer_address ? `${esc(doc.customer_address)}<br>` : "[Address]<br>"}
          ${doc.customer_phone || doc.customer_email ? `${esc(doc.customer_phone || "")}${doc.customer_phone && doc.customer_email ? " · " : ""}${esc(doc.customer_email || "")}` : "[Phone, E-mail]"}
        </div>
      </div>
      ${prepared}
    </div>
    <div class="q-section-head">DESCRIPTION OF WORK</div>
    <div class="q-desc-box">${descText ? esc(descText) : "N/A"}</div>
    <table class="q-items">
      <thead>
        <tr><th>ITEMIZED COSTS</th><th>QTY</th><th>UNIT PRICE</th><th>AMOUNT</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:#888">No items</td></tr>`}</tbody>
      <tfoot>
        <tr><td colspan="2" class="q-thank">${esc(settings.quote_thank_you || "Thank you for your business!")}</td>
            <td class="q-label">SUBTOTAL</td><td class="q-num">${fmtMoney(doc.subtotal, currency)}</td></tr>
        ${doc.tax_amount > 0 ? `<tr><td colspan="3" class="q-label">TAX</td><td class="q-num">${fmtMoney(doc.tax_amount, currency)}</td></tr>` : ""}
        ${discountRow}
        <tr><td colspan="3" class="q-label">OTHER</td><td class="q-num">${doc.other_charges > 0 ? fmtMoney(doc.other_charges, currency) : "N/A"}</td></tr>
        <tr class="q-total-row"><td colspan="3" class="q-label">TOTAL QUOTE</td><td class="q-num">${fmtMoney(doc.total, currency)}</td></tr>
      </tfoot>
    </table>
    <p class="q-terms">${esc(settings.quote_terms_text || "")}</p>
    ${acceptance}
    <p class="q-contact">${esc(settings.quote_contact_line || "")}</p>
    ${settings.quotation_footer ? `<p class="q-footer">${esc(settings.quotation_footer)}</p>` : ""}
  </div>`;
}

function buildShiftReportHtml(report, settings) {
  const currency = settings.currency || "USD";
  const fmt = (n) => fmtMoney(n, currency);
  const opened = report.opened_at ? new Date(report.opened_at).toLocaleString() : "N/A";
  const closed = report.closed_at ? new Date(report.closed_at).toLocaleString() : "N/A";
  const balanced = (report.total_shortage || 0) <= 0;
  const rows = [
    ["Opening float", fmt(report.opening_float)],
    ["Expected cash", fmt(report.expected_cash)],
    ["Counted cash", fmt(report.closing_cash)],
    ["Cash variance", fmt(Math.max(0, report.cash_shortage || 0))],
    ["Expected card", fmt(report.expected_card)],
    ["Counted card", fmt(report.closing_card)],
    ["Card variance", fmt(Math.max(0, report.card_shortage || 0))],
    ["Expected mobile", fmt(report.expected_mobile)],
    ["Counted mobile", fmt(report.closing_mobile)],
    ["Mobile variance", fmt(Math.max(0, report.mobile_shortage || 0))],
  ];
  return `<div class="receipt-paper shift-report">
    <div class="rcpt-title">${esc(settings.store_name || "Store")}</div>
    ${settings.address ? `<div class="rcpt-muted">${esc(settings.address)}</div>` : ""}
    <div class="rcpt-divider"></div>
    <div class="rcpt-line"><strong>END OF SHIFT REPORT</strong></div>
    <div class="rcpt-line">Cashier: ${esc(report.employee_name || "N/A")}</div>
    <div class="rcpt-line">Shop: ${esc(report.shop_name || "N/A")}</div>
    <div class="rcpt-line">Opened: ${opened}</div>
    <div class="rcpt-line">Closed: ${closed}</div>
    <div class="rcpt-line">Orders: ${report.order_count || 0}</div>
    <div class="rcpt-rule"></div>
    <table>${rows.map(([l, v]) => `<tr><td>${esc(l)}</td><td style="text-align:right">${v}</td></tr>`).join("")}</table>
    <div class="rcpt-rule"></div>
    <div class="rcpt-row"><span>TOTAL SHORTAGE</span><span class="${balanced ? "balanced" : "shortage"}">${fmt(report.total_shortage)}</span></div>
    <div class="rcpt-line ${balanced ? "balanced" : "shortage"}" style="margin-top:8px;text-align:center">
      ${balanced ? "✓ Shift balanced" : "⚠ Shortage reported to admin"}
    </div>
    ${report.notes ? `<div class="rcpt-line rcpt-note">Notes: ${esc(report.notes)}</div>` : ""}
  </div>`;
}

function buildDocHtml(doc, settings, docType = "receipt", preparedBy = "", pageSize = "a4") {
  if (docType === "quotation") {
    return wrapQuotationDocument(buildQuotationHtml(doc, settings, preparedBy, pageSize), pageSize);
  }
  return buildReceiptHtml(doc, settings, preparedBy);
}

function pageSizeStyles(pageSize = "a4") {
  if (pageSize === "letter") return "@page { size: letter; margin: 0.5in; }";
  if (pageSize === "receipt" || pageSize === "thermal") return "@page { size: 80mm auto; margin: 4mm; } body { padding: 0 !important; }";
  return "@page { size: A4; margin: 12mm; }";
}

function wrapQuotePage(html, pageSize = "a4") {
  return `<div class="quote-page-${pageSize}">${html}</div>`;
}

function sampleReceiptDoc() {
  return {
    id: 42,
    order_number: "ORD-PREVIEW-001",
    quote_number: "QTE-2034",
    items: [
      { product_name: "Service Fee", quantity: 1, unit_price: 100, line_total: 100 },
      { product_name: "Labor", quantity: 5, unit_price: 75, line_total: 375 },
      { product_name: "Parts", quantity: 1, unit_price: 150, line_total: 150 },
    ],
    subtotal: 625,
    tax_amount: 0,
    discount_amount: 9.35,
    other_charges: 0,
    total: 615.65,
    payment_method: "cash",
    amount_paid: 650,
    change_given: 34.35,
    customer_name: "Jane Doe",
    customer_company: "Acme Corp",
    customer_address: "123 Main St, Harare",
    customer_phone: "+263 77 000 0000",
    customer_email: "jane@acme.com",
    description_of_work: "Supply and installation of POS hardware and software configuration.",
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
    created_at: new Date().toISOString(),
    notes: "",
  };
}

function printHtml(html, title = "Print", pageSize = "a4", docType = "receipt") {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) { notify?.("Allow pop-ups to print", "warning"); return; }
  const pageCss = pageSizeStyles(pageSize);
  const fullDoc = buildExportDocument(html, docType, pageSize);
  w.document.write(`${fullDoc.replace("</head>", `<style>${pageCss}</style></head>`)}<script>window.onload=()=>{window.print();}<\/script>`);
  w.document.close();
}

function buildWordHtml(html, title = "Document", pageSize = "a4", docType = "receipt") {
  const inner = buildExportDocument(html, docType, pageSize);
  return inner.replace("<!DOCTYPE html>", '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">').replace("<html>", '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
}

async function saveDocument(html, title, pageSize = "a4", docType = "receipt") {
  if (!window.electronAPI?.savePdf) {
    notify?.("Save is only available in the desktop app", "warning");
    return;
  }
  const fullHtml = buildExportDocument(html, docType, pageSize);
  const pdf = await window.electronAPI.savePdf({ fullHtml, defaultName: `${title}.pdf` });
  if (pdf?.ok) notify(`PDF saved to ${pdf.path}`, "success");
}

async function saveWord(html, title, pageSize = "a4", docType = "receipt") {
  if (!window.electronAPI?.saveFile) {
    notify?.("Save is only available in the desktop app", "warning");
    return;
  }
  const doc = await window.electronAPI.saveFile({
    content: buildWordHtml(html, title, pageSize, docType),
    defaultName: `${title}.doc`,
    filters: [{ name: "Word Document", extensions: ["doc"] }],
  });
  if (doc?.ok) notify(`Word file saved to ${doc.path}`, "success");
}

window.receiptPreview = {
  buildReceiptHtml, buildQuotationHtml, buildDocHtml, buildShiftReportHtml,
  sampleReceiptDoc, printHtml, wrapQuotePage, wrapQuotationDocument, wrapReceiptDocument,
  quotationCssText, receiptCssText, buildExportDocument, setLogoDataUrl, applyLogo,
  pageSizeStyles, currencySym, fmtCurrency, saveDocument, saveWord, buildWordHtml,
};
