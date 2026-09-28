"""
scrape_starlink.py
===================
Worker scraper Starlink — output ke MySQL dan/atau JSON.

Status KIT (4 kondisi):
  active     — Online, bebas akses internet
  restricted — Online tapi ada banner Restricted for Business/Enterprise
  suspended  — Akun/KIT ditangguhkan / terminated
  inactive   — KIT offline

Mode:
  Standalone : python scrape_starlink.py
  Worker     : python scrape_starlink.py --worker-id 0 --start-idx 0 --end-idx 20
                --accounts-json accounts_list.json --output-json result_0.json
"""

import argparse
import asyncio
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright, Page
from playwright_stealth import Stealth

try:
    from ratelimit import SharedRateLimiter, Checkpoint, retry_after_seconds
except ImportError:
    # Fallback jika dijalankan dari direktori lain
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from ratelimit import SharedRateLimiter, Checkpoint, retry_after_seconds


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
    "state_file": _get_state_file(),
    "output_json": os.getenv("STARLINK_OUTPUT_JSON", "starlink_export.json"),
    "save_to_db": os.getenv("SAVE_TO_DB", "false").lower() in ("true", "1", "yes"),
}

# ── Restriction Detection (Business/Enterprise use ONLY) ──────────────────
_RESTRICTION_TEXT_KEYWORDS = [
    "restricted for business",
    "restricted for enterprise",
    "your service line is restricted",
    "high-speed service has been restricted",
    "restricted for business or enterprise use",
    "business or enterprise use",
    "commercial use restriction",
    "upgrade your plan to resume high-speed service",
    "in violation of our terms of service",
    "violation of our terms of service",
]

# ── Suspended/Terminated Detection ────────────────────────────────────────
_SUSPEND_TEXT_KEYWORDS = [
    "account has been suspended",
    "service has been suspended",
    "service has been terminated",
    "account suspended",
    "your account is suspended",
    "service suspended",
    "service terminated",
]

_RESTRICTION_BOOL_FIELDS = {
    "restricted", "isRestricted", "restricted_for_resale",
    "restrictedForResale", "isServiceRestricted", "serviceRestricted",
    "restrictedForEnterprise", "isEnterpriseRestricted",
    "throttled", "isThrottled", "isRestrictedForBusiness",
}

_RESTRICTION_CODE_FIELDS = {
    "restrictionCode", "restriction_code", "restrictionState",
    "restriction_state", "restrictionReason", "restriction_reason",
    "restrictionType", "restriction_type", "violationType",
    "restrictionDescription", "restrictionMessage", "policyViolation",
}

_RESTRICTION_CODE_NEGATIVE = {
    "", "none", "null", "no_restriction", "unrestricted", "active",
    "no_restrictions", "not_restricted", "false", "0",
}

_SUSPEND_STATUS_VALUES = {
    # Real suspend / termination states only (strings)
    "suspended", "terminated", "billing_suspended", "suspend",
}

# Fields whose VALUE indicates suspend/terminate state
_SUSPEND_FIELDS = {
    # Account-level
    "accountStatus", "account_status",
    # Service / subscription level (Starlink REST API variants)
    "serviceStatus", "service_status",
    "subscriptionStatus", "subscription_status",
    "serviceLineStatus", "service_line_status",
    "status", "lineStatus", "line_status",
    "lifecycleState", "lifecycle_state",
    "billingStatus", "billing_status",
}

# Boolean fields where True == suspended
_SUSPEND_TRUE_BOOL_FIELDS = {
    "isTerminated", "is_terminated",
    "isSuspended", "is_suspended",
    "isBillingSuspended", "is_billing_suspended",
    "suspended",
}


@dataclass
class KitRow:
    no: int
    controller: str
    code: str
    site: str
    sn: str
    kit: str
    status: str              # 'active' | 'restricted' | 'suspended' | 'inactive'
    quota: str
    restriction_detail: str
    scraped_at: str


def _deep_scan_json(data, depth: int = 0) -> tuple:
    """Scan JSON rekursif untuk deteksi banner restriction Business/Enterprise ToS. Return (is_restricted, detail)."""
    if depth > 8:
        return False, ""

    if isinstance(data, dict):
        for key, val in data.items():
            key_lower = key.lower()

            # 1. Cek string value yang mengandung kata kunci banner
            if isinstance(val, str) and len(val) > 3:
                val_lower = val.lower()
                for kw in _RESTRICTION_TEXT_KEYWORDS:
                    if kw in val_lower:
                        return True, f"Banner ToS ({key}: '{val[:100]}')"

            # 2. Cek boolean restriction fields
            if key in _RESTRICTION_BOOL_FIELDS or key_lower in {f.lower() for f in _RESTRICTION_BOOL_FIELDS}:
                if val is True or (isinstance(val, str) and val.strip().lower() == "true"):
                    return True, f"Restricted ({key}={val})"

            # 3. Cek code/state/reason fields
            if key in _RESTRICTION_CODE_FIELDS or key_lower in {f.lower() for f in _RESTRICTION_CODE_FIELDS}:
                if isinstance(val, str) and val.strip().lower() not in _RESTRICTION_CODE_NEGATIVE:
                    return True, f"Restricted ToS ({key}='{val}')"

            if isinstance(val, (dict, list)):
                found, detail = _deep_scan_json(val, depth + 1)
                if found:
                    return True, detail

    elif isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                item_lower = item.lower()
                for kw in _RESTRICTION_TEXT_KEYWORDS:
                    if kw in item_lower:
                        return True, f"Banner ToS ('{item[:100]}')"
            elif isinstance(item, (dict, list)):
                found, detail = _deep_scan_json(item, depth + 1)
                if found:
                    return True, detail

    return False, ""


