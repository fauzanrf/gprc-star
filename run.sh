#!/usr/bin/env bash
# =====================================================================
#             STARLINK GPRC DASHBOARD & SCRAPER RUN SCRIPT
# =====================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================"
echo "             STARLINK GPRC DASHBOARD & SCRAPER"
echo "======================================================================"
echo ""

MODE="docker"
EXTRA_ARGS=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --docker)   MODE="docker"; shift ;;
        --parallel) MODE="parallel"; shift ;;
        --serial)   MODE="serial"; shift ;;
        --login)    MODE="login"; shift ;;
        --workers)  EXTRA_ARGS="--workers $2"; shift 2 ;;
        *) shift ;;
    esac
done

if [ "$MODE" == "docker" ]; then
    echo "[*] Menjalankan seluruh sistem via Docker Compose..."
    docker compose up --build -d
    echo ""
    echo "Dashboard Web: http://localhost"
    echo "Swagger Docs : http://localhost/docs"
    exit 0
fi

if [ "$MODE" == "login" ]; then
    python3 scraper/login_vps.py
    exit 0
fi

if [ "$MODE" == "serial" ]; then
    python3 scraper/scrape_starlink.py
    exit 0
fi

if [ "$MODE" == "parallel" ]; then
    python3 scraper/parallel_scraper.py $EXTRA_ARGS
    exit 0
fi
