"""
scheduler.py
============
Scheduler otomatis untuk scraping Starlink di VPS dengan dukungan Multi-Akun Induk,
state countdown timer untuk frontend, dan integrasi riwayat ke tabel scrape_jobs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pymysql
import requests

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SCHEDULER] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("scheduler")


def _load_env():
    env_file = Path(".env")
    if not env_file.exists():
        env_file = Path("../.env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

# ── Config ────────────────────────────────────────────────────────────────────
INTERVAL_HOURS    = float(os.getenv("SCRAPE_INTERVAL_HOURS", "1"))
INTERVAL_SEC      = int(INTERVAL_HOURS * 3600)
SCRAPER_DIR       = Path(os.getenv("SCRAPER_DIR", str(Path(__file__).parent)))
OUTPUT_JSON       = Path(os.getenv("STARLINK_OUTPUT_JSON", "/data/starlink_export.json"))
LAST_STATUS_FILE  = SCRAPER_DIR / ".last_status.json"
STATE_JSON_SHARED = Path("/data/.scheduler_state.json")
STATE_JSON_LOCAL  = SCRAPER_DIR / ".scheduler_state.json"
N_WORKERS         = int(os.getenv("PARALLEL_WORKERS", "2"))

# ── Notifier ──────────────────────────────────────────────────────────────────
try:
    from notifier import WANotifier
    notifier = WANotifier()
except ImportError:
    notifier = None
    log.warning("notifier.py tidak ditemukan — notifikasi WA dinonaktifkan.")


# ── State Countdown Writer ───────────────────────────────────────────────────

def update_scheduler_state(status: str, sleep_sec: float = 0):
    try:
        now = datetime.now()
        data = {
            "status": status,
            "updated_at": now.isoformat(),
            "interval_seconds": INTERVAL_SEC,
        }
        if status == "scraping":
            data["started_at"] = now.isoformat()
        elif status == "idle":
            data["last_run"] = now.isoformat()
            data["next_run"] = (now + timedelta(seconds=sleep_sec)).isoformat()

        content = json.dumps(data)
        for target in (STATE_JSON_SHARED, STATE_JSON_LOCAL):
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            except Exception:
                pass
    except Exception as e:
        log.warning(f"Gagal menulis scheduler state: {e}")


# ── DB Helpers ────────────────────────────────────────────────────────────────

def _get_db_conn():
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


def is_job_running() -> bool:
    try:
        conn = _get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM scrape_jobs WHERE status = 'running' LIMIT 1")
            row = cur.fetchone()
        conn.close()
        return bool(row)
    except Exception as e:
        log.warning(f"Cek scrape_jobs running gagal: {e}")
        return False


def create_scrape_job(workers: int) -> int | None:
    try:
        conn = _get_db_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scrape_jobs (status, workers, total_kits, started_at, log)
                VALUES ('running', %s, 0, NOW(), %s)
                """,
                (workers, f"[SCHEDULER] Scheduled scrape otomatis dimulai pada {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"),
            )
            job_id = cur.lastrowid
        conn.commit()
        conn.close()
        log.info(f"Berhasil membuat scrape_jobs #{job_id}")
        return job_id
    except Exception as e:
        log.warning(f"Gagal membuat scrape_jobs di DB: {e}")
        return None


