"""
login_service.py
================
Layanan login Starlink headless dengan relay OTP via WebSocket.
Mendukung isolasi multi-akun induk (parent accounts).
"""
import asyncio
import json
import os
import re
from pathlib import Path

from playwright.async_api import async_playwright
from playwright_stealth import Stealth


class LoginService:
    def __init__(self):
        self.state_file = Path(os.getenv("STARLINK_STATE_FILE", "/app/scraper/auth_state.json"))
        self.login_url  = os.getenv("STARLINK_LOGIN_URL",  "https://starlink.com/auth/login")
        self.home_url   = os.getenv("STARLINK_DASHBOARD_URL", "https://starlink.com/account/home")

    async def _send(self, ws, event: str, **kwargs):
        try:
            await ws.send_json({"event": event, **kwargs})
        except Exception:
            pass

    async def login(self, ws, email: str, password: str, parent_account_id: int = None):
        """Jalankan alur login headless bersih; relay OTP ke WebSocket client."""
        await self._send(ws, "status", message="Memulai browser headless...")

        # Tentukan file auth state per akun induk
        if parent_account_id:
            target_state_file = Path(f"/app/scraper/auth_state_{parent_account_id}.json")
        else:
            target_state_file = self.state_file

        async with async_playwright() as p:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ]
            try:
                browser = await p.chromium.launch(
                    headless=True,
                    channel="chrome",
                    args=launch_args,
                    ignore_default_args=["--enable-automation"],
                )
            except Exception:
                browser = await p.chromium.launch(
                    headless=True,
                    args=launch_args,
                    ignore_default_args=["--enable-automation"],
                )

            # Mulai konteks bersih tanpa session cookies akun lain
            ctx_kwargs = {
                "viewport": {"width": 1280, "height": 800},
                "user_agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
            }
            context = await browser.new_context(**ctx_kwargs)
            await Stealth().apply_stealth_async(context)
            page = await context.new_page()

            # 1. Buka halaman login
            await self._send(ws, "status", message=f"Membuka {self.login_url}...")
            try:
                await page.goto(self.login_url, wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                await self._send(ws, "status", message=f"Navigasi memuat halaman ({e}), melanjutkan...")
            await page.wait_for_timeout(3000)

            # Tutup/accept banner cookie OneTrust jika ada
            try:
                cookie_btn = page.locator(
                    '#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("Terima Semua")'
                ).first
                if await cookie_btn.count() > 0 and await cookie_btn.is_visible():
                    await cookie_btn.click()
                    await page.wait_for_timeout(600)
            except Exception:
                pass

            # 2. Cari input email yang terlihat (visible)
            await self._send(ws, "status", message=f"Mencari form login email...")
            email_loc = page.locator(
                'input[autocomplete="email"], input[type="email"], input[name="email"], input[id*="email" i]'
            )
            
            email_input = None
            for _ in range(25):
                if await email_loc.count() > 0:
                    for idx in range(await email_loc.count()):
                        cand = email_loc.nth(idx)
                        if await cand.is_visible():
                            email_input = cand
                            break
                if email_input:
                    break
                await page.wait_for_timeout(1000)

            # Fallback jika input email menggunakan input biasa
            if not email_input:
                fallback_loc = page.locator(
                    'input:not([type="hidden"]):not([type="password"]):not([id*="vendor"]):not([placeholder*="Search" i])'
                )
                if await fallback_loc.count() > 0:
                    for idx in range(await fallback_loc.count()):
                        cand = fallback_loc.nth(idx)
                        if await cand.is_visible():
                            email_input = cand
                            break

            if not email_input:
                body_txt = (await page.locator("body").inner_text())[:200].replace("\n", " ")
                await self._send(
                    ws,
                    "login_failed",
                    message=f"Input email tidak ditemukan pada URL ({page.url}): {body_txt}",
                )
                await browser.close()
                return

            await self._send(ws, "status", message=f"Mengisi email: {email}...")
            await email_input.click()
            await email_input.fill(email)
            await page.wait_for_timeout(600)

            # 3. Klik tombol Next / Lanjut
            next_btn = page.locator(
                'button[type="submit"], button:has-text("Next"), button:has-text("Sign In"), button:has-text("Lanjut")'
            ).first
            if await next_btn.count() > 0 and await next_btn.is_visible():
                await self._send(ws, "status", message="Mengklik tombol Lanjut/Next...")
                await next_btn.click()
                await page.wait_for_timeout(2500)

            # 4. Cari input password
            pwd_loc = page.locator('input[autocomplete="current-password"], input[type="password"]')
            pwd_input = None
            for _ in range(15):
                if await pwd_loc.count() > 0:
                    for idx in range(await pwd_loc.count()):
                        cand = pwd_loc.nth(idx)
                        if await cand.is_visible():
                            pwd_input = cand
                            break
                if pwd_input:
                    break
                await page.wait_for_timeout(1000)

            if not pwd_input:
                await self._send(ws, "login_failed", message="Input password tidak ditemukan setelah submit email.")
                await browser.close()
                return

            await self._send(ws, "status", message="Mengisi password...")
            await pwd_input.click()
            await pwd_input.fill(password)
            await page.wait_for_timeout(600)

            # 5. Klik Sign In
            sign_in_btn = page.locator(
                'button[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Masuk")'
            ).first
            if await sign_in_btn.count() > 0 and await sign_in_btn.is_visible():
                await sign_in_btn.click()
            else:
                await page.keyboard.press("Enter")
            await self._send(ws, "status", message="Mengirim formulir login ke Starlink...")

            # 6. Monitor respons: Redirect Sukses / Password Error / OTP Prompt
            await self._send(ws, "status", message="Menunggu respons autentikasi dari Starlink...")
            otp_handled = False
            for step in range(45):
                await page.wait_for_timeout(1000)
                curr_url = page.url

                # A. Berhasil redirect ke dashboard / akun
                if "/account" in curr_url and "/login" not in curr_url:
                    break

                body_text = ""
                try:
                    body_text = await page.locator("body").inner_text()
                except Exception:
                    pass

                body_lower = body_text.lower()

                # B. Cek Pesan Error Password / Akun (seperti 'Wrong password', 'Invalid credentials', dsb)
                error_patterns = [
                    "wrong password",
                    "invalid credentials",
                    "incorrect",
                    "tidak valid",
                    "invalid email",
                    "check your password",
                    "user not found",
                    "account locked",
                    "too many attempts",
                ]
                found_error = None
                for ep in error_patterns:
                    if ep in body_lower:
                        # Cari elemen teks spesifik yang memuat pesan ini
                        try:
                            el = page.locator(f':text-matches("{ep}", "i")').first
                            if await el.count() > 0 and await el.is_visible():
                                found_error = (await el.inner_text()).strip()
                                break
                        except Exception:
                            found_error = ep
                        if not found_error:
                            found_error = ep

                if found_error:
                    await self._send(
                        ws,
                        "login_failed",
                        message=f"Autentikasi ditolak Starlink: \"{found_error}\". Periksa kembali password Anda.",
                    )
                    await browser.close()
                    return

                # C. Cek jika Starlink menampilkan halaman pemilihan metode pengiriman kode OTP
                send_code_btn = page.locator(
                    'button:has-text("Send Code"), button:has-text("Send verification code"), button:has-text("Kirim Kode")'
                ).first
                if await send_code_btn.count() > 0 and await send_code_btn.is_visible():
                    lbl = (await send_code_btn.inner_text()).strip()
                    await self._send(ws, "status", message=f"Meminta Starlink mengirimkan kode verifikasi ({lbl})...")
                    await send_code_btn.click()
                    await page.wait_for_timeout(2000)

                # D. Deteksi Form Input OTP
                if not otp_handled:
                    is_otp_page = any(w in body_lower for w in [
                        "verification code", "verify your identity", "enter code", "two-step",
                        "security code", "one-time", "kode verifikasi", "sent a code", "enter the 6-digit"
                    ])

                    otp_field = None

                    # Cari input OTP spesifik dulu
                    otp_selectors = [
                        'input[autocomplete="one-time-code"]',
                        'input[name="code"]',
                        'input[name="otp"]',
                        'input[id*="code" i]',
                        'input[placeholder*="code" i]',
                        'input[placeholder*="otp" i]',
                        'input[placeholder*="verification" i]',
                        'input[inputmode="numeric"]',
                        'input[type="tel"]',
                    ]
                    for sel in otp_selectors:
                        loc = page.locator(sel)
                        if await loc.count() > 0:
                            for idx in range(await loc.count()):
                                cand = loc.nth(idx)
                                if await cand.is_visible():
                                    otp_field = cand
                                    break
                        if otp_field:
                            break

                    # Jika halaman 2FA terdeteksi tapi selector spesifik belum kena, ambil input form yang visible
                    if not otp_field and is_otp_page:
                        cand_inputs = page.locator('input:not([type="hidden"]):not([disabled]):not([type="checkbox"]):not([id*="vendor"])')
                        for idx in range(await cand_inputs.count()):
                            cand = cand_inputs.nth(idx)
                            if await cand.is_visible():
                                otp_field = cand
                                break

                    if otp_field:
                        otp_handled = True
                        await self._send(
                            ws,
                            "otp_required",
                            message="Starlink meminta kode OTP. Periksa email atau HP Anda dan masukkan kodenya pada kolom di atas.",
                        )

                        try:
                            # Tunggu kode OTP dari WebSocket client (timeout 3 menit)
                            while True:
                                data = await asyncio.wait_for(ws.receive_json(), timeout=180.0)
                                if data.get("action") == "submit_otp":
                                    code = data.get("otp", "").strip()
                                    if code:
                                        await self._send(ws, "status", message=f"Mengirim kode OTP ({code})...")
                                        await otp_field.click()
                                        await otp_field.fill(code)
                                        await page.wait_for_timeout(600)
                                        otp_submit = page.locator(
                                            'button[type="submit"], button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit"), button:has-text("Lanjut")'
                                        ).first
                                        if await otp_submit.count() > 0 and await otp_submit.is_visible():
                                            await otp_submit.click()
                                        else:
                                            await page.keyboard.press("Enter")
                                        await self._send(ws, "status", message="OTP dikirim. Memverifikasi dengan Starlink...")
                                        await page.wait_for_timeout(3500)
                                        break
                        except asyncio.TimeoutError:
                            await self._send(ws, "login_failed", message="Batas waktu pengisian OTP habis (timeout 3 menit).")
                            await browser.close()
                            return
                        except Exception as e:
                            await self._send(ws, "login_failed", message=f"Gagal memproses OTP: {e}")
                            await browser.close()
                            return

            # 7. Validasi final keberhasilan login & penyelesaian SSO handshake
            await self._send(ws, "status", message="Memvalidasi sesi dan membuka dashboard akun...")
            for _ in range(15):
                await page.wait_for_timeout(1000)
                if "/login" not in page.url:
                    break

            # Pastikan mendarat di /account/home dan selesaikan SSO redirect handshake
            for attempt in range(4):
                try:
                    await page.goto(self.home_url, wait_until="networkidle", timeout=30000)
                    await page.wait_for_timeout(2000)
                except Exception:
                    pass

                # Cek apakah token API Starlink sudah aktif (200 OK)
                try:
                    api_check = await page.request.get("https://starlink.com/api/accounts/v3/accounts/contact")
                    if api_check.status == 200:
                        break
                except Exception:
                    pass

            # Sukses jika URL dashboard aktif dan tidak di halaman login
            is_success = ("/login" not in page.url and "/auth/login" not in page.url)

            if is_success:
                state = await context.storage_state()
                target_state_file.parent.mkdir(parents=True, exist_ok=True)
                await context.storage_state(path=str(target_state_file))

                # Jika akun utama (id=1 atau None), simpan juga ke auth_state default
                if not parent_account_id or parent_account_id == 1:
                    await context.storage_state(path=str(self.state_file))

                await self._save_session_to_db(state, parent_account_id, password=password)
                await self._send(ws, "login_success", message="Login & OTP berhasil diverifikasi! Sesi akun berhasil tersimpan.")
            else:
                body_snippet = (await page.locator("body").inner_text())[:250].replace("\n", " ")
                await self._send(
                    ws,
                    "login_failed",
                    message=f"Login belum selesai (URL: {page.url}). {body_snippet}",
                )

            await browser.close()

    async def _save_session_to_db(self, state: dict, parent_account_id: int = None, password: str = None):
        """Simpan auth_state ke tabel starlink_sessions dan parent_accounts."""
        try:
            import pymysql
            db_pass = os.getenv("DB_PASSWORD", "Strl1nkDB2026!")
            conn = pymysql.connect(
                host=os.getenv("DB_HOST", "mysql"),
                port=int(os.getenv("DB_PORT", "3306")),
                user=os.getenv("DB_USER", "starlink"),
                password=db_pass,
                database=os.getenv("DB_NAME", "starlink_db"),
                charset="utf8mb4",
            )
            state_json = json.dumps(state)
            with conn.cursor() as cur:
                # Default session untuk single-account legacy
                if not parent_account_id or parent_account_id == 1:
                    cur.execute(
                        """INSERT INTO starlink_sessions (id, auth_state, is_valid)
                           VALUES (1, %s, 1)
                           ON DUPLICATE KEY UPDATE auth_state=VALUES(auth_state), is_valid=1, updated_at=NOW()""",
                        (state_json,),
                    )
                # Simpan ke akun induk spesifik
                if parent_account_id:
                    if password:
                        cur.execute(
                            """UPDATE parent_accounts 
                               SET auth_state=%s, is_valid=1, password=%s, updated_at=NOW() 
                               WHERE id=%s""",
                            (state_json, password, parent_account_id),
                        )
                    else:
                        cur.execute(
                            """UPDATE parent_accounts 
                               SET auth_state=%s, is_valid=1, updated_at=NOW() 
                               WHERE id=%s""",
                            (state_json, parent_account_id),
                        )
            conn.commit()
            conn.close()
            print(f"[LoginService] Sesi berhasil disimpan ke DB untuk parent_id={parent_account_id}", flush=True)
        except Exception as e:
            print(f"[LoginService] DB save error: {e}", flush=True)
