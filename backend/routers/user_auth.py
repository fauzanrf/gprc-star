"""
user_auth.py — User Authentication & ACL (Access Control List) Router
Provides login, session verification, and user management matching Nexcare RBAC.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import User
from schemas import (
    UserLoginRequest,
    UserOut,
    UserTokenResponse,
    UserCreate,
    UserUpdate,
)
from auth_utils import (
    verify_password,
    hash_password,
    create_access_token,
    get_current_user,
    require_roles,
)

router = APIRouter(prefix="/api/user-auth", tags=["user-auth"])


@router.post("/login", response_model=UserTokenResponse)
def login(payload: UserLoginRequest, db: Session = Depends(get_db)):
    """Authenticates system user and returns JWT token + user details."""
    clean_email = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email atau password tidak sesuai.",
        )

    token_data = {
        "sub": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": user.role,
    }
    access_token = create_access_token(token_data)

    return UserTokenResponse(
        accessToken=access_token,
        token_type="bearer",
        user=UserOut.from_orm(user),
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    """Returns currently authenticated user profile."""
    return UserOut.from_orm(current_user)


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    """Invalidates current user session."""
    return {"message": "Berhasil logout."}


@router.get("/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "super_admin", "viewer")),
):
    """Lists all registered users. Restricted to Admin and Viewer."""
    users = db.query(User).order_by(User.id.asc()).all()
    return [UserOut.from_orm(u) for u in users]


@router.post("/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "super_admin")),
):
    """Creates a new user account. Restricted to Admin."""
    clean_email = payload.email.strip().lower()
    exists = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email sudah terdaftar.")

    allowed_roles = ["admin", "viewer"]
    role = payload.role if payload.role in allowed_roles else "viewer"

    new_user = User(
        name=payload.name.strip(),
        email=clean_email,
        password_hash=hash_password(payload.password),
        role=role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return UserOut.from_orm(new_user)


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "super_admin")),
):
    """Updates user information and role. Restricted to Admin."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan.")

    if payload.name is not None and payload.name.strip():
        user.name = payload.name.strip()
    if payload.email is not None and payload.email.strip():
        clean_email = payload.email.strip().lower()
        conflict = db.query(User).filter(func.lower(User.email) == clean_email, User.id != user_id).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Email sudah digunakan akun lain.")
        user.email = clean_email
    if payload.password is not None and payload.password.strip():
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        allowed_roles = ["admin", "viewer"]
        if payload.role in allowed_roles:
            user.role = payload.role

    user.updated_at = func.now()
    db.commit()
    db.refresh(user)
    return UserOut.from_orm(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "super_admin")),
):
    """Deletes a user. Cannot delete own account."""
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun Anda sendiri.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan.")

    db.delete(user)
    db.commit()
    return {"message": "User berhasil dihapus."}
