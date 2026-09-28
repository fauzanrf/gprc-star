/**
 * wa-gateway/index.js
 * ====================
 * WhatsApp Gateway menggunakan Baileys.
 * Menyediakan REST API untuk mengirim pesan WA ke grup atau nomor tertentu.
 *
 * Endpoints:
 *   GET  /health          — status koneksi WA
 *   GET  /qr              — tampilkan QR code (scan untuk login)
 *   POST /send            — kirim pesan teks ke nomor/grup
 *   GET  /groups          — daftar grup WA yang diikuti bot
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
const { Boom } = require("@hapi/boom");
const pino   = require("pino");
const QRCode = require("qrcode");
const path   = require("path");
const fs     = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT || "3001");
const API_SECRET = process.env.API_SECRET || "changeme-wa-secret";
const SESSION_DIR = process.env.SESSION_DIR || "/app/session";

const logger = pino({ level: "silent" }); // suppress Baileys noise

// ── State ─────────────────────────────────────────────────────────────────────
let sock          = null;
let qrData        = null;    // base64 QR image untuk /qr endpoint
let isConnected   = false;
let connectionState = "disconnected"; // connecting | open | disconnected

// ── WA Connection ─────────────────────────────────────────────────────────────
async function connectWA() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[WA] Baileys version: ${version.join(".")}`);

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
      // Generate QR base64 untuk endpoint /qr
      QRCode.toDataURL(qr, (err, url) => {
        if (!err) qrData = url;
      });
      console.log("[WA] QR tersedia — akses GET /qr untuk scan");
      connectionState = "connecting";
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
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`[WA] Koneksi terputus (reason: ${reason})`);

      if (reason === DisconnectReason.loggedOut) {
        console.log("[WA] Sesi logout. Hapus session dan scan ulang QR.");
        // Hapus session agar QR muncul lagi
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        setTimeout(connectWA, 2000);
      } else if (reason !== DisconnectReason.badSession) {
        // Reconnect otomatis untuk error sementara
        const delay = Math.min(30000, 5000 * (Math.random() + 1));
        console.log(`[WA] Reconnect dalam ${Math.round(delay / 1000)}s...`);
        setTimeout(connectWA, delay);
      }
    }
  });

  sock.ev.on("messages.upsert", () => {}); // diperlukan agar socket tetap aktif
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

/** GET /health — status koneksi */
app.get("/health", (req, res) => {
  res.json({
    status: connectionState,
    connected: isConnected,
    hasQR: !!qrData,
    qr: qrData,
  });
});

/** POST /logout — logout sesi WA */
app.post("/logout", auth, async (req, res) => {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
    }
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    isConnected = false;
    connectionState = "disconnected";
    qrData = null;
    setTimeout(connectWA, 1500);
    res.json({ ok: true, message: "Sesi WhatsApp berhasil diputuskan." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /qr — tampilkan QR code sebagai HTML */
app.get("/qr", (req, res) => {
  if (isConnected) {
    return res.send("<h2>WhatsApp sudah terhubung!</h2>");
  }
  if (!qrData) {
    return res.send("<h2>Menunggu QR... Refresh halaman ini dalam beberapa detik.</h2>" +
      "<script>setTimeout(()=>location.reload(), 3000)</script>");
  }
  res.send(`<!DOCTYPE html>
<html><head><title>Scan QR WA</title></head><body style="font-family:sans-serif;text-align:center;padding:40px">
  <h2>Scan QR dengan WhatsApp</h2>
  <p>Buka WhatsApp → Linked Devices → Tambah Perangkat</p>
  <img src="${qrData}" style="max-width:300px;border:1px solid #ccc;border-radius:8px">
  <p style="color:#888;font-size:13px">QR refresh otomatis setiap 30 detik</p>
  <script>setTimeout(()=>location.reload(), 30000)</script>
</body></html>`);
});

/**
 * POST /send — kirim pesan teks
 * Body: { "to": "628123456789@s.whatsapp.net" | "120363xxxxxxxx@g.us", "message": "..." }
 * Header: X-API-Key: <API_SECRET>
 */
app.post("/send", auth, async (req, res) => {
  if (!isConnected) {
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
  if (!isConnected) {
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[WA-Gateway] Berjalan di port ${PORT}`);
  console.log(`[WA-Gateway] Akses /qr untuk scan QR WhatsApp`);
});

connectWA().catch(err => {
  console.error("[WA] Fatal error:", err);
  process.exit(1);
});
