/**
 * wa-gateway/index.js
 * ====================
 * WhatsApp Gateway menggunakan Baileys.
 * Menyediakan REST API untuk mengirim pesan WA ke grup atau nomor tertentu.
 *
 * Endpoints:
 *   GET  /health          — status koneksi WA & QR code
 *   GET  /qr              — tampilkan QR code sebagai HTML (scan untuk login)
 *   POST /send            — kirim pesan teks ke nomor/grup
 *   GET  /groups          — daftar grup WA yang diikuti bot
 *   POST /logout          — logout & hapus sesi WA (siapkan QR baru)
 *   POST /reload          — reset sesi & generate QR baru secara paksa
 *
 * Env vars:
 *   PORT              = 3001 (default)
 *   API_SECRET        = secret untuk autentikasi header X-API-Key
 *   SESSION_DIR       = /app/session (path penyimpanan session Baileys)
 */

"use strict";

const express    = require("express");
const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const pino   = require("pino");
const QRCode = require("qrcode");
const path   = require("path");
const fs     = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || "3001");
const API_SECRET  = process.env.API_SECRET || "Strl1nkWA-s3cr3t-2026!";
const SESSION_DIR = process.env.SESSION_DIR || "/app/session";

const logger = pino({ level: "silent" }); // suppress Baileys noise

// ── State ─────────────────────────────────────────────────────────────────────
let sock            = null;
let qrData          = null;    // base64 data URL untuk QR code
let isConnected     = false;
let connectionState = "disconnected"; // connecting | open | disconnected
let isConnecting    = false;
let reconnectTimer  = null;

/**
 * Membersihkan seluruh isi SESSION_DIR secara aman tanpa menghapus folder SESSION_DIR itu sendiri.
 * Ini mencegah error EBUSY pada mount point volume Docker (/app/session).
 */
function clearSessionDir() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      const files = fs.readdirSync(SESSION_DIR);
      for (const file of files) {
        const fullPath = path.join(SESSION_DIR, file);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch (e) {
          console.warn(`[WA] Gagal hapus file session '${file}':`, e.message);
        }
      }
      console.log("[WA] Direktori session berhasil dibersihkan.");
    }
  } catch (err) {
    console.error("[WA] Error saat membersihkan session:", err.message);
  }
}

/**
 * Menjadwalkan reconnect dengan debounce agar tidak ada penumpukan timer.
 */
function scheduleReconnect(delayMs) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWA(false).catch(err => {
      console.error("[WA] Reconnect error:", err.message);
    });
  }, delayMs);
}

// ── WA Connection ─────────────────────────────────────────────────────────────
async function connectWA(forceNewSession = false) {
  if (isConnecting) {
    console.log("[WA] connectWA() sedang berjalan, abaikan panggilan ganda.");
    return;
  }
  isConnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Bersihkan socket lama jika masih ada
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (_) {}
    sock = null;
  }

  if (forceNewSession) {
    console.log("[WA] Memaksa sesi baru: menghapus auth state lama.");
    clearSessionDir();
    qrData = null;
  }

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    let version = [2, 3000, 1015901307];
    try {
      const v = await fetchLatestBaileysVersion();
      if (v && v.version) version = v.version;
    } catch (e) {
      console.warn("[WA] Menggunakan versi Baileys bawaan:", e.message);
    }

    console.log(`[WA] Inisialisasi Baileys v${version.join(".")}...`);

    sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ["Starlink GPRC", "Chrome", "120.0"],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        QRCode.toDataURL(qr, (err, url) => {
          if (!err) {
            qrData = url;
            connectionState = "connecting";
          }
        });
        console.log("[WA] QR code baru tersedia untuk discan.");
      }

      if (connection === "open") {
        console.log("[WA] Terhubung ke WhatsApp!");
        isConnected = true;
        connectionState = "open";
        qrData = null;
      }

      if (connection === "close") {
        isConnected = false;
        connectionState = "disconnected";

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errMsg = lastDisconnect?.error?.message || "Unknown error";
        console.log(`[WA] Koneksi terputus (status: ${statusCode}, pesan: ${errMsg})`);

        // Handle Disconnect Reasons
        if (
          statusCode === DisconnectReason.loggedOut ||
          statusCode === 401 ||
          statusCode === 403
        ) {
          console.log("[WA] Sesi logout/unauthorized. Hapus sesi lama & buat QR baru...");
          clearSessionDir();
          qrData = null;
          scheduleReconnect(1500);
        } else if (statusCode === DisconnectReason.badSession || statusCode === 500) {
          console.log("[WA] Sesi bermasalah (bad session). Hapus sesi & generate QR baru...");
          clearSessionDir();
          qrData = null;
          scheduleReconnect(2000);
        } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          console.log("[WA] Restart required oleh server WhatsApp. Menghubungkan kembali...");
          scheduleReconnect(1000);
        } else {
          // Kesalahan koneksi jaringan sementara (connectionLost, timedOut, connectionClosed, dll)
          const delay = Math.min(30000, 3000 * (Math.random() + 1));
          console.log(`[WA] Menghubungkan ulang dalam ${Math.round(delay / 1000)} detik...`);
          scheduleReconnect(delay);
        }
      }
    });

    sock.ev.on("messages.upsert", () => {});
  } catch (err) {
    console.error("[WA] Error inisialisasi koneksi:", err.message);
    scheduleReconnect(5000);
  } finally {
    isConnecting = false;
  }
}

