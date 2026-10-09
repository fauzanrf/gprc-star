"""Kits endpoints."""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Kit, Account
from schemas import KitOut

router = APIRouter(prefix="/api/kits", tags=["kits"])


def parse_quota_tb(quota_str: Optional[str]) -> float:
    """Konversi string kuota (e.g. '5.80 TB', '500 GB') ke float TB."""
    if not quota_str:
        return 0.0
    s = str(quota_str).strip().upper()
    try:
        parts = s.split()
        if not parts:
            return 0.0
        val = float(parts[0])
        if "TB" in s:
            return val
        if "GB" in s:
            return val / 1024.0
        if "MB" in s:
            return val / (1024.0 * 1024.0)
        return 0.0
    except (ValueError, TypeError):
        return 0.0


@router.get("", response_model=List[KitOut])
def list_kits(
    status: Optional[str] = Query(None, description="Filter by status: active|restricted|suspended|inactive"),
    account_id: Optional[int] = Query(None),
    parent_id: Optional[int] = Query(None, description="Filter by parent account id"),
    search: Optional[str] = Query(None, description="Search by site/kit/sn"),
    quota_filter: Optional[str] = Query(None, description="Filter by quota alert: limit | near_full | any_alert"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Kit).options(joinedload(Kit.account))

    if parent_id is not None:
        q = q.join(Account, Kit.account_id == Account.id).filter(Account.parent_account_id == parent_id)
    if status:
        q = q.filter(Kit.status == status)
    if account_id:
        q = q.filter(Kit.account_id == account_id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (Kit.site.ilike(like)) | (Kit.kit.ilike(like)) | (Kit.sn.ilike(like))
        )

    if quota_filter in ("limit", "near_full", "any_alert"):
        candidates = q.filter(Kit.quota.ilike("%TB%")).all()
        filtered = []
        for k in candidates:
            val_tb = parse_quota_tb(k.quota)
            if quota_filter == "limit" and val_tb >= 5.0:
                filtered.append((val_tb, k))
            elif quota_filter == "near_full" and 4.5 <= val_tb < 5.0:
                filtered.append((val_tb, k))
            elif quota_filter == "any_alert" and val_tb >= 4.5:
                filtered.append((val_tb, k))
        # Sort descending by quota TB
        filtered.sort(key=lambda x: x[0], reverse=True)
        kits = [item[1] for item in filtered[(page - 1) * size : page * size]]
    else:
        kits = q.offset((page - 1) * size).limit(size).all()

    result = []
    for k in kits:
        out = KitOut.from_orm(k)
        if k.account:
            out.account_number = k.account.account_number
            out.account_name   = k.account.account_name
            out.email          = k.account.email

        val_tb = parse_quota_tb(k.quota)
        if val_tb >= 5.0:
            out.quota_alert = "limit"
        elif val_tb >= 4.5:
            out.quota_alert = "near_full"
        else:
            out.quota_alert = None

        result.append(out)
    return result

