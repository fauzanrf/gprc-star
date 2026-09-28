"""Starlink login via WebSocket (OTP relay)."""
import json
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from database import get_db
from models import StarlinkSession
from schemas import SessionStatus
from services.login_service import LoginService

router = APIRouter(prefix="/api/auth", tags=["auth"])
_login_service = LoginService()


@router.get("/status", response_model=SessionStatus)
def session_status(db: Session = Depends(get_db)):
    sess = db.query(StarlinkSession).filter(StarlinkSession.id == 1).first()
    if not sess:
        return SessionStatus(is_valid=False, updated_at=None)
    return SessionStatus(is_valid=bool(sess.is_valid), updated_at=sess.updated_at)


@router.post("/logout")
def logout(db: Session = Depends(get_db)):
    db.query(StarlinkSession).filter(StarlinkSession.id == 1).update({"is_valid": 0})
    db.commit()
    return {"message": "Sesi dihapus."}


@router.websocket("/ws")
async def login_ws(websocket: WebSocket):
    """
    WebSocket untuk alur login Starlink + OTP.

    Flow:
      Client  → {action: "start_login", email: "...", password: "..."}
      Server  → {event: "status", message: "Membuka browser..."}
      Server  → {event: "otp_required"}         (jika Starlink minta OTP)
      Client  → {action: "submit_otp", otp: "123456"}
      Server  → {event: "login_success"} atau {event: "login_failed", message: "..."}
    """
    await websocket.accept()
    try:
        data = await websocket.receive_json()
        if data.get("action") != "start_login":
            await websocket.send_json({"event": "error", "message": "Action tidak valid."})
            return

        email             = data.get("email", "").strip()
        password          = data.get("password", "").strip()
        raw_pid           = data.get("parent_account_id")
        parent_account_id = int(raw_pid) if raw_pid is not None else None
        if not email or not password:
            await websocket.send_json({"event": "error", "message": "Email/password kosong."})
            return

        await _login_service.login(websocket, email, password, parent_account_id=parent_account_id)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"event": "error", "message": str(e)})
        except Exception:
            pass
