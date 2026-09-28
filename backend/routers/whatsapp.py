"""
whatsapp.py — Router untuk mengelola koneksi dan notifikasi WhatsApp Gateway
"""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import SystemSetting

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

WA_GATEWAY_URL = os.getenv("WA_GATEWAY_URL", "http://wa-gateway:3001")
WA_API_SECRET  = os.getenv("WA_API_SECRET", "Strl1nkWA-s3cr3t-2026!")


def _now_wib() -> str:
    wib = datetime.now(timezone.utc) + timedelta(hours=7)
    return wib.strftime("%d %b %Y, %H:%M:%S WIB")


def _get_setting(db: Session, key: str, default: str = "") -> str:
    item = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return item.value if item and item.value is not None else default


def _set_setting(db: Session, key: str, value: str):
    item = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if item:
        item.value = value
    else:
        item = SystemSetting(key=key, value=value)
        db.add(item)
    db.commit()


class WAConfigPayload(BaseModel):
    wa_enabled: bool = True
    wa_target: str = ""
    wa_target_type: str = "personal"  # "personal" | "group"
    wa_target_phone: Optional[str] = ""


class WATestPayload(BaseModel):
    to: Optional[str] = None
    message: Optional[str] = None


@router.get("/status")
def get_wa_status(db: Session = Depends(get_db)):
    """Cek status kesehatan WA Gateway dan konfigurasi saat ini."""
    gateway_data = {"status": "disconnected", "connected": False, "hasQR": False, "qr": None}
    try:
        r = requests.get(f"{WA_GATEWAY_URL}/health", timeout=4)
        if r.status_code == 200:
            gateway_data = r.json()
    except Exception as e:
        gateway_data["error"] = str(e)

    # Ambil config dari DB
    wa_target      = _get_setting(db, "wa_target", os.getenv("WA_TARGET", ""))
    wa_target_type = _get_setting(db, "wa_target_type", "personal")
    wa_target_phone= _get_setting(db, "wa_target_phone", "")
    wa_enabled_str = _get_setting(db, "wa_enabled", os.getenv("WA_ENABLED", "true"))
    wa_enabled     = wa_enabled_str.lower() in ("true", "1", "yes")

    return {
        **gateway_data,
        "config": {
            "wa_enabled": wa_enabled,
            "wa_target": wa_target,
            "wa_target_type": wa_target_type,
            "wa_target_phone": wa_target_phone,
        }
    }


@router.get("/groups")
def get_wa_groups():
    """Ambil daftar grup WA yang diikuti oleh bot."""
    try:
        r = requests.get(
            f"{WA_GATEWAY_URL}/groups",
            headers={"X-API-Key": WA_API_SECRET},
            timeout=8
        )
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=r.text)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Gagal menghubungi WA Gateway: {e}")


@router.get("/config")
def get_wa_config(db: Session = Depends(get_db)):
    """Ambil konfigurasi target dan status notifikasi WA."""
    wa_target      = _get_setting(db, "wa_target", os.getenv("WA_TARGET", ""))
    wa_target_type = _get_setting(db, "wa_target_type", "personal")
    wa_target_phone= _get_setting(db, "wa_target_phone", "")
    wa_enabled_str = _get_setting(db, "wa_enabled", os.getenv("WA_ENABLED", "true"))
    wa_enabled     = wa_enabled_str.lower() in ("true", "1", "yes")

    return {
        "wa_enabled": wa_enabled,
        "wa_target": wa_target,
        "wa_target_type": wa_target_type,
        "wa_target_phone": wa_target_phone,
    }


@router.post("/config")
def save_wa_config(payload: WAConfigPayload, db: Session = Depends(get_db)):
    """Simpan konfigurasi notifikasi WhatsApp ke database."""
    target = (payload.wa_target or "").strip()
    phone = (payload.wa_target_phone or "").strip()

    # Normalisasi nomor jika type personal
    if payload.wa_target_type == "personal" and phone:
        clean = phone.replace("+", "").replace("-", "").replace(" ", "").replace("@s.whatsapp.net", "")
        if clean.startswith("08"):
            clean = "628" + clean[2:]
        elif clean.startswith("8"):
            clean = "628" + clean[1:]
        target = f"{clean}@s.whatsapp.net"

    _set_setting(db, "wa_enabled", "true" if payload.wa_enabled else "false")
    _set_setting(db, "wa_target", target)
    _set_setting(db, "wa_target_type", payload.wa_target_type)
    _set_setting(db, "wa_target_phone", phone)

    return {
        "ok": True,
        "message": "Konfigurasi WhatsApp berhasil disimpan.",
        "config": {
            "wa_enabled": payload.wa_enabled,
            "wa_target": target,
            "wa_target_type": payload.wa_target_type,
            "wa_target_phone": phone,
        }
    }


@router.post("/test")
def send_test_message(payload: WATestPayload, db: Session = Depends(get_db)):
    """Kirim pesan uji coba ke target WhatsApp yang dikonfigurasi."""
    target = (payload.to or "").strip()
    if not target:
        target = _get_setting(db, "wa_target", os.getenv("WA_TARGET", ""))

    if not target:
        raise HTTPException(
            status_code=400,
            detail="Nomor target WA belum ditentukan. Silakan masukkan nomor HP terlebih dahulu."
        )

    # Format pesan default jika tidak ditentukan
    text = payload.message
    if not text:
        text = (
            f"🛰️ *Starlink GPRC — Uji Coba Notifikasi*\n"
            f"📅 {_now_wib()}\n\n"
            f"Halo! Pengaturan notifikasi WhatsApp Starlink GPRC telah terhubung dengan sukses.\n"
            f"Nomor ini akan menerima notifikasi otomatis saat terjadi perubahan status perangkat Starlink:\n\n"
            f"🔴 *SUSPENDED* : Kendala pembayaran / sub akun belum bayar\n"
            f"⚠️ *DIBATASI*  : Fair Use Policy / ToS terdeteksi\n"
            f"✅ *PULIH*     : Terminal kembali aktif normal\n\n"
            f"_Pesan ini dikirimkan melalui sistem Starlink GPRC Dashboard._"
        )

    try:
        r = requests.post(
            f"{WA_GATEWAY_URL}/send",
            json={"to": target, "message": text},
            headers={"X-API-Key": WA_API_SECRET},
            timeout=15,
        )
        if r.status_code == 200:
            return {
                "ok": True,
                "message": f"Pesan uji coba berhasil terkirim ke {target}!",
                "target": target,
                "timestamp": datetime.now().isoformat()
            }
        else:
            err_msg = r.text
            try:
                err_msg = r.json().get("error", r.text)
            except Exception:
                pass
            raise HTTPException(status_code=r.status_code, detail=f"Gagal mengirim pesan: {err_msg}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Gagal menghubungi WA Gateway: {e}")


@router.post("/disconnect")
def disconnect_wa():
    """Logout / putuskan sesi WA di gateway agar dapat scan QR ulang."""
    try:
        r = requests.post(
            f"{WA_GATEWAY_URL}/logout",
            headers={"X-API-Key": WA_API_SECRET},
            timeout=10
        )
        if r.status_code == 200:
            return {"ok": True, "message": "Sesi WhatsApp berhasil diputuskan."}
        raise HTTPException(status_code=r.status_code, detail=r.text)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Gagal memutuskan koneksi: {e}")
