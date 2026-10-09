"""Authentication utilities: Password hashing, JWT token handling, and dependencies."""
import os
import hmac
import hashlib
import json
import base64
import time
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
from models import User

JWT_SECRET = os.getenv("JWT_SECRET", "strl1nk_nexcare_jwt_secret_2026_pt_internetwork_indonesia!")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_SECONDS = 7 * 24 * 3600  # 7 days

security = HTTPBearer(auto_error=False)

# ── Password Hashing ──────────────────────────────────────────────────────────
try:
    import bcrypt
    def hash_password(plain: str) -> str:
        return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def verify_password(plain: str, hashed: str) -> bool:
        if not hashed:
            return False
        if hashed.startswith("$2b$") or hashed.startswith("$2a$") or hashed.startswith("$2y$"):
            return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
        # Fallback check
        if plain == hashed:
            return True
        return hashlib.sha256(plain.encode("utf-8")).hexdigest() == hashed
except ImportError:
    def hash_password(plain: str) -> str:
        salt = os.urandom(16).hex()
        digest = hashlib.sha256((salt + plain).encode("utf-8")).hexdigest()
        return f"sha256${salt}${digest}"

    def verify_password(plain: str, hashed: str) -> bool:
        if not hashed:
            return False
        if plain == hashed:
            return True
        if hashed.startswith("sha256$"):
            parts = hashed.split("$")
            if len(parts) == 3:
                salt, expected_digest = parts[1], parts[2]
                computed = hashlib.sha256((salt + plain).encode("utf-8")).hexdigest()
                return hmac.compare_digest(computed, expected_digest)
        return hashlib.sha256(plain.encode("utf-8")).hexdigest() == hashed


# ── JWT Handling ─────────────────────────────────────────────────────────────
try:
    import jwt
    def create_access_token(data: dict, expires_delta: int = JWT_EXPIRATION_SECONDS) -> str:
        to_encode = data.copy()
        expire = int(time.time()) + expires_delta
        to_encode.update({"exp": expire, "iat": int(time.time())})
        return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

    def decode_access_token(token: str) -> dict:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
except ImportError:
    def create_access_token(data: dict, expires_delta: int = JWT_EXPIRATION_SECONDS) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        payload = data.copy()
        payload["exp"] = int(time.time()) + expires_delta
        payload["iat"] = int(time.time())

        seg1 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
        seg2 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        signing_input = f"{seg1}.{seg2}".encode()
        sig = hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
        seg3 = base64.urlsafe_b64encode(sig).decode().rstrip("=")
        return f"{seg1}.{seg2}.{seg3}"

    def decode_access_token(token: str) -> dict:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT token format")
        seg1, seg2, seg3 = parts
        signing_input = f"{seg1}.{seg2}".encode()
        expected_sig = hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
        expected_seg3 = base64.urlsafe_b64encode(expected_sig).decode().rstrip("=")
        if not hmac.compare_digest(seg3, expected_seg3):
            raise ValueError("Signature verification failed")
        pad = 4 - len(seg2) % 4
        payload_bytes = base64.urlsafe_b64decode(seg2 + ("=" * (pad if pad < 4 else 0)))
        payload = json.loads(payload_bytes.decode())
        if payload.get("exp", 0) < time.time():
            raise ValueError("Token has expired")
        return payload


# ── Dependency: Get Current User ──────────────────────────────────────────────
def get_current_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not auth or not auth.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autentikasi diperlukan. Silakan login terlebih dahulu.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = auth.credentials
    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token payload tidak valid.")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Sesi login tidak valid atau kadaluarsa: {str(e)}")

    user_id_val = int(user_id) if str(user_id).isdigit() else user_id
    user = db.query(User).filter(User.id == user_id_val).first()
    if not user:
        raise HTTPException(status_code=401, detail="Pengguna tidak ditemukan.")
    return user


def get_optional_current_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    if not auth or not auth.credentials:
        return None
    try:
        payload = decode_access_token(auth.credentials)
        user_id = payload.get("sub")
        if not user_id:
            return None
        user_id_val = int(user_id) if str(user_id).isdigit() else user_id
        return db.query(User).filter(User.id == user_id_val).first()
    except Exception:
        return None


def require_roles(*allowed_roles: str):
    def role_checker(user: User = Depends(get_current_user)):
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Akses ditolak. Peran yang diizinkan: {', '.join(allowed_roles)}"
            )
        return user
    return role_checker
