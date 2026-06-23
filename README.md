# Entracte POS

Professional Point of Sale system for **Entracte Solutions** — Python (FastAPI) backend + Electron desktop app.

## Features

- **Square-inspired UI** — clean light theme, Lucide icons, smooth animations
- **Thermal receipt printing** — ESC/POS via `win32print` (from `check.py` logic)
- **Role-based access** — Admin vs Cashier with JWT authentication
- **CSV import/export** — inventory, orders, out-of-stock records
- **Out of stock tracking** — auto-archives when stock hits zero
- **Team management** — register users, reset PINs, delete users (admin)
- **macOS-style notifications** — toast alerts from the top
- **Barcode scanning** — type/scan in search bar

## Quick Start

```powershell
cd backend
pip install -r requirements.txt

cd ..\electron
npm install
npm start
```

## Default Accounts

| Role    | Username | PIN       |
|---------|----------|-----------|
| Admin   | admin    | admin123  |
| Cashier | cashier  | cashier1  |

> Change these immediately in production via **Team → Reset PIN**.

## CSV Import Format

```csv
name,price,quantity,category,sku,barcode
Espresso,3.50,100,Beverages,BEV-001,1000000001
```

## Printer Setup

Configure your thermal printer name in **Settings** (default: `EPSON TM-T20II Receipt5`). Receipts print automatically after each sale.

## Tech Stack

- **Backend:** Python, FastAPI, SQLAlchemy, SQLite, JWT, python-escpos
- **Frontend:** Electron, vanilla JS, Lucide icons
- **Security:** bcrypt PIN hashing, JWT tokens (12h expiry), admin-only endpoints
