from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from database import get_db
from models import Account, Kit, User
from schemas import (
    AccountOut,
    KitOut,
    AccountUpdate,
    AccountBulkEmailItem,
    AccountBulkUpdateResult,
)
from auth_utils import get_optional_current_user
from routers.kits import parse_quota_tb

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=List[AccountOut])
def list_accounts(parent_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    q = db.query(Account).options(joinedload(Account.parent_account))
    if parent_id is not None:
        q = q.filter(Account.parent_account_id == parent_id)
    accounts = q.order_by(Account.account_name).all()

    # Pre-fetch kit counts grouped by account_id to avoid N+1 queries
    kit_counts = dict(
        db.query(Kit.account_id, func.count(Kit.id))
        .group_by(Kit.account_id)
        .all()
    )

    result = []
    for acc in accounts:
        out = AccountOut.from_orm(acc)
        out.kit_count = kit_counts.get(acc.id, 0)
        out.email = acc.email or None
        if acc.parent_account:
            out.parent_account_name = acc.parent_account.account_name
        result.append(out)
    return result


@router.get("/{account_id}/kits", response_model=List[KitOut])
def get_account_kits(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    kits = db.query(Kit).filter(Kit.account_id == account_id).order_by(Kit.site).all()
    result = []
    for k in kits:
        out = KitOut.from_orm(k)
        out.account_number = acc.account_number
        out.account_name   = acc.account_name

        val_tb = parse_quota_tb(k.quota)
        if val_tb >= 5.0:
            out.quota_alert = "limit"
        elif val_tb >= 4.5:
            out.quota_alert = "near_full"
        else:
            out.quota_alert = None

        result.append(out)
    return result


@router.put("/{account_id}", response_model=AccountOut)
@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Mengupdate email, nama akun, atau akun induk untuk sub-account Starlink.
    Dapat digunakan untuk mengedit email dari luar.
    """
    if current_user and current_user.role in ("viewer", "magang"):
        raise HTTPException(
            status_code=403,
            detail="Role 'viewer' hanya memiliki izin baca-saja dan tidak dapat mengedit akun."
        )

    acc = db.query(Account).options(joinedload(Account.parent_account)).filter(Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Akun tidak ditemukan.")

    if payload.email is not None:
        clean_email = payload.email.strip()
        acc.email = clean_email if clean_email else None

    if payload.account_name is not None and payload.account_name.strip():
        acc.account_name = payload.account_name.strip()

    if payload.parent_account_id is not None:
        if payload.parent_account_id in (0, -1):
            acc.parent_account_id = None
        else:
            acc.parent_account_id = payload.parent_account_id

    acc.updated_at = func.now()
    db.commit()
    db.refresh(acc)

    kit_count = db.query(func.count(Kit.id)).filter(Kit.account_id == acc.id).scalar() or 0
    out = AccountOut.from_orm(acc)
    out.kit_count = kit_count
    out.email = acc.email or None
    if acc.parent_account:
        out.parent_account_name = acc.parent_account.account_name
    return out


@router.post("/bulk-update-email", response_model=AccountBulkUpdateResult)
def bulk_update_account_emails(
    items: List[AccountBulkEmailItem],
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Bulk update email untuk beberapa akun sekaligus dari luar.
    Menerima daftar nomor akun / id akun beserta alamat email barunya.
    """
    if current_user and current_user.role in ("viewer", "magang"):
        raise HTTPException(
            status_code=403,
            detail="Role 'viewer' hanya memiliki izin baca-saja."
        )

    updated = 0
    errors = []
    for item in items:
        clean_email = item.email.strip() if item.email else None
        acc = None
        if item.account_id:
            acc = db.query(Account).filter(Account.id == item.account_id).first()
        elif item.account_number:
            acc = db.query(Account).filter(Account.account_number == item.account_number.strip()).first()

        if acc:
            acc.email = clean_email
            acc.updated_at = func.now()
            updated += 1
        else:
            errors.append(f"Akun '{item.account_number or item.account_id}' tidak ditemukan.")

    db.commit()
    return AccountBulkUpdateResult(updated_count=updated, errors=errors)