def _deep_scan_suspend(data, depth: int = 0) -> tuple:
    """Scan JSON rekursif untuk deteksi suspend/terminated riil. Return (is_suspended, detail)."""
    if depth > 6:
        return False, ""

    if isinstance(data, dict):
        for key, val in data.items():
            key_lower = key.lower()

            # 1. Cek boolean flag suspended riil (isTerminated, isSuspended, suspended)
            if key in _SUSPEND_TRUE_BOOL_FIELDS or key_lower in {f.lower() for f in _SUSPEND_TRUE_BOOL_FIELDS}:
                if val is True or (isinstance(val, str) and val.strip().lower() in ("true", "1", "yes")):
                    return True, f"field '{key}' = True"

            # 2. Cek status field suspend riil (accountStatus/serviceStatus/status = 'suspended' atau status enum 9)
            if key in _SUSPEND_FIELDS or key_lower in {f.lower() for f in _SUSPEND_FIELDS}:
                if val in (9, "9"):
                    return True, f"field '{key}' = 9 (suspended)"
                if isinstance(val, str) and val.strip().lower() in _SUSPEND_STATUS_VALUES:
                    return True, f"field '{key}' = '{val}'"

            if isinstance(val, (dict, list)):
                found, det = _deep_scan_suspend(val, depth + 1)
                if found:
                    return True, det

    elif isinstance(data, list):
        for item in data:
            if isinstance(item, (dict, list)):
                found, det = _deep_scan_suspend(item, depth + 1)
                if found:
                    return True, det

    return False, ""


def _scan_text_restriction(text: str) -> tuple:
    """Cek teks DOM untuk banner restriction Business/Enterprise."""
    tl = text.lower()
    for kw in _RESTRICTION_TEXT_KEYWORDS:
        if kw in tl:
            return True, f"banner: '{kw}'"
    return False, ""


def _scan_text_suspend(text: str) -> tuple:
    """Cek teks DOM untuk banner suspended/terminated."""
    tl = text.lower()
    for kw in _SUSPEND_TEXT_KEYWORDS:
        if kw in tl:
            return True, f"banner: '{kw}'"
    return False, ""


async def _check_page_status(page: Page) -> tuple:
    """
    Scan DOM halaman untuk banner restriction DAN suspend pada elemen alert/banner resmi.
    Return: (status: 'active'|'restricted'|'suspended', detail: str)
    """
    selectors = [
        ".MuiAlert-root", "[role='alert']",
        "[class*='Alert']", "[class*='Banner']",
        "[class*='alert']", "[class*='banner']",
        "[class*='Notice']", "[class*='notification']",
    ]

    collected_texts = []
    for sel in selectors:
        try:
            elements = page.locator(sel)
            count = await elements.count()
            for i in range(min(count, 10)):
                try:
                    text = (await elements.nth(i).inner_text(timeout=1200)).strip()
                    if text:
                        collected_texts.append(text)
                except Exception:
                    pass
        except Exception:
            pass

    for text in collected_texts:
        # Cek suspend TERLEBIH DAHULU (lebih kritis)
        is_susp, det_susp = _scan_text_suspend(text)
        if is_susp:
            return "suspended", det_susp
        # Cek restriction
        is_restr, det_restr = _scan_text_restriction(text)
        if is_restr:
            return "restricted", det_restr

    return "active", ""


async def _fetch_json(
    page: Page,
    url: str,
    max_retries: int = 4,
    label: str = "",
    limiter: "SharedRateLimiter | None" = None,
) -> dict | None:
    """Fetch JSON dengan retry + exponential backoff pada rate limit."""
    for attempt in range(max_retries):
        try:
            if limiter:
                await limiter.acquire_async()
            res = await page.request.get(url, timeout=15000)
            if res.status == 429:
                ra = retry_after_seconds(dict(res.headers)) if limiter else None
                wait = ra or (25 * (attempt + 1))
                print(f"  [Rate Limit 429] {label or url} -- cooldown {wait:.0f}s...", flush=True)
                if limiter:
                    await limiter.penalize_async(wait)
                await asyncio.sleep(wait)
                continue
            if res.status == 200:
                return await res.json()
            print(f"  [HTTP {res.status}] {label or url}", flush=True)
            return None
        except Exception as ex:
            print(f"  [Error] {label or url}: {ex}", flush=True)
            await asyncio.sleep(3)
    return None


