"""Parent Accounts Router — Management for multiple primary Starlink credentials."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import ParentAccount, Account, Kit
from schemas import ParentAccountOut, ParentAccountCreate

router = APIRouter(prefix="/api/parent-accounts", tags=["parent-accounts"])


@router.get("", response_model=List[ParentAccountOut])
def list_parent_accounts(db: Session = Depends(get_db)):
    """Daftar semua akun induk Starlink."""
    parents = db.query(ParentAccount).order_by(ParentAccount.id).all()
    results = []
    for p in parents:
        sub_count = db.query(Account).filter(Account.parent_account_id == p.id).count()
        kit_count = (
            db.query(Kit)
            .join(Account, Kit.account_id == Account.id)
            .filter(Account.parent_account_id == p.id)
            .count()
        )
        results.append(
            ParentAccountOut(
                id=p.id,
                account_name=p.account_name,
                email=p.email,
                is_active=bool(p.is_active),
                is_valid=bool(p.is_valid),
                last_scraped_at=p.last_scraped_at,
                created_at=p.created_at,
                sub_account_count=sub_count,
                total_kits=kit_count,
            )
        )
    return results


@router.post("", response_model=ParentAccountOut)
def create_parent_account(data: ParentAccountCreate, db: Session = Depends(get_db)):
    """Tambah akun induk Starlink baru."""
    existing = db.query(ParentAccount).filter(ParentAccount.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Akun dengan email {data.email} sudah terdaftar.")

    new_acc = ParentAccount(
        account_name=data.account_name,
        email=data.email,
        password=data.password,
        is_active=1,
        is_valid=0,
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)

    return ParentAccountOut(
        id=new_acc.id,
        account_name=new_acc.account_name,
        email=new_acc.email,
        is_active=True,
        is_valid=False,
        last_scraped_at=None,
        created_at=new_acc.created_at,
        sub_account_count=0,
        total_kits=0,
    )


@router.patch("/{id}/toggle")
def toggle_parent_account(id: int, db: Session = Depends(get_db)):
    """Aktifkan / nonaktifkan akun induk dari siklus scraping."""
    acc = db.query(ParentAccount).filter(ParentAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Akun induk tidak ditemukan.")

    acc.is_active = 0 if acc.is_active else 1
    db.commit()
    return {"id": acc.id, "is_active": bool(acc.is_active)}


@router.delete("/{id}")
def delete_parent_account(id: int, db: Session = Depends(get_db)):
    """Hapus akun induk Starlink."""
    acc = db.query(ParentAccount).filter(ParentAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Akun induk tidak ditemukan.")

    # Detach sub-accounts
    db.query(Account).filter(Account.parent_account_id == id).update({"parent_account_id": None})
    db.delete(acc)
    db.commit()
    return {"ok": True, "deleted_id": id}