// ── Express API ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));

/** Middleware autentikasi API key */
function auth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/** GET /health — status koneksi & QR code */
app.get("/health", (req, res) => {
  res.json({
    status: connectionState,
    connected: isConnected,
    hasQR: !!qrData,
    qr: qrData,
  });
});

/** POST /logout — logout sesi WA & siapkan QR code baru */
app.post("/logout", auth, async (req, res) => {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (_) {}
      sock = null;
    }
    clearSessionDir();
    isConnected = false;
    connectionState = "disconnected";
    qrData = null;
    scheduleReconnect(1000);
    res.json({ ok: true, message: "Sesi WhatsApp berhasil diputuskan & QR baru sedang disiapkan." });
  } catch (err) {
    console.error("[WA] Error logout:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /reload — paksa reload socket & generate QR code baru */
app.post("/reload", auth, async (req, res) => {
  try {
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (_) {}
      sock = null;
    }
    clearSessionDir();
    isConnected = false;
    connectionState = "disconnected";
    qrData = null;
    scheduleReconnect(500);
    res.json({ ok: true, message: "WhatsApp Gateway direload. QR code baru sedang dibuat." });
  } catch (err) {
    console.error("[WA] Error reload:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /qr — tampilkan QR code sebagai HTML */
app.get("/qr", (req, res) => {
  if (isConnected) {
    return res.send(`<!DOCTYPE html>
<html><head><title>WhatsApp Terhubung</title></head><body style="font-family:sans-serif;text-align:center;padding:50px">
  <h2 style="color:#16a34a">WhatsApp sudah terhubung!</h2>
  <p>Sesi aktif dan siap menerima notifikasi Starlink GPRC.</p>
</body></html>`);
  }
  if (!qrData) {
    return res.send(`<!DOCTYPE html>
<html><head><title>Menunggu QR Code</title></head><body style="font-family:sans-serif;text-align:center;padding:50px">
  <h2>Menunggu QR Code WhatsApp...</h2>
  <p>QR code sedang dibuat. Halaman ini akan memuat ulang secara otomatis.</p>
  <script>setTimeout(() => location.reload(), 3000);</script>
</body></html>`);
  }
  res.send(`<!DOCTYPE html>
<html><head><title>Scan QR WA - Starlink GPRC</title></head><body style="font-family:sans-serif;text-align:center;padding:40px">
  <h2>Scan QR dengan WhatsApp</h2>
  <p>Buka WhatsApp &rarr; Pengaturan / Titik Tiga &rarr; <b>Perangkat Tertaut</b> &rarr; <b>Tautkan Perangkat</b></p>
  <div style="margin:20px 0">
    <img src="${qrData}" style="max-width:280px;border:1px solid #ddd;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
  </div>
  <p style="color:#666;font-size:13px">Halaman otomatis refresh setiap 20 detik jika belum discan.</p>
  <script>setTimeout(() => location.reload(), 20000);</script>
</body></html>`);
});

/**
 * POST /send — kirim pesan teks
 * Body: { "to": "628123456789@s.whatsapp.net" | "120363xxxxxxxx@g.us", "message": "..." }
 * Header: X-API-Key: <API_SECRET>
 */
app.post("/send", auth, async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(503).json({ error: "WhatsApp belum terhubung. Scan QR terlebih dahulu." });
  }

  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "Field 'to' dan 'message' wajib diisi" });
  }

  try {
    await sock.sendMessage(to, { text: message });
    console.log(`[WA] Pesan terkirim ke ${to}`);
    res.json({ ok: true, to, ts: new Date().toISOString() });
  } catch (err) {
    console.error(`[WA] Gagal kirim ke ${to}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /groups — daftar grup WA (untuk mendapatkan group JID)
 * Header: X-API-Key: <API_SECRET>
 */
app.get("/groups", auth, async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(503).json({ error: "WhatsApp belum terhubung" });
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.entries(groups).map(([id, g]) => ({
      id,
      name: g.subject,
      participants: g.participants?.length || 0,
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Global Error Guard ────────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("[WA] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[WA] Uncaught Exception:", err.message);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WA-Gateway] Berjalan di port ${PORT}`);
  console.log(`[WA-Gateway] Akses /qr untuk scan QR WhatsApp`);
});

connectWA(false).catch(err => {
  console.error("[WA] Error saat start:", err.message);
  scheduleReconnect(3000);
});