def _resolve_kit_status(
    api_active: bool,
    json_data: dict,
    page_status: str = "active",
    home_page_status: str = "active",
    has_traffic: bool = False,
) -> tuple:
    """
    Tentukan status akhir KIT di level TERMINAL dari semua sumber data.
    Return: (status: str, detail: str)

    Status:
      - 'restricted' : banner Business/Enterprise ToS terdeteksi di DOM ATAU
                       field JSON eksplisit (restricted=true, restrictionCode, dll.)
      - 'suspended'  : akun/KIT ditangguhkan
      - 'inactive'   : api_active=False (terminal tidak aktif/offline)
      - 'active'     : normal
    """
    # 1. Cek restriction dari DOM page (banner ToS) — prioritas ToS
    if home_page_status == "restricted" or page_status == "restricted":
        return "restricted", "Your service line is restricted for Business or Enterprise use in violation of our Terms of Service."

    # 2. Cek deep scan JSON untuk field restriction eksplisit
    is_restr_json, det_restr = _deep_scan_json(json_data)
    if is_restr_json:
        return "restricted", det_restr

    # 3. Cek suspend dari DOM / deep scan JSON (jangan biarkan traffic meng-override suspend)
    if home_page_status == "suspended" or page_status == "suspended":
        return "suspended", "DOM: account/service suspended"

    is_susp_json, det_susp = _deep_scan_suspend(json_data)
    if is_susp_json:
        return "suspended", det_susp

    # 4. Cek inactive (KIT offline)
    if not api_active:
        return "inactive", ""

    return "active", ""


async def _fetch_sl_data(
    page: Page,
    acc_num: str,
    sl: str,
    sl_meta: dict | None,
    home_page_status: str,
    limiter: "SharedRateLimiter | None" = None,
) -> tuple:
    """
    Return: (quota_str, status, restriction_detail)
    status: 'active' | 'restricted' | 'suspended' | 'inactive'
    """
    quota_str = "-"
    consumed = 0.0

    # 1. Quota via telemetry API
    try:
        q_url = (
            f"https://starlink.com/api/telemetryagg/v1/data-usage/account"
            f"/{acc_num}/service-line/{sl}/annotated"
        )
        if limiter:
            await limiter.acquire_async()
        res = await page.request.get(q_url, timeout=10000)
        if res.status == 429:
            ra = retry_after_seconds(dict(res.headers)) if limiter else None
            wait = ra or 30.0
            print(f"    [429] Kuota {sl} -- cooldown {wait:.0f}s...", flush=True)
            if limiter:
                await limiter.penalize_async(wait)
            await asyncio.sleep(wait)
        elif res.status == 200:
            d = await res.json()
            cycles = d.get("content", {}).get("billingCyclesAnnotated", [])
            if cycles:
                curr = cycles[-1]
                lines = curr.get("dataUsageSummaryLines", [])
                consumed = (
                    (lines[0].get("consumedAmountGB", 0) or 0)
                    if lines
                    else (curr.get("totalAmountGB", 0) or 0)
                )
                quota_str = f"{consumed / 1024:.2f} TB" if consumed >= 1000 else f"{consumed:.2f} GB"
    except Exception as e:
        print(f"    [!] Error fetch kuota {sl}: {e}", flush=True)

    # 2. Ambil metadata service-line
    meta = sl_meta or {}
    net_status = meta.get("networkStatus")
    sl_status_val = meta.get("status")

    # 3. Fetch detail service-line jika metadata belum lengkap
    if (net_status is None or "subscription" not in meta) and sl:
        sl_det = await _fetch_json(
            page,
            f"https://starlink.com/api/webagg/v2/accounts/service-line/{sl}",
            label=f"SL detail {sl}",
            limiter=limiter,
        )
        if sl_det:
            c = sl_det.get("content", {}) or {}
            c_net = c.get("networkStatus")
            if c_net is not None:
                net_status = c_net
            meta = {**meta, **c}
            if meta.get("status") is not None:
                sl_status_val = meta.get("status")

    # 4. Resolve status akhir secara hierarkis:
    sub = meta.get("subscription") if isinstance(meta.get("subscription"), dict) else {}
    sub_status_val = sub.get("status") or sub.get("subscriptionStatus")

    # A. Cek restriction (banner DOM atau networkStatus > 1 ToS)
    if home_page_status == "restricted":
        return quota_str, "restricted", "Your service line is restricted for Business or Enterprise use in violation of our Terms of Service."

    if net_status is not None and net_status > 1:
        return (
            quota_str,
            "restricted",
            "Your service line is restricted for Business or Enterprise use in violation of our Terms of Service.",
        )

    is_restr, det_restr = _deep_scan_json(meta)
    if is_restr:
        return quota_str, "restricted", det_restr

    # B. Cek suspended (Akun / Service Line / Subscription ditangguhkan)
    if home_page_status == "suspended":
        return quota_str, "suspended", "account/service suspended"

    # Periksa status numerik (enum 9 = Suspended) atau string suspended
    if sl_status_val in (9, "9") or str(sl_status_val).lower() in _SUSPEND_STATUS_VALUES:
        return quota_str, "suspended", f"Service line suspended ({sl_status_val})"

    if sub_status_val in (9, "9") or str(sub_status_val).lower() in _SUSPEND_STATUS_VALUES:
        return quota_str, "suspended", f"Subscription suspended ({sub_status_val})"

    if sub.get("isSuspended") is True or sub.get("suspended") is True:
        return quota_str, "suspended", "Subscription suspended"

    if meta.get("isSuspended") is True or meta.get("suspended") is True:
        return quota_str, "suspended", "Service line suspended"

    is_susp_meta, det_susp_meta = _deep_scan_suspend(meta)
    if is_susp_meta:
        return quota_str, "suspended", det_susp_meta

    is_susp_sub, det_susp_sub = _deep_scan_suspend(sub)
    if is_susp_sub:
        return quota_str, "suspended", det_susp_sub

    # C. Cek status Paused / Cancelled / Inactive (Kit tidak terpakai lagi)
    if sub.get("isPaused") is True or str(sub_status_val).lower() == "paused" or str(sl_status_val).lower() == "paused":
        return quota_str, "inactive", "Subscription paused"

    if str(sub_status_val).lower() in ("inactive", "cancelled", "canceled", "deactivated"):
        return quota_str, "inactive", "Subscription inactive"

    if str(sl_status_val).lower() in ("inactive", "cancelled", "canceled", "deactivated"):
        return quota_str, "inactive", f"Service line {sl_status_val}"

    if sub.get("active") is False or meta.get("active") is False:
        return quota_str, "inactive", "Subscription inactive"

    return quota_str, "active", ""


