# 🛰️ Starlink GPRC Dashboard & Parallel Scraper

Platform monitoring dan kontrol Starlink berbasis web modern yang terintegrasi penuh dengan **Docker**, **FastAPI (Backend & WebSocket)**, **React (Frontend)**, dan **MySQL (Database)**. Dilengkapi dengan mesin scraping paralel berkinerja tinggi serta sistem login headless yang mendukung input **OTP real-time via WebSocket**.

---

## 🌟 Fitur Utama

1. **Dashboard Monitoring Real-Time**:
   - Menampilkan total terminal/KIT, jumlah perangkat aktif, terblokir (*restricted*), ditangguhkan (*suspended*), dan offline (*inactive*).
   - Ringkasan pemakaian kuota dan statistik per sub-account.
2. **Login Otomatis & Relay OTP via WebSocket**:
   - Login Starlink dijalankan secara *headless* di backend menggunakan Playwright.
   - Jika Starlink meminta kode OTP / 2FA, antarmuka web secara otomatis memunculkan dialog input OTP dan merelay kode ke browser secara real-time.
3. **Multi-Worker Parallel Scraping**:
   - Membagi puluhan/ratusan sub-akun ke beberapa worker proses Chromium secara simultan untuk memangkas waktu proses hingga 4x–8x lebih cepat.
   - Live stream log terminal proses scraping langsung ke layar dashboard via WebSocket.
4. **Deteksi Status 4 Kondisi (Akurat & Berlapis)**:
   - 🟢 **Active**: Terminal normal, online, dan bebas akses internet.
   - 🔴 **Restricted**: Online namun terkena penangguhan banner *"Restricted for Business/Enterprise use"*.
   - 🟠 **Suspended**: Layanan atau akun ditangguhkan (*account suspended / terminated*).
   - ⚫ **Inactive**: Terminal dalam kondisi offline / non-aktif.
5. **Penyimpanan Terstruktur ke Database MySQL**:
   - Hasil scraping otomatis di-upsert ke tabel database MySQL (`accounts`, `kits`, `scrape_jobs`, `starlink_sessions`).

---

## 🏗 Arsitektur Sistem

```
                              ┌───────────────────────────────────┐
                              │          Nginx (Port 80)          │
                              │ Reverse Proxy & WebSocket Gateway │
                              └─────────┬───────────────┬─────────┘
                                        │               │
                                        ▼               ▼
                   ┌────────────────────────────┐   ┌───────────────────────────┐
                   │      Frontend (React)      │   │     Backend (FastAPI)     │
                   │  - Port 80 (via Nginx)     │   │  - Port 8000 (REST + WS)  │
                   │  - SPA Dashboard           │   │  - Playwright Login Relay │
                   │  - Filter & Live Log       │   │  - Scraper Job Manager    │
                   └────────────────────────────┘   └─────────────┬─────────────┘
                                                                  │
                                            ┌─────────────────────┴─────────────┐
                                            │                                   │
                                            ▼                                   ▼
                             ┌────────────────────────────┐       ┌───────────────────────────┐
                             │       MySQL Database       │       │    Parallel Scraper Engine│
                             │  - Port 3306               │       │  - Subprocess Multi-Worker│
                             │  - Data Akun & KIT         │       │  - Direct DB Upsert       │
                             └────────────────────────────┘       └───────────────────────────┘
```

---

## 📂 Struktur Direktori

