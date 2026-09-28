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
    return wib.strftime("%-d %b %Y, %H:%M WIB")


def _get_setting_from_db(key: str, default: str = "") -> str:
    try:
        import pymysql
        conn = pymysql.connect(
            host=os.getenv("DB_HOST", "mysql"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "starlink"),
            password=os.getenv("DB_PASSWORD", "starlink_pass"),
            database=os.getenv("DB_NAME", "starlink_db"),
            charset="utf8mb4",
            connect_timeout=3,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT `value` FROM system_settings WHERE `key` = %s", (key,))
            row = cur.fetchone()
            if row and row[0] is not None:
                return row[0]
        conn.close()
    except Exception:
        pass
    return default


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
