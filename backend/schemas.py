"""Pydantic schemas for request/response."""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


# ── Parent Account ───────────────────────────────────────────────────────────
class ParentAccountBase(BaseModel):
    account_name: str
    email: str

class ParentAccountCreate(ParentAccountBase):
    password: Optional[str] = None

class ParentAccountOut(ParentAccountBase):
    id: int
    is_active: bool
    is_valid: bool
    last_scraped_at: Optional[datetime]
    created_at: Optional[datetime]
    sub_account_count: Optional[int] = 0
    total_kits: Optional[int] = 0

    class Config:
        from_attributes = True


# ── Account ──────────────────────────────────────────────────────────────────
class AccountBase(BaseModel):
    account_number: str
    account_name: str

class AccountOut(AccountBase):
    id: int
    parent_account_id: Optional[int] = None
    email: Optional[str] = None
    parent_account_name: Optional[str] = None
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    kit_count: Optional[int] = 0

    class Config:
        from_attributes = True


class AccountUpdate(BaseModel):
    account_name: Optional[str] = None
    email: Optional[str] = None
    parent_account_id: Optional[int] = None


class AccountBulkEmailItem(BaseModel):
    account_number: Optional[str] = None
    account_id: Optional[int] = None
    email: str


class AccountBulkUpdateResult(BaseModel):
    updated_count: int
    errors: List[str] = []



# ── Kit ──────────────────────────────────────────────────────────────────────
class KitOut(BaseModel):
    id: int
    account_id: int
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    email: Optional[str] = None
    site: Optional[str]
    sn: Optional[str]
    kit: Optional[str]
    status: str     # active | restricted | suspended | inactive
    quota: Optional[str]
    quota_alert: Optional[str] = None  # "limit" (>=5TB) | "near_full" (4.5-5TB) | None
    restriction_detail: Optional[str]
    scraped_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Scrape Job ────────────────────────────────────────────────────────────────
class ScrapeJobOut(BaseModel):
    id: int
    status: str
    workers: int
    total_kits: int
    started_at: Optional[datetime]
    finished_at: Optional[datetime]

    class Config:
        from_attributes = True

class StartScrapeRequest(BaseModel):
    workers: Optional[int] = None   # None = pakai PARALLEL_WORKERS dari env
    parent_account_id: Optional[int] = None  # None = scrape semua akun aktif


# ── Dashboard Stats ───────────────────────────────────────────────────────────
class DashboardStats(BaseModel):
    total_kits: int
    active: int
    restricted: int
    suspended: int
    inactive: int
    total_accounts: int
    limit_quota_count: Optional[int] = 0
    near_full_quota_count: Optional[int] = 0
    quota_alerts: Optional[List[dict]] = []
    last_scraped_at: Optional[datetime] = None
    next_scraped_at: Optional[datetime] = None
    is_scraping: bool = False
    scrape_interval_seconds: int = 3600


# ── Auth ─────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class SessionStatus(BaseModel):
    is_valid: bool
    updated_at: Optional[datetime]


# ── System User Auth & ACL ───────────────────────────────────────────────────
class UserLoginRequest(BaseModel):
    email: str
    password: str

class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    avatar_url: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UserTokenResponse(BaseModel):
    accessToken: str
    token_type: str = "bearer"
    user: UserOut

class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: Optional[str] = "viewer"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None



# ── KIT Grouping & Quota Monitoring ──────────────────────────────────────────
class GroupBase(BaseModel):
    name: str
    description: Optional[str] = None
    quota_limit_per_kit_gb: Optional[float] = 100.0  # Batas per KIT (default 100 GB)
    quota_limit_gb: Optional[float] = 0.0          # Optional custom total limit
    color: Optional[str] = "#3b82f6"

class GroupCreate(GroupBase):
    initial_kit_ids: Optional[List[int]] = []

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    quota_limit_per_kit_gb: Optional[float] = None
    quota_limit_gb: Optional[float] = None
    color: Optional[str] = None

class GroupMemberOut(BaseModel):
    kit_id: int
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    site: Optional[str] = None
    kit: Optional[str] = None
    sn: Optional[str] = None
    status: str
    quota: Optional[str] = None
    quota_gb: float = 0.0
    limit_gb: float = 100.0
    usage_percentage: float = 0.0
    excess_gb: float = 0.0
    alert_level: str = "normal"  # normal | near_limit | over_quota
    is_mini: bool = False
    added_at: Optional[datetime] = None

class GroupOut(GroupBase):
    id: int
    member_count: int = 0
    quota_limit_per_kit_gb: float = 100.0
    total_allocation_gb: float = 0.0
    total_allocation_formatted: str = "0.00 GB"
    total_quota_gb: float = 0.0
    total_quota_formatted: str = "0.00 GB"
    overall_usage_percentage: float = 0.0
    kits_over_limit: int = 0
    kits_near_limit: int = 0
    kits_safe: int = 0
    alert_level: str = "normal"  # normal | near_limit | over_quota
    active_kits: int = 0
    inactive_kits: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class GroupDetailOut(GroupOut):
    members: List[GroupMemberOut] = []

class AddMembersRequest(BaseModel):
    kit_ids: List[int]