```
Scrap Starlink/
├── backend/                  # REST API & WebSocket Server
│   ├── routers/              # Endpoint Auth, Accounts, Kits, Scrape, Dashboard
│   ├── services/             # LoginService (Playwright) & ScraperService
│   ├── database.py           # Koneksi SQLAlchemy & MySQL
│   ├── models.py             # Schema ORM Database
│   ├── schemas.py            # Pydantic Schemas
│   ├── main.py               # Entrypoint FastAPI
│   ├── Dockerfile            # Container Backend
│   └── requirements.txt      # Dependensi Python Backend
│
├── frontend/                 # Web Application (React + Vite + Vanilla CSS)
│   ├── src/
│   │   ├── pages/            # Dashboard, Login, Kits, Scraping, Accounts
│   │   ├── api.js            # API Fetcher & WebSocket Handler
│   │   └── App.jsx           # Layout & Router
│   ├── Dockerfile            # Container Frontend Multi-stage (Node -> Nginx)
│   └── nginx.conf            # Nginx config untuk SPA
│
├── scraper/                  # Engine Scraper Paralel & Database Writer
│   ├── scrape_starlink.py    # Worker Playwright & Deteksi Status
│   ├── parallel_scraper.py   # Orchestrator Multi-Worker
│   ├── db_writer.py          # Handler simpan data langsung ke MySQL
│   ├── login_vps.py          # Script login via CLI
│   └── discover.py           # Script login via Visual Chrome
│
├── nginx/
│   └── nginx.conf            # Reverse Proxy untuk Port 80 (API, WS, Frontend)
│
├── docker-compose.yml        # Orchestration 4 Service (MySQL, Backend, Frontend, Nginx)
├── .env                      # File Konfigurasi Lingkungan Aktif
├── .env.example              # Template Konfigurasi
├── run.bat                   # Runner Interaktif untuk Windows
└── run.sh                    # Runner CLI untuk Linux / VPS
```

---

## ⚙️ Konfigurasi Environment (`.env`)

Salin `.env.example` menjadi `.env` dan sesuaikan parameter berikut:

```env
# ── Kredensial Login Starlink ─────────────────────────────────────────
STARLINK_EMAIL=email_anda@domain.com
STARLINK_PASSWORD=PasswordStarlinkAnda

# ── Mode Headless ─────────────────────────────────────────────────────
HEADLESS=true

# ── Parallelism ───────────────────────────────────────────────────────
PARALLEL_WORKERS=4
WORKER_TIMEOUT_MINUTES=120

# ── Database MySQL ───────────────────────────────────────────────────
DB_HOST=mysql
DB_PORT=3306
DB_USER=starlink
DB_PASSWORD=starlink_pass
DB_NAME=starlink_db

# ── Path File ─────────────────────────────────────────────────────────
STARLINK_STATE_FILE=/app/scraper/auth_state.json
STARLINK_OUTPUT_JSON=starlink_export.json
STARLINK_DASHBOARD_URL=https://starlink.com/account/home
STARLINK_LOGIN_URL=https://www.starlink.com/login

# ── CORS ──────────────────────────────────────────────────────────────
CORS_ORIGINS=http://localhost,http://localhost:80,http://localhost:3000
```

---

## 🚀 Panduan Penggunaan

### METODE 1: Menggunakan Docker Compose (Rekomendasi Utama)

Metode ini menjalankan seluruh sistem (Database MySQL, Backend, Frontend, Nginx) dalam satu perintah terisolasi tanpa perlu menginstal dependensi manual.

#### 🪟 Di Windows:
1. Pastikan **Docker Desktop** sudah berjalan.
2. Buka terminal (PowerShell atau CMD) di folder proyek.
3. Jalankan:
   ```cmd
   docker compose up --build -d
   ```
   *(Atau cukup klik ganda `run.bat` dan pilih opsi **[1]**)*.

#### 🐧 Di Linux / VPS:
1. Pastikan Docker dan Docker Compose sudah terpasang.
2. Jalankan perintah:
   ```bash
   chmod +x run.sh
   docker compose up --build -d
   ```
   *(Atau jalankan `./run.sh --docker`)*.

