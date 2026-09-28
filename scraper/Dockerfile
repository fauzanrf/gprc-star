FROM python:3.12-slim

# ── System deps untuk Playwright Chromium ─────────────────────────────────────
RUN apt-get update && apt-get install -y \
    wget curl gnupg ca-certificates fonts-liberation \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxcb1 libxkbcommon0 libx11-6 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY scraper/requirements.txt /app/scraper/
RUN pip install --no-cache-dir -r /app/scraper/requirements.txt

# Install Playwright Chromium
RUN playwright install chromium
RUN playwright install-deps chromium || true

# Copy source
COPY scraper /app/scraper

WORKDIR /app/scraper

# Volume untuk output JSON dan auth session
VOLUME ["/data", "/app/scraper"]

ENV PYTHONUNBUFFERED=1
ENV SCRAPER_DIR=/app/scraper
ENV STARLINK_OUTPUT_JSON=/data/starlink_export.json

CMD ["python", "scheduler.py"]
