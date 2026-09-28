"""
ratelimit.py
============
Global shared rate limiter (token bucket) dan checkpoint helper
untuk multi-process Starlink scraping.

Token bucket state disimpan di file JSON sehingga semua worker process
bisa berbagi state yang sama. FileLock memastikan mutual exclusion.

Ketika satu worker kena 429, ia memanggil penalize() yang meng-inject
"cooldown until" timestamp ke state file — semua worker lain akan
membaca ini dan ikut menunggu sebelum request berikutnya.

Penggunaan:
    from ratelimit import SharedRateLimiter, retry_after_seconds

    limiter = SharedRateLimiter(state_path)   # tiap worker buat instance
    await limiter.acquire_async()             # tunggu sebelum request
    resp = await page.request.get(url)
    if resp.status == 429:
        wait = retry_after_seconds(resp.headers) or 60
        await limiter.penalize(wait)
        await asyncio.sleep(wait)
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from filelock import FileLock, Timeout as FileLockTimeout

# ── Konstanta default ─────────────────────────────────────────────────────────
_DEFAULT_RATE     = 1.4   # token/detik (1 req / ~0.7s — aman dari Envoy rate limiter Starlink)
_DEFAULT_CAPACITY = 4     # kapasitas burst maksimum token bucket
_LOCK_TIMEOUT_SEC = 10    # max tunggu dapat file lock sebelum menyerah
_MIN_WAIT_SEC     = 0.2   # min jeda antar acquire (batas bawah anti-spam)


def retry_after_seconds(headers: dict[str, Any] | None) -> float | None:
    """
    Baca header Retry-After / x-envoy-ratelimited dari respons HTTP 429.
    Return: jumlah detik tunggu, atau None jika header tidak ada.
    """
    if not headers:
        return None

    # Cek Starlink Envoy Rate Limiter
    for k, v in headers.items():
        if k.lower() == "x-envoy-ratelimited" and str(v).lower() == "true":
            return 60.0

    # Coba header standar (case-insensitive)
    for key in ("retry-after", "Retry-After", "x-ratelimit-reset-after", "x-ratelimit-reset"):
        val = headers.get(key)
        if val is None:
            val = headers.get(key.lower())
        if val is None:
            continue

        try:
            n = float(str(val).strip())
            if n > time.time() - 1_000_000:
                n = max(0.0, n - time.time())
            return max(1.0, n)
        except (ValueError, TypeError):
            pass

    return None


class SharedRateLimiter:
    """
    Token bucket berbasis file JSON — aman untuk multi-process.

    State file schema (JSON):
    {
        "tokens": <float>,          # token yang tersedia saat ini
        "last_refill": <float>,     # Unix timestamp refill terakhir
        "cooldown_until": <float>,  # Unix timestamp: tunggu sampai ini (dari penalize)
        "rate": <float>,            # token/detik
        "capacity": <float>         # kapasitas maksimum
    }
    """

    def __init__(
        self,
        state_path: str | Path,
        rate: float = _DEFAULT_RATE,
        capacity: float = _DEFAULT_CAPACITY,
    ):
        self._state_path = Path(state_path)
        self._lock_path  = Path(str(state_path) + ".lock")
        self._rate       = rate
        self._capacity   = capacity
        self._lock       = FileLock(str(self._lock_path), timeout=_LOCK_TIMEOUT_SEC)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _read_state(self) -> dict:
        """Baca state dari file. Return default jika file belum ada / rusak."""
        if self._state_path.exists():
            try:
                data = json.loads(self._state_path.read_text(encoding="utf-8"))
                return {
                    "tokens":        float(data.get("tokens", self._capacity)),
                    "last_refill":   float(data.get("last_refill", time.time())),
                    "cooldown_until": float(data.get("cooldown_until", 0.0)),
                    "rate":          float(data.get("rate", self._rate)),
                    "capacity":      float(data.get("capacity", self._capacity)),
                }
            except Exception:
                pass
        return {
            "tokens": self._capacity,
            "last_refill": time.time(),
            "cooldown_until": 0.0,
            "rate": self._rate,
            "capacity": self._capacity,
        }

    def _write_state(self, state: dict) -> None:
        self._state_path.write_text(
            json.dumps(state, indent=2), encoding="utf-8"
        )

    def _refill(self, state: dict) -> dict:
        """Isi ulang token berdasarkan waktu yang berlalu sejak refill terakhir."""
        now     = time.time()
        elapsed = now - state["last_refill"]
        added   = elapsed * state["rate"]
        state["tokens"]      = min(state["capacity"], state["tokens"] + added)
        state["last_refill"] = now
        return state

    # ── Public API ────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """
        Reset state ke kondisi awal (kapasitas penuh, tanpa cooldown).
        Dipanggil oleh orchestrator sebelum spawn worker.
        """
        try:
            with self._lock:
                self._write_state({
                    "tokens": self._capacity,
                    "last_refill": time.time(),
                    "cooldown_until": 0.0,
                    "rate": self._rate,
                    "capacity": self._capacity,
                })
            print(
                f"[RateLimiter] State direset: {self._capacity} token, "
                f"rate={self._rate} tok/s, capacity={self._capacity}",
                flush=True,
            )
        except FileLockTimeout:
            pass  # Tidak kritis saat reset

    def penalize(self, wait_sec: float) -> None:
        """
        Terapkan penalti global: semua worker harus menunggu sampai
        `now + wait_sec` sebelum request berikutnya.

        Dipanggil synchronously (tidak perlu await) karena operasi file cepat.
        Juga kosongkan token bucket agar acquire() ikut menunggu.
        """
        until = time.time() + wait_sec
        try:
            with self._lock:
                state = self._read_state()
                # Hanya perpanjang jika cooldown baru lebih lama
                state["cooldown_until"] = max(state.get("cooldown_until", 0.0), until)
                # Kosongkan token (paksa tunggu refill)
                state["tokens"] = 0.0
                self._write_state(state)
            print(
                f"[RateLimiter] PENALIZED — cooldown {wait_sec:.0f}s "
                f"(hingga {time.strftime('%H:%M:%S', time.localtime(until))})",
                flush=True,
            )
        except FileLockTimeout:
            # Fallback: tunggu di sini saja jika tidak bisa lock
            time.sleep(min(wait_sec, 5))

    async def penalize_async(self, wait_sec: float) -> None:
        """Async wrapper untuk penalize — agar bisa di-await dari coroutine."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.penalize, wait_sec)

    def acquire(self) -> None:
        """
        Synchronous acquire — blokir sampai ada token tersedia dan cooldown selesai.
        Gunakan acquire_async() dari coroutine asyncio.
        """
        while True:
            wait_needed = 0.0

            try:
                with self._lock:
                    state   = self._read_state()
                    state   = self._refill(state)
                    now     = time.time()

                    # Cek cooldown global (dari penalize)
                    cooldown_remaining = state.get("cooldown_until", 0.0) - now
                    if cooldown_remaining > 0:
                        wait_needed = cooldown_remaining
                    elif state["tokens"] >= 1.0:
                        # Konsumsi 1 token
                        state["tokens"] -= 1.0
                        self._write_state(state)
                        return  # ✅ Dapat token
                    else:
                        # Hitung waktu sampai 1 token tersedia
                        wait_needed = max(
                            _MIN_WAIT_SEC,
                            (1.0 - state["tokens"]) / state["rate"],
                        )
                        wait_needed = min(wait_needed, 5.0)  # max 5s per iterasi
            except FileLockTimeout:
                wait_needed = 1.0  # Jika lock timeout, tunggu sebentar dan coba lagi

            time.sleep(wait_needed)

    async def acquire_async(self) -> None:
        """
        Async-friendly acquire — yield kontrol ke event loop saat menunggu.
        Gunakan ini dari dalam coroutine asyncio.
        """
        while True:
            wait_needed = 0.0

            try:
                with self._lock:
                    state   = self._read_state()
                    state   = self._refill(state)
                    now     = time.time()

                    cooldown_remaining = state.get("cooldown_until", 0.0) - now
                    if cooldown_remaining > 0:
                        wait_needed = min(cooldown_remaining, 5.0)
                    elif state["tokens"] >= 1.0:
                        state["tokens"] -= 1.0
                        self._write_state(state)
                        return  # ✅ Dapat token
                    else:
                        wait_needed = max(
                            _MIN_WAIT_SEC,
                            (1.0 - state["tokens"]) / state["rate"],
                        )
                        wait_needed = min(wait_needed, 5.0)
            except FileLockTimeout:
                wait_needed = 1.0

            await asyncio.sleep(wait_needed)

    def status(self) -> dict:
        """Return snapshot status saat ini (untuk logging/debug)."""
        try:
            with self._lock:
                state = self._read_state()
                state = self._refill(state)
                return {
                    "tokens":          round(state["tokens"], 2),
                    "cooldown_until":  state.get("cooldown_until", 0.0),
                    "cooldown_remaining": max(0.0, state.get("cooldown_until", 0.0) - time.time()),
                    "rate":            state["rate"],
                    "capacity":        state["capacity"],
                }
        except FileLockTimeout:
            return {}


