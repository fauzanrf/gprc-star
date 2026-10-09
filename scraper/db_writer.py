"""
db_writer.py
============
Utility untuk menyimpan hasil scraping ke database MySQL.
Dipanggil oleh scrape_starlink.py setelah scraping selesai.
"""
import os
from datetime import datetime
from pathlib import Path

import pymysql
import pymysql.cursors


def _get_conn():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "mysql"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "starlink"),
        password=os.getenv("DB_PASSWORD", "starlink_pass"),
        database=os.getenv("DB_NAME", "starlink_db"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def upsert_account(conn, account_number: str, account_name: str, parent_account_id: int = None, email: str = None) -> int:
    """Insert atau update akun, return account.id."""
    with conn.cursor() as cur:
        if parent_account_id:
            cur.execute(
                """INSERT INTO accounts (account_number, account_name, parent_account_id, email)
                   VALUES (%s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE 
                     account_name = VALUES(account_name), 
                     parent_account_id = VALUES(parent_account_id),
                     email = COALESCE(VALUES(email), email),
                     updated_at = NOW()""",
                (account_number, account_name, parent_account_id, email),
            )
        else:
            cur.execute(
                """INSERT INTO accounts (account_number, account_name, email)
                   VALUES (%s, %s, %s)
                   ON DUPLICATE KEY UPDATE 
                     account_name = VALUES(account_name), 
                     email = COALESCE(VALUES(email), email),
                     updated_at = NOW()""",
                (account_number, account_name, email),
            )
        cur.execute("SELECT id FROM accounts WHERE account_number = %s", (account_number,))
        row = cur.fetchone()
        return row["id"]


def upsert_kit(conn, account_id: int, row: dict) -> bool:
    """Insert atau update data KIT berdasarkan kit serial number. Mengabaikan kit dummy ('-')."""
    kit_sn = (row.get("kit") or "").strip()
    if not kit_sn or kit_sn in ("-", "None", "null"):
        return False

    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO kits
               (account_id, site, sn, kit, status, quota, restriction_detail, scraped_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE
                 account_id        = IF(VALUES(status) = 'active' OR status != 'active', VALUES(account_id), account_id),
                 site              = IF(VALUES(site) != '-' AND VALUES(site) != '', VALUES(site), site),
                 sn                = IF(VALUES(sn) != '-' AND VALUES(sn) != '', VALUES(sn), sn),
                 status            = IF(status = 'active' AND VALUES(status) = 'inactive' AND quota NOT IN ('-', '0.00 GB', '0 GB', '0 MB', '0.0 GB', '0'), status, VALUES(status)),
                 quota             = IF(VALUES(quota) NOT IN ('-', '', '0.00 GB', '0 GB', '0 MB', '0.0 GB', '0') OR quota IN ('-', '', '0.00 GB', '0 GB', '0 MB', '0.0 GB', '0'), VALUES(quota), quota),
                 restriction_detail= IF(VALUES(restriction_detail) != '' OR restriction_detail IS NULL, VALUES(restriction_detail), restriction_detail),
                 scraped_at        = VALUES(scraped_at)""",
            (
                account_id,
                row.get("site") or "-",
                row.get("sn") or "-",
                kit_sn,
                row.get("status", "active"),          # 'active' | 'restricted' | 'suspended' | 'inactive'
                row.get("quota") or "-",
                row.get("restriction_detail") or "",
                row.get("scraped_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
    return True


def save_rows_to_db(rows: list[dict], parent_account_id: int = None):
    """
    Simpan list hasil scraping ke MySQL.
    rows = list of dict dari dataclass KitRow (via asdict()).
    """
    if not rows:
        print("[DB] Tidak ada baris untuk disimpan.", flush=True)
        return

    if not parent_account_id:
        try:
            parent_account_id = int(os.getenv("PARENT_ACCOUNT_ID", "0")) or None
        except Exception:
            parent_account_id = None

    conn = _get_conn()
    saved_kits = 0
    try:
        conn.begin()
        for row in rows:
            acc_email = row.get("email")
            if acc_email in ("-", "None", "null", ""):
                acc_email = None
            acc_id = upsert_account(conn, row["code"], row["controller"], parent_account_id, email=acc_email)
            if upsert_kit(conn, acc_id, row):
                saved_kits += 1
        conn.commit()
        print(f"[DB] {len(rows)} baris diproses ({saved_kits} KIT valid disimpan) ke MySQL (parent_account_id={parent_account_id}).", flush=True)
    except Exception as e:
        conn.rollback()
        print(f"[DB] Error saat menyimpan ke MySQL: {e}", flush=True)
        raise
    finally:
        conn.close()


def update_scrape_job(job_id: int, status: str, total_kits: int = 0, log: str = ""):
    """Update status scrape_jobs di database."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            if status == "done":
                cur.execute(
                    "UPDATE scrape_jobs SET status=%s, total_kits=%s, finished_at=NOW(), log=%s WHERE id=%s",
                    (status, total_kits, log, job_id),
                )
            else:
                cur.execute(
                    "UPDATE scrape_jobs SET status=%s, log=%s WHERE id=%s",
                    (status, log, job_id),
                )
        conn.commit()
    finally:
        conn.close()