async def launch_browser(p):
    """Launch browser — support Windows lokal (Google Chrome) dan Linux VPS (Chromium)."""
    headless_env = os.getenv("HEADLESS", "true").strip().lower()
    is_headless = headless_env in ("true", "1", "yes")
    launch_args = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
    ]
    try:
        return await p.chromium.launch(
            headless=is_headless, channel="chrome",
            args=launch_args, ignore_default_args=["--enable-automation"],
        )
    except Exception:
        return await p.chromium.launch(
            headless=is_headless, args=launch_args,
            ignore_default_args=["--enable-automation"],
        )


async def _safe_goto(page, url: str, max_retries: int = 3, timeout_ms: int = 30000) -> bool:
    """Navigasi halaman dengan auto-cooldown jika terkena rate limit / ERR_HTTP_RESPONSE_CODE_FAILURE."""
    for attempt in range(max_retries):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            return True
        except Exception as e:
            err_str = str(e)
            if "ERR_HTTP_RESPONSE_CODE_FAILURE" in err_str or "429" in err_str:
                wait_sec = 8 * (attempt + 1)
                print(f"  [Rate Limit / 429 Navigasi] Cooldown {wait_sec}s...", flush=True)
                await asyncio.sleep(wait_sec)
            else:
                await asyncio.sleep(2)
    return False


