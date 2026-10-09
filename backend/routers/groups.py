"""
routers/groups.py
=================
API endpoints untuk manajemen Grouping KIT dan monitoring agregasi kuota
(khususnya Starlink Mini dan kelompok armada/lokasi).
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from datetime import datetime

from database import get_db
from models import Kit, Account, KitGroup, KitGroupMember
from schemas import (
    GroupOut, GroupDetailOut, GroupCreate, GroupUpdate,
    GroupMemberOut, AddMembersRequest
)

router = APIRouter(prefix="/api/groups", tags=["groups"])


def parse_quota_gb(quota_str: Optional[str]) -> float:
    """Konversi string kuota (e.g. '188.99 GB', '6.35 TB', '500 MB') ke float GB."""
    if not quota_str:
        return 0.0
    s = str(quota_str).strip().upper()
    try:
        parts = s.split()
        if not parts:
            return 0.0
        val = float(parts[0])
        if "TB" in s:
            return val * 1024.0
        if "GB" in s:
            return val
        if "MB" in s:
            return val / 1024.0
        return val
    except (ValueError, TypeError):
        return 0.0


def format_quota(quota_gb: float) -> str:
    """Format angka GB ke string terbaca rapi."""
    if quota_gb >= 1024.0:
        return f"{quota_gb / 1024.0:.2f} TB"
    return f"{quota_gb:.2f} GB"


def is_starlink_mini(sn: Optional[str], kit: Optional[str], site: Optional[str]) -> bool:
    """Deteksi apakah KIT merupakan perangkat Starlink Mini."""
    s_sn = (sn or "").upper()
    s_kit = (kit or "").upper()
    s_site = (site or "").lower()

    if s_sn.startswith("M1HT") or s_kit.startswith("KIT4M") or "mini" in s_site or "mini" in s_sn.lower():
        return True
    return False


@router.get("/detect-mini")
def detect_starlink_mini(db: Session = Depends(get_db)):
    """
    Scan otomatis seluruh KIT di database untuk mendeteksi perangkat Starlink Mini
    berdasarkan Dish SN (M1HT...), KIT Serial (KIT4M...), atau penamaan Site.
    """
    kits = db.query(Kit).options(joinedload(Kit.account)).all()
    mini_kits = []

    for k in kits:
        if is_starlink_mini(k.sn, k.kit, k.site):
            q_gb = parse_quota_gb(k.quota)
            mini_kits.append({
                "id": k.id,
                "account_id": k.account_id,
                "account_name": k.account.account_name if k.account else "-",
                "account_number": k.account.account_number if k.account else "-",
                "site": k.site or "-",
                "kit": k.kit or "-",
                "sn": k.sn or "-",
                "status": k.status,
                "quota": k.quota or "-",
                "quota_gb": round(q_gb, 2),
                "is_mini": True,
            })

    # Sort dari kuota terbesar
    mini_kits.sort(key=lambda x: x["quota_gb"], reverse=True)
    return {
        "total_mini_detected": len(mini_kits),
        "total_quota_gb": round(sum(k["quota_gb"] for k in mini_kits), 2),
        "total_quota_formatted": format_quota(sum(k["quota_gb"] for k in mini_kits)),
        "kits": mini_kits
    }


@router.get("", response_model=List[GroupOut])
def list_groups(db: Session = Depends(get_db)):
    """Daftar semua group beserta statistik agregasi kuota dan member."""
    groups = (
        db.query(KitGroup)
        .options(
            joinedload(KitGroup.members).joinedload(KitGroupMember.kit)
        )
        .order_by(KitGroup.id.desc())
        .all()
    )

    result = []
    for g in groups:
        member_count = len(g.members)
        total_quota_gb = 0.0
        active_kits = 0
        inactive_kits = 0

        for m in g.members:
            if m.kit:
                total_quota_gb += parse_quota_gb(m.kit.quota)
                if m.kit.status == "active":
                    active_kits += 1
                else:
                    inactive_kits += 1

        total_quota_gb = round(total_quota_gb, 2)
        limit_gb = g.quota_limit_gb or 0.0

        if limit_gb > 0:
            usage_pct = round((total_quota_gb / limit_gb) * 100.0, 1)
            if usage_pct >= 100.0:
                alert_level = "over_quota"
            elif usage_pct >= 80.0:
                alert_level = "near_limit"
            else:
                alert_level = "normal"
        else:
            usage_pct = 0.0
            alert_level = "normal"

        out = GroupOut(
            id=g.id,
            name=g.name,
            description=g.description,
            quota_limit_gb=limit_gb,
            color=g.color or "#3b82f6",
            member_count=member_count,
            total_quota_gb=total_quota_gb,
            total_quota_formatted=format_quota(total_quota_gb),
            usage_percentage=usage_pct,
            alert_level=alert_level,
            active_kits=active_kits,
            inactive_kits=inactive_kits,
            created_at=g.created_at,
            updated_at=g.updated_at,
        )
        result.append(out)

    return result


@router.post("", response_model=GroupDetailOut, status_code=status.HTTP_201_CREATED)
def create_group(payload: GroupCreate, db: Session = Depends(get_db)):
    """Buat group baru dan opsional langsung tambahkan daftar KIT anggota."""
    grp = KitGroup(
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
        quota_limit_gb=payload.quota_limit_gb or 0.0,
        color=payload.color or "#3b82f6",
    )
    db.add(grp)
    db.flush()

    # Tambahkan initial kits jika ada
    if payload.initial_kit_ids:
        unique_ids = list(set(payload.initial_kit_ids))
        for kid in unique_ids:
            # Pastikan kit ada
            kit_exists = db.query(Kit).filter(Kit.id == kid).first()
            if kit_exists:
                db.add(KitGroupMember(group_id=grp.id, kit_id=kid))

    db.commit()
    db.refresh(grp)

    return get_group_detail(grp.id, db)


@router.get("/{group_id}", response_model=GroupDetailOut)
def get_group_detail(group_id: int, db: Session = Depends(get_db)):
    """Detail group beserta daftar lengkap anggota KIT dan kuota masing-masing."""
    grp = (
        db.query(KitGroup)
        .filter(KitGroup.id == group_id)
        .options(
            joinedload(KitGroup.members)
            .joinedload(KitGroupMember.kit)
            .joinedload(Kit.account)
        )
        .first()
    )
    if not grp:
        raise HTTPException(status_code=404, detail="Group tidak ditemukan")

    members_out = []
    total_quota_gb = 0.0
    active_kits = 0
    inactive_kits = 0

    for m in grp.members:
        if m.kit:
            k = m.kit
            q_gb = round(parse_quota_gb(k.quota), 2)
            total_quota_gb += q_gb
            if k.status == "active":
                active_kits += 1
            else:
                inactive_kits += 1

            mini_flag = is_starlink_mini(k.sn, k.kit, k.site)
            members_out.append(
                GroupMemberOut(
                    kit_id=k.id,
                    account_name=k.account.account_name if k.account else "-",
                    account_number=k.account.account_number if k.account else "-",
                    site=k.site or "-",
                    kit=k.kit or "-",
                    sn=k.sn or "-",
                    status=k.status,
                    quota=k.quota or "-",
                    quota_gb=q_gb,
                    is_mini=mini_flag,
                    added_at=m.added_at,
                )
            )

    # Sort anggota berdasarkan pemakaian kuota tertinggi
    members_out.sort(key=lambda x: x.quota_gb, reverse=True)

    total_quota_gb = round(total_quota_gb, 2)
    limit_gb = grp.quota_limit_gb or 0.0
    if limit_gb > 0:
        usage_pct = round((total_quota_gb / limit_gb) * 100.0, 1)
        if usage_pct >= 100.0:
            alert_level = "over_quota"
        elif usage_pct >= 80.0:
            alert_level = "near_limit"
        else:
            alert_level = "normal"
    else:
        usage_pct = 0.0
        alert_level = "normal"

    return GroupDetailOut(
        id=grp.id,
        name=grp.name,
        description=grp.description,
        quota_limit_gb=limit_gb,
        color=grp.color or "#3b82f6",
        member_count=len(members_out),
        total_quota_gb=total_quota_gb,
        total_quota_formatted=format_quota(total_quota_gb),
        usage_percentage=usage_pct,
        alert_level=alert_level,
        active_kits=active_kits,
        inactive_kits=inactive_kits,
        created_at=grp.created_at,
        updated_at=grp.updated_at,
        members=members_out,
    )


@router.put("/{group_id}", response_model=GroupDetailOut)
def update_group(group_id: int, payload: GroupUpdate, db: Session = Depends(get_db)):
    """Update informasi dasar group (nama, deskripsi, batas kuota, warna)."""
    grp = db.query(KitGroup).filter(KitGroup.id == group_id).first()
    if not grp:
        raise HTTPException(status_code=404, detail="Group tidak ditemukan")

    if payload.name is not None:
        grp.name = payload.name.strip()
    if payload.description is not None:
        grp.description = payload.description.strip()
    if payload.quota_limit_gb is not None:
        grp.quota_limit_gb = payload.quota_limit_gb
    if payload.color is not None:
        grp.color = payload.color.strip()

    grp.updated_at = datetime.now()
    db.commit()
    return get_group_detail(group_id, db)


@router.delete("/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    """Hapus group beserta relasi anggotanya (tidak menghapus data KIT)."""
    grp = db.query(KitGroup).filter(KitGroup.id == group_id).first()
    if not grp:
        raise HTTPException(status_code=404, detail="Group tidak ditemukan")

    db.delete(grp)
    db.commit()
    return {"message": f"Group '{grp.name}' berhasil dihapus."}


@router.post("/{group_id}/members")
def add_group_members(group_id: int, payload: AddMembersRequest, db: Session = Depends(get_db)):
    """Tambahkan satu atau beberapa KIT ke dalam group."""
    grp = db.query(KitGroup).filter(KitGroup.id == group_id).first()
    if not grp:
        raise HTTPException(status_code=404, detail="Group tidak ditemukan")

    added_count = 0
    for kid in set(payload.kit_ids):
        # Cek apakah sudah jadi member
        existing = (
            db.query(KitGroupMember)
            .filter(KitGroupMember.group_id == group_id, KitGroupMember.kit_id == kid)
            .first()
        )
        if not existing:
            # Pastikan kit ada di DB
            kit_exists = db.query(Kit).filter(Kit.id == kid).first()
            if kit_exists:
                db.add(KitGroupMember(group_id=group_id, kit_id=kid))
                added_count += 1

    db.commit()
    return {"message": f"Berhasil menambahkan {added_count} KIT ke group.", "added": added_count}


@router.delete("/{group_id}/members/{kit_id}")
def remove_group_member(group_id: int, kit_id: int, db: Session = Depends(get_db)):
    """Keluarkan KIT dari group."""
    member = (
        db.query(KitGroupMember)
        .filter(KitGroupMember.group_id == group_id, KitGroupMember.kit_id == kit_id)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="KIT bukan anggota group ini")

    db.delete(member)
    db.commit()
    return {"message": "KIT berhasil dikeluarkan dari group."}
