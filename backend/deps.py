from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from database import get_db
from models import Employee
from auth import decode_token


def get_current_user(
    authorization: str = Header(None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Employee:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:].strip()
    try:
        payload = decode_token(token)
        employee_id = int(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid token")
    employee = db.query(Employee).filter(
        Employee.id == employee_id, Employee.is_active == True
    ).first()
    if not employee:
        raise HTTPException(status_code=401, detail="User not found")
    return employee


def require_admin(user: Employee = Depends(get_current_user)) -> Employee:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