async def scrape_accounts(
    accounts: list,
    state_file: Path | None = None,
    worker_id: int = 0,
    headless: bool = True,
    dashboard_url: str | None = None,
    limiter: "SharedRateLimiter | None" = None,
    checkpoint: "Checkpoint | None" = None,
    all_accounts: list | None = None,
) -> list[KitRow]:
    state_file    = state_file    or CONFIG["state_file"]
    dashboard_url = dashboard_url or CONFIG["dashboard_url"]

    rows: list[KitRow] = []
    scraped_at = datetime.now(timezone.utc).isoformat()

    # Mapping lengkap accountNumber -> accountName untuk verifikasi ketepatan controller
    acc_list = all_accounts or accounts
    acc_map = {
        a.get("accountNumber", "").strip(): a.get("accountName", "").strip()
        for a in acc_list if a.get("accountNumber")
    }

    print("=" * 65)
    print(f"[W{worker_id}] Menghubungkan ke dashboard Starlink...")

    async with async_playwright() as p:
        browser = await launch_browser(p)
        context = await browser.new_context(
            storage_state=str(state_file),
            viewport={"width": 1280, "height": 800},
        )
        await Stealth().apply_stealth_async(context)
        page = await context.new_page()

        try:
            await _safe_goto(page, dashboard_url, max_retries=3, timeout_ms=45000)
            await page.wait_for_timeout(1000)
            await context.storage_state(path=str(state_file))
        except Exception as ex:
            print(f"[W{worker_id}] [Info] Navigasi awal: {ex}", flush=True)

        home_page_status, home_detail = await _check_page_status(page)

        total_acc = len(accounts)
        for idx, acc in enumerate(accounts, start=1):
            try:
                acc_num  = acc.get("accountNumber", "").strip()
                acc_name = acc.get("accountName", "").strip()

                # ── Checkpoint: skip akun yang sudah selesai ──────────────
                if checkpoint and checkpoint.is_done(acc_num):
                    print(f"\n[W{worker_id}] [{idx}/{total_acc}] SKIP (checkpoint): {acc_name} ({acc_num})", flush=True)
                    continue

                print(f"\n[W{worker_id}] [{idx}/{total_acc}] Memproses: {acc_name} ({acc_num})", flush=True)

                # ── Fast UI Account Switching ──────────────────────────────
                switched = (len(accounts) == 1)
                if len(accounts) > 1:
                    for attempt in range(3):
                        try:
                            await page.keyboard.press("Escape")
                            await page.wait_for_timeout(150)

                            profile_btn = page.locator('button[aria-label="User profile"]')
                            if await profile_btn.count() == 0 or not await profile_btn.is_visible():
                                if limiter:
                                    await limiter.acquire_async()
                                await _safe_goto(page, dashboard_url, max_retries=2, timeout_ms=25000)
                                await page.wait_for_timeout(1000)

                            await profile_btn.wait_for(state="visible", timeout=8000)
                            await profile_btn.click()
                            await page.wait_for_timeout(350)

                            acc_item = page.locator("li.MuiMenuItem-root").filter(has_text="ACC-").first
                            await acc_item.wait_for(state="visible", timeout=6000)
                            await acc_item.click()
                            await page.wait_for_timeout(400)

                            opt = page.locator(f'li[role="option"][value="{acc_num}"]')
                            if await opt.count() > 0:
                                await opt.click(timeout=6000)
                                # Verifikasi pergantian akun via cookie (tunggu hingga 5 detik)
                                for _ in range(25):
                                    await asyncio.sleep(0.2)
                                    cookies = await context.cookies()
                                    cur_acc = next((c["value"] for c in cookies if c["name"] == "starlink.com.account_number"), None)
                                    if cur_acc == acc_num:
                                        switched = True
                                        break
                                if switched:
                                    # Jeda ekstra agar token Starlink.Com.Access.V1 selesai terupdate
                                    await page.wait_for_timeout(1000)
                                    break
                                else:
                                    print(f"[W{worker_id}]   [Peringatan] Cookie akun belum berganti ke {acc_num} setelah klik.")
                            else:
                                print(f"[W{worker_id}]   [Info] {acc_num} tidak ada di dropdown.")
                                await page.keyboard.press("Escape")
                                break
                        except Exception as e:
                            if attempt < 2:
                                wait_s = 2 * (attempt + 1)
                                print(f"[W{worker_id}]   [Retry {attempt+1}] Switcher: {e} (cooldown {wait_s}s)...", flush=True)
                                await asyncio.sleep(wait_s)
                                await _safe_goto(page, dashboard_url, max_retries=2, timeout_ms=25000)
                                await page.wait_for_timeout(1000)
                            else:
                                print(f"[W{worker_id}]   [Peringatan] Skip switcher: {e}", flush=True)

                if not switched and len(accounts) > 1:
                    print(f"[W{worker_id}]   [Skip] {acc_name} ({acc_num}) switcher gagal. Melewati untuk mencegah data tertukar.", flush=True)
                    continue

                # Proteksi ganda: verifikasi cookie akun sebelum mengambil user-terminals
                cur_cookies = await context.cookies()
                cur_active_acc = next((c["value"] for c in cur_cookies if c["name"] == "starlink.com.account_number"), None)
                if cur_active_acc and cur_active_acc != acc_num:
                    print(f"[W{worker_id}]   [Batal] Cookie sesi ({cur_active_acc}) tidak cocok dengan target ({acc_num}). Melewati untuk mencegah data tertukar!", flush=True)
                    continue

                # ── Ambil terminals via /user-terminals ───────────────────
                max_retries = 3
                terminals_found = False

                for attempt in range(max_retries):
                    try:
                        if limiter:
                            await limiter.acquire_async()
                        ut_res = await page.request.get(
                            "https://starlink.com/api/webagg/v2/accounts/user-terminals",
                            timeout=15000,
                        )
                        if ut_res.status == 401:
                            print(f"[W{worker_id}]   [401] Sesi perlu refresh via SSO...", flush=True)
                            await _safe_goto(page, dashboard_url, max_retries=2, timeout_ms=25000)
                            await context.add_cookies([
                                {"name": "starlink.com.account_number", "value": acc_num, "domain": "starlink.com", "path": "/"}
                            ])
                            continue

                        if ut_res.status == 429:
                            ra = retry_after_seconds(dict(ut_res.headers)) if limiter else None
                            is_envoy = ut_res.headers.get("x-envoy-ratelimited") == "true"
                            wait_sec = ra or (60.0 if is_envoy else (15 * (attempt + 1)))
                            print(f"[W{worker_id}]   [429] user-terminals -- cooldown {wait_sec:.0f}s...", flush=True)
                            if limiter:
                                await limiter.penalize_async(wait_sec)
                            await asyncio.sleep(wait_sec)
                            continue

                        if ut_res.status == 200:
                            ut_data    = await ut_res.json()
                            ut_results = ut_data.get("content", {}).get("results", [])

                            if ut_results:
                                terminals_found = True
                                print(f"[W{worker_id}]   {len(ut_results)} terminal ditemukan.", flush=True)

                                # Ambil service-lines metadata
                                sl_map: dict[str, dict] = {}
                                for p_idx in range(3):
                                    sl_res_data = await _fetch_json(
                                        page,
                                        f"https://starlink.com/api/webagg/v2/accounts/service-lines?page={p_idx}&limit=100",
                                        label=f"SL list p{p_idx}",
                                        limiter=limiter,
                                    )
                                    if not sl_res_data:
                                        break
                                    items = sl_res_data.get("content", {}).get("results", [])
                                    for item in items:
                                        sln = item.get("serviceLineNumber")
                                        if sln:
                                            sl_map[sln] = item
                                    if len(items) < 100:
                                        break

                                if len(sl_map) == 0:
                                    print(f"[W{worker_id}]   [Info] {acc_name} ({acc_num}) tidak memiliki subscription (0 service lines). Melewati.", flush=True)
                                    if checkpoint:
                                        checkpoint.mark_done(acc_num)
                                    break

                                # Process unique service lines secara paralel (asyncio.gather)
                                unique_sls = list(dict.fromkeys(
                                    t.get("serviceLineNumber")
                                    for t in ut_results
                                    if t.get("serviceLineNumber") and t.get("serviceLineNumber") in sl_map
                                ))

                                async def _process_single_sl(sl_key: str):
                                    sl_item = sl_map.get(sl_key, {})
                                    site_name = sl_item.get("nickname") or sl_item.get("displayName") or sl_key
                                    quota, sl_status, sl_det = await _fetch_sl_data(
                                        page, acc_num, sl_key, sl_item, home_page_status, limiter=limiter
                                    )
                                    return sl_key, (site_name, quota, sl_status, sl_det)

                                sl_tasks = [_process_single_sl(sl) for sl in unique_sls]
                                sl_results_list = await asyncio.gather(*sl_tasks)
                                sl_info = dict(sl_results_list)

                                # Tulis baris per terminal
                                for t in ut_results:
                                    kit    = t.get("kitSerialNumber") or "-"
                                    sn     = t.get("dishSerialNumber") or "-"
                                    sl_num = t.get("serviceLineNumber") or ""
                                    t_nick = (t.get("nickname") or "").strip()
                                    api_active = bool(t.get("active"))

                                    # Validasi kepemilikan service-line untuk mencegah crosstalk antar akun
                                    t_sl_item = sl_map.get(sl_num, {})
                                    sl_acc_ref = t_sl_item.get("accountReferenceId") if isinstance(t_sl_item, dict) else None
                                    if sl_num not in sl_map:
                                        if sl_acc_ref and sl_acc_ref in acc_map:
                                            final_code = sl_acc_ref
                                            final_controller = acc_map[sl_acc_ref]
                                        else:
                                            # Terminal residu sesi yang tidak terdaftar di akun ini — jangan kaitkan!
                                            continue
                                    else:
                                        if sl_acc_ref and sl_acc_ref in acc_map:
                                            final_code = sl_acc_ref
                                            final_controller = acc_map[sl_acc_ref]
                                        else:
                                            final_code = acc_num
                                            final_controller = acc_name

                                    base_site, quota, sl_status, sl_det = sl_info.get(
                                        sl_num, (sl_num or "-", "-", "active", "")
                                    )
                                    site = t_nick or base_site or "-"
                                    has_data = bool(quota not in ("-", "0.00 GB", "0 GB", "0 MB", "0.0 GB"))

                                    # Status resolution:
                                    # - 'suspended': akun belum dibayar / kendala pembayaran billing
                                    # - 'restricted': pelanggaran ToS Enterprise/Business
                                    # - 'inactive': kit tidak terpakai lagi / subscription inactive di sub-akun
                                    # - 'active': normal
                                    if home_page_status == "suspended":
                                        final_status = "suspended"
                                        final_det    = home_detail or "DOM: account/billing suspended"
                                    elif sl_status == "suspended":
                                        final_status = "suspended"
                                        final_det    = sl_det or "Subscription suspended"
                                    elif sl_status == "restricted":
                                        final_status = "restricted"
                                        final_det    = sl_det
                                    elif sl_status == "inactive":
                                        final_status = "inactive"
                                        final_det    = sl_det or "Subscription inactive"
                                    elif not api_active:
                                        final_status = "inactive"
                                        final_det    = "Terminal offline"
                                    else:
                                        final_status = "active"
                                        final_det    = ""

                                    icon = {"restricted": "[! RESTRICTED]", "suspended": "[X SUSPENDED]",
                                             "inactive": "[- INACTIVE]"}.get(final_status, "[+ active]")
                                    print(f"[W{worker_id}]     {site} | {kit} | {icon} | {quota}", flush=True)

                                    rows.append(KitRow(
                                        no=0,
                                        controller=final_controller,
                                        code=final_code,
                                        site=site,
                                        sn=sn,
                                        kit=kit,
                                        status=final_status.lower(),
                                        quota=quota,
                                        restriction_detail=final_det,
                                        scraped_at=scraped_at,
                                    ))

                            break
                        else:
                            print(f"[W{worker_id}]   [HTTP {ut_res.status}] user-terminals")
                            break

                    except Exception as ex:
                        print(f"[W{worker_id}]   [Error] user-terminals: {ex}")
                        await asyncio.sleep(2)

                # ── Fallback: service-line-numbers ────────────────────────
                if not terminals_found:
                    service_lines = []
                    for attempt in range(max_retries):
                        try:
                            if limiter:
                                await limiter.acquire_async()
                            sl_res = await page.request.get(
                                "https://starlink.com/api/accounts/v1/accounts/service-line-numbers?Page=0&Limit=100",
                                timeout=15000,
                            )
                            if sl_res.status == 429:
                                ra = retry_after_seconds(dict(sl_res.headers)) if limiter else None
                                wait_sec = ra or (15 * (attempt + 1))
                                print(f"[W{worker_id}]   [429] SL-numbers -- cooldown {wait_sec:.0f}s...", flush=True)
                                if limiter:
                                    await limiter.penalize_async(wait_sec)
                                await asyncio.sleep(wait_sec)
                                continue
                            if sl_res.status == 200:
                                sl_data = await sl_res.json()
                                service_lines = sl_data.get("content", {}).get("results", [])
                                break
                        except Exception as ex:
                            print(f"[W{worker_id}]   [Error SL-numbers]: {ex}")
                            await asyncio.sleep(2)

                    if not service_lines:
                        print(f"[W{worker_id}]   Tidak ada terminal / SL aktif.")
                        rows.append(KitRow(
                            no=0, controller=acc_name, code=acc_num, site="-",
                            sn="-", kit="-",
                            status="inactive",
                            quota="-", restriction_detail="No active service line", scraped_at=scraped_at,
                        ))
                        continue

                    for sl in service_lines:
                        quota, sl_status, sl_det = await _fetch_sl_data(
                            page, acc_num, sl, {}, home_page_status, limiter=limiter
                        )
                        sl_det_json = await _fetch_json(
                            page,
                            f"https://starlink.com/api/webagg/v2/accounts/service-line/{sl}",
                            label=f"SL fallback {sl}",
                            limiter=limiter,
                        )

                        det_content = {}
                        site_name = sl
                        if sl_det_json:
                            det_content = sl_det_json.get("content", {}) or {}
                            site_name = det_content.get("nickname") or det_content.get("displayName") or sl

                        terminals = det_content.get("userTerminals", [])
                        has_data = bool(quota not in ("-", "0.00 GB", "0 GB", "0 MB", "0.0 GB"))
                        for t in terminals:
                            kit    = t.get("serialNumber") or t.get("kitSerialNumber") or "-"
                            sn     = t.get("dishSerialNumber") or "-"
                            api_active = bool(t.get("active"))
                            # Status resolution: suspended > restricted > inactive > active
                            t_status, t_det = _resolve_kit_status(
                                api_active, t, "active", home_page_status, has_traffic=has_data
                            )
                            if sl_status == "suspended":
                                t_status = "suspended"
                                t_det    = sl_det or "Subscription suspended"
                            elif sl_status == "restricted" and t_status != "suspended":
                                t_status = "restricted"
                                t_det    = sl_det
                            elif not api_active:
                                t_status = "inactive"
                                t_det    = ""
                            elif sl_status == "inactive" and t_status == "active":
                                t_status = "inactive"
                                t_det    = sl_det

                            sl_acc_ref = det_content.get("accountReferenceId") if isinstance(det_content, dict) else None
                            if sl_acc_ref and sl_acc_ref in acc_map:
                                final_code = sl_acc_ref
                                final_controller = acc_map[sl_acc_ref]
                            else:
                                final_code = acc_num
                                final_controller = acc_name

                            rows.append(KitRow(
                                no=0, controller=final_controller, code=final_code, site=t_site,
                                sn=sn, kit=kit,
                                status=t_status.lower(),
                                quota=quota, restriction_detail=t_det, scraped_at=scraped_at,
                            ))

                        if not terminals:
                            sl_acc_ref = det_content.get("accountReferenceId") if isinstance(det_content, dict) else None
                            if sl_acc_ref and sl_acc_ref in acc_map:
                                final_code = sl_acc_ref
                                final_controller = acc_map[sl_acc_ref]
                            else:
                                final_code = acc_num
                                final_controller = acc_name

                            rows.append(KitRow(
                                no=0, controller=final_controller, code=final_code, site=site_name,
                                sn="-", kit="-", status=sl_status, quota=quota,
                                restriction_detail=sl_det, scraped_at=scraped_at,
                            ))

            except Exception as acc_err:
                print(f"[W{worker_id}]   [Error Akun {acc_name}]: {acc_err}", flush=True)
                await asyncio.sleep(1)
            else:
                # ── Checkpoint: tandai akun selesai ──────────────────────
                if checkpoint and acc_num:
                    checkpoint.mark_done(acc_num)

            await asyncio.sleep(0.1)

        await browser.close()

    return rows


