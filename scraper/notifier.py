"""
notifier.py
===========
Modul pengiriman notifikasi WhatsApp via WA Gateway (Baileys).

Penggunaan:
    from notifier import WANotifier
    notifier = WANotifier()
    notifier.send_alert(suspended_kits, restricted_kits, stats)
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

import requests

# ── Config ────────────────────────────────────────────────────────────────────
_WA_GATEWAY_URL = os.getenv("WA_GATEWAY_URL", "http://wa-gateway:3001")
_WA_API_KEY     = os.getenv("WA_API_SECRET", "changeme-wa-secret")
_WA_TARGET      = os.getenv("WA_TARGET", "")   # JID grup atau nomor: 628xxx@s.whatsapp.net | 120363xxx@g.us
_WA_ENABLED     = os.getenv("WA_ENABLED", "true").lower() in ("true", "1", "yes")


def _now_wib() -> str:
    """Return waktu sekarang dalam format 'DD Mon YYYY, HH:MM WIB'."""
    # WIB = UTC+7
    from datetime import timedelta
    wib = datetime.now(timezone.utc) + timedelta(hours=7)
    return f"{wib.day} {wib.strftime('%b %Y, %H:%M WIB')}"


ID_MONTHS = [
    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
]


def _get_db_connection():
    import pymysql
    return pymysql.connect(
        host=os.getenv("DB_HOST", "mysql"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "starlink"),
        password=os.getenv("DB_PASSWORD", "Strl1nkDB2026!"),
        database=os.getenv("DB_NAME", "starlink_db"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=5,
    )


def _get_setting_from_db(key: str, default: str = "") -> str:
    try:
        conn = _get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT `value` FROM system_settings WHERE `key` = %s", (key,))
            row = cur.fetchone()
            if row and row.get("value") is not None:
                return row["value"]
        conn.close()
    except Exception:
        pass
    return default


def get_suspend_accounts_from_db(day: int | None = None) -> list[dict]:
    """
    Ambil akun dan terminal Starlink yang memiliki suspend_date sesuai dengan hari tertentu (1-31).
    """
    import re
    from datetime import timedelta
    if day is None:
        wib = datetime.now(timezone.utc) + timedelta(hours=7)
        target_day = wib.day
    else:
        target_day = int(day)

    try:
        conn = _get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    a.id as account_id,
                    a.account_number,
                    a.account_name,
                    a.suspend_date,
                    k.id as kit_id,
                    k.site,
                    k.kit as kit_sn,
                    k.sn as dish_sn,
                    k.status as kit_status,
                    k.quota
                FROM accounts a
                LEFT JOIN kits k ON k.account_id = a.id
                WHERE a.suspend_date IS NOT NULL AND a.suspend_date != ''
                ORDER BY a.account_name ASC, k.site ASC
            """)
            rows = cur.fetchall()
        conn.close()

        accounts_map = {}
        for r in rows:
            raw_sdate = str(r["suspend_date"]).strip()
            # Cek kecocokan tanggal suspend
            matches = False
            digits = re.findall(r"\d+", raw_sdate)
            if digits:
                for d in digits:
                    if int(d) == target_day:
                        matches = True
                        break
            if not matches:
                continue

            acc_id = r["account_id"]
            if acc_id not in accounts_map:
                accounts_map[acc_id] = {
                    "id": acc_id,
                    "account_number": r["account_number"],
                    "account_name": r["account_name"],
                    "suspend_date": raw_sdate,
                    "kits": []
                }
            if r["kit_id"]:
                accounts_map[acc_id]["kits"].append({
                    "id": r["kit_id"],
                    "site": r["site"] or "-",
                    "kit": r["kit_sn"] or "-",
                    "sn": r["dish_sn"] or "-",
                    "status": r["kit_status"] or "active",
                    "quota": r["quota"] or "-"
                })

        return list(accounts_map.values())
    except Exception as e:
        print(f"[Notifier] Error query suspend accounts: {e}", flush=True)
        return []


