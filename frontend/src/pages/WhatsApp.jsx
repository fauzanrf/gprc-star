import React, { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare,
  Send,
  Smartphone,
  Users,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  QrCode,
  ShieldCheck,
  CheckCheck,
  Bell,
  Save,
  Info,
  Calendar,
  Clock,
  Copy,
  Check,
  Radio,
  FileText,
  AlertTriangle
} from 'lucide-react'
import {
  getWhatsAppStatus,
  getWhatsAppGroups,
  getWhatsAppConfig,
  saveWhatsAppConfig,
  sendWhatsAppTest,
  disconnectWhatsApp,
  reloadWhatsApp,
  getWhatsAppReminderPreview,
  sendWhatsAppReminder
} from '../api'

export default function WhatsAppPage() {
  const [status, setStatus] = useState({ connected: false, status: 'disconnected', hasQR: false, qr: null })
  const [loadingStatus, setLoadingStatus] = useState(true)

  // Config State
  const [enabled, setEnabled] = useState(true)
  const [targetType, setTargetType] = useState('personal') // 'personal' | 'group'
  const [phone, setPhone] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [groups, setGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [reminderAuto, setReminderAuto] = useState(true)
  const [reminderTime, setReminderTime] = useState('08:00')

  // Actions State
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState('')
  const [saveError, setSaveError] = useState('')

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // { ok: bool, message: str }

  const [disconnecting, setDisconnecting] = useState(false)
  const [reloading, setReloading] = useState(false)

  // Suspend Reminder State
  const todayDay = new Date().getDate()
  const [selectedDay, setSelectedDay] = useState(todayDay)
  const [reminderPreview, setReminderPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderSendResult, setReminderSendResult] = useState(null)
  const [copied, setCopied] = useState(false)

  // Helper untuk format nomor ke format WA (628xxx@s.whatsapp.net)
  const formatPhoneToJid = (val) => {
    let clean = (val || '').replace(/[^0-9]/g, '')
    if (clean.startsWith('08')) {
      clean = '628' + clean.slice(2)
    } else if (clean.startsWith('8')) {
      clean = '628' + clean.slice(1)
    }
    return clean ? `${clean}@s.whatsapp.net` : ''
  }

  // Load status & config
  const fetchAll = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const st = await getWhatsAppStatus()
      setStatus(st || {})

      if (st && st.config) {
        setEnabled(st.config.wa_enabled ?? true)
        setTargetType(st.config.wa_target_type || 'personal')
        setPhone(st.config.wa_target_phone || '')
        if (st.config.wa_target_type === 'group') {
          setSelectedGroup(st.config.wa_target || '')
        }
        setReminderAuto(st.config.wa_reminder_auto ?? true)
        setReminderTime(st.config.wa_reminder_time || '08:00')
      }
    } catch (e) {
      console.error('Error fetching WA status:', e)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  // Load groups list
  const fetchGroups = useCallback(async () => {
    if (!status.connected) return
    setLoadingGroups(true)
    try {
      const list = await getWhatsAppGroups()
      setGroups(list || [])
    } catch (e) {
      console.warn('Could not fetch groups:', e)
    } finally {
      setLoadingGroups(false)
    }
  }, [status.connected])

  // Fetch Suspend Reminder Preview
  const fetchReminder = useCallback(async (dayToFetch) => {
    setLoadingPreview(true)
    try {
      const res = await getWhatsAppReminderPreview({ day: dayToFetch })
      setReminderPreview(res || null)
    } catch (err) {
      console.warn('Gagal memuat preview reminder:', err)
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (status.connected) {
      fetchGroups()
    }
  }, [status.connected, fetchGroups])

  useEffect(() => {
    fetchReminder(selectedDay)
  }, [selectedDay, fetchReminder])

  // Auto poll status if not connected (for QR scan updates)
  useEffect(() => {
    if (status.connected) return
    const timer = setInterval(() => {
      getWhatsAppStatus().then(st => {
        if (st) setStatus(st)
      }).catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [status.connected])

  // Handle Save Config
  const handleSaveConfig = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess('')
    setSaveError('')

    let finalTarget = ''
    if (targetType === 'personal') {
      if (!phone.trim()) {
        setSaveError('Silakan masukkan nomor WhatsApp Anda terlebih dahulu.')
        setSaving(false)
        return
      }
      finalTarget = formatPhoneToJid(phone)
    } else {
      if (!selectedGroup) {
        setSaveError('Silakan pilih salah satu grup WhatsApp dari daftar.')
        setSaving(false)
        return
      }
      finalTarget = selectedGroup
    }

    try {
      const res = await saveWhatsAppConfig({
        wa_enabled: enabled,
        wa_target: finalTarget,
        wa_target_type: targetType,
        wa_target_phone: phone,
        wa_reminder_auto: reminderAuto,
        wa_reminder_time: reminderTime
      })
      setSaveSuccess(res.message || 'Konfigurasi berhasil disimpan!')
      setTimeout(() => setSaveSuccess(''), 4500)
    } catch (err) {
      setSaveError(err.message || 'Gagal menyimpan konfigurasi.')
    } finally {
      setSaving(false)
    }
  }

  // Handle Test Message
  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)

    let targetToTest = ''
    if (targetType === 'personal') {
      targetToTest = formatPhoneToJid(phone)
    } else {
      targetToTest = selectedGroup
    }

    if (!targetToTest) {
      setTestResult({ ok: false, message: 'Nomor atau grup tujuan belum diisi!' })
      setTesting(false)
      return
    }

    try {
      const res = await sendWhatsAppTest({ to: targetToTest, day: selectedDay })
      setTestResult({ ok: true, message: res.message || 'Pesan uji coba berhasil terkirim!' })
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Gagal mengirim pesan uji coba.' })
    } finally {
      setTesting(false)
    }
  }

  // Handle Send Reminder Now
  const handleSendReminder = async () => {
    let targetToSend = targetType === 'personal' ? formatPhoneToJid(phone) : selectedGroup
    if (!targetToSend) {
      alert('Tujuan WhatsApp (nomor HP atau grup) belum ditentukan!')
      return
    }

    const count = reminderPreview?.total_accounts || 0
    if (!window.confirm(`Kirim reminder suspend Tanggal ${selectedDay} (${count} akun) sekarang ke ${targetToSend}?`)) {
      return
    }

    setSendingReminder(true)
    setReminderSendResult(null)
    try {
      const res = await sendWhatsAppReminder({
        day: selectedDay,
        to: targetToSend
      })
      setReminderSendResult({
        ok: true,
        message: res.message || `Reminder Tanggal ${selectedDay} berhasil dikirim ke ${targetToSend}!`
      })
      setTimeout(() => setReminderSendResult(null), 6000)
    } catch (err) {
      setReminderSendResult({
        ok: false,
        message: err.message || 'Gagal mengirim reminder WhatsApp.'
      })
    } finally {
      setSendingReminder(false)
    }
  }

  // Handle Copy Message
  const handleCopyMessage = () => {
    if (!reminderPreview?.message) return
    navigator.clipboard.writeText(reminderPreview.message).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  // Handle Disconnect
  const handleDisconnect = async () => {
    if (!window.confirm('Yakin ingin memutuskan koneksi WhatsApp? Anda harus scan QR ulang untuk menghubungkan kembali.')) {
      return
    }
    setDisconnecting(true)
    try {
      await disconnectWhatsApp()
      await fetchAll()
    } catch (err) {
      alert('Gagal memutuskan koneksi: ' + (err.message || err))
    } finally {
      setDisconnecting(false)
    }
  }

  // Handle Reload
  const handleReload = async () => {
    setReloading(true)
    try {
      await reloadWhatsApp()
      await fetchAll()
    } catch (err) {
      alert('Gagal me-reload WhatsApp Gateway: ' + (err.message || err))
    } finally {
      setReloading(false)
    }
  }

  const effectiveJid = targetType === 'personal' ? formatPhoneToJid(phone) : selectedGroup

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#25D366', display: 'flex' }}><MessageSquare size={26} /></span>
            Notifikasi & Pengingat WhatsApp
          </h1>
          <p className="page-subtitle">
            Kelola WhatsApp Gateway dan kirim pesan reminder otomatis untuk Starlink yang akan di-suspend pada tanggal jatuh tempo.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => { fetchAll(); fetchReminder(selectedDay); }}
          disabled={loadingStatus}
          style={{ fontSize: 13, gap: 6 }}
        >
          <RefreshCw size={14} className={loadingStatus ? 'spin' : ''} />
          Refresh Status
        </button>
      </div>

      {/* Grid Atas: Status Gateway & Konfigurasi Pengiriman */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 24, marginBottom: 24 }}>
        
        {/* KARTU 1: Status Koneksi WhatsApp Gateway */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
              <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={18} color="var(--purple-main)" /> Status Gateway
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  background: status.connected ? '#dcfce7' : status.hasQR ? '#fef3c7' : '#fee2e2',
                  color: status.connected ? '#15803d' : status.hasQR ? '#b45309' : '#b91c1c'
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: status.connected ? '#22c55e' : status.hasQR ? '#f59e0b' : '#ef4444'
                  }}
                />
                {status.connected ? 'Terhubung' : status.hasQR ? 'Menunggu Scan' : 'Terputus'}
              </span>
            </div>

            {/* Konten Berdasarkan Status Koneksi */}
            {status.connected ? (
              <div style={{ textAlign: 'center', padding: '24px 16px' }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    background: '#dcfce7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                    color: '#16a34a'
                  }}
                >
                  <CheckCheck size={38} />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)', marginBottom: 6 }}>
                  WhatsApp Sesi Aktif
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 300, margin: '0 auto 16px' }}>
                  Gateway siap mengirimkan notifikasi reminder akun Starlink.
                </p>
                {status.jid && (
                  <div style={{
                    display: 'inline-block',
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-light)',
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: 'var(--text-main)',
                    marginBottom: 16
                  }}>
                    ID: {status.jid.split('@')[0]}
                  </div>
                )}
              </div>
            ) : status.hasQR && status.qr ? (
              <div style={{ textAlign: 'center', padding: '16px' }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-main)' }}>
                  Scan QR Code dengan WhatsApp
                </h4>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Buka WhatsApp di HP &rarr; Menu Titik Tiga / Pengaturan &rarr; <b>Perangkat Tertaut</b> &rarr; <b>Tautkan Perangkat</b>
                </p>
                <div style={{ display: 'inline-block', padding: 12, background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <img src={status.qr} alt="QR Code WhatsApp" style={{ width: 200, height: 200, display: 'block' }} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
                  * QR Code otomatis diperbarui setiap 20 detik.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '36px 16px' }}>
                <RefreshCw size={36} className="spin" style={{ color: 'var(--purple-main)', margin: '0 auto 16px', display: 'block' }} />
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>
                  Menghubungkan ke WhatsApp Gateway...
                </h4>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, maxWidth: 280, margin: '6px auto 0' }}>
                  Memeriksa modul Baileys WA. Pastikan container WhatsApp Gateway berjalan di VPS.
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons Gateway */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleReload}
              disabled={reloading}
              title="Reload sesi gateway untuk membuat QR baru"
              style={{ fontSize: 12.5 }}
            >
              <RefreshCw size={13} className={reloading ? 'spin' : ''} />
              {reloading ? 'Merefresh...' : 'Reload Gateway'}
            </button>
            {status.connected && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{ fontSize: 12.5 }}
              >
                <LogOut size={13} /> {disconnecting ? 'Memutuskan...' : 'Putuskan Sesi'}
              </button>
            )}
          </div>
        </div>

        {/* KARTU 2: Form Konfigurasi Target Notifikasi */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 18 }}>
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} color="var(--purple-main)" /> Pengaturan Pengiriman
            </span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#25D366' }}
              />
              <span>Aktifkan Notifikasi WA</span>
            </label>
          </div>

          <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Tipe Target (Personal vs Grup) */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Tujuan Pengiriman
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setTargetType('personal')}
                  className={`btn ${targetType === 'personal' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ justifyContent: 'center', fontSize: 13 }}
                >
                  <Smartphone size={14} /> Nomor Pribadi
                </button>
                <button
                  type="button"
                  onClick={() => setTargetType('group')}
                  className={`btn ${targetType === 'group' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ justifyContent: 'center', fontSize: 13 }}
                >
                  <Users size={14} /> Grup WhatsApp
                </button>
              </div>
            </div>

            {/* Input Personal Phone */}
            {targetType === 'personal' && (
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Nomor WhatsApp Tujuan
                </label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="08123456789 atau 628123456789"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  style={{ width: '100%', fontSize: 13.5 }}
                />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  * Otomatis dikonversi ke format internasional (misal 628xxx@s.whatsapp.net).
                </p>
              </div>
            )}

            {/* Input Group Selector */}
            {targetType === 'group' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Pilih Grup WhatsApp
                  </label>
                  <button
                    type="button"
                    onClick={fetchGroups}
                    disabled={loadingGroups || !status.connected}
                    style={{ background: 'none', border: 'none', color: 'var(--purple-main)', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <RefreshCw size={12} className={loadingGroups ? 'spin' : ''} /> Refresh Daftar
                  </button>
                </div>

                {!status.connected ? (
                  <div style={{ padding: 12, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
                    Scan QR terlebih dahulu agar bot dapat membaca daftar grup yang diikuti.
                  </div>
                ) : groups.length === 0 ? (
                  <div style={{ padding: 12, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)' }}>
                    {loadingGroups ? 'Memuat daftar grup...' : 'Belum ada grup yang ditemukan. Pastikan bot sudah dimasukkan ke grup WA Anda.'}
                  </div>
                ) : (
                  <select
                    className="input-select"
                    style={{ width: '100%', fontSize: 13 }}
                    value={selectedGroup}
                    onChange={e => setSelectedGroup(e.target.value)}
                  >
                    <option value="">-- Pilih Grup WhatsApp --</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.participants} anggota)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Pengaturan Reminder Harian Otomatis */}
            <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={15} color="var(--purple-main)" /> Reminder Harian Otomatis
                </span>
                <input
                  type="checkbox"
                  checked={reminderAuto}
                  onChange={e => setReminderAuto(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#25D366' }}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Kirim daftar akun Starlink yang jatuh tempo suspend pada tanggal tersebut secara otomatis setiap hari.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Jam Kirim (WIB):
                </label>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                  disabled={!reminderAuto}
                  className="input-text"
                  style={{ width: 110, fontSize: 13, padding: '4px 8px' }}
                />
              </div>
            </div>

            {/* Feedback Messages */}
            {saveSuccess && (
              <div style={{ padding: '10px 14px', background: '#dcfce7', color: '#15803d', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} /> {saveSuccess}
              </div>
            )}
            {saveError && (
              <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#b91c1c', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={16} /> {saveError}
              </div>
            )}
            {testResult && (
              <div style={{
                padding: '10px 14px',
                background: testResult.ok ? '#dcfce7' : '#fee2e2',
                color: testResult.ok ? '#15803d' : '#b91c1c',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}

            {/* Action Buttons Form */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleTest}
                disabled={testing || !status.connected || (!phone && !selectedGroup)}
                title="Kirim pesan uji coba ke target yang dipilih"
                style={{ fontSize: 12.5 }}
              >
                <Send size={13} />
                {testing ? 'Mengirim...' : 'Uji Coba Kirim'}
              </button>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{ fontSize: 13 }}
              >
                <Save size={14} />
                {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
          </form>
        </div>

      </div>

      {/* KARTU BESAR: Fitur Reminder Starlink Jatuh Tempo Suspend */}
      <div className="card" style={{ marginBottom: 24, border: '1px solid var(--purple-main)', boxShadow: '0 4px 18px rgba(107, 70, 193, 0.08)' }}>
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Calendar size={20} color="var(--purple-main)" />
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                Daftar Starlink Jatuh Tempo Suspend
              </h2>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#ede9fe', color: 'var(--purple-main)', padding: '2px 8px', borderRadius: 12 }}>
                Reminder Fitur
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
              Daftar akun & terminal Starlink yang jatuh tempo suspend pada tanggal yang dipilih dan akan dikirimkan via WhatsApp.
            </p>
          </div>

          {/* Kontrol Pemilihan Tanggal & Tombol Kirim */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Pilih Tanggal:</label>
              <select
                className="input-select"
                value={selectedDay}
                onChange={e => setSelectedDay(Number(e.target.value))}
                style={{ fontWeight: 600, fontSize: 13, minWidth: 120 }}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>
                    Tanggal {d} {d === todayDay ? '(Hari ini)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className={`btn ${selectedDay === todayDay ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSelectedDay(todayDay)}
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              Hari Ini (Tgl {todayDay})
            </button>

            <button
              type="button"
              className="btn btn-blue"
              onClick={handleSendReminder}
              disabled={sendingReminder || !status.connected || !effectiveJid}
              style={{ fontSize: 13, gap: 6, fontWeight: 600 }}
              title="Kirim daftar reminder suspend tanggal ini ke WhatsApp sekarang"
            >
              <Send size={14} />
              {sendingReminder ? 'Mengirim Reminder...' : `Kirim Reminder Tgl ${selectedDay}`}
            </button>
          </div>
        </div>

        {/* Feedback Pengiriman Reminder */}
        {reminderSendResult && (
          <div style={{
            margin: '16px 0 0',
            padding: '12px 16px',
            background: reminderSendResult.ok ? '#dcfce7' : '#fee2e2',
            color: reminderSendResult.ok ? '#15803d' : '#b91c1c',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            {reminderSendResult.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            {reminderSendResult.message}
          </div>
        )}

        {/* Ringkasan Statistik Tanggal Terpilih */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, margin: '18px 0' }}>
          <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 16px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tanggal Jatuh Tempo</span>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--purple-main)', marginTop: 4 }}>
              Tanggal {selectedDay}
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {reminderPreview?.target_date_display || `Tanggal ${selectedDay}`}
            </span>
          </div>

          <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 16px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Akun</span>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
              {reminderPreview ? reminderPreview.total_accounts : '-'} Akun
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Akan di-suspend</span>
          </div>

          <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 16px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Terminal</span>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
              {reminderPreview ? reminderPreview.total_kits : '-'} Unit
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Perangkat Starlink</span>
          </div>

          <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-light)', borderRadius: 10, padding: '12px 16px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Kirim WA</span>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {effectiveJid || '(Belum diset)'}
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {targetType === 'personal' ? 'Nomor Pribadi' : 'Grup WhatsApp'}
            </span>
          </div>
        </div>

        {/* Tabel / List Akun yang Akan di-Suspend */}
        <div style={{ marginTop: 8 }}>
          {loadingPreview ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
              <RefreshCw size={20} className="spin" style={{ margin: '0 auto 8px', display: 'block' }} />
              Memuat daftar akun Starlink untuk Tanggal {selectedDay}...
            </div>
          ) : !reminderPreview || reminderPreview.total_accounts === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', background: '#f8fafc', borderRadius: 10, border: '1px dashed #cbd5e1' }}>
              <CheckCircle2 size={32} color="#16a34a" style={{ margin: '0 auto 10px', display: 'block' }} />
              <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', margin: '0 0 4px' }}>
                Tidak Ada Akun yang Jatuh Tempo Suspend pada Tanggal {selectedDay}
              </h4>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto' }}>
                Semua akun dalam status aman atau tidak ada akun dengan tanggal suspend {selectedDay} yang tercatat di database.
              </p>
            </div>
          ) : (
            <div className="table-responsive" style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: 8 }}>
              <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 2 }}>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}>No</th>
                    <th>Nama Akun / Controller</th>
                    <th>Nomor Akun</th>
                    <th style={{ textAlign: 'center' }}>Tanggal Suspend</th>
                    <th>Terminal Starlink (Kits)</th>
                  </tr>
                </thead>
                <tbody>
                  {reminderPreview.accounts.map((acc, idx) => (
                    <tr key={acc.id || idx}>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ fontWeight: 700, color: 'var(--text-main)' }}>{acc.account_name}</td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-subtle)', padding: '2px 6px', borderRadius: 4 }}>
                          {acc.account_number}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: '#fff8e1',
                          color: '#b45309',
                          fontWeight: 700,
                          fontSize: 11.5
                        }}>
                          <Calendar size={11} /> Tgl {acc.suspend_date}
                        </span>
                      </td>
                      <td>
                        {acc.kits && acc.kits.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {acc.kits.map((k, ki) => (
                              <div key={k.id || ki} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600 }}>{k.site || k.kit}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({k.kit})</span>
                                <span style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: k.status === 'active' ? '#dcfce7' : k.status === 'suspended' ? '#fee2e2' : '#fef3c7',
                                  color: k.status === 'active' ? '#15803d' : k.status === 'suspended' ? '#b91c1c' : '#b45309'
                                }}>
                                  {k.status ? k.status.toUpperCase() : 'UNKNOWN'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Tidak ada terminal terdaftar</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Row Bawah: Pratinjau Tampilan Pesan WhatsApp & Panduan */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 24 }}>
        
        {/* Mockup Chat WhatsApp dengan Teks Reminder Aktual */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Pratinjau Pesan Reminder di WhatsApp</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleCopyMessage}
              disabled={!reminderPreview?.message}
              style={{ fontSize: 12, padding: '4px 10px', gap: 5 }}
              title="Salin teks pesan ke clipboard"
            >
              {copied ? <Check size={13} color="#16a34a" /> : <Copy size={13} />}
              {copied ? 'Tersalin!' : 'Salin Pesan'}
            </button>
          </div>

          <div style={{
            background: '#efeae2',
            backgroundImage: 'radial-gradient(#d1d7db 1px, transparent 1px)',
            backgroundSize: '16px 16px',
            borderRadius: 'var(--radius-md)',
            padding: '18px 14px',
            border: '1px solid #d1d7db',
            maxHeight: 460,
            overflowY: 'auto'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '8px 8px 8px 0px',
              padding: '14px 16px',
              maxWidth: 420,
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              position: 'relative',
              fontSize: 12.5,
              lineHeight: 1.6,
              color: '#111b21',
              fontFamily: 'Segoe UI, -apple-system, sans-serif',
              whiteSpace: 'pre-wrap'
            }}>
              {reminderPreview?.message || (
                '🛰️ *PENGINGAT JATUH TEMPO SUSPEND STARLINK*\nMemuat pratinjau pesan...'
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 10.5, color: '#667781' }}>
                <span>{reminderTime || '08:00'}</span>
                <CheckCheck size={14} color="#53bdeb" />
              </div>
            </div>
          </div>
        </div>

        {/* Informasi Cara Kerja Reminder Suspend */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Bagaimana Cara Kerja Pengingat Suspend?</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#eff6ff', border: '1px solid #dbeafe', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>📅</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1e40af' }}>1. Pencocokan Tanggal Suspend Akun</div>
                <div style={{ fontSize: 12, color: '#1e3a8a', marginTop: 2, lineHeight: 1.4 }}>
                  Sistem membaca <code>suspend_date</code> pada masing-masing akun (dapat diatur di menu Akun). Akun yang tanggalnya sesuai dengan hari berjalan akan otomatis dikelompokkan.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#f0fdf4', border: '1px solid #dcfce7', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>⏰</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#166534' }}>2. Pengiriman Otomatis Harian</div>
                <div style={{ fontSize: 12, color: '#14532d', marginTop: 2, lineHeight: 1.4 }}>
                  Scheduler otomatis memeriksa tanggal hari ini dan mengirimkan daftar reminder tepat pada jam yang ditentukan (misalnya pukul <b>{reminderTime} WIB</b>) setiap pagi.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fef3c7', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>📲</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>3. Pengiriman Manual On-Demand</div>
                <div style={{ fontSize: 12, color: '#78350f', marginTop: 2, lineHeight: 1.4 }}>
                  Anda dapat memilih tanggal mana saja (1–31) dan menekan tombol <b>Kirim Reminder</b> kapan saja untuk mengirim pengingat secara instan ke tim tanpa menunggu jadwal otomatis.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fee2e2', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b' }}>4. Pencegahan Layanan Terputus</div>
                <div style={{ fontSize: 12, color: '#7f1d1d', marginTop: 2, lineHeight: 1.4 }}>
                  Dengan adanya notifikasi reminder ini, tim operasional / keuangan dapat segera memproses pembayaran atau perpanjangan sebelum layanan terminal diputus/disuspend oleh Starlink.
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
