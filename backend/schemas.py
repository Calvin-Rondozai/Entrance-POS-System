from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str
    color: str = "#006AFF"


class CategoryResponse(BaseModel):
    id: int
    name: str
    color: str
    model_config = {"from_attributes": True}


class ProductCreate(BaseModel):
    name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    price: float
    cost: float = 0.0
    stock_quantity: int = 0
    low_stock_threshold: int = 5
    category_id: Optional[int] = None
    shop_id: Optional[int] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    cost: Optional[float] = None
    stock_quantity: Optional[int] = None
    low_stock_threshold: Optional[int] = None
    category_id: Optional[int] = None
    shop_id: Optional[int] = None
    is_active: Optional[bool] = None


class ProductResponse(BaseModel):
    id: int
    name: str
    sku: Optional[str] = None
    description: Optional[str] = None
    barcode: Optional[str] = None
    price: float
    cost: float
    stock_quantity: int
    low_stock_threshold: int
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    is_active: bool
    is_low_stock: bool = False
    model_config = {"from_attributes": True}


class CustomerCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None


class CustomerResponse(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    loyalty_points: int
    total_spent: float
    model_config = {"from_attributes": True}


class EmployeeCreate(BaseModel):
    name: str
    username: str = Field(min_length=3, max_length=50)
    email: Optional[str] = None
    password: str = Field(min_length=1)
    role: str = "cashier"
    shop_id: Optional[int] = None


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = Field(default=None, min_length=3, max_length=50)
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    shop_id: Optional[int] = None
    is_active: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=1)


class EmployeeLogin(BaseModel):
    username: str
    password: str = Field(min_length=1)


class EmployeeResponse(BaseModel):
    id: int
    name: str
    username: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    shop_address: Optional[str] = None
    is_active: bool
    theme: Optional[str] = None
    printer_name: Optional[str] = None
    printer_page_size: Optional[str] = None
    quote_page_size: Optional[str] = None
    pos_view: Optional[str] = None
    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    theme: Optional[str] = None
    printer_name: Optional[str] = None
    printer_page_size: Optional[str] = None
    quote_page_size: Optional[str] = None
    pos_view: Optional[str] = None


