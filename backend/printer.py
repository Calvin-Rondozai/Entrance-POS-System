import os
from datetime import datetime
from io import BytesIO

from escpos.printer import Dummy
from PIL import Image

try:
    import win32print
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False


def _currency_sym(currency: str) -> str:
    return "$" if currency == "USD" else currency


def _as_bool(val, default=True) -> bool:
    if val is None:
        return default
    return str(val).lower() in ("true", "1", "yes")


def _format_line(left: str, right: str, width: int = 48) -> str:
    if len(left) > width - len(right) - 1:
        left = left[: max(1, width - len(right) - 4)] + "..."
    spaces = max(1, width - len(left) - len(right))
    return f"{left}{' ' * spaces}{right}"


def build_document_lines(doc, settings: dict, doc_type: str = "receipt", cashier_name: str | None = None) -> list[str]:
    """Build receipt/quotation as plain text lines for preview."""
    company = settings.get("store_name", "Entracte Solutions")
    address = settings.get("address", "")
    email = settings.get("email", "")
    phone = settings.get("receipt_phone", "")
    tagline = settings.get("receipt_tagline", "")
    header = settings.get("receipt_header", "")
    footer = settings.get("receipt_footer", "Thank you for shopping with us!")
    brand = settings.get("receipt_brand_line", "Entracte Point Of Sale")
    website = settings.get("receipt_website", "https://entractesolutions.com")
    currency = settings.get("currency", "USD")
    sym = _currency_sym(currency)
    show_tax = _as_bool(settings.get("receipt_show_tax"), True)
    show_payment = _as_bool(settings.get("receipt_show_payment"), True) and doc_type == "receipt"
    is_quote = doc_type == "quotation"
    quote_footer = settings.get("quotation_footer", footer)

    lines: list[str] = []

    if _as_bool(settings.get("receipt_show_logo"), True):
        lines.append("[LOGO]")

    lines.append(company.upper())
    if tagline:
        lines.append(tagline)
    if address:
        lines.append(address)
    if phone:
        lines.append(phone)
    if email:
        lines.append(email)
    if header:
        for part in header.split("\n"):
            if part.strip():
                lines.append(part.strip())
    lines.append("")

    now = doc.created_at if hasattr(doc, "created_at") and doc.created_at else datetime.utcnow()
    date_str = now.strftime("%m/%d/%Y").lstrip("0").replace("/0", "/")
    time_str = now.strftime("%I:%M %p").lstrip("0")
    lines.append(f"{date_str}  {time_str}")

    if is_quote:
        lines.append("QUOTATION")
        lines.append(f"Quote: {getattr(doc, 'quote_number', 'QTE-PREVIEW')}")
        if getattr(doc, "customer_name", None):
            lines.append(f"Customer: {doc.customer_name}")
        if getattr(doc, "customer_phone", None):
            lines.append(f"Phone: {doc.customer_phone}")
        if getattr(doc, "customer_email", None):
            lines.append(f"Email: {doc.customer_email}")
        if getattr(doc, "valid_until", None):
            vu = doc.valid_until.strftime("%m/%d/%Y") if hasattr(doc.valid_until, "strftime") else str(doc.valid_until)
            lines.append(f"Valid until: {vu}")
    else:
        lines.append("Station: 1")
        ticket = getattr(doc, "id", None) or "N/A"
        lines.append(f"Ticket: #{ticket}")
        lines.append(f"Order: {getattr(doc, 'order_number', 'PREVIEW')}")
        if cashier_name:
            lines.append(f"Cashier: {cashier_name}")

    lines.append("-" * 48)

    for item in doc.items:
        item_line = f"{item.quantity} x {item.product_name}"
        price_str = f"{sym}{item.line_total:.2f}"
        lines.append(_format_line(item_line, price_str))

    lines.append("-" * 48)
    lines.append(_format_line("SUBTOTAL", f"{sym}{doc.subtotal:.2f}"))

    if show_tax and doc.tax_amount > 0:
        lines.append(_format_line("TAX", f"{sym}{doc.tax_amount:.2f}"))

    if getattr(doc, "discount_amount", 0) > 0:
        lines.append(_format_line("DISCOUNT", f"-{sym}{doc.discount_amount:.2f}"))

    lines.append("=" * 48)
    lines.append(f"TOTAL: {sym}{doc.total:.2f}")
    lines.append("=" * 48)

    if show_payment:
        paid_str = f"{sym}{doc.amount_paid:.2f}"
        lines.append(_format_line(doc.payment_method.upper(), paid_str))
        change_str = f"{sym}{doc.change_given:.2f}"
        lines.append(_format_line("CHANGE", change_str))
        lines.append("-" * 48)

    if getattr(doc, "notes", None):
        lines.append(f"Note: {doc.notes}")
        lines.append("")

    closing = quote_footer if is_quote else footer
    if closing:
        lines.append("")
        lines.append(closing)
    if brand:
        lines.append(brand)
    if website:
        lines.append(website)

    return lines


def print_raw(data: bytes, printer_name: str) -> None:
    if not HAS_WIN32:
        raise RuntimeError("Printing is only supported on Windows")
    h_printer = win32print.OpenPrinter(printer_name)
    try:
        win32print.StartDocPrinter(h_printer, 1, ("Receipt", None, "RAW"))
        win32print.StartPagePrinter(h_printer)
        win32print.WritePrinter(h_printer, data)
        win32print.EndPagePrinter(h_printer)
        win32print.EndDocPrinter(h_printer)
    finally:
        win32print.ClosePrinter(h_printer)


