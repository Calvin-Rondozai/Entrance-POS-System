"""Reset an admin password locally (forgot-password recovery).

Usage (from the backend folder):
    python reset_admin_password.py
    python reset_admin_password.py --username admin --password "NewSecurePass1"

Requires direct access to nexuspos.db on this machine.
"""
import argparse
import sys

from auth import hash_pin
from database import SessionLocal
from models import Employee


def main():
    parser = argparse.ArgumentParser(description="Reset a POS user password")
    parser.add_argument("--username", default="admin", help="Username to reset (default: admin)")
    parser.add_argument("--password", default=None, help="New password (prompted if omitted)")
    args = parser.parse_args()

    password = args.password
    if not password:
        password = input(f"New password for '{args.username}': ").strip()
    if len(password) < 4:
        print("Password must be at least 4 characters.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        user = db.query(Employee).filter(Employee.username == args.username).first()
        if not user:
            print(f"No user found with username '{args.username}'.", file=sys.stderr)
            sys.exit(1)
        user.pin_hash = hash_pin(password)
        if user.role != "admin":
            print(f"Warning: '{args.username}' is role '{user.role}', not admin.")
        db.commit()
        print(f"Password updated for '{args.username}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