def finish_scrape_job(job_id: int | None, status: str, total_kits: int = 0, log_content: str = ""):
    if not job_id:
        return
    try:
        conn = _get_db_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE scrape_jobs
                SET status=%s, total_kits=%s, finished_at=NOW(), log=%s
                WHERE id=%s
                """,
                (status, total_kits, log_content[-60000:], job_id),
            )
        conn.commit()
        conn.close()
        log.info(f"Berhasil update scrape_jobs #{job_id} -> {status} (Total {total_kits} KIT)")
    except Exception as e:
        log.warning(f"Gagal update scrape_jobs #{job_id}: {e}")


# ── Diff Helper ───────────────────────────────────────────────────────────────

def _load_json(path: Path) -> list | dict | None:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        return None
    except Exception:
        return None


def _kit_key(kit: dict) -> str:
    """Unique key per KIT: kombinasi account + kit serial."""
    return f"{kit.get('code', '')}::{kit.get('kit', '')}"


def compute_diff(previous: list[dict], current: list[dict]) -> tuple[list, list, list]:
    """
    Bandingkan status run sebelumnya vs sekarang.
    Return: (new_suspended, new_restricted, recovered)
    """
    prev_map: dict[str, str] = {_kit_key(k): k.get("status", "active") for k in (previous or [])}
    curr_map: dict[str, dict] = {_kit_key(k): k for k in (current or [])}

    new_suspended  = []
    new_restricted = []
    recovered      = []

    for key, kit in curr_map.items():
        curr_status = kit.get("status", "active")
        prev_status = prev_map.get(key, "active")

        if curr_status == "suspended" and prev_status != "suspended":
            new_suspended.append(kit)
        elif curr_status == "restricted" and prev_status not in ("restricted", "suspended"):
            new_restricted.append(kit)
        elif prev_status in ("suspended", "restricted") and curr_status == "active":
            recovered.append(kit)

    return new_suspended, new_restricted, recovered


def compute_stats(kits: list[dict]) -> dict:
    stats = {"active": 0, "restricted": 0, "suspended": 0, "inactive": 0, "total": len(kits)}
    for k in kits:
        s = k.get("status", "active")
        if s in stats:
            stats[s] += 1
    return stats


# ── Multi-Account Scraping ───────────────────────────────────────────────────

def get_active_parents() -> list[dict]:
    """Query akun induk yang aktif dari MySQL."""
    try:
        conn = _get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT id, account_name, email, auth_state FROM parent_accounts WHERE is_active = 1")
            return cur.fetchall()
    except Exception as e:
        log.warning(f"Tidak dapat membaca parent_accounts: {e}")
        return []


def run_single_scrape(parent_id: int = None, state_file: Path = None, output_json: Path = None, job_id: int = None) -> tuple[bool, int, list[str]]:
    """Jalankan parallel_scraper.py untuk akun tertentu."""
    parallel_script = SCRAPER_DIR / "parallel_scraper.py"
    if not parallel_script.exists():
        msg = f"parallel_scraper.py tidak ditemukan di {SCRAPER_DIR}"
        log.error(msg)
        return False, 0, [msg]

    target_output = output_json or OUTPUT_JSON

    env = {
        **os.environ,
        "SAVE_TO_DB": os.getenv("SAVE_TO_DB", "true"),
        "STARLINK_OUTPUT_JSON": str(target_output),
        "PARALLEL_WORKERS": str(N_WORKERS),
    }
    if job_id:
        env["SCRAPE_JOB_ID"] = str(job_id)
    if parent_id:
        env["PARENT_ACCOUNT_ID"] = str(parent_id)
    if state_file:
        env["STARLINK_STATE_FILE"] = str(state_file)

    cmd = [
        sys.executable, str(parallel_script),
        "--workers", str(N_WORKERS),
        "--output-json", str(target_output),
    ]
    if parent_id:
        cmd += ["--parent-id", str(parent_id)]
    if state_file and state_file.exists():
        cmd += ["--state-file", str(state_file)]

    log.info(f"Memulai scraping: {' '.join(cmd)}")
    log_lines = [f"Memulai scraping: {' '.join(cmd)}"]
    kits_count = 0
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(SCRAPER_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        for line in proc.stdout:
            line = line.rstrip()
            if line:
                log.info(f"  {line}")
                log_lines.append(line)
                m_total = re.search(r"\[SUKSES\]\s+Total\s+(\d+)\s+KIT", line, re.IGNORECASE)
                if m_total:
                    kits_count = int(m_total.group(1))
                elif kits_count == 0 and "Total" in line and "KIT" in line:
                    m = re.search(r"Total\s+(\d+)\s+KIT", line, re.IGNORECASE)
                    if m:
                        kits_count = int(m.group(1))

        ret = proc.wait()
        if target_output.exists() and kits_count == 0:
            loaded = _load_json(target_output)
            if isinstance(loaded, list):
                kits_count = len(loaded)

        if ret == 0:
            log.info(f"Scraping SELESAI ({kits_count} KIT).")
            return True, kits_count, log_lines
        else:
            log.error(f"Scraping GAGAL (exit code {ret})")
            return False, kits_count, log_lines

    except Exception as e:
        err = f"Error menjalankan scraper: {e}"
        log.error(err)
        log_lines.append(err)
        return False, 0, log_lines


def run_scraping(job_id: int = None) -> tuple[bool, int, str]:
    """Jalankan scraping untuk semua akun induk yang aktif dan gabungkan hasilnya."""
    parents = get_active_parents()
    all_log_lines = []

    if not parents:
        log.info("Tidak ada parent_accounts di DB — menjalankan scraper default.")
        all_log_lines.append("Tidak ada parent_accounts di DB — menjalankan scraper default.")
        ok, cnt, lines = run_single_scrape(job_id=job_id)
        all_log_lines.extend(lines)
        return ok, cnt, "\n".join(all_log_lines)

    log.info(f"Ditemukan {len(parents)} akun induk aktif untuk di-scrape.")
    all_log_lines.append(f"Ditemukan {len(parents)} akun induk aktif untuk di-scrape.")
    all_success = True
    combined_kits = []
    temp_files = []
    total_kits = 0

    for p in parents:
        pid    = p["id"]
        pname  = p["account_name"]
        pemail = p["email"]
        banner = f"\n{'─'*50}\nMemulai Scraping: {pname} ({pemail}, ID={pid})\n{'─'*50}"
        log.info(banner)
        all_log_lines.append(banner)

        # Siapkan auth_state file
        state_file = SCRAPER_DIR / f"auth_state_{pid}.json"
        if p.get("auth_state"):
            try:
                state_file.write_text(p["auth_state"], encoding="utf-8")
            except Exception as e:
                log.warning(f"Gagal menulis auth_state_{pid}.json: {e}")
        elif pid == 1 and not state_file.exists():
            default_sf = SCRAPER_DIR / "auth_state.json"
            if default_sf.exists():
                state_file = default_sf

        if not state_file.exists():
            w_msg = f"Akun '{pname}' (ID={pid}) belum login / tidak memiliki auth_state valid. Silakan login terlebih dahulu melalui menu Akun Induk."
            log.warning(w_msg)
            all_log_lines.append(f"[WARNING] {w_msg}")
            all_success = False
            continue

        parent_output = SCRAPER_DIR / f".export_parent_{pid}.json"
        temp_files.append(parent_output)

        ok, cnt, lines = run_single_scrape(parent_id=pid, state_file=state_file, output_json=parent_output, job_id=job_id)
        all_log_lines.extend(lines)
        total_kits += cnt

        if ok and parent_output.exists():
            parent_kits = _load_json(parent_output) or []
            combined_kits.extend(parent_kits)
        else:
            all_success = False

        # Update last_scraped_at di DB
        try:
            conn = _get_db_conn()
            with conn.cursor() as cur:
                cur.execute("UPDATE parent_accounts SET last_scraped_at = NOW() WHERE id = %s", (pid,))
            conn.commit()
            conn.close()
        except Exception:
            pass

    # Simpan hasil gabungan seluruh akun induk ke OUTPUT_JSON (deduplikasi KIT unik)
    if combined_kits:
        from parallel_scraper import deduplicate_rows
        combined_kits = deduplicate_rows(combined_kits)
        for i, row in enumerate(combined_kits, start=1):
            row["no"] = i
        try:
            OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT_JSON.write_text(json.dumps(combined_kits, ensure_ascii=False, indent=2), encoding="utf-8")
            msg_comb = f"Semua data dari {len(parents)} akun induk digabungkan ke {OUTPUT_JSON} (Total: {len(combined_kits)} KIT unik)"
            log.info(msg_comb)
            all_log_lines.append(f"[INFO] {msg_comb}")
            total_kits = len(combined_kits)
        except Exception as e:
            err_comb = f"Gagal menulis {OUTPUT_JSON}: {e}"
            log.error(err_comb)
            all_log_lines.append(f"[ERROR] {err_comb}")

    # Bersihkan file temporer
    for tf in temp_files:
        try:
            tf.unlink(missing_ok=True)
        except Exception:
            pass

    return all_success, total_kits, "\n".join(all_log_lines)


# ── Notifikasi ────────────────────────────────────────────────────────────────

def do_notify(previous_kits: list[dict], current_kits: list[dict]):
    if not notifier:
        return
    effective_target = notifier.get_effective_target()
    if not effective_target or not notifier.is_enabled():
        log.info("WA_TARGET belum diatur atau WA_ENABLED=false, skip notifikasi.")
        return

    new_suspended, new_restricted, recovered = compute_diff(previous_kits, current_kits)
    stats = compute_stats(current_kits)

    log.info(f"Diff: +{len(new_suspended)} suspended, +{len(new_restricted)} restricted, {len(recovered)} recovered")

    if new_suspended or new_restricted or recovered:
        log.info("Perubahan status terdeteksi — mengirim notifikasi WA...")
        ok = notifier.send_status_change(
            new_suspended=new_suspended,
            new_restricted=new_restricted,
            recovered=recovered,
            stats=stats,
        )
        if not ok:
            log.warning("Notifikasi WA gagal dikirim.")
    else:
        log.info("Tidak ada perubahan status — tidak ada notifikasi.")


# ── Main Loop ─────────────────────────────────────────────────────────────────

_stop_event = False


def handle_signal(signum, frame):
    global _stop_event
    log.info(f"Signal {signum} diterima — menghentikan scheduler...")
    _stop_event = True


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def main():
    global _stop_event

    log.info("=" * 60)
    log.info("  Starlink GPRC Scheduler")
    log.info(f"  Interval  : {INTERVAL_HOURS} jam ({INTERVAL_SEC} detik)")
    log.info(f"  Workers   : {N_WORKERS}")
    log.info(f"  Output    : {OUTPUT_JSON}")
    log.info(f"  WA notif  : {os.getenv('WA_ENABLED', 'true')}")
    log.info("=" * 60)

    startup_wait = int(os.getenv("SCHEDULER_STARTUP_WAIT", "30"))
    log.info(f"Startup wait {startup_wait}s sebelum scraping pertama...")
    update_scheduler_state("idle", sleep_sec=startup_wait)
    time.sleep(startup_wait)

    while not _stop_event:
        if is_job_running():
            log.info("Job scraping lain sedang berjalan di background, menunggu 60 detik...")
            time.sleep(60)
            continue

        start_ts = time.time()
        log.info(f"\n{'='*60}")
        log.info(f"  Menjalankan scheduled scraping: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        log.info(f"{'='*60}")

        update_scheduler_state("scraping")

        # Buat entri ScrapeJob di MySQL
        job_id = create_scrape_job(workers=N_WORKERS)

        previous_kits: list[dict] = _load_json(LAST_STATUS_FILE) or _load_json(OUTPUT_JSON) or []

        success, total_kits, job_log = run_scraping(job_id=job_id)

        # Ambil jumlah KIT unik aktual dari DB agar 100% konsisten dengan Dashboard Overview
        actual_kits = total_kits
        try:
            conn = _get_db_conn()
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) as cnt FROM kits")
                row = cur.fetchone()
                if row and row.get("cnt"):
                    actual_kits = row["cnt"]
            conn.close()
        except Exception:
            pass

        # Update entri ScrapeJob di MySQL
        finish_scrape_job(
            job_id=job_id,
            status="done" if success else "failed",
            total_kits=actual_kits,
            log_content=job_log,
        )

        if success:
            current_kits: list[dict] = _load_json(OUTPUT_JSON) or []
            do_notify(previous_kits, current_kits)
            try:
                LAST_STATUS_FILE.write_text(
                    json.dumps(current_kits, ensure_ascii=False),
                    encoding="utf-8",
                )
            except Exception as e:
                log.warning(f"Gagal menulis LAST_STATUS_FILE: {e}")
        else:
            log.warning("Scraping gagal — status tidak diperbarui, tidak ada notifikasi.")

        elapsed = time.time() - start_ts
        sleep_sec = max(0, INTERVAL_SEC - elapsed)

        update_scheduler_state("idle", sleep_sec=sleep_sec)
        log.info(f"Selesai dalam {elapsed:.0f}s. Scraping berikutnya dalam {sleep_sec:.0f}s.")

        slept = 0
        while slept < sleep_sec and not _stop_event:
            time.sleep(min(5, sleep_sec - slept))
            slept += 5

    log.info("Scheduler dihentikan.")


if __name__ == "__main__":
    main()
