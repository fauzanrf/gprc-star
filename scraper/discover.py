"""
discover.py
============
Run this ONCE, first, before touching scrape_starlink.py.

What it does:
1. Opens a real (visible) Chromium window pointed at your Starlink /
   reseller dashboard login page.
2. Waits for YOU to log in manually (type credentials, solve OTP/captcha
   if any). This keeps credentials out of the script entirely.
3. Once you're on the dashboard, it saves the logged-in session
   (cookies + localStorage) to `auth_state.json` so future runs of
   scrape_starlink.py don't need you to log in again.
4. While you click around (open a sub-account, open its kit list),
   it prints + logs every background API call (XHR/fetch) the page makes,
   including the JSON it returned. This is how we find the "real" data
   source instead of scraping HTML.

HOW TO USE THE OUTPUT:
- Look in api_calls.log for a request whose JSON response contains your
  SN / KIT / STATUS fields (search for one of your real serial numbers,
  e.g. "4PBA0438...").
- Copy that request's URL. You'll paste a matching pattern into
  CONFIG["api_url_pattern"] in scrape_starlink.py.
- If you can't find any such call (some dashboards render everything
  server-side with no clean API), that's fine — scrape_starlink.py has a
  DOM-scraping fallback. In that case, note the CSS selector of the table
  rows instead (right-click a row -> Inspect in the browser).
"""

import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

# ---- EDIT THIS: the login page of your Starlink / reseller dashboard ----
LOGIN_URL = "https://www.starlink.com/login"  # <-- change if you use a different portal
STATE_FILE = Path("auth_state.json")
LOG_FILE = Path("api_calls.log")


async def main():
    async with async_playwright() as p:
        # Gunakan Google Chrome asli + argumen anti-deteksi bot
        browser = await p.chromium.launch(
            headless=False,
            channel="chrome",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
            ignore_default_args=["--enable-automation"],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800}
        )
        await Stealth().apply_stealth_async(context)
        page = await context.new_page()

        log_lines = []

        def log(msg: str):
            print(msg)
            log_lines.append(msg)

        async def on_response(response):
            url = response.url
            # Only bother with XHR/fetch JSON responses, skip static assets
            if response.request.resource_type not in ("xhr", "fetch"):
                return
            try:
                ctype = response.headers.get("content-type", "")
                if "application/json" not in ctype:
                    return
                body = await response.json()
                snippet = json.dumps(body)[:800]
                log(f"\n[{response.status}] {response.request.method} {url}\n{snippet}")
            except Exception:
                pass  # non-JSON or already consumed body, ignore

        page.on("response", lambda r: asyncio.create_task(on_response(r)))

        await page.goto(LOGIN_URL)

        print("\n" + "=" * 60)
        print(">>> Jendela Google Chrome telah terbuka.")
        print(">>> Silakan login secara manual (masukkan email, password, OTP/captcha).")
        print(">>> Setelah Anda berada di Dashboard / halaman akun,")
        print(">>> KEMBALI KE TERMINAL INI lalu tekan tombol ENTER.")
        print("=" * 60 + "\n")
        
        await asyncio.get_event_loop().run_in_executor(None, input, "Tekan ENTER jika Anda SUDAH BERHASIL LOGIN ke dashboard... ")

        # Save the authenticated session for reuse by scrape_starlink.py
        await context.storage_state(path=str(STATE_FILE))
        
        saved_data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        cookie_count = len(saved_data.get("cookies", []))
        if cookie_count == 0:
            print("\n[PERINGATAN] Sesi login kosong (0 cookies).")
            print("Pastikan Anda melakukan login di dalam jendela Chrome yang dibuka script ini, bukan di browser lain.\n")
        else:
            print(f"\n[SUKSES] Berhasil menyimpan sesi: {cookie_count} cookies tersimpan di {STATE_FILE.resolve()}")

        print("\n" + "=" * 60)
        print(">>> Sekarang di browser, klik salah satu sub-account / daftar kit")
        print(">>> agar data API XHR terekam.")
        print(">>> Jika sudah selesai browsing, tekan tombol ENTER di terminal ini.")
        print("=" * 60 + "\n")
        
        await asyncio.get_event_loop().run_in_executor(None, input, "Tekan ENTER jika sudah selesai klik sub-account... ")

        LOG_FILE.write_text("\n".join(log_lines), encoding="utf-8")
        print(f"\n[SUKSES] Tersimpan {len(log_lines)} respons API ke {LOG_FILE.resolve()}")
        print("Buka file tersebut untuk melihat endpoint data kit/SN.\n")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())