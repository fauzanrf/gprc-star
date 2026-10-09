"""SQLAlchemy ORM models."""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Enum, ForeignKey,
    SmallInteger, Float, func,
)
from sqlalchemy.orm import relationship
from database import Base


class ParentAccount(Base):
    __tablename__ = "parent_accounts"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    account_name    = Column(String(255), nullable=False)
    email           = Column(String(255), unique=True, nullable=False, index=True)
    password        = Column(String(255), nullable=True)
    auth_state      = Column(Text, nullable=True)
    is_active       = Column(SmallInteger, default=1)
    is_valid        = Column(SmallInteger, default=0)
    last_scraped_at = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=func.now())
    updated_at      = Column(DateTime, default=func.now(), onupdate=func.now())

    accounts = relationship("Account", back_populates="parent_account")


class Account(Base):
    __tablename__ = "accounts"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    parent_account_id = Column(Integer, ForeignKey("parent_accounts.id", ondelete="SET NULL"), nullable=True)
    account_number    = Column(String(50), unique=True, nullable=False, index=True)
    account_name      = Column(String(255), nullable=False)
    email             = Column(String(255), nullable=True)
    created_at        = Column(DateTime, default=func.now())
    updated_at        = Column(DateTime, default=func.now(), onupdate=func.now())

    parent_account = relationship("ParentAccount", back_populates="accounts")
    kits           = relationship("Kit", back_populates="account", cascade="all, delete-orphan")


class Kit(Base):
    __tablename__ = "kits"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    account_id         = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    site               = Column(String(255))
    sn                 = Column(String(100))  # Dish Serial Number
    kit                = Column(String(100), unique=True, index=True)  # Kit Serial Number
    status             = Column(
        Enum("active", "restricted", "suspended", "inactive"),
        nullable=False,
        default="active",
    )
    quota              = Column(String(50))
    restriction_detail = Column(Text)
    scraped_at         = Column(DateTime)

    account = relationship("Account", back_populates="kits")
    group_memberships = relationship("KitGroupMember", back_populates="kit", cascade="all, delete-orphan")


class ScrapeJob(Base):
    __tablename__ = "scrape_jobs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    status      = Column(
        Enum("pending", "running", "done", "failed"),
        nullable=False,
        default="pending",
    )
    workers     = Column(SmallInteger, default=4)
    total_kits  = Column(Integer, default=0)
    started_at  = Column(DateTime, default=func.now())
    finished_at = Column(DateTime)
    log         = Column(Text)


class StarlinkSession(Base):
    __tablename__ = "starlink_sessions"

    id         = Column(Integer, primary_key=True, default=1)
    auth_state = Column(Text)          # JSON content of auth_state.json
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    is_valid   = Column(SmallInteger, default=0)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key        = Column(String(100), primary_key=True)
    value      = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class KitGroup(Base):
    __tablename__ = "kit_groups"

    id                     = Column(Integer, primary_key=True, autoincrement=True)
    name                   = Column(String(255), nullable=False)
    description            = Column(Text, nullable=True)
    quota_limit_per_kit_gb = Column(Float, nullable=True, default=100.0)
    quota_limit_gb         = Column(Float, nullable=True, default=0.0)
    color                  = Column(String(50), default="#3b82f6")
    created_at             = Column(DateTime, default=func.now())
    updated_at             = Column(DateTime, default=func.now(), onupdate=func.now())

    members        = relationship("KitGroupMember", back_populates="group", cascade="all, delete-orphan")


class KitGroupMember(Base):
    __tablename__ = "kit_group_members"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    group_id   = Column(Integer, ForeignKey("kit_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    kit_id     = Column(Integer, ForeignKey("kits.id", ondelete="CASCADE"), nullable=False, index=True)
    added_at   = Column(DateTime, default=func.now())

    group      = relationship("KitGroup", back_populates="members")
    kit        = relationship("Kit", back_populates="group_memberships")


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    name          = Column(String(100), nullable=False)
    email         = Column(String(150), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role          = Column(
        Enum("super_admin", "noc2", "noc1", "technical_support", "magang", "provisioning", name="user_role"),
        default="noc1",
        nullable=False,
    )
    avatar_url    = Column(String(255), nullable=True)
    created_at    = Column(DateTime, default=func.now())
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())


