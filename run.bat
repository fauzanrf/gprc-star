@echo off
setlocal
title Starlink GPRC Dashboard & Scraper
color 0B
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ======================================================================
echo             STARLINK GPRC DASHBOARD & PARALLEL SCRAPER
echo ======================================================================
echo.

:: Menu Pilihan
echo Menu:
echo   [1] Buka Web Dashboard di Browser (http://localhost:8080) [Default]
echo   [2] Jalankan Scraping PARALLEL (Ambil data terbaru)
echo   [3] Jalankan Scraping SERIAL (1 proses browser)
echo   [4] Login Starlink Visual (discover.py)
echo   [5] Login Starlink Headless (login_vps.py)
echo   [6] Jalankan Full Stack via Docker Compose (MySQL + Backend + SPA)
echo   [7] Update Library / Install Playwright
echo   [8] Keluar
echo.
set /p opt="Pilih opsi [1-8] (Default=1): "
if "%opt%"=="" set opt=1

if "%opt%"=="1" goto RUN_DASHBOARD
if "%opt%"=="2" goto SCRAPE_PARALLEL
if "%opt%"=="3" goto SCRAPE_SERIAL
if "%opt%"=="4" goto LOGIN_GUI
if "%opt%"=="5" goto LOGIN_CLI
if "%opt%"=="6" goto RUN_DOCKER
if "%opt%"=="7" goto DEPS
if "%opt%"=="8" goto KELUAR

:RUN_DASHBOARD
echo.
echo ======================================================================
echo          MEMBUKA STARLINK WEB DASHBOARD...
echo ======================================================================
echo Membuka http://localhost di browser...
start http://localhost
goto PAUSE_END

:SCRAPE_PARALLEL
echo.
echo ======================================================================
echo          MENJALANKAN PARALLEL SCRAPING STARLINK...
echo ======================================================================
python scraper/parallel_scraper.py
goto PAUSE_END

:SCRAPE_SERIAL
echo.
echo ======================================================================
echo          MENJALANKAN SCRAPING SERIAL STARLINK...
echo ======================================================================
python scraper/scrape_starlink.py
goto PAUSE_END

:LOGIN_GUI
echo.
echo Membuka browser visual untuk login...
python scraper/discover.py
goto PAUSE_END

:LOGIN_CLI
echo.
echo Menjalankan login headless via CLI...
python scraper/login_vps.py
goto PAUSE_END

:RUN_DOCKER
echo.
echo ======================================================================
echo          MENJALANKAN DOCKER COMPOSE...
echo ======================================================================
echo.
docker compose up --build -d
echo.
echo Dashboard Web: http://localhost
echo Swagger Docs : http://localhost/docs
goto PAUSE_END

:DEPS
echo.
echo Mengupdate dependensi...
python -m pip install -r scraper/requirements.txt
playwright install chromium
goto PAUSE_END

:PAUSE_END
echo.
pause
:KELUAR