def build_suspend_reminder_message(accounts: list[dict], target_day: int) -> str:
    """
    Bangun format pesan reminder WhatsApp untuk akun yang akan di-suspend pada tanggal tertentu.
    """
    from datetime import timedelta
    wib = datetime.now(timezone.utc) + timedelta(hours=7)
    month_name = ID_MONTHS[wib.month] if 1 <= wib.month <= 12 else ""
    date_display = f"{target_day} {month_name} {wib.year}"
    time_display = f"{wib.day} {wib.strftime('%b %Y, %H:%M WIB')}"

    total_acc = len(accounts)
    total_kits = sum(len(a.get("kits", [])) for a in accounts)

    header = [
        "🛰️ *PENGINGAT JATUH TEMPO SUSPEND STARLINK*",
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


class WANotifier:
    """Kirim notifikasi WhatsApp via WA Gateway REST API."""

    def __init__(
        self,
        gateway_url: str = _WA_GATEWAY_URL,
        api_key: str = _WA_API_KEY,
        target_jid: str = _WA_TARGET,
    ):
        self.gateway_url = gateway_url.rstrip("/")
        self.api_key     = api_key
        self.target_jid  = target_jid

    def get_effective_target(self) -> str:
        db_target = _get_setting_from_db("wa_target")
        if db_target:
            return db_target.strip()
        return self.target_jid or os.getenv("WA_TARGET", "")

    def is_enabled(self) -> bool:
        db_val = _get_setting_from_db("wa_enabled")
        if db_val:
            return db_val.lower() in ("true", "1", "yes")
        return os.getenv("WA_ENABLED", "true").lower() in ("true", "1", "yes")

    def is_gateway_ready(self) -> bool:
        """Cek apakah WA gateway sudah terhubung."""
        try:
            r = requests.get(f"{self.gateway_url}/health", timeout=5)
            data = r.json()
            return data.get("connected", False)
        except Exception:
            return False

    def send_message(self, text: str, target: str | None = None) -> bool:
        """
        Kirim pesan teks ke WA group/nomor.
        Return True jika berhasil.
        """
        if not self.is_enabled():
            print("[Notifier] WA_ENABLED=false, skip notifikasi.", flush=True)
            return False

        jid = target or self.get_effective_target()
        if not jid:
            print("[Notifier] WA_TARGET tidak dikonfigurasi. Atur di menu Notifikasi WA atau .env.", flush=True)
            return False

        try:
            r = requests.post(
                f"{self.gateway_url}/send",
                json={"to": jid, "message": text},
                headers={"X-API-Key": self.api_key},
                timeout=15,
            )
            if r.status_code == 200:
                print(f"[Notifier] WA terkirim ke {jid}", flush=True)
                return True
            else:
                print(f"[Notifier] Gagal kirim WA ({r.status_code}): {r.text}", flush=True)
                return False
        except Exception as e:
            print(f"[Notifier] Error WA: {e}", flush=True)
            return False

    def build_alert_message(
        self,
        new_suspended: list[dict],
        new_restricted: list[dict],
        recovered: list[dict],
        stats: dict[str, int],
    ) -> str:
        """
        Bangun pesan notifikasi WA dari diff status.

        Args:
            new_suspended  : KIT yang baru suspended (belum ada di run sebelumnya)
            new_restricted : KIT yang baru restricted
            recovered      : KIT yang sebelumnya suspended/restricted, sekarang active
            stats          : dict total (active, restricted, suspended, inactive, total)
        """
        lines = [
            f"🛰️ *Starlink GPRC Alert*",
            f"📅 {_now_wib()}",
            "",
        ]

        if new_suspended:
            lines.append(f"🔴 *SUSPENDED* ({len(new_suspended)} terminal baru):")
            for k in new_suspended:
                lines.append(f"  • {k.get('controller', '-')} — {k.get('site', k.get('kit', '-'))}")
            lines.append("")

        if new_restricted:
            lines.append(f"⚠️ *DIBATASI / ToS* ({len(new_restricted)} terminal baru):")
            for k in new_restricted:
                lines.append(f"  • {k.get('controller', '-')} — {k.get('site', k.get('kit', '-'))}")
            lines.append("")

        if recovered:
            lines.append(f"✅ *PULIH* ({len(recovered)} terminal):")
            for k in recovered:
                lines.append(f"  • {k.get('controller', '-')} — {k.get('site', k.get('kit', '-'))}")
            lines.append("")

        total    = stats.get("total", 0)
        active   = stats.get("active", 0)
        susp     = stats.get("suspended", 0)
        restr    = stats.get("restricted", 0)
        inactive = stats.get("inactive", 0)

        lines.append(f"📊 Total: {total} terminal")
        lines.append(
            f"✅ Aktif: {active}  🔴 Suspended: {susp}  "
            f"⚠️ Dibatasi: {restr}  ⬛ Offline: {inactive}"
        )

        return "\n".join(lines)

    def send_alert(
        self,
        new_suspended: list[dict],
        new_restricted: list[dict],
        recovered: list[dict],
        stats: dict[str, int],
        target: str | None = None,
    ) -> bool:
        """Kirim alert perubahan status ke WA. Return True jika ada yang dikirim."""
        if not (new_suspended or new_restricted or recovered):
            print("[Notifier] Tidak ada perubahan status, tidak ada notifikasi.", flush=True)
            return False

        msg = self.build_alert_message(new_suspended, new_restricted, recovered, stats)
        return self.send_message(msg, target)

    send_status_change = send_alert

    def send_suspend_reminder(
        self,
        target_day: int | None = None,
        target: str | None = None,
    ) -> bool:
        """Kirim reminder akun Starlink yang jatuh tempo suspend pada tanggal tertentu."""
        from datetime import datetime, timezone, timedelta
        if target_day is None:
            wib = datetime.now(timezone.utc) + timedelta(hours=7)
            target_day = wib.day

        accounts = get_suspend_accounts_from_db(target_day)
        msg = build_suspend_reminder_message(accounts, target_day)
        return self.send_message(msg, target)

    def send_scrape_done(self, stats: dict[str, int], target: str | None = None) -> bool:
        """Kirim ringkasan hasil scraping (tanpa diff) — opsional."""
        total    = stats.get("total", 0)
        active   = stats.get("active", 0)
        susp     = stats.get("suspended", 0)
        restr    = stats.get("restricted", 0)
        inactive = stats.get("inactive", 0)
        msg = (
            f"🛰️ *Starlink GPRC — Ringkasan Scraping*\n"
            f"📅 {_now_wib()}\n\n"
            f"📊 Total: {total} terminal\n"
            f"✅ Aktif     : {active}\n"
            f"🔴 Suspended : {susp}\n"
            f"⚠️ Dibatasi  : {restr}\n"
            f"⬛ Offline   : {inactive}"
        )
        return self.send_message(msg, target)
