"""Dashboard stats endpoint."""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, select

from database import get_db
from models import Kit, Account, ScrapeJob, ParentAccount
from schemas import DashboardStats

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


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


@router.get("/stats", response_model=DashboardStats)
def get_stats(parent_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    kits_q = db.query(Kit)
    acc_q  = db.query(Account)

    if parent_id is not None:
        kits_q = kits_q.join(Account, Kit.account_id == Account.id).filter(Account.parent_account_id == parent_id)
        acc_q  = acc_q.filter(Account.parent_account_id == parent_id)

    total_kits     = kits_q.count()
    active         = kits_q.filter(Kit.status == "active").count()
    restricted     = kits_q.filter(Kit.status == "restricted").count()
    suspended      = kits_q.filter(Kit.status == "suspended").count()
    inactive       = kits_q.filter(Kit.status == "inactive").count()
    total_accounts = acc_q.count()

    # Hitung Quota Alerts (Limit Quota 5TB+ & Hampir Full 4.5TB - 5TB)
    tb_candidates = kits_q.filter(Kit.quota.ilike("%TB%")).all()
    limit_quota_count = 0
    near_full_quota_count = 0
    quota_alerts = []

    for k in tb_candidates:
        tb = parse_quota_tb(k.quota)
        if tb >= 5.0:
            limit_quota_count += 1
            quota_alerts.append({
                "id": k.id,
                "site": k.site or "-",
                "kit": k.kit or "-",
                "sn": k.sn or "-",
                "account_name": k.account.account_name if k.account else "-",
                "account_number": k.account.account_number if k.account else "-",
                "quota": k.quota,
                "usage_tb": round(tb, 2),
                "level": "limit",
                "label": "Limit Quota",
            })
        elif tb >= 4.5:
            near_full_quota_count += 1
            quota_alerts.append({
                "id": k.id,
                "site": k.site or "-",
                "kit": k.kit or "-",
                "sn": k.sn or "-",
                "account_name": k.account.account_name if k.account else "-",
                "account_number": k.account.account_number if k.account else "-",
                "quota": k.quota,
                "usage_tb": round(tb, 2),
                "level": "near_full",
                "label": "Quota Hampir Full",
            })

    # Urutkan berdasarkan pemakaian tertinggi
    quota_alerts.sort(key=lambda x: x["usage_tb"], reverse=True)

    # Cek status running job
    running_job = db.query(ScrapeJob).filter(ScrapeJob.status == "running").first()
    is_scraping = running_job is not None

    last_job = (
        db.query(ScrapeJob)
        .filter(ScrapeJob.status == "done")
        .order_by(ScrapeJob.finished_at.desc())
        .first()
    )
    last_scraped = last_job.finished_at if last_job else None

    # Interval dari env (default 1 jam = 3600 detik)
    interval_hours = float(os.getenv("SCRAPE_INTERVAL_HOURS", "1"))
    interval_seconds = int(interval_hours * 3600)

    # Cek info scheduler state dari file shared jika ada
    next_scraped = None
    state_file = Path("/data/.scheduler_state.json")
    if not state_file.exists():
        state_file = Path(os.getenv("SCRAPER_DIR", "/app/scraper")) / ".scheduler_state.json"
    if state_file.exists():
        try:
            info = json.loads(state_file.read_text(encoding="utf-8"))
            if "next_run" in info:
                next_scraped = datetime.fromisoformat(info["next_run"])
            if info.get("status") == "scraping":
                is_scraping = True
        except Exception:
            pass

    if not next_scraped and last_scraped:
        next_scraped = last_scraped + timedelta(seconds=interval_seconds)

    return DashboardStats(
        total_kits=total_kits,
        active=active,
        restricted=restricted,
        suspended=suspended,
        inactive=inactive,
        total_accounts=total_accounts,
        limit_quota_count=limit_quota_count,
        near_full_quota_count=near_full_quota_count,
        quota_alerts=quota_alerts,
        last_scraped_at=last_scraped,
        next_scraped_at=next_scraped,
        is_scraping=is_scraping,
        scrape_interval_seconds=interval_seconds,
    )


@router.get("/summary")
def get_summary(parent_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """Ringkasan status KIT per akun."""
    q = (
        db.query(
            Account.account_number,
            Account.account_name,
            Account.parent_account_id,
            func.count(Kit.id).label("total"),
            func.sum(func.if_(Kit.status == "active", 1, 0)).label("active"),
            func.sum(func.if_(Kit.status == "restricted", 1, 0)).label("restricted"),
            func.sum(func.if_(Kit.status == "suspended", 1, 0)).label("suspended"),
            func.sum(func.if_(Kit.status == "inactive", 1, 0)).label("inactive"),
        )
        .outerjoin(Kit, Kit.account_id == Account.id)
    )

    if parent_id is not None:
        q = q.filter(Account.parent_account_id == parent_id)

    rows = q.group_by(Account.id).all()

    return [
        {
            "account_number": r.account_number,
            "account_name": r.account_name,
            "parent_account_id": r.parent_account_id,
            "total": r.total or 0,
            "active": int(r.active or 0),
            "restricted": int(r.restricted or 0),
            "suspended": int(r.suspended or 0),
            "inactive": int(r.inactive or 0),
        }
        for r in rows
    ]