#### 🌐 Akses Web & API:
- **Dashboard Web**: [http://localhost](http://localhost)
- **Swagger REST API Docs**: [http://localhost/docs](http://localhost/docs)
- **Frontend Direct Port**: [http://localhost:3000](http://localhost:3000)
- **Backend Direct Port**: [http://localhost:8000](http://localhost:8000)

---

### METODE 2: Menjalankan Secara Mandiri / Lokal (Tanpa Docker)

Jika Anda ingin menjalankan scraping langsung dari CLI di komputer lokal atau VPS tanpa Docker:

#### 🪟 Di Windows:
1. Pastikan Python 3.10+ terpasang dan dicentang opsi *"Add Python to PATH"*.
2. Buka file `run.bat` (Interaktif Menu):
   - Opsi `[2]`: Menjalankan Scraping Paralel (Multi-Worker).
   - Opsi `[3]`: Menjalankan Scraping Serial (Single Process).
   - Opsi `[4]`: Membuka browser visual Chrome untuk login manual pertama kali.
   - Opsi `[5]`: Menjalankan login headless via terminal.
   - Opsi `[6]`: Menginstal library & browser Playwright Chromium.

#### 🐧 Di Linux / VPS:
1. Berikan izin eksekusi pada script runner:
   ```bash
   chmod +x run.sh
   ```
2. Jalankan opsi yang diinginkan:
   ```bash
   # 1. Login / perbarui sesi di VPS (masukkan OTP di terminal jika diminta)
   ./run.sh --login

   # 2. Jalankan scraping paralel dengan 4 worker default
   ./run.sh --parallel

   # 3. Jalankan scraping paralel dengan jumlah worker kustom (misal: 6 worker)
   ./run.sh --parallel --workers 6

   # 4. Jalankan scraping serial
   ./run.sh --serial
   ```

---

## 📊 Penjelasan Detail Status KIT

Sistem melakukan pemindaian berlapis terhadap respon API dan elemen visual Starlink:

| Status | Indikator Visual | Deskripsi Kondisi |
| :--- | :---: | :--- |
| **`active`** | 🟢 Hijau | Terminal normal, aktif, online, dan memiliki kuota internet normal. |
| **`restricted`** | 🔴 Merah | Terminal online namun terkena pemblokiran *Restricted for Business/Enterprise use* (High-speed service restricted / ToS violation). |
| **`suspended`** | 🟠 Oranye | Layanan atau akun ditangguhkan (*Service suspended / Terminated / Payment past due*). |
| **`inactive`** | ⚫ Abu-abu | Terminal terdaftar dalam akun tetapi dalam status offline / dimatikan. |

---

## 📡 Daftar REST API & WebSocket Endpoints

### 🔐 Autentikasi (`/api/auth`)
- `GET /api/auth/status` : Memeriksa status sesi Starlink saat ini.
- `POST /api/auth/logout` : Menghapus/menonaktifkan sesi Starlink.
- `WS /api/auth/ws` : WebSocket alur login headless Playwright & pengiriman kode OTP real-time.

### 🏢 Sub-Accounts (`/api/accounts`)
- `GET /api/accounts` : Mengambil daftar semua sub-account Starlink.
- `GET /api/accounts/{id}/kits` : Mengambil seluruh KIT milik sub-account tertentu.

### 📡 KIT / Terminal (`/api/kits`)
- `GET /api/kits` : Mengambil daftar semua KIT dengan filter `status` (`active`, `restricted`, `suspended`, `inactive`), pencarian kata kunci (`search`), dan pagination (`page`, `size`).

### ⚡ Scraping Control (`/api/scrape`)
- `POST /api/scrape/start` : Menjalankan job scraping paralel baru (parameter `workers`).
- `GET /api/scrape/status` : Mengambil status job scraping terbaru yang sedang berjalan/terakhir selesai.
- `GET /api/scrape/jobs` : Riwayat seluruh scraping job.
- `WS /api/scrape/ws` : WebSocket live streaming log output scraping secara real-time.

### 📈 Dashboard Summary (`/api/dashboard`)
- `GET /api/dashboard/stats` : Mengambil total KIT, total akun, serta rincian jumlah status (active, restricted, suspended, inactive).
- `GET /api/dashboard/summary` : Ringkasan jumlah KIT dan status per controller/sub-account.

---

## 🛠 Troubleshooting & Pertanyaan Umum (FAQ)

**Q: Sesi Starlink expired / gagal login?**  
> Buka menu **Login Starlink** pada Dashboard Web, isi email & password, lalu masukkan kode OTP saat diminta. Sesi baru akan otomatis tersimpan ke file `auth_state.json` dan database MySQL.

**Q: Berapa worker paralel yang ideal?**  
> - **RAM 2–4 GB**: Gunakan `2` worker (`PARALLEL_WORKERS=2`).
> - **RAM 4–8 GB**: Gunakan `4` worker (Default).
> - **RAM 8+ GB**: Gunakan `6` sampai `8` worker untuk kecepatan maksimal.

**Q: Bagaimana cara menghentikan container Docker?**  
> Jalankan perintah:
> ```bash
> docker compose down
> ```
> *(Tambahkan flag `-v` jika ingin menghapus seluruh volume database data)*.

---

## 📄 Lisensi

Dikembangkan untuk kebutuhan manajemen, monitoring, dan otomatisasi operasional Starlink.