class ShopCreate(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None


class ShopUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class ShopResponse(BaseModel):
    id: int
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    employee_count: int = 0
    model_config = {"from_attributes": True}


class CashSessionOpen(BaseModel):
    opening_float: float = Field(ge=0)
    shop_id: Optional[int] = None


class CashSessionClose(BaseModel):
    closing_cash: float = Field(ge=0)
    closing_card: float = Field(ge=0, default=0)
    closing_mobile: float = Field(ge=0, default=0)
    notes: Optional[str] = None
    acknowledge_shortage: bool = False


class ShiftReconcilePreview(BaseModel):
    opening_float: float
    sales_cash: float
    sales_card: float
    sales_mobile: float
    expected_cash: float
    expected_card: float
    expected_mobile: float
    cash_shortage: float
    card_shortage: float
    mobile_shortage: float
    total_shortage: float
    order_count: int
    currency: str = "USD"


class CashSessionResponse(BaseModel):
    id: int
    employee_id: int
    employee_name: Optional[str] = None
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    shop_address: Optional[str] = None
    opening_float: float
    closing_cash: Optional[float] = None
    closing_card: Optional[float] = None
    closing_mobile: Optional[float] = None
    expected_cash: Optional[float] = None
    expected_card: Optional[float] = None
    expected_mobile: Optional[float] = None
    cash_shortage: float = 0.0
    card_shortage: float = 0.0
    mobile_shortage: float = 0.0
    total_shortage: float = 0.0
    status: str
    notes: Optional[str] = None
    opened_at: datetime
    closed_at: Optional[datetime] = None
    order_count: int = 0


class LoginResponse(BaseModel):
    employee: EmployeeResponse
    token: str


class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(ge=1)
    discount: float = 0.0


class OrderCreate(BaseModel):
    items: List[OrderItemCreate]
    payment_method: str = "cash"
    amount_paid: float
    discount_amount: float = 0.0
    customer_id: Optional[int] = None
    notes: Optional[str] = None


class OrderItemResponse(BaseModel):
    id: int
    product_id: int
    product_name: str
    quantity: int
    unit_price: float
    discount: float
    line_total: float
    model_config = {"from_attributes": True}


class OrderResponse(BaseModel):
    id: int
    order_number: str
    subtotal: float
    tax_amount: float
    discount_amount: float
    total: float
    payment_method: str
    amount_paid: float
    change_given: float
    status: str
    employee_id: Optional[int] = None
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    created_at: datetime
    items: List[OrderItemResponse]
    model_config = {"from_attributes": True}


class DashboardStats(BaseModel):
    today_sales: float
    today_orders: int
    week_sales: float
    month_sales: float
    total_products: int
    low_stock_count: int
    out_of_stock_count: int
    total_customers: int


class TopProduct(BaseModel):
    product_id: int
    product_name: str
    quantity_sold: int
    revenue: float


class SalesByDay(BaseModel):
    date: str
    sales: float
    orders: int


class CashierSales(BaseModel):
    employee_id: int
    employee_name: str
    total_sales: float
    order_count: int


class SettingsUpdate(BaseModel):
    store_name: Optional[str] = None
    tax_rate: Optional[float] = None
    currency: Optional[str] = None
    receipt_footer: Optional[str] = None
    receipt_header: Optional[str] = None
    receipt_tagline: Optional[str] = None
    receipt_phone: Optional[str] = None
    receipt_brand_line: Optional[str] = None
    receipt_website: Optional[str] = None
    receipt_show_logo: Optional[bool] = None
    receipt_show_tax: Optional[bool] = None
    receipt_show_payment: Optional[bool] = None
    quotation_valid_days: Optional[int] = None
    quotation_footer: Optional[str] = None
    quote_title: Optional[str] = None
    quote_fax: Optional[str] = None
    quote_terms_text: Optional[str] = None
    quote_thank_you: Optional[str] = None
    quote_show_acceptance: Optional[bool] = None
    quote_show_prepared_by: Optional[bool] = None
    quote_contact_line: Optional[str] = None
    printer_name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    theme: Optional[str] = None


class SettingsResponse(BaseModel):
    store_name: str
    tax_rate: float
    currency: str
    receipt_footer: str
    receipt_header: str
    receipt_tagline: str
    receipt_phone: str
    receipt_brand_line: str
    receipt_website: str
    receipt_show_logo: bool
    receipt_show_tax: bool
    receipt_show_payment: bool
    quotation_valid_days: int
    quotation_footer: str
    quote_title: str
    quote_fax: str
    quote_terms_text: str
    quote_thank_you: str
    quote_show_acceptance: bool
    quote_show_prepared_by: bool
    quote_contact_line: str
    printer_name: str
    address: str
    email: str
    theme: str


class QuotationItemCreate(BaseModel):
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    unit_price: Optional[float] = None
    quantity: int = Field(ge=1)
    discount: float = 0.0


class QuotationCreate(BaseModel):
    items: List[QuotationItemCreate]
    customer_name: Optional[str] = None
    customer_company: Optional[str] = None
    customer_address: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    description_of_work: Optional[str] = None
    other_charges: float = 0.0
    valid_days: Optional[int] = None
    valid_until: Optional[datetime] = None
    discount_amount: float = 0.0
    notes: Optional[str] = None


class QuotationUpdate(BaseModel):
    items: Optional[List[QuotationItemCreate]] = None
    customer_name: Optional[str] = None
    customer_company: Optional[str] = None
    customer_address: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    other_charges: Optional[float] = None
    valid_days: Optional[int] = None
    valid_until: Optional[datetime] = None
    discount_amount: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class QuotationItemResponse(BaseModel):
    id: int
    product_id: Optional[int] = None
    product_name: str
    quantity: int
    unit_price: float
    discount: float
    line_total: float
    model_config = {"from_attributes": True}


class QuotationResponse(BaseModel):
    id: int
    quote_number: str
    subtotal: float
    tax_amount: float
    discount_amount: float
    total: float
    customer_name: Optional[str] = None
    customer_company: Optional[str] = None
    customer_address: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    description_of_work: Optional[str] = None
    other_charges: float = 0.0
    valid_until: Optional[datetime] = None
    notes: Optional[str] = None
    status: str
    employee_id: Optional[int] = None
    created_at: datetime
    items: List[QuotationItemResponse]
    model_config = {"from_attributes": True}


class ReceiptPreviewRequest(BaseModel):
    doc_type: str = "receipt"
    items: List[OrderItemCreate] = []
    customer_name: Optional[str] = None
    payment_method: str = "cash"
    amount_paid: Optional[float] = None
    discount_amount: float = 0.0


class OutOfStockResponse(BaseModel):
    id: int
    product_id: Optional[int] = None
    name: str
    sku: Optional[str] = None
    price: float
    category_name: Optional[str] = None
    date_out: datetime
    model_config = {"from_attributes": True}


class ImportResult(BaseModel):
    success_count: int
    error_count: int
    errors: List[str]


class ActivityLogCreate(BaseModel):
    action: str = Field(min_length=1, max_length=300)
    page: Optional[str] = Field(None, max_length=100)
    status_code: Optional[int] = None
    error_message: Optional[str] = Field(None, max_length=2000)
    details: Optional[str] = Field(None, max_length=2000)


class ActivityLogEvent(BaseModel):
    """Pre-auth events (login / health checks only)."""
    action: str = Field(min_length=1, max_length=300)
    page: Literal["login", "system"]
    username: Optional[str] = Field(None, max_length=100)
    status_code: Optional[int] = None
    error_message: Optional[str] = Field(None, max_length=2000)
    details: Optional[str] = Field(None, max_length=2000)


class ActivityLogResponse(BaseModel):
    id: int
    employee_id: Optional[int] = None
    username: str
    user_name: Optional[str] = None
    action: str
    page: Optional[str] = None
    status_code: Optional[int] = None
    error_message: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}
