from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from database import get_db
from models import Account, Kit
from schemas import AccountOut, KitOut
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
