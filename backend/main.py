import os
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, desc, text, or_

from database import engine, get_db, Base
from models import (
    Category, Product, Customer, Employee, Order, OrderItem,
    Quotation, QuotationItem, Shop, CashSession,
    Settings, OrderStatus, OutOfStockRecord, ActivityLog,
)
from schemas import (
    CategoryCreate, CategoryResponse,
    ProductCreate, ProductUpdate, ProductResponse,
    CustomerCreate, CustomerResponse,
    EmployeeCreate, EmployeeUpdate, EmployeeLogin, EmployeeResponse,
    LoginResponse, ResetPasswordRequest, ProfileUpdate,
    OrderCreate, OrderResponse,
    QuotationCreate, QuotationUpdate, QuotationResponse,
    ReceiptPreviewRequest,
    DashboardStats, TopProduct, SalesByDay, CashierSales,
    SettingsUpdate, SettingsResponse,
    OutOfStockResponse, ImportResult,
    ShopCreate, ShopUpdate, ShopResponse,
    CashSessionOpen, CashSessionClose, CashSessionResponse, ShiftReconcilePreview,
    ActivityLogCreate, ActivityLogResponse,
)
from auth import hash_pin, verify_pin, create_access_token
from deps import get_current_user, require_admin
from seed import seed_database
from csv_service import (
    import_inventory_csv, export_products_csv,
    export_out_of_stock_csv, export_orders_csv, check_out_of_stock,
)
from printer import build_receipt_bytes, build_document_lines, print_raw

Base.metadata.create_all(bind=engine)


def backfill_order_shops():
    with engine.connect() as conn:
        conn.execute(text("""
            UPDATE orders SET shop_id = (
                SELECT e.shop_id FROM employees e WHERE e.id = orders.employee_id
            )
            WHERE shop_id IS NULL AND employee_id IS NOT NULL
        """))
        conn.execute(text("""
            UPDATE orders SET shop_id = (
                SELECT p.shop_id FROM order_items oi
                INNER JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = orders.id AND p.shop_id IS NOT NULL
                LIMIT 1
            )
            WHERE shop_id IS NULL
        """))
        conn.commit()