def build_receipt_bytes(
    doc,
    settings: dict,
    logo_path: str | None = None,
    ticket_number: int | None = None,
    doc_type: str = "receipt",
    cashier_name: str | None = None,
) -> bytes:
    company = settings.get("store_name", "Entracte Solutions")
    address = settings.get("address", "")
    email = settings.get("email", "")
    phone = settings.get("receipt_phone", "")
    tagline = settings.get("receipt_tagline", "")
    header = settings.get("receipt_header", "")
    footer = settings.get("receipt_footer", "Thank you for shopping with us!")
    brand = settings.get("receipt_brand_line", "Entracte Point Of Sale")
    website = settings.get("receipt_website", "https://entractesolutions.com")
    currency = settings.get("currency", "USD")
    sym = _currency_sym(currency)
    show_tax = _as_bool(settings.get("receipt_show_tax"), True)
    show_payment = _as_bool(settings.get("receipt_show_payment"), True) and doc_type == "receipt"
    show_logo = _as_bool(settings.get("receipt_show_logo"), True)
    is_quote = doc_type == "quotation"
    quote_footer = settings.get("quotation_footer", footer)

    p = Dummy()

    if show_logo and logo_path and os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path).convert("RGB")
            max_width = 384
            ratio = max_width / logo.width
            logo = logo.resize((max_width, int(logo.height * ratio)), Image.LANCZOS)
            logo = logo.convert("1")
            p.set(align="center")
            p.image(logo)
            p.text("\n\n")
        except Exception:
            pass

    p.set(align="center", width=2, height=2)
    p.text(f"{company}\n")
    p.set(align="center", width=1, height=1)
    if tagline:
        p.text(f"{tagline}\n")
    if address:
        p.text(f"{address}\n")
    if phone:
        p.text(f"{phone}\n")
    if email:
        p.text(f"{email}\n")
    if header:
        for part in header.split("\n"):
            if part.strip():
                p.text(f"{part.strip()}\n")
    p.text("\n")

    now = doc.created_at if hasattr(doc, "created_at") and doc.created_at else datetime.utcnow()
    date_str = now.strftime("%m/%d/%Y").lstrip("0").replace("/0", "/")
    time_str = now.strftime("%I:%M %p").lstrip("0")

    p.text(f"{date_str}  {time_str}\n")

    if is_quote:
        p.text("QUOTATION\n")
        p.text(f"Quote: {doc.quote_number}\n")
        if getattr(doc, "customer_name", None):
            p.text(f"Customer: {doc.customer_name}\n")
        if getattr(doc, "customer_phone", None):
            p.text(f"Phone: {doc.customer_phone}\n")
        if getattr(doc, "customer_email", None):
            p.text(f"Email: {doc.customer_email}\n")
        if getattr(doc, "valid_until", None):
            vu = doc.valid_until.strftime("%m/%d/%Y")
            p.text(f"Valid until: {vu}\n")
    else:
        ticket = ticket_number or getattr(doc, "id", 0)
        p.text("Station: 1\n")
        p.text(f"Ticket: #{ticket}\n")
        p.text(f"Order: {doc.order_number}\n")
        if cashier_name:
            p.text(f"Cashier: {cashier_name}\n")

    p.text("------------------------------------------------\n")
    p.set(align="left")

    for item in doc.items:
        item_line = f"{item.quantity} x {item.product_name}"
        if len(item_line) > 36:
            item_line = item_line[:33] + "..."
        price_str = f"{sym}{item.line_total:.2f}"
        spaces = max(1, 48 - len(item_line) - len(price_str))
        p.text(f"{item_line}{' ' * spaces}{price_str}\n")

    p.text("------------------------------------------------\n")
    subtotal_str = f"{sym}{doc.subtotal:.2f}"
    spaces = max(1, 48 - len("SUBTOTAL") - len(subtotal_str))
    p.text(f"SUBTOTAL{' ' * spaces}{subtotal_str}\n")

    if show_tax and doc.tax_amount > 0:
        tax_str = f"{sym}{doc.tax_amount:.2f}"
        spaces = max(1, 48 - len("TAX") - len(tax_str))
        p.text(f"TAX{' ' * spaces}{tax_str}\n")

    if getattr(doc, "discount_amount", 0) > 0:
        disc_str = f"-{sym}{doc.discount_amount:.2f}"
        spaces = max(1, 48 - len("DISCOUNT") - len(disc_str))
        p.text(f"DISCOUNT{' ' * spaces}{disc_str}\n")

    p.text("================================================\n")
    p.set(align="center", width=2, height=2)
    p.text(f"TOTAL: {sym}{doc.total:.2f}\n")

    p.set(align="left", width=1, height=1)
    p.text("================================================\n")

    if show_payment:
        paid_str = f"{sym}{doc.amount_paid:.2f}"
        spaces = max(1, 48 - len(doc.payment_method.upper()) - len(paid_str))
        p.text(f"{doc.payment_method.upper()}{' ' * spaces}{paid_str}\n")
        change_str = f"{sym}{doc.change_given:.2f}"
        spaces = max(1, 48 - len("CHANGE") - len(change_str))
        p.text(f"CHANGE{' ' * spaces}{change_str}\n")
        p.text("------------------------------------------------\n")

    if getattr(doc, "notes", None):
        p.text(f"Note: {doc.notes}\n")

    p.set(align="center")
    closing = quote_footer if is_quote else footer
    if closing:
        p.text(f"\n{closing}\n")
    if brand:
        p.text(f"{brand}\n")
    if website:
        p.text(f"{website}\n")
    p.text("\n\n")
    p.cut()

    return p.output
