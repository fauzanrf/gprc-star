"""
parallel_scraper.py
====================
Orchestrator untuk menjalankan scraping Starlink secara paralel.

Cara kerja:
  1. Fetch daftar akun SEKALI via API (gunakan auth_state.json)
  2. Bagi akun ke N worker proses (dikonfigurasi via PARALLEL_WORKERS di .env)
  3. Reset SharedRateLimiter global (token bucket berbasis file) sebelum spawn
  4. Spawn setiap worker sebagai subprocess terpisah (scrape_starlink.py)
     dengan jeda acak 8–15 detik antar worker agar tidak burst bersamaan
  5. Setiap worker berbagi rate limiter + checkpoint file yang sama
  6. Tunggu semua worker selesai (max WORKER_TIMEOUT_MINUTES menit per worker)
  7. Merge semua hasil JSON worker, assign nomor urut, simpan ke output JSON tunggal

Konfigurasi (.env):
  PARALLEL_WORKERS        = 2       # Jumlah worker paralel (disarankan 2 dengan rate limiter)
  WORKER_TIMEOUT_MINUTES  = 120     # Timeout per worker dalam menit (default: 120)
  STARLINK_OUTPUT_JSON    = starlink_export.json
  STARLINK_STATE_FILE     = auth_state.json
  STARLINK_DASHBOARD_URL  = https://starlink.com/account/home
  HEADLESS                = true

Penggunaan:
  python parallel_scraper.py
  python parallel_scraper.py --workers 2
  python parallel_scraper.py --workers 2 --output-json hasil.json
  python parallel_scraper.py --keep-temp      (simpan file temp untuk debug)
"""

import argparse
import asyncio
import json
import os
import random
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

try:
    from ratelimit import SharedRateLimiter, Checkpoint, retry_after_seconds
except ImportError:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parent))
    from ratelimit import SharedRateLimiter, Checkpoint, retry_after_seconds


# ============================== CONFIG ==============================
def _load_env():
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

def _get_state_file():
    sf = Path(os.getenv("STARLINK_STATE_FILE", "auth_state.json"))
    if not sf.exists():
        candidate = Path(__file__).parent / sf.name
        if candidate.exists():
            return candidate
        candidate2 = Path(__file__).parent.parent / sf.name
        if candidate2.exists():
            return candidate2
    return sf


CONFIG = {
    "dashboard_url": os.getenv("STARLINK_DASHBOARD_URL", "https://starlink.com/account/home"),
    "state_file":    _get_state_file(),
    "output_json":   os.getenv("STARLINK_OUTPUT_JSON", "starlink_export.json"),
    "workers":       int(os.getenv("PARALLEL_WORKERS", "2")),   # disarankan 2 dengan rate limiter
    "timeout_min":   int(os.getenv("WORKER_TIMEOUT_MINUTES", "120")),
}
# ====================================================================


