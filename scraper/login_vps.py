"""
login_vps.py
============
Skrip login otomatis berbasis CLI (Headless) untuk deployment di Linux VPS / Server.
Tidak membutuhkan GUI/monitor.

Fitur:
1. Otomatis membaca email & password dari file .env (atau prompt terminal jika belum ada).
2. Menjalankan browser secara headless dengan anti-bot stealth.
3. Menangani 2FA OTP langsung melalui terminal CLI (tanpa perlu browser visual).
4. Menyimpan sesi ke auth_state.json yang siap digunakan oleh scrape_starlink.py.
"""

import asyncio
import getpass
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright
from playwright_stealth import Stealth


def load_env():
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

LOGIN_URL = os.getenv("STARLINK_LOGIN_URL", "https://starlink.com/auth/login")
HOME_URL = os.getenv("STARLINK_DASHBOARD_URL", "https://starlink.com/account/home")
STATE_FILE = Path(os.getenv("STARLINK_STATE_FILE", "auth_state.json"))


async def launch_browser(p):
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
            headless=is_headless,
            channel="chrome",
            args=launch_args,
            ignore_default_args=["--enable-automation"],
        )
    except Exception:
        return await p.chromium.launch(
            headless=is_headless,
            args=launch_args,
            ignore_default_args=["--enable-automation"],
        )


async def main():
    print("=" * 65)
    print("       STARLINK HEADLESS CLI LOGIN (VPS / SERVER)")
    print("=" * 65)

    # 1. Ambil Kredensial
    email = os.getenv("STARLINK_EMAIL", "").strip()
    password = os.getenv("STARLINK_PASSWORD", "").strip()

    if not email:
        email = input("Masukkan Email Starlink: ").strip()
    else:
        print(f"[*] Menggunakan Email dari .env: {email}")

    if not password:
        password = getpass.getpass("Masukkan Password Starlink: ")
    else:
        print("[*] Menggunakan Password dari .env.")

    if not email or not password:
        print("[ERROR] Email dan password wajib diisi!")
        sys.exit(1)

    # 2. Buka Browser Headless
    print("\n[*] Menjalankan browser headless...")
    async with async_playwright() as p:
        browser = await launch_browser(p)

        context_kwargs = {"viewport": {"width": 1280, "height": 800}}
        if STATE_FILE.exists():
            try:
                context_kwargs["storage_state"] = str(STATE_FILE)
            except Exception:
                pass

        context = await browser.new_context(**context_kwargs)
        await Stealth().apply_stealth_async(context)
        page = await context.new_page()

        # Cek apakah sesi yang ada masih aktif
        if STATE_FILE.exists():
            print("[*] Memeriksa sesi yang tersimpan...")
            try:
                await page.goto(HOME_URL, wait_until="domcontentloaded", timeout=25000)
                await page.wait_for_timeout(3000)
                if "/account" in page.url and "/login" not in page.url:
                    print(f"\n[SUKSES] Sesi Anda masih aktif di {page.url}!")
                    await context.storage_state(path=str(STATE_FILE))
                    await browser.close()
                    return
            except Exception:
                pass

        # 3. Navigasi ke Halaman Login
        print(f"[*] Membuka {LOGIN_URL} ...")
        await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(3000)

        # Cari input email
        email_input = page.locator('input[type="email"], input[name="email"], input[id*="email"], input[type="text"]').first
        try:
            await email_input.wait_for(state="visible", timeout=15000)
        except Exception:
            print("[!] Input email tidak langsung terlihat, mencoba inspect form...")

        # Ketik email
        print("[*] Mengisi kredensial...")
        await email_input.fill(email)
        await page.wait_for_timeout(500)

        # Cek apakah ada tombol Next (jika flow 2-step) atau langsung input password
        pwd_input = page.locator('input[type="password"]')
        if await pwd_input.count() == 0 or not await pwd_input.first.is_visible():
            next_btn = page.locator('button[type="submit"], button:has-text("Next"), button:has-text("Sign In")').first
            if await next_btn.count() > 0 and await next_btn.is_visible():
                await next_btn.click()
                await page.wait_for_timeout(2000)

        await pwd_input.first.wait_for(state="visible", timeout=15000)
        await pwd_input.first.fill(password)
        await page.wait_for_timeout(500)

        submit_btn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")').first
        await submit_btn.click()
        print("[*] Mengirimkan formulir login...")

        # 4. Tunggu hasil login atau 2FA OTP
        otp_prompted = False
        for _ in range(30):  # tunggu hingga 30 detik
            await page.wait_for_timeout(1000)
            curr_url = page.url

            # Berhasil login
            if "/account" in curr_url and "/login" not in curr_url:
                break

            # Cek form OTP / Kode verifikasi
            otp_selectors = [
                'input[autocomplete="one-time-code"]',
                'input[name="code"]',
                'input[name="otp"]',
                'input[id*="code"]',
                'input[placeholder*="code" i]',
                'input[placeholder*="verification" i]',
                'input[type="tel"]',
            ]
            otp_field = None
            for sel in otp_selectors:
                loc = page.locator(sel)
                if await loc.count() > 0 and await loc.first.is_visible():
                    otp_field = loc.first
                    break

            if otp_field and not otp_prompted:
                otp_prompted = True
                print("\n" + "=" * 65)
                print("[2FA / OTP] Starlink meminta kode verifikasi yang dikirim ke email/HP.")
                print("=" * 65)
                otp_code = input(">> Masukkan kode OTP (6 digit): ").strip()
                if otp_code:
                    await otp_field.fill(otp_code)
                    await page.wait_for_timeout(500)
                    # Submit OTP
                    otp_submit = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Continue")').first
                    if await otp_submit.count() > 0 and await otp_submit.is_visible():
                        await otp_submit.click()
                    else:
                        await page.keyboard.press("Enter")
                    print("[*] Mengirim kode OTP...")
                    await page.wait_for_timeout(3000)

        # 5. Konfirmasi login berhasil
        await page.wait_for_timeout(3000)
        if "/account" in page.url and "/login" not in page.url:
            await context.storage_state(path=str(STATE_FILE))
            saved_data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            cookie_count = len(saved_data.get("cookies", []))
            print("\n" + "=" * 65)
            print(f"[SUKSES] Berhasil login ke Starlink!")
            print(f"Sesi login tersimpan: {cookie_count} cookies di {STATE_FILE.resolve()}")
            print("Sekarang Anda bisa menjalankan: python scrape_starlink.py")
            print("=" * 65 + "\n")
        else:
            print(f"\n[PERINGATAN] Login belum mencapai dashboard (URL saat ini: {page.url}).")
            body_snippet = (await page.locator("body").inner_text())[:400].replace("\n", " ")
            print(f"Cuplikan layar: {body_snippet}")
            print("Pastikan email/password benar, atau coba jalankan dengan HEADLESS=false jika memungkinkan.")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
