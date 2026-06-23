import csv
import io
from typing import Tuple, List

import pandas as pd
from sqlalchemy.orm import Session

from models import Product, Category, OutOfStockRecord


def import_inventory_csv(db: Session, content: bytes) -> Tuple[int, int, List[str]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV file is empty or has no headers")

    fields = {f.strip().lower() for f in reader.fieldnames}
    required = {"name", "price", "quantity"}
    missing = required - fields
    if missing:
        raise ValueError(f"Missing columns: {', '.join(missing)}. Required: name, price, quantity")

    success = 0
    errors = 0
    error_msgs = []

    for i, row in enumerate(reader, start=2):
        try:
            row_l = {k.strip().lower(): (v.strip() if v else "") for k, v in row.items()}
            name = row_l.get("name", "")
            if not name:
                errors += 1
                error_msgs.append(f"Row {i}: empty name")
                continue

            price = float(row_l["price"])
            quantity = int(float(row_l["quantity"]))
            category_name = row_l.get("category", "General") or "General"
            sku = row_l.get("sku", "") or f"SKU-{name[:20].upper().replace(' ', '-')}-{i}"

            if price < 0 or quantity < 0:
                errors += 1
                error_msgs.append(f"Row {i}: invalid price/quantity for '{name}'")
                continue

            cat = db.query(Category).filter(Category.name == category_name).first()
            if not cat:
                cat = Category(name=category_name)
                db.add(cat)
                db.flush()

            existing = db.query(Product).filter(Product.name.ilike(name)).first()
            if existing:
                existing.price = price
                existing.stock_quantity += quantity
                existing.category_id = cat.id
                if existing.stock_quantity > 0:
                    existing.is_active = True
            else:
                barcode = row_l.get("barcode") or None
                db.add(Product(
                    name=name, sku=sku, barcode=barcode, price=price,
                    stock_quantity=quantity, category_id=cat.id,
                ))
            success += 1
        except Exception as e:
            errors += 1
            error_msgs.append(f"Row {i}: {e}")

    db.commit()
    return success, errors, error_msgs[:20]


def export_products_csv(db: Session) -> str:
    products = db.query(Product).filter(Product.is_active == True).order_by(Product.name).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Name", "SKU", "Barcode", "Price", "Cost", "Quantity", "Category"])
    for p in products:
        writer.writerow([
            p.id, p.name, p.sku, p.barcode or "", p.price, p.cost,
            p.stock_quantity, p.category.name if p.category else "",
        ])
    return output.getvalue()


def export_out_of_stock_csv(db: Session) -> str:
    records = db.query(OutOfStockRecord).order_by(OutOfStockRecord.date_out.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Product ID", "Name", "SKU", "Price", "Category", "Date Out"])
    for r in records:
        writer.writerow([
            r.id, r.product_id or "", r.name, r.sku or "", r.price,
            r.category_name or "", r.date_out.strftime("%Y-%m-%d %H:%M:%S"),
        ])
    return output.getvalue()


def export_orders_csv(db: Session) -> str:
    from models import Order
    orders = db.query(Order).order_by(Order.created_at.desc()).limit(500).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Order #", "Date", "Subtotal", "Tax", "Total", "Payment", "Status", "Items"])
    for o in orders:
        items = "; ".join(f"{i.product_name} x{i.quantity}" for i in o.items)
        writer.writerow([
            o.order_number, o.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            o.subtotal, o.tax_amount, o.total, o.payment_method, o.status, items,
        ])
    return output.getvalue()


def check_out_of_stock(db: Session):
    products = db.query(Product).filter(
        Product.is_active == True, Product.stock_quantity <= 0
    ).all()
    for p in products:
        existing = db.query(OutOfStockRecord).filter(
            OutOfStockRecord.product_id == p.id
        ).first()
        if not existing:
            db.add(OutOfStockRecord(
                product_id=p.id, name=p.name, sku=p.sku, price=p.price,
                category_name=p.category.name if p.category else None,
            ))
        p.is_active = False
    db.commit()
