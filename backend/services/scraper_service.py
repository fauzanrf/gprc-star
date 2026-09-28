"""
scraper_service.py
==================
Mengelola parallel scraping jobs dan broadcast log via WebSocket.
Mendukung multi-akun induk (per akun atau semua akun aktif)
serta pembatalan proses scraping (cancellation).
"""
import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Set, Optional, List

import pymysql
import pymysql.cursors


class ScrapeManager:
    """Singleton manager untuk scraping jobs & WebSocket subscribers."""

    def __init__(self):
        self._subscribers: Set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        self._current_job_id: Optional[int] = None
        self._current_proc: Optional[asyncio.subprocess.Process] = None
        self._cancel_requested: bool = False

    def subscribe(self, queue: asyncio.Queue):
        self._subscribers.add(queue)

    def unsubscribe(self, queue: asyncio.Queue):
        self._subscribers.discard(queue)

    async def broadcast(self, message: str):
        dead = set()
        for q in list(self._subscribers):
            try:
                await q.put(message)
            except Exception:
                dead.add(q)
        self._subscribers -= dead

    def _get_conn(self):
        return pymysql.connect(
            host=os.getenv("DB_HOST", "mysql"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "starlink"),
            password=os.getenv("DB_PASSWORD", "Strl1nkDB2026!"),
            database=os.getenv("DB_NAME", "starlink_db"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )

    def _update_job(self, job_id: int, status: str, total_kits: int = 0, log: str = ""):
        try:
            conn = self._get_conn()
            with conn.cursor() as cur:
                if status in ("done", "failed"):
                    cur.execute(
                        "UPDATE scrape_jobs SET status=%s, total_kits=%s, finished_at=NOW(), log=%s WHERE id=%s",
                        (status, total_kits, log[-60000:], job_id),
                    )
                else:
                    cur.execute(
                        "UPDATE scrape_jobs SET status=%s, log=%s WHERE id=%s",
                        (status, log[-60000:], job_id),
                    )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ScrapeManager] DB update error: {e}", flush=True)

    def _update_parent_scraped(self, parent_id: int):
        try:
            conn = self._get_conn()
            with conn.cursor() as cur:
                cur.execute("UPDATE parent_accounts SET last_scraped_at = NOW() WHERE id = %s", (parent_id,))
            conn.commit()
            conn.close()
        except Exception:
            pass

    def _get_parent_account(self, parent_id: int) -> Optional[dict]:
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, account_name, email, is_active, is_valid, auth_state FROM parent_accounts WHERE id = %s", (parent_id,))
                return cur.fetchone()
        finally:
            conn.close()

    def _get_active_parents(self) -> List[dict]:
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, account_name, email, is_active, is_valid, auth_state FROM parent_accounts WHERE is_active = 1 ORDER BY id")
                return cur.fetchall() or []
        finally:
            conn.close()

    async def cancel_current_job(self) -> tuple[bool, str]:
        """Batalkan proses scraping manual yang sedang berjalan."""
        async with self._lock:
            if not self._current_job_id:
                return False, "Tidak ada proses scraping manual yang sedang berjalan."

            self._cancel_requested = True
            job_id = self._current_job_id
            proc = self._current_proc

        if proc and proc.returncode is None:
            try:
                # Kirim sinyal SIGTERM ke seluruh process group (orchestrator + workers)
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                await asyncio.sleep(0.8)
                if proc.returncode is None:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

        await self.broadcast(json.dumps({
            "type": "log",
            "message": f"\n[!] PROSES SCRAPING #{job_id} TELAH DIBATALKAN OLEH PENGGUNA.\n"
        }))
        await self.broadcast(json.dumps({
            "type": "job_failed",
            "job_id": job_id,
            "message": "Scraping dibatalkan oleh pengguna."
        }))

        self._update_job(job_id, "failed", 0, "Scraping dibatalkan oleh pengguna.")
        return True, f"Proses scraping #{job_id} berhasil dibatalkan."

    async def run_job(self, job_id: int, n_workers: int | None = None, parent_account_id: int | None = None):
        """Jalankan parallel scraping job secara async (per akun induk atau semua)."""
        n_workers = n_workers or int(os.getenv("PARALLEL_WORKERS", "3"))
        log_lines = []

        async def log(msg: str):
            log_lines.append(msg)
            await self.broadcast(json.dumps({"type": "log", "message": msg}))

        self._cancel_requested = False
        self._current_job_id = job_id
        await self.broadcast(json.dumps({"type": "job_start", "job_id": job_id}))
        self._update_job(job_id, "running")

        scraper_dir = Path(os.getenv("SCRAPER_DIR", "/app/scraper"))
        parallel_script = scraper_dir / "parallel_scraper.py"

        async def run_single(target_parent: dict | None) -> tuple[bool, int]:
            if self._cancel_requested:
                return False, 0

            pid = target_parent["id"] if target_parent else None
            pname = target_parent["account_name"] if target_parent else "Default"
            pemail = target_parent["email"] if target_parent else ""

            # Siapkan auth_state file
            if pid:
                state_file = scraper_dir / f"auth_state_{pid}.json"
                if target_parent.get("auth_state"):
                    try:
                        state_file.write_text(target_parent["auth_state"], encoding="utf-8")
                    except Exception as e:
                        await log(f"[!] Gagal menulis state file {state_file.name}: {e}")
                elif pid == 1 and not state_file.exists():
                    default_sf = scraper_dir / "auth_state.json"
                    if default_sf.exists():
                        state_file = default_sf

                if not state_file.exists():
                    await log(f"[ERROR] Akun '{pname}' (ID={pid}) belum memiliki auth_state/sesi valid!")
                    await log("Silakan lakukan Login terlebih dahulu melalui menu Akun Induk.")
                    return False, 0
            else:
                state_file = scraper_dir / "auth_state.json"
                if not state_file.exists():
                    await log("[ERROR] File auth_state.json default tidak ditemukan!")
                    return False, 0

            await log(f"\n{'='*55}\n[Job {job_id}] Scraping Akun: {pname} ({pemail})\nWorkers: {n_workers} | Sesi: {state_file.name}\n{'='*55}")

            cmd = [
                sys.executable, str(parallel_script),
                "--workers", str(n_workers),
                "--state-file", str(state_file),
            ]
            if pid:
                cmd += ["--parent-id", str(pid)]

            env = {
                **os.environ,
                "SAVE_TO_DB": "true",
                "SCRAPE_JOB_ID": str(job_id),
                "STARLINK_STATE_FILE": str(state_file),
            }
            if pid:
                env["PARENT_ACCOUNT_ID"] = str(pid)

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
                cwd=str(scraper_dir),
                start_new_session=True,
            )
            self._current_proc = proc

            kits_count = 0
            try:
                async for line_bytes in proc.stdout:
                    if self._cancel_requested:
                        break
                    line = line_bytes.decode("utf-8", errors="replace").rstrip()
                    await log(line)
                    m_total = re.search(r"\[SUKSES\]\s+Total\s+(\d+)\s+KIT", line, re.IGNORECASE)
                    if m_total:
                        kits_count = int(m_total.group(1))
                    elif kits_count == 0 and "Total" in line and "KIT" in line:
                        m = re.search(r"Total\s+(\d+)\s+KIT", line, re.IGNORECASE)
                        if m:
                            kits_count = int(m.group(1))
            except Exception:
                pass

            ret = await proc.wait()
            self._current_proc = None

            if self._cancel_requested:
                await log(f"\n[!] Scraping akun {pname} dihentikan karena dibatalkan.")
                return False, kits_count

            if ret == 0:
                if pid:
                    self._update_parent_scraped(pid)
                await log(f"[*] Selesai scraping akun: {pname} ({kits_count} KIT)")
                return True, kits_count
            else:
                await log(f"[!] Gagal scraping akun: {pname} (exit code {ret})")
                return False, kits_count

        try:
            total_kits = 0
            all_ok = True

            # Skenario 1: Scrape akun spesifik
            if parent_account_id:
                target = self._get_parent_account(parent_account_id)
                if not target:
                    raise RuntimeError(f"Akun induk dengan ID {parent_account_id} tidak ditemukan.")
                ok, cnt = await run_single(target)
                total_kits += cnt
                all_ok = ok
            # Skenario 2: Scrape semua akun aktif secara berurutan
            else:
                parents = self._get_active_parents()
                if not parents:
                    await log("Tidak ada akun induk di database, menggunakan akun default...")
                    ok, cnt = await run_single(None)
                    total_kits += cnt
                    all_ok = ok
                else:
                    await log(f"Ditemukan {len(parents)} akun induk aktif untuk di-scrape.")
                    for p in parents:
                        if self._cancel_requested:
                            break
                        ok, cnt = await run_single(p)
                        total_kits += cnt
                        if not ok:
                            all_ok = False

            if self._cancel_requested:
                self._update_job(job_id, "failed", total_kits, "\n".join(log_lines) + "\n[CANCELLED]")
                await self.broadcast(json.dumps({"type": "job_failed", "job_id": job_id, "message": "Dibatalkan"}))
            elif all_ok:
                actual_kits = total_kits
                try:
                    conn = self._get_conn()
                    with conn.cursor() as cur:
                        if parent_account_id:
                            cur.execute("SELECT COUNT(k.id) as cnt FROM kits k JOIN accounts a ON k.account_id = a.id WHERE a.parent_account_id = %s", (parent_account_id,))
                        else:
                            cur.execute("SELECT COUNT(*) as cnt FROM kits")
                        row = cur.fetchone()
                        if row and row.get("cnt"):
                            actual_kits = row["cnt"]
                    conn.close()
                except Exception:
                    pass
                self._update_job(job_id, "done", actual_kits, "\n".join(log_lines))
                await self.broadcast(json.dumps({"type": "job_done", "job_id": job_id, "total_kits": actual_kits}))
                await log(f"\n[Job {job_id}] SEMUA SCRAPING SELESAI! Total {actual_kits} KIT tersinkronisasi.")
            else:
                self._update_job(job_id, "failed", total_kits, "\n".join(log_lines))
                await self.broadcast(json.dumps({"type": "job_failed", "job_id": job_id}))
                await log(f"\n[Job {job_id}] SELESAI DENGAN CATATAN (beberapa akun gagal/butuh login).")

        except Exception as e:
            if not self._cancel_requested:
                self._update_job(job_id, "failed", 0, str(e))
                await self.broadcast(json.dumps({"type": "job_failed", "job_id": job_id, "error": str(e)}))
                await log(f"[Job {job_id}] Error: {e}")
        finally:
            self._current_job_id = None
            self._current_proc = None
            self._cancel_requested = False