# ── Checkpoint Helper ─────────────────────────────────────────────────────────

class Checkpoint:
    """
    Simpan/baca daftar accountNumber yang sudah selesai diproses.
    Dipakai bersama oleh semua worker (filelock protected).

    Penggunaan (dalam worker):
        ckpt = Checkpoint(checkpoint_path)
        if ckpt.is_done(acc_num):
            print("Skip (already done)")
            continue
        # ... proses akun ...
        ckpt.mark_done(acc_num)
    """

    def __init__(self, checkpoint_path: str | Path):
        self._path      = Path(checkpoint_path)
        self._lock_path = Path(str(checkpoint_path) + ".lock")
        self._lock      = FileLock(str(self._lock_path), timeout=_LOCK_TIMEOUT_SEC)

    def _read(self) -> set[str]:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                return set(data.get("done", []))
            except Exception:
                pass
        return set()

    def _write(self, done: set[str]) -> None:
        self._path.write_text(
            json.dumps({"done": sorted(done)}, indent=2), encoding="utf-8"
        )

    def is_done(self, acc_num: str) -> bool:
        """Return True jika akun sudah diproses sebelumnya."""
        try:
            with self._lock:
                return acc_num in self._read()
        except FileLockTimeout:
            return False  # Jika tidak bisa lock, anggap belum selesai (safe default)

    def mark_done(self, acc_num: str) -> None:
        """Tandai akun sebagai selesai diproses."""
        try:
            with self._lock:
                done = self._read()
                done.add(acc_num)
                self._write(done)
        except FileLockTimeout:
            pass  # Non-fatal: akun mungkin diproses ulang jika restart

    def count(self) -> int:
        """Return jumlah akun yang sudah selesai."""
        try:
            with self._lock:
                return len(self._read())
        except FileLockTimeout:
            return 0

    def clear(self) -> None:
        """Hapus checkpoint (mulai dari nol)."""
        try:
            with self._lock:
                self._write(set())
        except FileLockTimeout:
            pass