def run_migrations():
    migrations = [
        "ALTER TABLE employees ADD COLUMN phone VARCHAR(50)",
        "ALTER TABLE quotations ADD COLUMN customer_company VARCHAR(200)",
        "ALTER TABLE quotations ADD COLUMN customer_address TEXT",
        "ALTER TABLE quotations ADD COLUMN description_of_work TEXT",
        "ALTER TABLE quotations ADD COLUMN other_charges FLOAT DEFAULT 0",
        "ALTER TABLE employees ADD COLUMN shop_id INTEGER",
        "ALTER TABLE orders ADD COLUMN shop_id INTEGER",
        "ALTER TABLE orders ADD COLUMN cash_session_id INTEGER",
        "ALTER TABLE products ADD COLUMN shop_id INTEGER",
        "ALTER TABLE employees ADD COLUMN profile_theme VARCHAR(20)",
        "ALTER TABLE employees ADD COLUMN profile_printer VARCHAR(200)",
        "ALTER TABLE employees ADD COLUMN profile_page_size VARCHAR(20)",
        "ALTER TABLE employees ADD COLUMN profile_quote_page_size VARCHAR(20)",
        "ALTER TABLE employees ADD COLUMN profile_pos_view VARCHAR(20)",
        """CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER,
            username VARCHAR(100) NOT NULL,
            user_name VARCHAR(200),
            action VARCHAR(300) NOT NULL,
            page VARCHAR(100),
            details TEXT,
            created_at DATETIME,
            FOREIGN KEY(employee_id) REFERENCES employees(id)
        )""",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass

app = FastAPI(title="Entracte POS API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "electron", "renderer", "ES.png")


@app.on_event("startup")
def startup():
    run_migrations()
    backfill_order_shops()
    db = next(get_db())
    seed_database(db)
    db.close()


def get_setting(db: Session, key: str, default: str = "") -> str:
    s = db.query(Settings).filter(Settings.key == key).first()
    return s.value if s else default


def get_all_settings(db: Session) -> dict:
    return {
        "store_name": get_setting(db, "store_name", "Entracte Solutions"),
        "tax_rate": get_setting(db, "tax_rate", "0"),
        "currency": get_setting(db, "currency", "USD"),
        "receipt_footer": get_setting(db, "receipt_footer", "Thank you!"),
        "receipt_header": get_setting(db, "receipt_header", ""),
        "receipt_tagline": get_setting(db, "receipt_tagline", ""),
        "receipt_phone": get_setting(db, "receipt_phone", ""),
        "receipt_brand_line": get_setting(db, "receipt_brand_line", "Entracte Point Of Sale"),
        "receipt_website": get_setting(db, "receipt_website", "https://entractesolutions.com"),
        "receipt_show_logo": get_setting(db, "receipt_show_logo", "true"),
        "receipt_show_tax": get_setting(db, "receipt_show_tax", "true"),
        "receipt_show_payment": get_setting(db, "receipt_show_payment", "true"),
        "quotation_valid_days": get_setting(db, "quotation_valid_days", "30"),
        "quotation_footer": get_setting(db, "quotation_footer", "This quotation is valid for the period stated above."),
        "quote_title": get_setting(db, "quote_title", "QUOTATION"),
        "quote_fax": get_setting(db, "quote_fax", ""),
        "quote_terms_text": get_setting(db, "quote_terms_text", "This quotation is not a contract or a bill. It is our best guess at total price for the work and materials described above. The customer will be billed for actual work performed."),
        "quote_thank_you": get_setting(db, "quote_thank_you", "Thank you for your business!"),
        "quote_show_acceptance": get_setting(db, "quote_show_acceptance", "true"),
        "quote_show_prepared_by": get_setting(db, "quote_show_prepared_by", "true"),
        "quote_contact_line": get_setting(db, "quote_contact_line", "If you have any questions, please contact us."),
        "theme": get_setting(db, "theme", "light"),
        "printer_name": get_setting(db, "printer_name", "EPSON TM-T20II Receipt5"),
        "address": get_setting(db, "address", ""),
        "email": get_setting(db, "email", ""),
    }


def settings_for_employee(db: Session, employee: Employee, acting_user: Optional[Employee] = None) -> dict:
    settings = get_all_settings(db)
    shop_id = employee.shop_id
    session = get_open_session(db, employee.id)
    if session and session.shop_id:
        shop_id = session.shop_id
    if shop_id:
        shop = db.query(Shop).filter(Shop.id == shop_id).first()
        if shop:
            settings["store_name"] = shop.name
            if shop.address:
                settings["address"] = shop.address
            if shop.phone:
                settings["receipt_phone"] = shop.phone
    user = acting_user or employee
    if user.profile_printer:
        settings["printer_name"] = user.profile_printer
    return settings


def printer_for_user(user: Employee, settings: dict) -> str:
    return user.profile_printer or settings.get("printer_name") or ""


def _settings_bool(val: str, default: bool = True) -> bool:
    if val is None:
        return default
    return str(val).lower() in ("true", "1", "yes")


def settings_to_response(s: dict) -> SettingsResponse:
    return SettingsResponse(
        store_name=s["store_name"],
        tax_rate=float(s["tax_rate"]),
        currency=s["currency"],
        receipt_footer=s["receipt_footer"],
        receipt_header=s["receipt_header"],
        receipt_tagline=s["receipt_tagline"],
        receipt_phone=s["receipt_phone"],
        receipt_brand_line=s["receipt_brand_line"],
        receipt_website=s["receipt_website"],
        receipt_show_logo=_settings_bool(s["receipt_show_logo"]),
        receipt_show_tax=_settings_bool(s["receipt_show_tax"]),
        receipt_show_payment=_settings_bool(s["receipt_show_payment"]),
        quotation_valid_days=int(s["quotation_valid_days"]),
        quotation_footer=s["quotation_footer"],
        quote_title=s["quote_title"],
        quote_fax=s["quote_fax"],
        quote_terms_text=s["quote_terms_text"],
        quote_thank_you=s["quote_thank_you"],
        quote_show_acceptance=_settings_bool(s["quote_show_acceptance"]),
        quote_show_prepared_by=_settings_bool(s["quote_show_prepared_by"]),
        quote_contact_line=s["quote_contact_line"],
        printer_name=s["printer_name"],
        address=s["address"],
        email=s["email"],
        theme=s["theme"],
    )


def product_to_response(p: Product) -> ProductResponse:
    return ProductResponse(
        id=p.id, name=p.name, sku=p.sku, description=p.description, barcode=p.barcode,
        price=p.price, cost=p.cost, stock_quantity=p.stock_quantity,
        low_stock_threshold=p.low_stock_threshold, category_id=p.category_id,
        category_name=p.category.name if p.category else None,
        shop_id=p.shop_id,
        shop_name=p.shop.name if p.shop else None,
        is_active=p.is_active,
        is_low_stock=p.stock_quantity <= p.low_stock_threshold,
    )


def employee_to_response(e: Employee, db: Session) -> EmployeeResponse:
    shop = db.query(Shop).filter(Shop.id == e.shop_id).first() if e.shop_id else None
    return EmployeeResponse(
        id=e.id, name=e.name, username=e.username, email=e.email, phone=e.phone,
        role=e.role, shop_id=e.shop_id, shop_name=shop.name if shop else None,
        shop_address=shop.address if shop else None, is_active=e.is_active,
        theme=e.profile_theme, printer_name=e.profile_printer,
        printer_page_size=e.profile_page_size, quote_page_size=e.profile_quote_page_size,
        pos_view=e.profile_pos_view,
    )


def session_to_response(s: CashSession, db: Session, order_count: int = 0) -> CashSessionResponse:
    emp = db.query(Employee).filter(Employee.id == s.employee_id).first()
    shop = db.query(Shop).filter(Shop.id == s.shop_id).first() if s.shop_id else None
    return CashSessionResponse(
        id=s.id, employee_id=s.employee_id, employee_name=emp.name if emp else None,
        shop_id=s.shop_id, shop_name=shop.name if shop else None,
        shop_address=shop.address if shop else None,
        opening_float=s.opening_float, closing_cash=s.closing_cash,
        closing_card=s.closing_card, closing_mobile=s.closing_mobile,
        expected_cash=s.expected_cash, expected_card=s.expected_card,
        expected_mobile=s.expected_mobile, cash_shortage=s.cash_shortage or 0,
        card_shortage=s.card_shortage or 0, mobile_shortage=s.mobile_shortage or 0,
        total_shortage=s.total_shortage or 0, status=s.status, notes=s.notes,
        opened_at=s.opened_at, closed_at=s.closed_at, order_count=order_count,
    )


def get_open_session(db: Session, employee_id: int) -> Optional[CashSession]:
    return db.query(CashSession).filter(
        CashSession.employee_id == employee_id,
        CashSession.status == "open",
    ).first()


def _auto_sku(name: str) -> str:
    base = "".join(c for c in name.upper() if c.isalnum())[:12] or "ITEM"
    return f"{base}-{uuid.uuid4().hex[:6].upper()}"


def write_activity_log(
    db: Session,
    user: Employee,
    action: str,
    page: Optional[str] = None,
    details: Optional[str] = None,
):
    entry = ActivityLog(
        employee_id=user.id,
        username=user.username,
        user_name=user.name,
        action=action,
        page=page,
        details=details,
    )
    db.add(entry)
    db.commit()


# --- Auth ---
@app.post("/api/auth/login", response_model=LoginResponse)
def login(credentials: EmployeeLogin, db: Session = Depends(get_db)):
    employee = db.query(Employee).filter(
        Employee.username == credentials.username,
        Employee.is_active == True,
    ).first()
    if not employee or not verify_pin(credentials.password, employee.pin_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token(employee.id, employee.role)
    write_activity_log(db, employee, "Signed in", "login", f"role={employee.role}")
    return LoginResponse(employee=employee_to_response(employee, db), token=token)


@app.get("/api/auth/me", response_model=EmployeeResponse)
def me(user: Employee = Depends(get_current_user), db: Session = Depends(get_db)):
    return employee_to_response(user, db)


@app.put("/api/auth/profile", response_model=EmployeeResponse)
def update_profile(data: ProfileUpdate, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    field_map = {
        "theme": "profile_theme",
        "printer_name": "profile_printer",
        "printer_page_size": "profile_page_size",
        "quote_page_size": "profile_quote_page_size",
        "pos_view": "profile_pos_view",
    }
    for api_key, val in data.model_dump(exclude_unset=True).items():
        col = field_map.get(api_key)
        if col:
            setattr(user, col, val if val != "" else None)
    db.commit()
    db.refresh(user)
    return employee_to_response(user, db)


# --- Categories ---
@app.get("/api/categories", response_model=List[CategoryResponse])
def list_categories(db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    return db.query(Category).order_by(Category.name).all()


@app.post("/api/categories", response_model=CategoryResponse)
def create_category(data: CategoryCreate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    if db.query(Category).filter(Category.name == data.name).first():
        raise HTTPException(status_code=400, detail="Category already exists")
    cat = Category(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


# --- Products ---
@app.get("/api/products", response_model=List[ProductResponse])
def list_products(
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    low_stock_only: bool = False,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: Employee = Depends(get_current_user),
):
    q = db.query(Product).options(joinedload(Product.shop), joinedload(Product.category))
    if not include_inactive or user.role != "admin":
        q = q.filter(Product.is_active == True, Product.stock_quantity > 0)
    elif not include_inactive:
        q = q.filter(Product.is_active == True)
    if search:
        term = f"%{search}%"
        q = q.filter(
            (Product.name.ilike(term)) | (Product.sku.ilike(term)) | (Product.barcode.ilike(term))
        )
    if category_id:
        q = q.filter(Product.category_id == category_id)
    filter_shop = shop_id
    if filter_shop is None and user.role == "cashier" and user.shop_id:
        filter_shop = user.shop_id
    if filter_shop is not None:
        q = q.filter(or_(Product.shop_id == filter_shop, Product.shop_id.is_(None)))
    products = q.order_by(Product.name).all()
    result = [product_to_response(p) for p in products]
    if low_stock_only:
        result = [p for p in result if p.is_low_stock]
    return result


@app.get("/api/products/barcode/{barcode}", response_model=ProductResponse)
def get_product_by_barcode(barcode: str, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    product = db.query(Product).filter(Product.barcode == barcode, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product_to_response(product)


@app.post("/api/products", response_model=ProductResponse)
def create_product(data: ProductCreate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    payload = data.model_dump()
    if payload.get("shop_id") and not db.query(Shop).filter(Shop.id == payload["shop_id"]).first():
        raise HTTPException(status_code=400, detail="Shop not found")
    if not payload.get("sku"):
        payload["sku"] = _auto_sku(payload["name"])
    if db.query(Product).filter(Product.sku == payload["sku"]).first():
        raise HTTPException(status_code=400, detail="Product code already exists")
    product = Product(**payload)
    db.add(product)
    db.commit()
    db.refresh(product)
    product = db.query(Product).options(joinedload(Product.shop), joinedload(Product.category)).filter(Product.id == product.id).first()
    return product_to_response(product)


@app.put("/api/products/{product_id}", response_model=ProductResponse)
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    updates = data.model_dump(exclude_unset=True)
    if updates.get("shop_id") and not db.query(Shop).filter(Shop.id == updates["shop_id"]).first():
        raise HTTPException(status_code=400, detail="Shop not found")
    for key, value in updates.items():
        setattr(product, key, value)
    db.commit()
    db.refresh(product)
    check_out_of_stock(db)
    product = db.query(Product).options(joinedload(Product.shop), joinedload(Product.category)).filter(Product.id == product.id).first()
    return product_to_response(product)


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(product)
    db.commit()
    return {"message": "Product deleted"}


@app.post("/api/products/import-csv", response_model=ImportResult)
async def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    content = await file.read()
    try:
        success, errors, msgs = import_inventory_csv(db, content)
        check_out_of_stock(db)
        return ImportResult(success_count=success, error_count=errors, errors=msgs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/products/export-csv")
def export_csv(db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    csv_data = export_products_csv(db)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory.csv"},
    )


# --- Out of Stock ---
@app.get("/api/out-of-stock", response_model=List[OutOfStockResponse])
def list_out_of_stock(db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    return db.query(OutOfStockRecord).order_by(desc(OutOfStockRecord.date_out)).all()


@app.delete("/api/out-of-stock/{record_id}")
def delete_out_of_stock(record_id: int, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    record = db.query(OutOfStockRecord).filter(OutOfStockRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(record)
    db.commit()
    return {"message": "Deleted"}


@app.delete("/api/out-of-stock")
def clear_out_of_stock(db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    db.query(OutOfStockRecord).delete()
    db.commit()
    return {"message": "Cleared"}


@app.get("/api/out-of-stock/export-csv")
def export_oos_csv(db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    csv_data = export_out_of_stock_csv(db)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=out_of_stock.csv"},
    )


# --- Employees ---
@app.get("/api/employees", response_model=List[EmployeeResponse])
def list_employees(db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    return [employee_to_response(e, db) for e in db.query(Employee).order_by(Employee.name).all()]


@app.post("/api/employees", response_model=EmployeeResponse)
def create_employee(data: EmployeeCreate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    if db.query(Employee).filter(Employee.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if data.role not in ("admin", "cashier"):
        raise HTTPException(status_code=400, detail="Role must be admin or cashier")
    if data.shop_id and not db.query(Shop).filter(Shop.id == data.shop_id).first():
        raise HTTPException(status_code=400, detail="Shop not found")
    employee = Employee(
        name=data.name, username=data.username, email=data.email,
        pin_hash=hash_pin(data.password), role=data.role, shop_id=data.shop_id,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee_to_response(employee, db)


@app.put("/api/employees/{employee_id}", response_model=EmployeeResponse)
def update_employee(employee_id: int, data: EmployeeUpdate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    updates = data.model_dump(exclude_unset=True)
    if "username" in updates and updates["username"] != employee.username:
        existing = db.query(Employee).filter(Employee.username == updates["username"], Employee.id != employee_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
    if "role" in updates and updates["role"] not in ("admin", "cashier"):
        raise HTTPException(status_code=400, detail="Role must be admin or cashier")
    if "role" in updates and updates["role"] != "admin" and employee.role == "admin":
        admin_count = db.query(Employee).filter(Employee.role == "admin", Employee.is_active == True).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")
    if "shop_id" in updates and updates["shop_id"] and not db.query(Shop).filter(Shop.id == updates["shop_id"]).first():
        raise HTTPException(status_code=400, detail="Shop not found")
    for key, value in updates.items():
        setattr(employee, key, value)
    db.commit()
    db.refresh(employee)
    return employee_to_response(employee, db)


@app.post("/api/employees/{employee_id}/reset-password")
def reset_password(employee_id: int, data: ResetPasswordRequest, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    employee.pin_hash = hash_pin(data.password)
    db.commit()
    return {"message": "Password reset successfully"}


@app.delete("/api/employees/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.role == "admin":
        admin_count = db.query(Employee).filter(Employee.role == "admin", Employee.is_active == True).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    db.delete(employee)
    db.commit()
    return {"message": "Employee deleted"}


# --- Customers ---
@app.get("/api/customers", response_model=List[CustomerResponse])
def list_customers(search: Optional[str] = None, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    q = db.query(Customer)
    if search:
        term = f"%{search}%"
        q = q.filter(Customer.name.ilike(term))
    return q.order_by(Customer.name).all()


@app.post("/api/customers", response_model=CustomerResponse)
def create_customer(data: CustomerCreate, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    customer = Customer(**data.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


# --- Orders ---
@app.post("/api/orders", response_model=OrderResponse)
def create_order(data: OrderCreate, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    if not data.items:
        raise HTTPException(status_code=400, detail="Order must have at least one item")

    tax_rate = float(get_all_settings(db)["tax_rate"]) / 100
    subtotal = 0.0
    order_items = []

    for item_data in data.items:
        product = db.query(Product).filter(Product.id == item_data.product_id, Product.is_active == True).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item_data.product_id} not found")
        if product.stock_quantity < item_data.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name}")
        line_total = (product.price * item_data.quantity) - item_data.discount
        subtotal += line_total
        order_items.append((product, item_data, line_total))

    tax_amount = round(subtotal * tax_rate, 2)
    total = round(subtotal + tax_amount - data.discount_amount, 2)
    if data.amount_paid < total:
        raise HTTPException(status_code=400, detail="Insufficient payment amount")

    order_number = f"ORD-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    session = get_open_session(db, user.id)
    shop_id = user.shop_id
    if session and session.shop_id:
        shop_id = session.shop_id
    if not shop_id:
        for product, _, _ in order_items:
            if product.shop_id:
                shop_id = product.shop_id
                break
    order = Order(
        order_number=order_number, subtotal=round(subtotal, 2), tax_amount=tax_amount,
        discount_amount=data.discount_amount, total=total, payment_method=data.payment_method,
        amount_paid=data.amount_paid, change_given=round(data.amount_paid - total, 2),
        employee_id=user.id, customer_id=data.customer_id, notes=data.notes,
        shop_id=shop_id, cash_session_id=session.id if session else None,
    )
    db.add(order)
    db.flush()

    for product, item_data, line_total in order_items:
        db.add(OrderItem(
            order_id=order.id, product_id=product.id, product_name=product.name,
            quantity=item_data.quantity, unit_price=product.price,
            discount=item_data.discount, line_total=round(line_total, 2),
        ))
        product.stock_quantity -= item_data.quantity

    db.commit()
    check_out_of_stock(db)
    order = (
        db.query(Order)
        .options(joinedload(Order.shop), joinedload(Order.items), joinedload(Order.employee).joinedload(Employee.shop))
        .filter(Order.id == order.id)
        .first()
    )
    return order


@app.get("/api/orders", response_model=List[OrderResponse])
def list_orders(
    limit: int = Query(200, le=1000),
    shop_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: Employee = Depends(get_current_user),
):
    q = (
        db.query(Order)
        .options(joinedload(Order.shop), joinedload(Order.items), joinedload(Order.employee).joinedload(Employee.shop))
    )
    if user.role == "cashier" and user.shop_id:
        q = q.filter(or_(Order.shop_id == user.shop_id, Order.employee_id == user.id))
    if shop_id is not None:
        q = q.filter(Order.shop_id == shop_id)
    return q.order_by(desc(Order.created_at)).limit(limit).all()


@app.get("/api/orders/{order_id}", response_model=OrderResponse)
def get_order(order_id: int, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    order = (
        db.query(Order)
        .options(joinedload(Order.shop), joinedload(Order.items), joinedload(Order.employee).joinedload(Employee.shop))
        .filter(Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.get("/api/orders/export-csv")
def export_orders(db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    csv_data = export_orders_csv(db)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=orders.csv"},
    )


@app.post("/api/orders/{order_id}/print")
def print_order(order_id: int, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    emp = db.query(Employee).filter(Employee.id == order.employee_id).first() if order.employee_id else user
    settings = settings_for_employee(db, user, acting_user=user)
    logo = LOGO_PATH if os.path.exists(LOGO_PATH) else None
    receipt_bytes = build_receipt_bytes(
        order, settings, logo_path=logo, ticket_number=order.id,
        cashier_name=emp.name if emp else user.name,
    )
    try:
        print_raw(receipt_bytes, printer_for_user(user, settings))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Print failed: {e}")
    return {"message": "Receipt printed"}


class _PreviewItem:
    def __init__(self, name, qty, price, discount=0):
        self.product_name = name
        self.quantity = qty
        self.line_total = round(price * qty - discount, 2)


class _PreviewDoc:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _build_preview_doc(data: ReceiptPreviewRequest, db: Session, settings: dict):
    tax_rate = float(settings["tax_rate"]) / 100
    subtotal = 0.0
    items = []
    for item_data in data.items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        if not product:
            continue
        line_total = round(product.price * item_data.quantity - item_data.discount, 2)
        subtotal += line_total
        items.append(_PreviewItem(product.name, item_data.quantity, product.price, item_data.discount))
    tax_amount = round(subtotal * tax_rate, 2) if _settings_bool(settings.get("receipt_show_tax"), True) else 0
    total = round(subtotal + tax_amount - data.discount_amount, 2)
    amount_paid = data.amount_paid if data.amount_paid is not None else total
    return _PreviewDoc(
        items=items,
        subtotal=round(subtotal, 2),
        tax_amount=tax_amount,
        discount_amount=data.discount_amount,
        total=total,
        payment_method=data.payment_method,
        amount_paid=amount_paid,
        change_given=round(max(0, amount_paid - total), 2),
        order_number="PREVIEW-001",
        quote_number="QTE-PREVIEW-001",
        customer_name=data.customer_name,
        created_at=datetime.utcnow(),
        valid_until=datetime.utcnow() + timedelta(days=int(settings.get("quotation_valid_days", 30))),
    )


@app.post("/api/receipt/preview")
def receipt_preview(data: ReceiptPreviewRequest, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    settings = get_all_settings(db)
    doc = _build_preview_doc(data, db, settings)
    lines = build_document_lines(doc, settings, doc_type=data.doc_type)
    return {"lines": lines, "doc_type": data.doc_type}


# --- Quotations ---
@app.post("/api/quotations", response_model=QuotationResponse)
def create_quotation(data: QuotationCreate, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    if not data.items:
        raise HTTPException(status_code=400, detail="Quotation must have at least one item")

    settings = get_all_settings(db)
    subtotal, tax_amount, quote_items = _build_quotation_items(data.items, db, settings)
    total = round(subtotal + tax_amount - data.discount_amount + data.other_charges, 2)
    if data.valid_until:
        valid_until = data.valid_until
    else:
        valid_days = data.valid_days or int(settings.get("quotation_valid_days", 30))
        valid_until = datetime.utcnow() + timedelta(days=valid_days)

    quote_number = f"QTE-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    quotation = Quotation(
        quote_number=quote_number,
        subtotal=round(subtotal, 2),
        tax_amount=tax_amount,
        discount_amount=data.discount_amount,
        total=total,
        customer_name=data.customer_name,
        customer_company=data.customer_company,
        customer_address=data.customer_address,
        customer_phone=data.customer_phone,
        customer_email=data.customer_email,
        description_of_work=data.description_of_work,
        other_charges=data.other_charges,
        valid_until=valid_until,
        notes=data.notes,
        employee_id=user.id,
    )
    db.add(quotation)
    db.flush()
    _save_quote_items(quotation.id, quote_items, db)

    db.commit()
    db.refresh(quotation)
    return quotation


@app.get("/api/quotations", response_model=List[QuotationResponse])
def list_quotations(limit: int = Query(50, le=200), db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    return db.query(Quotation).order_by(desc(Quotation.created_at)).limit(limit).all()


@app.get("/api/quotations/{quote_id}", response_model=QuotationResponse)
def get_quotation(quote_id: int, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    quote = db.query(Quotation).filter(Quotation.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return quote


def _normalize_quote_items(items_data):
    return [QuotationItemCreate(**i) if isinstance(i, dict) else i for i in items_data]


def _quote_field(item_data, key, default=None):
    if isinstance(item_data, dict):
        return item_data.get(key, default)
    return getattr(item_data, key, default)


def _resolve_quote_line(item_data, db: Session):
    product_id = _quote_field(item_data, "product_id")
    product_name = _quote_field(item_data, "product_name")
    unit_price = _quote_field(item_data, "unit_price")
    if product_id:
        product = db.query(Product).filter(Product.id == product_id).first()
        if product:
            price = unit_price if unit_price is not None else product.price
            return product.id, product.name, float(price), item_data
        if product_name and unit_price is not None:
            return None, product_name.strip(), float(unit_price), item_data
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    if not product_name or unit_price is None:
        raise HTTPException(status_code=400, detail="Each line needs a product or a custom name and price")
    return None, product_name.strip(), float(unit_price), item_data


def _build_quotation_items(data_items, db: Session, settings: dict):
    tax_rate = float(settings["tax_rate"]) / 100
    subtotal = 0.0
    quote_items = []
    for item_data in _normalize_quote_items(data_items):
        product_id, name, unit_price, raw = _resolve_quote_line(item_data, db)
        qty = _quote_field(raw, "quantity", 1)
        discount = _quote_field(raw, "discount", 0) or 0
        line_total = round(unit_price * qty - discount, 2)
        subtotal += line_total
        quote_items.append((product_id, name, unit_price, raw, line_total))
    tax_amount = round(subtotal * tax_rate, 2) if _settings_bool(settings.get("receipt_show_tax"), True) else 0
    return subtotal, tax_amount, quote_items


def _save_quote_items(quotation_id: int, quote_items, db: Session):
    for product_id, name, unit_price, item_data, line_total in quote_items:
        db.add(QuotationItem(
            quotation_id=quotation_id,
            product_id=product_id,
            product_name=name,
            quantity=_quote_field(item_data, "quantity", 1),
            unit_price=unit_price,
            discount=_quote_field(item_data, "discount", 0) or 0,
            line_total=line_total,
        ))


@app.put("/api/quotations/{quote_id}", response_model=QuotationResponse)
def update_quotation(quote_id: int, data: QuotationUpdate, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    quote = db.query(Quotation).filter(Quotation.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quotation not found")
    settings = get_all_settings(db)
    updates = data.model_dump(exclude_unset=True)
    items_data = updates.pop("items", None)
    valid_days = updates.pop("valid_days", None)
    valid_until = updates.pop("valid_until", None)

    try:
        if items_data is not None:
            if not items_data:
                raise HTTPException(status_code=400, detail="Quotation must have at least one item")
            subtotal, tax_amount, quote_items = _build_quotation_items(items_data, db, settings)
            discount = updates.pop("discount_amount", None)
            if discount is None:
                discount = quote.discount_amount or 0
            other = updates.pop("other_charges", None)
            if other is None:
                other = quote.other_charges or 0
            quote.subtotal = round(subtotal, 2)
            quote.tax_amount = tax_amount
            quote.discount_amount = discount
            quote.other_charges = other
            quote.total = round(subtotal + tax_amount - discount + other, 2)
            db.query(QuotationItem).filter(QuotationItem.quotation_id == quote.id).delete(synchronize_session=False)
            db.flush()
            _save_quote_items(quote.id, quote_items, db)

        for key, value in updates.items():
            if hasattr(quote, key):
                setattr(quote, key, value)

        if items_data is None and any(k in updates for k in ("discount_amount", "other_charges")):
            quote.total = round(
                quote.subtotal + quote.tax_amount - (quote.discount_amount or 0) + (quote.other_charges or 0), 2
            )

        if valid_until is not None:
            quote.valid_until = valid_until
        elif valid_days is not None:
            quote.valid_until = datetime.utcnow() + timedelta(days=valid_days)

        db.commit()
        db.refresh(quote)
        return quote
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update quotation: {e}")


@app.post("/api/quotations/{quote_id}/print")
def print_quotation(quote_id: int, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    quote = db.query(Quotation).filter(Quotation.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quotation not found")
    emp = db.query(Employee).filter(Employee.id == quote.employee_id).first() if quote.employee_id else user
    settings = settings_for_employee(db, emp or user, acting_user=user)
    logo = LOGO_PATH if os.path.exists(LOGO_PATH) else None
    receipt_bytes = build_receipt_bytes(
        quote, settings, logo_path=logo, doc_type="quotation",
        cashier_name=emp.name if emp else user.name,
    )
    try:
        print_raw(receipt_bytes, printer_for_user(user, settings))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Print failed: {e}")
    return {"message": "Quotation printed"}


# --- Shops ---
@app.get("/api/shops", response_model=List[ShopResponse])
def list_shops(db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    shops = db.query(Shop).order_by(Shop.name).all()
    result = []
    for shop in shops:
        count = db.query(Employee).filter(Employee.shop_id == shop.id, Employee.is_active == True).count()
        result.append(ShopResponse(
            id=shop.id, name=shop.name, address=shop.address, phone=shop.phone,
            is_active=shop.is_active, employee_count=count,
        ))
    return result


@app.post("/api/shops", response_model=ShopResponse)
def create_shop(data: ShopCreate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    shop = Shop(**data.model_dump())
    db.add(shop)
    db.commit()
    db.refresh(shop)
    return ShopResponse(id=shop.id, name=shop.name, address=shop.address, phone=shop.phone, is_active=shop.is_active)


@app.put("/api/shops/{shop_id}", response_model=ShopResponse)
def update_shop(shop_id: int, data: ShopUpdate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(shop, key, value)
    db.commit()
    db.refresh(shop)
    count = db.query(Employee).filter(Employee.shop_id == shop.id, Employee.is_active == True).count()
    return ShopResponse(
        id=shop.id, name=shop.name, address=shop.address, phone=shop.phone,
        is_active=shop.is_active, employee_count=count,
    )


@app.delete("/api/shops/{shop_id}")
def delete_shop(shop_id: int, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    db.query(Product).filter(Product.shop_id == shop_id).update({"shop_id": None})
    db.query(Order).filter(Order.shop_id == shop_id).update({"shop_id": None})
    db.query(CashSession).filter(CashSession.shop_id == shop_id).update({"shop_id": None})
    db.query(Employee).filter(Employee.shop_id == shop_id).update({"shop_id": None})
    db.delete(shop)
    db.commit()
    return {"message": "Shop deleted"}


# --- Cash sessions ---
@app.get("/api/cash-sessions/current")
def current_session(db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    session = get_open_session(db, user.id)
    if not session:
        return Response(content="null", media_type="application/json")
    order_count = db.query(func.count(Order.id)).filter(Order.cash_session_id == session.id).scalar()
    return session_to_response(session, db, order_count)


@app.post("/api/cash-sessions/open", response_model=CashSessionResponse)
def open_session(data: CashSessionOpen, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    if get_open_session(db, user.id):
        raise HTTPException(status_code=400, detail="You already have an open shift")
    shop_id = data.shop_id or user.shop_id
    if shop_id and not db.query(Shop).filter(Shop.id == shop_id).first():
        raise HTTPException(status_code=400, detail="Shop not found")
    session = CashSession(
        employee_id=user.id, shop_id=shop_id, opening_float=data.opening_float, status="open",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session_to_response(session, db, 0)


def _session_sales_totals(session, db: Session):
    orders = db.query(Order).filter(
        Order.cash_session_id == session.id,
        Order.status == OrderStatus.COMPLETED.value,
    ).all()
    sales_cash = sum(o.total for o in orders if o.payment_method == "cash")
    sales_card = sum(o.total for o in orders if o.payment_method == "card")
    sales_mobile = sum(o.total for o in orders if o.payment_method == "mobile")
    return orders, sales_cash, sales_card, sales_mobile


@app.get("/api/cash-sessions/reconcile", response_model=ShiftReconcilePreview)
def reconcile_session(
    closing_cash: float = Query(..., ge=0),
    closing_card: float = Query(0, ge=0),
    closing_mobile: float = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: Employee = Depends(get_current_user),
):
    session = get_open_session(db, user.id)
    if not session:
        raise HTTPException(status_code=400, detail="No open shift")
    orders, sales_cash, sales_card, sales_mobile = _session_sales_totals(session, db)
    expected_cash = round(session.opening_float + sales_cash, 2)
    expected_card = round(sales_card, 2)
    expected_mobile = round(sales_mobile, 2)
    cash_shortage = round(max(0, expected_cash - closing_cash), 2)
    card_shortage = round(max(0, expected_card - closing_card), 2)
    mobile_shortage = round(max(0, expected_mobile - closing_mobile), 2)
    settings = get_all_settings(db)
    return ShiftReconcilePreview(
        opening_float=session.opening_float,
        sales_cash=round(sales_cash, 2),
        sales_card=round(sales_card, 2),
        sales_mobile=round(sales_mobile, 2),
        expected_cash=expected_cash,
        expected_card=expected_card,
        expected_mobile=expected_mobile,
        cash_shortage=cash_shortage,
        card_shortage=card_shortage,
        mobile_shortage=mobile_shortage,
        total_shortage=round(cash_shortage + card_shortage + mobile_shortage, 2),
        order_count=len(orders),
        currency=settings.get("currency", "USD"),
    )


@app.post("/api/cash-sessions/close", response_model=CashSessionResponse)
def close_session(data: CashSessionClose, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    session = get_open_session(db, user.id)
    if not session:
        raise HTTPException(status_code=400, detail="No open shift to close")

    orders, sales_cash, sales_card, sales_mobile = _session_sales_totals(session, db)

    expected_cash = round(session.opening_float + sales_cash, 2)
    expected_card = round(sales_card, 2)
    expected_mobile = round(sales_mobile, 2)

    cash_shortage = round(expected_cash - data.closing_cash, 2)
    card_shortage = round(expected_card - data.closing_card, 2)
    mobile_shortage = round(expected_mobile - data.closing_mobile, 2)
    total_shortage = round(max(0, cash_shortage) + max(0, card_shortage) + max(0, mobile_shortage), 2)

    if total_shortage > 0 and not data.acknowledge_shortage:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Shift does not balance",
                "total_shortage": total_shortage,
                "cash_shortage": max(0, cash_shortage),
                "card_shortage": max(0, card_shortage),
                "mobile_shortage": max(0, mobile_shortage),
                "expected_cash": expected_cash,
                "expected_card": expected_card,
                "expected_mobile": expected_mobile,
            },
        )

    session.closing_cash = data.closing_cash
    session.closing_card = data.closing_card
    session.closing_mobile = data.closing_mobile
    session.expected_cash = expected_cash
    session.expected_card = expected_card
    session.expected_mobile = expected_mobile
    session.cash_shortage = max(0, cash_shortage)
    session.card_shortage = max(0, card_shortage)
    session.mobile_shortage = max(0, mobile_shortage)
    session.total_shortage = total_shortage
    session.notes = data.notes
    session.status = "closed"
    session.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return session_to_response(session, db, len(orders))


@app.get("/api/cash-sessions", response_model=List[CashSessionResponse])
def list_sessions(
    days: int = Query(30, le=90),
    employee_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: Employee = Depends(get_current_user),
):
    if user.role != "admin" and employee_id and employee_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    start = datetime.utcnow() - timedelta(days=days)
    q = db.query(CashSession).filter(CashSession.opened_at >= start)
    if user.role != "admin":
        q = q.filter(CashSession.employee_id == user.id)
    elif employee_id:
        q = q.filter(CashSession.employee_id == employee_id)
    sessions = q.order_by(desc(CashSession.opened_at)).all()
    result = []
    for s in sessions:
        order_count = db.query(func.count(Order.id)).filter(Order.cash_session_id == s.id).scalar()
        result.append(session_to_response(s, db, order_count))
    return result


# --- Reports ---
@app.get("/api/reports/dashboard", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    month_start = today_start - timedelta(days=30)
    completed = Order.status == OrderStatus.COMPLETED.value

    today_sales = db.query(func.coalesce(func.sum(Order.total), 0)).filter(completed, Order.created_at >= today_start).scalar()
    today_orders = db.query(func.count(Order.id)).filter(completed, Order.created_at >= today_start).scalar()
    week_sales = db.query(func.coalesce(func.sum(Order.total), 0)).filter(completed, Order.created_at >= week_start).scalar()
    month_sales = db.query(func.coalesce(func.sum(Order.total), 0)).filter(completed, Order.created_at >= month_start).scalar()
    products = db.query(Product).filter(Product.is_active == True).all()
    low_stock = sum(1 for p in products if 0 < p.stock_quantity <= p.low_stock_threshold)
    oos_count = db.query(func.count(OutOfStockRecord.id)).scalar()

    return DashboardStats(
        today_sales=float(today_sales), today_orders=today_orders,
        week_sales=float(week_sales), month_sales=float(month_sales),
        total_products=len(products), low_stock_count=low_stock,
        out_of_stock_count=oos_count, total_customers=db.query(func.count(Customer.id)).scalar(),
    )


@app.get("/api/reports/top-products", response_model=List[TopProduct])
def top_products(limit: int = 10, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    rows = (
        db.query(OrderItem.product_id, OrderItem.product_name,
                 func.sum(OrderItem.quantity).label("qty"),
                 func.sum(OrderItem.line_total).label("revenue"))
        .join(Order).filter(Order.status == OrderStatus.COMPLETED.value)
        .group_by(OrderItem.product_id, OrderItem.product_name)
        .order_by(desc("qty")).limit(limit).all()
    )
    return [TopProduct(product_id=r.product_id, product_name=r.product_name, quantity_sold=r.qty, revenue=float(r.revenue)) for r in rows]


@app.get("/api/reports/sales-by-day", response_model=List[SalesByDay])
def sales_by_day(days: int = 7, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    start = datetime.utcnow() - timedelta(days=days)
    orders = db.query(Order).filter(Order.created_at >= start, Order.status == OrderStatus.COMPLETED.value).all()
    by_day = {}
    for o in orders:
        day = o.created_at.strftime("%Y-%m-%d")
        if day not in by_day:
            by_day[day] = {"sales": 0.0, "orders": 0}
        by_day[day]["sales"] += o.total
        by_day[day]["orders"] += 1
    result = []
    for i in range(days):
        d = (datetime.utcnow() - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        data = by_day.get(d, {"sales": 0.0, "orders": 0})
        result.append(SalesByDay(date=d, sales=round(data["sales"], 2), orders=data["orders"]))
    return result


@app.get("/api/reports/cashier-sales", response_model=List[CashierSales])
def cashier_sales(days: int = 30, db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    start = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(
            Employee.id,
            Employee.name,
            func.coalesce(func.sum(Order.total), 0).label("sales"),
            func.count(Order.id).label("orders"),
        )
        .outerjoin(Order, (Order.employee_id == Employee.id) & (Order.created_at >= start) & (Order.status == OrderStatus.COMPLETED.value))
        .filter(Employee.is_active == True)
        .group_by(Employee.id, Employee.name)
        .order_by(desc("sales"))
        .all()
    )
    return [
        CashierSales(employee_id=r.id, employee_name=r.name, total_sales=round(float(r.sales), 2), order_count=r.orders)
        for r in rows
    ]


@app.get("/api/printers")
def list_printers(user: Employee = Depends(get_current_user)):
    try:
        import win32print
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        printers = [p[2] for p in win32print.EnumPrinters(flags)]
        default = win32print.GetDefaultPrinter()
        return {"printers": printers, "default": default}
    except Exception:
        return {"printers": [], "default": ""}


# --- Settings ---
@app.get("/api/settings", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    return settings_to_response(get_all_settings(db))


@app.put("/api/settings", response_model=SettingsResponse)
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), admin: Employee = Depends(require_admin)):
    mapping = {
        "store_name": data.store_name,
        "tax_rate": str(data.tax_rate) if data.tax_rate is not None else None,
        "currency": data.currency,
        "receipt_footer": data.receipt_footer,
        "receipt_header": data.receipt_header,
        "receipt_tagline": data.receipt_tagline,
        "receipt_phone": data.receipt_phone,
        "receipt_brand_line": data.receipt_brand_line,
        "receipt_website": data.receipt_website,
        "receipt_show_logo": str(data.receipt_show_logo).lower() if data.receipt_show_logo is not None else None,
        "receipt_show_tax": str(data.receipt_show_tax).lower() if data.receipt_show_tax is not None else None,
        "receipt_show_payment": str(data.receipt_show_payment).lower() if data.receipt_show_payment is not None else None,
        "quotation_valid_days": str(data.quotation_valid_days) if data.quotation_valid_days is not None else None,
        "quotation_footer": data.quotation_footer,
        "quote_title": data.quote_title,
        "quote_fax": data.quote_fax,
        "quote_terms_text": data.quote_terms_text,
        "quote_thank_you": data.quote_thank_you,
        "quote_show_acceptance": str(data.quote_show_acceptance).lower() if data.quote_show_acceptance is not None else None,
        "quote_show_prepared_by": str(data.quote_show_prepared_by).lower() if data.quote_show_prepared_by is not None else None,
        "quote_contact_line": data.quote_contact_line,
        "theme": data.theme,
        "printer_name": data.printer_name,
        "address": data.address,
        "email": data.email,
    }
    for key, value in mapping.items():
        if value is not None:
            setting = db.query(Settings).filter(Settings.key == key).first()
            if setting:
                setting.value = value
            else:
                db.add(Settings(key=key, value=value))
    db.commit()
    return get_settings(db)


# --- Activity logs ---
@app.post("/api/activity-logs", response_model=ActivityLogResponse)
def create_activity_log(
    data: ActivityLogCreate,
    db: Session = Depends(get_db),
    user: Employee = Depends(get_current_user),
):
    entry = ActivityLog(
        employee_id=user.id,
        username=user.username,
        user_name=user.name,
        action=data.action,
        page=data.page,
        details=data.details,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.get("/api/activity-logs", response_model=List[ActivityLogResponse])
def list_activity_logs(
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    username: Optional[str] = Query(None),
    page: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: Employee = Depends(require_admin),
):
    q = db.query(ActivityLog).order_by(desc(ActivityLog.created_at))
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(or_(
            ActivityLog.action.ilike(term),
            ActivityLog.details.ilike(term),
            ActivityLog.username.ilike(term),
            ActivityLog.user_name.ilike(term),
            ActivityLog.page.ilike(term),
        ))
    if username:
        q = q.filter(ActivityLog.username == username)
    if page:
        q = q.filter(ActivityLog.page == page)
    return q.offset(offset).limit(limit).all()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Entracte POS"}