async def fetch_accounts(state_file: Path, dashboard_url: str) -> list:
    """
    Fetch daftar semua sub-account dari API Starlink menggunakan auth_state.json.
    Dipanggil SEKALI oleh orchestrator sebelum spawn worker.
    """
    print("[Orchestrator] Menghubungkan ke Starlink untuk mengambil daftar akun...", flush=True)

    async with async_playwright() as p:
        headless_env = os.getenv("HEADLESS", "true").strip().lower()
        is_headless = headless_env in ("true", "1", "yes")
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        ]
        try:
            browser = await p.chromium.launch(
                headless=is_headless, channel="chrome",
                args=launch_args, ignore_default_args=["--enable-automation"],
            )
        except Exception:
            browser = await p.chromium.launch(
                headless=is_headless, args=launch_args,
                ignore_default_args=["--enable-automation"],
            )

        context = await browser.new_context(
            storage_state=str(state_file),
            viewport={"width": 1280, "height": 800},
        )
        await Stealth().apply_stealth_async(context)
        page = await context.new_page()

        try:
            await page.goto(dashboard_url, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(3000)
            await context.storage_state(path=str(state_file))
        except Exception:
            try:
                await page.goto(dashboard_url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(4000)
                await context.storage_state(path=str(state_file))
            except Exception as ex:
                print(f"[Orchestrator] [Info] Navigasi awal: {ex}", flush=True)

        accounts = []
        for attempt in range(4):
            acc_resp = await page.request.get("https://starlink.com/api/accounts/v3/accounts/contact")
            if acc_resp.status == 429:
                ra = retry_after_seconds(dict(acc_resp.headers))
                wait_sec = ra or 30.0
                print(f"[Orchestrator] Rate limit 429. Cooldown {wait_sec:.0f}s (attempt {attempt+1}/4)...", flush=True)
                await asyncio.sleep(wait_sec)
                continue
            if acc_resp.status == 401:
                print("[Orchestrator] Sesi perlu refresh. Menyegarkan via SSO...", flush=True)
                try:
                    await page.goto(dashboard_url, wait_until="networkidle", timeout=40000)
                    await page.wait_for_timeout(3500)
                    await context.storage_state(path=str(state_file))
                except Exception:
                    try:
                        await page.goto(dashboard_url, wait_until="domcontentloaded", timeout=30000)
                        await page.wait_for_timeout(4000)
                        await context.storage_state(path=str(state_file))
                    except Exception:
                        pass
                continue
            if acc_resp.status == 200:
                acc_data = await acc_resp.json()
                accounts = acc_data.get("content", [])
                break
            await asyncio.sleep(5)

        await browser.close()

        if not accounts:
            raise SystemExit(
                "[Orchestrator] Gagal memuat akun (Rate limit / Sesi habis). "
                "Tunggu 1-2 menit atau perbarui sesi login."
            )

    print(f"[Orchestrator] {len(accounts)} sub-account ditemukan.", flush=True)
    return accounts


def split_accounts(accounts: list, n_workers: int) -> list:
    """Bagi daftar akun menjadi N chunk (hampir merata)."""
    total = len(accounts)
    chunk_size = (total + n_workers - 1) // n_workers  # ceiling division
    return [accounts[i:i + chunk_size] for i in range(0, total, chunk_size)]


def spawn_worker(
    worker_id: int,
    start_idx: int,
    end_idx: int,
    accounts_json_path: str,
    output_json_path: str,
    rate_state_path: str | None = None,
    checkpoint_path: str | None = None,
    parent_id: int | None = None,
    state_file: Path | None = None,
) -> subprocess.Popen:
    """
    Spawn satu worker subprocess yang menjalankan scrape_starlink.py.
    stdout/stderr diteruskan langsung ke terminal agar progress bisa dipantau.
    """
    script_path = Path(__file__).parent / "scrape_starlink.py"
    cmd = [
        sys.executable, str(script_path),
        "--worker-id",     str(worker_id),
        "--start-idx",     str(start_idx),
        "--end-idx",       str(end_idx),
        "--accounts-json", accounts_json_path,
        "--output-json",   output_json_path,
    ]
    if rate_state_path:
        cmd += ["--rate-state", rate_state_path]
    if checkpoint_path:
        cmd += ["--checkpoint-file", checkpoint_path]
    if state_file:
        cmd += ["--state-file", str(state_file)]
    print(f"[Orchestrator] Spawning Worker {worker_id}: akun {start_idx}–{end_idx - 1} (state={state_file.name if state_file else 'default'})", flush=True)

    env = os.environ.copy()
    if parent_id:
        env["PARENT_ACCOUNT_ID"] = str(parent_id)
    if state_file:
        env["STARLINK_STATE_FILE"] = str(state_file)

    return subprocess.Popen(cmd, cwd=str(Path(__file__).parent), env=env)


def deduplicate_rows(rows: list) -> list:
    """
    Deduplikasi hasil scraping berdasarkan nomor KIT unik.
    Jika satu nomor KIT fisik terambil lebih dari 1 kali di sub-akun berbeda,
    pilih entri yang memiliki data terbaik (traffic kuota > status active > status lain).
    """
    def _rank(r: dict) -> tuple:
        status = (r.get("status") or "").lower()
        quota = (r.get("quota") or "").strip()
        has_traffic = bool(quota and quota not in ("-", "0.00 GB", "0 GB", "0 MB", "0.0 GB", "0"))
        # Skor status: suspended dan restricted memiliki prioritas tertinggi agar tidak tertimpa status stale
        status_score = {"suspended": 5, "restricted": 4, "active": 3, "inactive": 1}.get(status, 0)
        return (1 if has_traffic else 0, status_score)

    unique_map: dict[str, dict] = {}
    non_kit_rows: list[dict] = []

    for row in rows:
        kit_sn = (row.get("kit") or "").strip()
        if not kit_sn or kit_sn in ("-", "None", "null"):
            non_kit_rows.append(row)
            continue

        if kit_sn not in unique_map:
            unique_map[kit_sn] = row
        else:
            # Bandingkan apakah row baru lebih baik daripada row sebelumnya
            if _rank(row) > _rank(unique_map[kit_sn]):
                unique_map[kit_sn] = row

    deduped = list(unique_map.values()) + non_kit_rows
    for i, row in enumerate(deduped, start=1):
        row["no"] = i
    return deduped


def merge_results(worker_output_files: list) -> list:
    """
    Gabungkan semua file JSON dari worker menjadi satu list.
    Deduplikasi KIT fisik unik dan assign nomor urut berurutan dari 1.
    """
    merged = []
    for f in worker_output_files:
        p = Path(f)
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                merged.extend(data)
            except Exception as e:
                print(f"[Orchestrator] [!] Gagal baca {f}: {e}", flush=True)
        else:
            print(f"[Orchestrator] [!] File tidak ditemukan: {f}", flush=True)

    return deduplicate_rows(merged)


def cleanup_temp_files(files: list):
    """Hapus file JSON temporer worker setelah merge selesai."""
    for f in files:
        try:
            Path(f).unlink(missing_ok=True)
        except Exception:
            pass


def run_parallel(
    n_workers: int,
    output_json: str,
    keep_temp: bool = False,
    state_file: Path | None = None,
    parent_id: int | None = None,
):
    """Orchestration flow utama."""
    if state_file is None:
        state_file = CONFIG["state_file"]
    else:
        state_file = Path(state_file)

    dashboard   = CONFIG["dashboard_url"]
    timeout_sec = CONFIG["timeout_min"] * 60

    if not state_file.exists():
        raise SystemExit(
            f"File sesi '{state_file}' tidak ditemukan. "
            "Jalankan discover.py atau login_vps.py terlebih dahulu."
        )

    # 1. Fetch daftar akun (sekali, oleh orchestrator)
    accounts = asyncio.run(fetch_accounts(state_file, dashboard))
    if not accounts:
        raise SystemExit("[Orchestrator] Tidak ada akun yang ditemukan.")

    total_acc = len(accounts)
    n_workers = min(n_workers, total_acc)  # Jangan spawn lebih banyak worker dari jumlah akun

    # 2. Simpan daftar akun ke file temp untuk dibaca worker
    scraper_dir  = Path(__file__).parent.resolve()
    ts           = datetime.now().strftime("%Y%m%d_%H%M%S")
    accounts_tmp = (scraper_dir / f".accounts_tmp_{ts}.json").resolve()
    accounts_tmp.write_text(json.dumps(accounts, ensure_ascii=False), encoding="utf-8")

    # 3. Bagi akun ke N chunk
    chunks = split_accounts(accounts, n_workers)
    actual_workers = len(chunks)

    # ── Setup rate limiter + checkpoint bersama ───────────────────────────────
    rate_state_path  = (scraper_dir / f".ratelimit_state_{ts}.json").resolve()
    checkpoint_path  = (scraper_dir / f".checkpoint_{ts}.json").resolve()

    # Reset limiter (hapus penalti lama, isi token penuh)
    limiter = SharedRateLimiter(rate_state_path)
    limiter.reset()
    print(f"[Orchestrator] Rate limiter: {rate_state_path}", flush=True)
    print(f"[Orchestrator] Checkpoint  : {checkpoint_path}", flush=True)

    print(f"\n{'='*65}", flush=True)
    print(f"[Orchestrator] Memulai {actual_workers} worker paralel untuk {total_acc} akun", flush=True)
    print(f"[Orchestrator] Timeout per worker: {CONFIG['timeout_min']} menit", flush=True)
    print(f"[Orchestrator] Output akhir: {output_json}", flush=True)
    print(f"{'='*65}\n", flush=True)

    # 4. Spawn semua worker
    worker_outputs = []
    processes      = []
    cumulative     = 0

    def _on_cancel_signal(signum, frame):
        print("\n[Orchestrator] Menerima sinyal pembatalan. Menghentikan semua proses worker...", flush=True)
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        time.sleep(0.5)
        for p in processes:
            try:
                if p.poll() is None:
                    p.kill()
            except Exception:
                pass
        sys.exit(130)

    signal.signal(signal.SIGTERM, _on_cancel_signal)
    signal.signal(signal.SIGINT, _on_cancel_signal)

    for wid, chunk in enumerate(chunks):
        out_file = (scraper_dir / f".result_worker_{wid}_{ts}.json").resolve()
        worker_outputs.append(str(out_file))

        proc = spawn_worker(
            worker_id=wid,
            start_idx=cumulative,
            end_idx=cumulative + len(chunk),
            accounts_json_path=str(accounts_tmp),
            output_json_path=str(out_file),
            rate_state_path=str(rate_state_path),
            checkpoint_path=str(checkpoint_path),
            parent_id=parent_id,
            state_file=state_file,
        )
        processes.append(proc)
        cumulative += len(chunk)
        if wid < len(chunks) - 1:  # Tidak perlu delay setelah worker terakhir
            delay = random.uniform(10, 18)
            print(f"[Orchestrator] Jeda {delay:.1f}s sebelum spawn worker berikutnya...", flush=True)
            time.sleep(delay)

    # 5. Tunggu semua worker selesai
    print(f"\n[Orchestrator] Semua worker telah di-spawn. Menunggu selesai...", flush=True)
    start_time     = time.time()
    failed_workers = []

    for wid, proc in enumerate(processes):
        remaining = timeout_sec - (time.time() - start_time)
        if remaining <= 0:
            print(f"[Orchestrator] [!] Timeout global habis. Worker {wid} di-kill.", flush=True)
            proc.kill()
            failed_workers.append(wid)
            continue

        try:
            ret = proc.wait(timeout=remaining)
            if ret != 0:
                print(f"[Orchestrator] [!] Worker {wid} selesai dengan error code {ret}", flush=True)
                failed_workers.append(wid)
            else:
                print(f"[Orchestrator] [OK] Worker {wid} selesai.", flush=True)
        except subprocess.TimeoutExpired:
            mins = CONFIG['timeout_min']
            print(f"[Orchestrator] [!] Worker {wid} melebihi batas waktu ({mins} menit). Di-kill.", flush=True)
            proc.kill()
            failed_workers.append(wid)

    # 6. Merge hasil dari semua worker
    print(f"\n[Orchestrator] Menggabungkan hasil dari {actual_workers} worker...", flush=True)
    merged = merge_results(worker_outputs)

    # Simpan kembali ke MySQL jika save_to_db aktif agar seluruh data ter-deduplikasi bersih
    if os.getenv("SAVE_TO_DB", "true").lower() in ("true", "1", "yes"):
        try:
            from db_writer import save_rows_to_db
            save_rows_to_db(merged, parent_account_id=parent_id)
        except Exception as e:
            print(f"[Orchestrator] [DB Error] Gagal simpan final: {e}", flush=True)

    # 7. Simpan output JSON final
    out_path = Path(output_json).resolve()
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Orchestrator] Output disimpan: {out_path}", flush=True)

    # 8. Cleanup file temporer
    temp_files = worker_outputs + [str(accounts_tmp), str(rate_state_path), str(checkpoint_path)]
    lock_files = [
        str(rate_state_path) + ".lock",
        str(checkpoint_path) + ".lock",
        str(checkpoint_path) + ".lock",
    ]
    if not keep_temp:
        cleanup_temp_files(temp_files + lock_files)
        print("[Orchestrator] File temporer dibersihkan.", flush=True)
    else:
        print(f"[Orchestrator] File temp disimpan (--keep-temp): {worker_outputs}", flush=True)

    # 9. Ringkasan akhir
    total_restricted = sum(1 for r in merged if r.get("status", "").lower() == "restricted")
    total_suspended  = sum(1 for r in merged if r.get("status", "").lower() == "suspended")
    total_inactive   = sum(1 for r in merged if r.get("status", "").lower() == "inactive")
    total_active     = sum(1 for r in merged if r.get("status", "").lower() == "active")

    print(f"\n{'='*65}")
    print(f"[SUKSES] Total {len(merged)} KIT berhasil diproses oleh {actual_workers} worker.")
    print(f"         Output JSON: {out_path}")
    print(f"{'='*65}")
    print(f"  [+] Active (normal)     : {total_active}")
    print(f"  [!] RESTRICTED (banner) : {total_restricted}  (online tapi terkena restricted!)")
    print(f"  [X] SUSPENDED           : {total_suspended}  (akun/layanan ditangguhkan!)")
    print(f"  [-] Inactive (offline)  : {total_inactive}")
    if failed_workers:
        print(f"  [!] Worker gagal/timeout: Worker {failed_workers}")
    print(f"{'='*65}")

    return len(merged), failed_workers


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Starlink Parallel Scraper Orchestrator")
    parser.add_argument(
        "--workers", type=int, default=CONFIG["workers"],
        help=f"Jumlah worker paralel (default dari .env: {CONFIG['workers']})",
    )
    parser.add_argument(
        "--output-json", type=str, default=CONFIG["output_json"],
        help=f"Path file output JSON akhir (default: {CONFIG['output_json']})",
    )
    parser.add_argument(
        "--keep-temp", action="store_true",
        help="Simpan file JSON temporer worker (berguna untuk debug)",
    )
    parser.add_argument(
        "--state-file", type=str, default=None,
        help="Path ke file auth_state.json untuk akun ini",
    )
    parser.add_argument(
        "--parent-id", type=int, default=None,
        help="ID parent_account untuk menandai sub-account dan kit di database",
    )
    args = parser.parse_args()

    print("=" * 65)
    print("       STARLINK PARALLEL SCRAPER ORCHESTRATOR")
    print(f"       Workers      : {args.workers}")
    print(f"       Timeout      : {CONFIG['timeout_min']} menit/worker")
    print(f"       Output JSON  : {args.output_json}")
    if args.parent_id:
        print(f"       Parent ID    : {args.parent_id}")
    print("=" * 65)

    run_parallel(
        n_workers=args.workers,
        output_json=args.output_json,
        keep_temp=args.keep_temp,
        state_file=args.state_file,
        parent_id=args.parent_id,
    )