# ── Self-test (jalankan langsung: python ratelimit.py) ───────────────────────

if __name__ == "__main__":
    import tempfile
    import threading

    print("=" * 55)
    print("  SharedRateLimiter Self-Test")
    print("=" * 55)

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        state_path = tmp.name

    limiter = SharedRateLimiter(state_path, rate=2.0, capacity=3)
    limiter.reset()

    # Test 1: Acquire 3 token (langsung, karena bucket penuh)
    print("\n[Test 1] Acquire 3 token dari bucket penuh:")
    for i in range(3):
        t0 = time.time()
        limiter.acquire()
        print(f"  Token {i+1} diperoleh dalam {time.time()-t0:.2f}s")

    # Test 2: Token habis — harus tunggu refill
    print("\n[Test 2] Token habis — acquire token ke-4 (harus tunggu ~0.5s):")
    t0 = time.time()
    limiter.acquire()
    waited = time.time() - t0
    print(f"  Token 4 diperoleh dalam {waited:.2f}s (expected ~0.5s)")
    assert waited >= 0.3, f"Terlalu cepat: {waited:.2f}s"

    # Test 3: Penalize
    print("\n[Test 3] Penalize 3s — acquire berikutnya harus menunggu:")
    limiter.penalize(3.0)
    t0 = time.time()
    limiter.acquire()
    waited = time.time() - t0
    print(f"  Acquire setelah penalize: {waited:.2f}s (expected ~3s)")
    assert waited >= 2.5, f"Penalize tidak efektif: {waited:.2f}s"

    # Test 4: Checkpoint
    print("\n[Test 4] Checkpoint:")
    ckpt = Checkpoint(state_path + ".ckpt.json")
    ckpt.clear()
    assert not ckpt.is_done("ACC-001")
    ckpt.mark_done("ACC-001")
    assert ckpt.is_done("ACC-001")
    assert not ckpt.is_done("ACC-002")
    print(f"  mark_done/is_done: OK  ({ckpt.count()} done)")

    # Test 5: Thread safety
    print("\n[Test 5] Thread safety (5 thread × 2 acquire):")
    limiter2 = SharedRateLimiter(state_path, rate=4.0, capacity=10)
    limiter2.reset()
    results = []
    def worker_thread(tid):
        for _ in range(2):
            limiter2.acquire()
            results.append(tid)

    threads = [threading.Thread(target=worker_thread, args=(i,)) for i in range(5)]
    t0 = time.time()
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"  10 acquire selesai dalam {time.time()-t0:.2f}s, results count={len(results)}")
    assert len(results) == 10

    # Cleanup
    Path(state_path).unlink(missing_ok=True)
    Path(state_path + ".lock").unlink(missing_ok=True)
    Path(state_path + ".ckpt.json").unlink(missing_ok=True)
    Path(state_path + ".ckpt.json.lock").unlink(missing_ok=True)

    print("\n" + "=" * 55)
    print("  Semua test LULUS [OK]")
    print("=" * 55)