async def main(args):
    if getattr(args, "state_file", None):
        state_file = Path(args.state_file)
    else:
        state_file = CONFIG["state_file"]
    if not state_file.exists():
        raise SystemExit(
            f"'{state_file}' tidak ditemukan. Jalankan login_vps.py terlebih dahulu."
        )

    # ── Worker Mode ──────────────────────────────────────────────────
    if args.accounts_json and args.output_json:
        accounts_path = Path(args.accounts_json)
        all_accounts = json.loads(accounts_path.read_text(encoding="utf-8"))
        start = args.start_idx
        end   = args.end_idx if args.end_idx is not None else len(all_accounts)
        subset = all_accounts[start:end]

        # Setup shared limiter + checkpoint jika path disediakan
        limiter    = SharedRateLimiter(args.rate_state)    if args.rate_state    else None
        checkpoint = Checkpoint(args.checkpoint_file)      if args.checkpoint_file else None

        if limiter:
            print(f"[W{args.worker_id}] Rate limiter aktif: {args.rate_state}", flush=True)
        if checkpoint:
            done_count = checkpoint.count()
            print(f"[W{args.worker_id}] Checkpoint aktif: {done_count} akun sudah selesai.", flush=True)

        print("=" * 65)
        try:
            rows = await scrape_accounts(
                subset, state_file,
                worker_id=args.worker_id,
                limiter=limiter,
                checkpoint=checkpoint,
                all_accounts=all_accounts,
            )
        except Exception as e:
            print(f"[W{args.worker_id}] [Fatal Error] {e}", flush=True)
            rows = []

        output = [asdict(r) for r in rows]
        Path(args.output_json).write_text(
            json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n[W{args.worker_id}] {len(rows)} baris -> {args.output_json}", flush=True)

        # Simpan ke DB jika dikonfigurasi
        if CONFIG["save_to_db"]:
            try:
                from db_writer import save_rows_to_db
                save_rows_to_db(output)
            except Exception as e:
                print(f"[W{args.worker_id}] [DB Error] {e}", flush=True)
        return

    # ── Standalone Mode ──────────────────────────────────────────────
    print("=" * 65)
    print("Memulai scraping Starlink (Standalone)...")
    print("=" * 65)

    async with async_playwright() as p:
        browser = await launch_browser(p)
        context = await browser.new_context(
            storage_state=str(state_file),
            viewport={"width": 1280, "height": 800},
        )
        await Stealth().apply_stealth_async(context)
        page = await context.new_page()

        print("\nMengambil daftar sub-account...")
        acc_resp = await page.request.get("https://starlink.com/api/accounts/v3/accounts/contact")
        if acc_resp.status == 401:
            await page.goto(CONFIG["dashboard_url"], wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            await context.storage_state(path=str(state_file))
            acc_resp = await page.request.get("https://starlink.com/api/accounts/v3/accounts/contact")

        if acc_resp.status != 200:
            raise SystemExit(f"Gagal memuat akun (HTTP {acc_resp.status}).")

        accounts = (await acc_resp.json()).get("content", [])
        print(f"Total sub-account: {len(accounts)}")
        await browser.close()

    rows = await scrape_accounts(accounts, state_file, worker_id=0)
    for i, r in enumerate(rows, start=1):
        r.no = i

    output_data = [asdict(r) for r in rows]
    out_path = Path(args.output_json or CONFIG["output_json"])
    out_path.write_text(json.dumps(output_data, ensure_ascii=False, indent=2), encoding="utf-8")

    stats = {"active": 0, "restricted": 0, "suspended": 0, "inactive": 0}
    for r in rows:
        stats[r.status] = stats.get(r.status, 0) + 1

    print(f"\n{'='*65}")
    for s, cnt in stats.items():
        icon = {"active":"[+ active]    ","restricted":"[! restricted]","suspended":"[X suspended] ","inactive":"[- inactive]  "}.get(s,"")
        print(f"  {icon} : {cnt}")
    print(f"{'='*65}")

    if CONFIG["save_to_db"]:
        try:
            from db_writer import save_rows_to_db
            save_rows_to_db(output_data)
        except Exception as e:
            print(f"[DB Error] {e}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Starlink Scraper")
    parser.add_argument("--worker-id",       type=int, default=0)
    parser.add_argument("--start-idx",       type=int, default=0)
    parser.add_argument("--end-idx",         type=int, default=None)
    parser.add_argument("--accounts-json",   type=str, default=None)
    parser.add_argument("--output-json",     type=str, default=None)
    parser.add_argument("--rate-state",      type=str, default=None,
                        help="Path ke file state rate limiter bersama (dari orchestrator)")
    parser.add_argument("--checkpoint-file", type=str, default=None,
                        help="Path ke file checkpoint bersama (dari orchestrator)")
    parser.add_argument("--state-file",      type=str, default=None,
                        help="Path ke file auth_state.json untuk akun ini")
    asyncio.run(main(parser.parse_args()))
