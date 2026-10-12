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
from models import SystemSetting, Account, Kit
from sqlalchemy.orm import joinedload
import re

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

WA_GATEWAY_URL = os.getenv("WA_GATEWAY_URL", "http://wa-gateway:3001")
WA_API_SECRET  = os.getenv("WA_API_SECRET", "Strl1nkWA-s3cr3t-2026!")

ID_MONTHS = [
    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


def _now_wib_dt() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=7)


def _now_wib() -> str:
    wib = _now_wib_dt()
    return f"{wib.day} {wib.strftime('%b %Y, %H:%M:%S WIB')}"


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
    wa_reminder_auto: bool = True
    wa_reminder_time: str = "08:00"


class WATestPayload(BaseModel):
    to: Optional[str] = None
    message: Optional[str] = None
    day: Optional[int] = None


class WAReminderSendPayload(BaseModel):
    day: Optional[int] = None
    date: Optional[str] = None
    to: Optional[str] = None
    custom_message: Optional[str] = None


def get_suspend_accounts_data(db: Session, target_day: int, target_date_str: Optional[str] = None) -> list[dict]:
    """
    Ambil akun dan data terminal Starlink yang memiliki suspend_date cocok dengan target_day.
    """
    accounts = (
        db.query(Account)
        .options(joinedload(Account.kits))
        .filter(Account.suspend_date.isnot(None), Account.suspend_date != "")
        .order_by(Account.account_name.asc())
        .all()
    )

    result = []
    for acc in accounts:
        raw_sdate = str(acc.suspend_date).strip()
        matches = False

        # Cek angka hari (1-31)
        digits = re.findall(r"\d+", raw_sdate)
        if digits:
            for d in digits:
                if int(d) == target_day:
                    matches = True
                    break

        if not matches and target_date_str and raw_sdate == target_date_str.strip():
            matches = True

        if not matches:
            continue

        kits_list = []
        for k in acc.kits:
            kits_list.append({
                "id": k.id,
                "site": k.site or "-",
                "kit": k.kit or "-",
                "sn": k.sn or "-",
                "status": k.status or "active",
                "quota": k.quota or "-",
            })

        result.append({
            "id": acc.id,
            "account_number": acc.account_number,
            "account_name": acc.account_name,
            "suspend_date": raw_sdate,
            "kits": kits_list,
        })

    return result


