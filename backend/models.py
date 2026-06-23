from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, Enum
)
from sqlalchemy.orm import relationship
import enum

from database import Base


class EmployeeRole(str, enum.Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    CASHIER = "cashier"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    CARD = "card"
    MOBILE = "mobile"


class OrderStatus(str, enum.Enum):
    COMPLETED = "completed"
    REFUNDED = "refunded"
    VOIDED = "voided"


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    color = Column(String(7), default="#6366f1")
    products = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    sku = Column(String(50), unique=True, index=True)
    barcode = Column(String(50), unique=True, nullable=True)
    description = Column(Text, nullable=True)
    price = Column(Float, nullable=False)
    cost = Column(Float, default=0.0)
    stock_quantity = Column(Integer, default=0)
    low_stock_threshold = Column(Integer, default=5)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category = relationship("Category", back_populates="products")
    shop = relationship("Shop")


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    email = Column(String(200), nullable=True)
    phone = Column(String(20), nullable=True)
    loyalty_points = Column(Integer, default=0)
    total_spent = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)


class Shop(Base):
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    address = Column(Text, nullable=True)
    phone = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    employees = relationship("Employee", back_populates="shop")


class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    username = Column(String(100), unique=True, nullable=False)
    email = Column(String(200), unique=True, nullable=True)
    phone = Column(String(50), nullable=True)
    pin_hash = Column(String(200), nullable=False)
    role = Column(String(20), default=EmployeeRole.CASHIER.value)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    profile_theme = Column(String(20), nullable=True)
    profile_printer = Column(String(200), nullable=True)
    profile_page_size = Column(String(20), nullable=True)
    profile_quote_page_size = Column(String(20), nullable=True)
    profile_pos_view = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    shop = relationship("Shop", back_populates="employees")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String(20), unique=True, index=True)
    subtotal = Column(Float, nullable=False)
    tax_amount = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    total = Column(Float, nullable=False)
    payment_method = Column(String(20), default=PaymentMethod.CASH.value)
    amount_paid = Column(Float, nullable=False)
    change_given = Column(Float, default=0.0)
    status = Column(String(20), default=OrderStatus.COMPLETED.value)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    cash_session_id = Column(Integer, ForeignKey("cash_sessions.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    employee = relationship("Employee")
    customer = relationship("Customer")
    shop = relationship("Shop")

    @property
    def shop_name(self):
        if self.shop:
            return self.shop.name
        if self.employee and getattr(self.employee, "shop", None):
            return self.employee.shop.name
        return None


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_name = Column(String(200), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    discount = Column(Float, default=0.0)
    line_total = Column(Float, nullable=False)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")


class Quotation(Base):
    __tablename__ = "quotations"

    id = Column(Integer, primary_key=True, index=True)
    quote_number = Column(String(20), unique=True, index=True)
    subtotal = Column(Float, nullable=False)
    tax_amount = Column(Float, default=0.0)
    discount_amount = Column(Float, default=0.0)
    total = Column(Float, nullable=False)
    customer_name = Column(String(200), nullable=True)
    customer_company = Column(String(200), nullable=True)
    customer_address = Column(Text, nullable=True)
    customer_phone = Column(String(50), nullable=True)
    customer_email = Column(String(200), nullable=True)
    description_of_work = Column(Text, nullable=True)
    other_charges = Column(Float, default=0.0)
    valid_until = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(20), default="draft")
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("QuotationItem", back_populates="quotation", cascade="all, delete-orphan")
    employee = relationship("Employee")


class QuotationItem(Base):
    __tablename__ = "quotation_items"

    id = Column(Integer, primary_key=True, index=True)
    quotation_id = Column(Integer, ForeignKey("quotations.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String(200), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    discount = Column(Float, default=0.0)
    line_total = Column(Float, nullable=False)

    quotation = relationship("Quotation", back_populates="items")
    product = relationship("Product")


class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=False)


class CashSession(Base):
    __tablename__ = "cash_sessions"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    opening_float = Column(Float, nullable=False, default=0.0)
    closing_cash = Column(Float, nullable=True)
    closing_card = Column(Float, nullable=True)
    closing_mobile = Column(Float, nullable=True)
    expected_cash = Column(Float, nullable=True)
    expected_card = Column(Float, nullable=True)
    expected_mobile = Column(Float, nullable=True)
    cash_shortage = Column(Float, default=0.0)
    card_shortage = Column(Float, default=0.0)
    mobile_shortage = Column(Float, default=0.0)
    total_shortage = Column(Float, default=0.0)
    status = Column(String(20), default="open")
    notes = Column(Text, nullable=True)
    opened_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    employee = relationship("Employee")
    shop = relationship("Shop")


class OutOfStockRecord(Base):
    __tablename__ = "out_of_stock"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    name = Column(String(200), nullable=False)
    sku = Column(String(50), nullable=True)
    price = Column(Float, default=0.0)
    category_name = Column(String(100), nullable=True)
    date_out = Column(DateTime, default=datetime.utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    username = Column(String(100), nullable=False, index=True)
    user_name = Column(String(200), nullable=True)
    action = Column(String(300), nullable=False)
    page = Column(String(100), nullable=True, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    employee = relationship("Employee")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    username = Column(String(100), nullable=False, index=True)
    user_name = Column(String(200), nullable=True)
    action = Column(String(200), nullable=False)
    page = Column(String(100), nullable=True, index=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    employee = relationship("Employee")
