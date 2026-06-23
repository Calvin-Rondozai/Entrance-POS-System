from sqlalchemy.orm import Session
from models import Category, Product, Customer, Employee, Settings, Shop
from auth import hash_pin


def seed_database(db: Session):
    if db.query(Employee).first():
        return

    defaults = [
        ("store_name", "Entracte Solutions"),
        ("tax_rate", "0"),
        ("currency", "USD"),
        ("receipt_footer", "Thank you for shopping with us!"),
        ("receipt_header", ""),
        ("receipt_tagline", ""),
        ("receipt_phone", ""),
        ("receipt_brand_line", "Entracte Point Of Sale"),
        ("receipt_website", "https://entractesolutions.com"),
        ("receipt_show_logo", "true"),
        ("receipt_show_tax", "true"),
        ("receipt_show_payment", "true"),
        ("quotation_valid_days", "30"),
        ("quotation_footer", "This quotation is valid for the period stated above. Prices subject to change."),
        ("quote_title", "QUOTATION"),
        ("quote_fax", ""),
        ("quote_terms_text", "This quotation is not a contract or a bill. It is our best guess at total price for the work and materials described above. The customer will be billed for actual work performed."),
        ("quote_thank_you", "Thank you for your business!"),
        ("quote_show_acceptance", "true"),
        ("quote_show_prepared_by", "true"),
        ("quote_contact_line", "If you have any questions, please contact us."),
        ("theme", "light"),
        ("printer_name", "EPSON TM-T20II Receipt5"),
        ("address", "1548 Platinum Park, Zvishavane"),
        ("email", "bookings@wakefieldlodges.co.zw"),
    ]
    for key, value in defaults:
        db.add(Settings(key=key, value=value))

    categories = [
        Category(name="Beverages", color="#006AFF"),
        Category(name="Snacks", color="#F5A623"),
        Category(name="Electronics", color="#7B61FF"),
        Category(name="Clothing", color="#E8457C"),
        Category(name="Groceries", color="#00C853"),
        Category(name="General", color="#9E9E9E"),
    ]
    db.add_all(categories)
    db.flush()

    products = [
        Product(name="Espresso", sku="BEV-001", barcode="1000000001", price=3.50, stock_quantity=100, category_id=categories[0].id),
        Product(name="Latte", sku="BEV-002", barcode="1000000002", price=4.75, stock_quantity=80, category_id=categories[0].id),
        Product(name="Green Tea", sku="BEV-003", barcode="1000000003", price=2.99, stock_quantity=60, category_id=categories[0].id),
        Product(name="Potato Chips", sku="SNK-001", barcode="2000000001", price=2.49, stock_quantity=120, category_id=categories[1].id),
        Product(name="USB-C Cable", sku="ELC-001", barcode="3000000001", price=12.99, stock_quantity=50, category_id=categories[2].id),
        Product(name="T-Shirt", sku="CLT-001", barcode="4000000001", price=19.99, stock_quantity=30, category_id=categories[3].id),
        Product(name="Bread Loaf", sku="GRC-001", barcode="5000000001", price=3.49, stock_quantity=25, category_id=categories[4].id),
        Product(name="Milk (1L)", sku="GRC-002", barcode="5000000002", price=4.29, stock_quantity=3, low_stock_threshold=10, category_id=categories[4].id),
    ]
    db.add_all(products)

    shop = Shop(name="Entracte Solutions", address="1548 Platinum Park, Zvishavane", phone="")
    db.add(shop)
    db.flush()

    employees = [
        Employee(name="Administrator", username="admin", email="admin@entracte.com", pin_hash=hash_pin("admin123"), role="admin", shop_id=shop.id),
        Employee(name="Cashier", username="cashier", email=None, pin_hash=hash_pin("cashier1"), role="cashier", shop_id=shop.id),
    ]
    db.add_all(employees)
    db.commit()