def build_suspend_reminder_text(
    accounts: list[dict],
    target_day: int,
    wib_now: datetime,
    is_test: bool = False,
) -> str:
    """
    Format teks notifikasi WhatsApp untuk reminder Starlink yang akan di-suspend.
    """
    month_name = ID_MONTHS[wib_now.month] if 1 <= wib_now.month <= 12 else ""
    date_display = f"{target_day} {month_name} {wib_now.year}"
    time_display = f"{wib_now.day} {wib_now.strftime('%b %Y, %H:%M WIB')}"

    total_acc = len(accounts)
    total_kits = sum(len(a.get("kits", [])) for a in accounts)

    title_prefix = "🛰️ *[UJI COBA] " if is_test else "🛰️ *"
    header = [
        f"{title_prefix}PENGINGAT JATUH TEMPO SUSPEND STARLINK*",
        f"📅 *Jatuh Tempo : Tanggal {target_day} ({date_display})*",
        f"⏰ *Waktu Kirim : {time_display}*",
        "────────────────────────",
    ]

    if not accounts:
        header.extend([
            f"✅ *Tidak ada akun Starlink yang jatuh tempo suspend pada tanggal {target_day}.*",
            "",
            "Semua akun dalam status aman untuk tanggal ini.",
            "────────────────────────",
            "_Pesan otomatis dari Starlink GPRC System_",
        ])
        return "\n".join(header)

    header.append(f"Berikut daftar *{total_acc} akun* Starlink yang dijadwalkan *suspend pada tanggal {target_day}*:\n")

    lines = list(header)
    status_icons = {
        "active": "🟢",
        "suspended": "🔴",
        "restricted": "⚠️",
        "inactive": "⬛",
    }
    status_labels = {
        "active": "Aktif",
        "suspended": "Suspended",
        "restricted": "Dibatasi",
        "inactive": "Offline",
    }

    stat_counts = {"active": 0, "suspended": 0, "restricted": 0, "inactive": 0}

    for idx, acc in enumerate(accounts, start=1):
        acc_name = acc.get("account_name") or "-"
        acc_num = acc.get("account_number") or "-"
        kits = acc.get("kits", [])

        lines.append(f"*{idx}. {acc_name}*")
        lines.append(f"   • No. Akun: `{acc_num}`")

        if not kits:
            lines.append("   • Terminal: (Tidak ada terminal terdaftar)")
        elif len(kits) == 1:
            k = kits[0]
            st = (k.get("status") or "active").lower()
            stat_counts[st] = stat_counts.get(st, 0) + 1
            icon = status_icons.get(st, "⚪")
            label = status_labels.get(st, st)
            site_name = k.get("site") or k.get("kit") or "-"
            kit_code = k.get("kit") or "-"
            lines.append(f"   • Site/KIT : {site_name} (`{kit_code}`)")
            lines.append(f"   • Status   : {icon} {label}")
        else:
            lines.append(f"   • Terminal ({len(kits)} unit):")
            for k in kits:
                st = (k.get("status") or "active").lower()
                stat_counts[st] = stat_counts.get(st, 0) + 1
                icon = status_icons.get(st, "⚪")
                label = status_labels.get(st, st)
                site_name = k.get("site") or k.get("kit") or "-"
                kit_code = k.get("kit") or "-"
                lines.append(f"     - {site_name} (`{kit_code}`) — {icon} {label}")
        lines.append("")

    lines.append("────────────────────────")
    lines.append(f"📊 *Ringkasan Tanggal {target_day}:*")
    lines.append(f"• Total Akun     : {total_acc} Akun")
    lines.append(f"• Total Terminal : {total_kits} Terminal")
    lines.append(
        f"• Rincian Status : 🟢 {stat_counts.get('active', 0)} Aktif | "
        f"🔴 {stat_counts.get('suspended', 0)} Suspended | "
        f"⚠️ {stat_counts.get('restricted', 0)} Dibatasi"
    )
    lines.append("")
    lines.append("⚠️ *Perhatian:*")
    lines.append("Mohon segera lakukan pengecekan tagihan / pembayaran perpanjangan sebelum layanan dinonaktifkan/suspend oleh Starlink.")
    lines.append("")
    lines.append("_Pesan otomatis dari Starlink GPRC System_")

    return "\n".join(lines)


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
    wa_target        = _get_setting(db, "wa_target", os.getenv("WA_TARGET", ""))
    wa_target_type   = _get_setting(db, "wa_target_type", "personal")
    wa_target_phone  = _get_setting(db, "wa_target_phone", "")
    wa_enabled_str   = _get_setting(db, "wa_enabled", os.getenv("WA_ENABLED", "true"))
    wa_enabled       = wa_enabled_str.lower() in ("true", "1", "yes")
    wa_reminder_auto = _get_setting(db, "wa_reminder_auto", "true").lower() in ("true", "1", "yes")
    wa_reminder_time = _get_setting(db, "wa_reminder_time", "08:00")

    return {
        **gateway_data,
        "config": {
            "wa_enabled": wa_enabled,
            "wa_target": wa_target,
            "wa_target_type": wa_target_type,
            "wa_target_phone": wa_target_phone,
            "wa_reminder_auto": wa_reminder_auto,
            "wa_reminder_time": wa_reminder_time,
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
    wa_target        = _get_setting(db, "wa_target", os.getenv("WA_TARGET", ""))
    wa_target_type   = _get_setting(db, "wa_target_type", "personal")
    wa_target_phone  = _get_setting(db, "wa_target_phone", "")
    wa_enabled_str   = _get_setting(db, "wa_enabled", os.getenv("WA_ENABLED", "true"))
    wa_enabled       = wa_enabled_str.lower() in ("true", "1", "yes")
    wa_reminder_auto = _get_setting(db, "wa_reminder_auto", "true").lower() in ("true", "1", "yes")
    wa_reminder_time = _get_setting(db, "wa_reminder_time", "08:00")

    return {
        "wa_enabled": wa_enabled,
        "wa_target": wa_target,
        "wa_target_type": wa_target_type,
        "wa_target_phone": wa_target_phone,
        "wa_reminder_auto": wa_reminder_auto,
        "wa_reminder_time": wa_reminder_time,
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
    _set_setting(db, "wa_reminder_auto", "true" if payload.wa_reminder_auto else "false")
    _set_setting(db, "wa_reminder_time", payload.wa_reminder_time or "08:00")

    return {
        "ok": True,
        "message": "Konfigurasi WhatsApp berhasil disimpan.",
        "config": {
            "wa_enabled": payload.wa_enabled,
            "wa_target": target,
            "wa_target_type": payload.wa_target_type,
            "wa_target_phone": phone,
            "wa_reminder_auto": payload.wa_reminder_auto,
            "wa_reminder_time": payload.wa_reminder_time or "08:00",
        }
    }


@router.get("/reminder/preview")
def get_suspend_reminder_preview(
    day: Optional[int] = None,
    date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Preview daftar akun dan format pesan WhatsApp untuk reminder suspend Starlink pada tanggal tertentu.
    """
    wib_now = _now_wib_dt()
    target_day = int(day) if day is not None else wib_now.day
    target_day = max(1, min(31, target_day))

    accounts = get_suspend_accounts_data(db, target_day, target_date_str=date)
    msg = build_suspend_reminder_text(accounts, target_day, wib_now)

    total_kits = sum(len(a.get("kits", [])) for a in accounts)
    month_name = ID_MONTHS[wib_now.month] if 1 <= wib_now.month <= 12 else ""
    date_display = f"{target_day} {month_name} {wib_now.year}"

    return {
        "target_day": target_day,
        "target_date_display": date_display,
        "time_display": f"{wib_now.day} {wib_now.strftime('%b %Y, %H:%M WIB')}",
        "total_accounts": len(accounts),
        "total_kits": total_kits,
        "accounts": accounts,
        "message": msg,
    }


@router.post("/reminder/send")
def send_suspend_reminder(payload: WAReminderSendPayload, db: Session = Depends(get_db)):
    """
    Kirim reminder daftar akun Starlink yang akan di-suspend via WhatsApp.
    """
    wib_now = _now_wib_dt()
    target_day = int(payload.day) if payload.day is not None else wib_now.day
    target_day = max(1, min(31, target_day))

    target = (payload.to or "").strip()
    if not target:
        target = _get_setting(db, "wa_target", os.getenv("WA_TARGET", ""))

    if not target:
        raise HTTPException(
            status_code=400,
            detail="Tujuan WhatsApp (nomor / grup) belum diatur. Silakan atur nomor atau pilih grup tujuan terlebih dahulu."
        )

    # Jika custom message diberikan oleh user, pakai itu; jika tidak, bangun secara otomatis
    if payload.custom_message and payload.custom_message.strip():
        text = payload.custom_message.strip()
        accounts = get_suspend_accounts_data(db, target_day, target_date_str=payload.date)
    else:
        accounts = get_suspend_accounts_data(db, target_day, target_date_str=payload.date)
        text = build_suspend_reminder_text(accounts, target_day, wib_now)

    total_kits = sum(len(a.get("kits", [])) for a in accounts)

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
                "message": f"Reminder suspend Tanggal {target_day} berhasil terkirim ke {target}!",
                "target": target,
                "target_day": target_day,
                "total_accounts": len(accounts),
                "total_kits": total_kits,
                "sent_message": text,
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

    # Format pesan default: kirimkan format reminder suspend aktual
    text = payload.message
    if not text:
        wib_now = _now_wib_dt()
        target_day = int(payload.day) if payload.day is not None else wib_now.day
        accounts = get_suspend_accounts_data(db, target_day)
        text = build_suspend_reminder_text(accounts, target_day, wib_now, is_test=True)

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
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=r.text)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Gagal menghubungi WA Gateway: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memutuskan koneksi: {e}")


@router.post("/reload")
def reload_wa():
    """Paksa reset sesi dan reload QR code baru."""
    try:
        r = requests.post(
            f"{WA_GATEWAY_URL}/reload",
            headers={"X-API-Key": WA_API_SECRET},
            timeout=10
        )
        if r.status_code == 200:
            return r.json()
        raise HTTPException(status_code=r.status_code, detail=r.text)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Gagal menghubungi WA Gateway: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal me-reload gateway: {e}")

