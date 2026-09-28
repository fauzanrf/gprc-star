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
  Info
} from 'lucide-react'
import {
  getWhatsAppStatus,
  getWhatsAppGroups,
  getWhatsAppConfig,
  saveWhatsAppConfig,
  sendWhatsAppTest,
  disconnectWhatsApp
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

  // Actions State
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState('')
  const [saveError, setSaveError] = useState('')

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // { ok: bool, message: str }

  const [disconnecting, setDisconnecting] = useState(false)

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

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (status.connected) {
      fetchGroups()
    }
  }, [status.connected, fetchGroups])

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

  // Handle Save
  const handleSave = async (e) => {
    if (e) e.preventDefault()
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
        wa_target_phone: phone
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
      const res = await sendWhatsAppTest({ to: targetToTest })
      setTestResult({ ok: true, message: res.message || 'Pesan uji coba berhasil terkirim!' })
    } catch (err) {
      setTestResult({ ok: false, message: err.message || 'Gagal mengirim pesan uji coba.' })
    } finally {
      setTesting(false)
    }
  }

  // Handle Disconnect
  const handleDisconnect = async () => {
    if (!window.confirm('Yakin ingin memutuskan koneksi WhatsApp? Anda harus scan QR ulang untuk menghubungkan kembali.')) {
      return
    }
    setDisconnecting(true)
    try {
      await disconnectWhatsApp()
      fetchAll()
    } catch (err) {
      alert('Gagal disconnect: ' + err.message)
    } finally {
      setDisconnecting(false)
    }
  }

  const effectiveJid = targetType === 'personal' ? formatPhoneToJid(phone) : selectedGroup

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#25D366', display: 'flex' }}><MessageSquare size={26} /></span>
            Notifikasi WhatsApp
          </h1>
          <p className="page-subtitle">
            Kelola koneksi WhatsApp Gateway, nomor tujuan notifikasi, dan kirim pesan alert otomatis
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={fetchAll}
          disabled={loadingStatus}
          style={{ fontSize: 13, gap: 6 }}
        >
          <RefreshCw size={14} className={loadingStatus ? 'spin' : ''} />
          Refresh Status
        </button>
      </div>

      {/* Grid Utama */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24, marginBottom: 24 }}>
        
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
                  fontWeight: 700,
                  background: status.connected ? '#e8f5e9' : (status.hasQR ? '#fff8e1' : '#ffebee'),
                  color: status.connected ? '#2e7d32' : (status.hasQR ? '#b45309' : '#c62828'),
                  border: `1px solid ${status.connected ? '#c8e6c9' : (status.hasQR ? '#fde68a' : '#ffcdd2')}`
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: status.connected ? '#00c853' : (status.hasQR ? '#f59e0b' : '#ef4444'),
                    boxShadow: status.connected ? '0 0 8px #00c853' : 'none'
                  }}
                />
                {status.connected ? 'Terhubung (Online)' : (status.hasQR ? 'Menunggu Scan QR' : 'Terputus (Offline)')}
              </span>
            </div>

            {status.connected ? (
              <div style={{ background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 18, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                      WhatsApp Sesi Aktif
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Baileys Multi-File Auth Session &bull; Siap Kirim
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Gateway aktif melayani permintaan notifikasi. Setiap ada perubahan status (Suspended, ToS, atau Pulih) pada terminal Starlink, sistem akan otomatis mengirimkan pesan ke target yang Anda tentukan di bawah.
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px 8px', background: '#f8fafc', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 20 }}>
                {status.qr ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                      Scan QR Code dengan WhatsApp
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                      Buka WhatsApp di HP &rarr; Menu Titik Tiga / Pengaturan &rarr; <b>Perangkat Tertaut</b> &rarr; <b>Tautkan Perangkat</b>
                    </p>
                    <div style={{ display: 'inline-block', padding: 8, background: '#ffffff', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                      <img src={status.qr} alt="QR Code WhatsApp" style={{ width: 220, height: 220, display: 'block' }} />
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 10 }}>
                      QR diperbarui otomatis setiap 30 detik.
                    </p>
                  </div>
                ) : (
                  <div style={{ padding: '24px 0' }}>
                    <QrCode size={36} color="var(--text-light)" style={{ marginBottom: 10 }} />
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                      Menghubungkan ke WhatsApp Gateway...
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Silakan tunggu beberapa saat atau klik Refresh Status.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {status.connected && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{ fontSize: 12.5, color: '#dc2626', borderColor: '#fecaca', gap: 6 }}
              >
                <LogOut size={13} /> {disconnecting ? 'Memutuskan...' : 'Putuskan Sesi WhatsApp'}
              </button>
            </div>
          )}
        </div>

        {/* KARTU 2: Pengaturan Target Notifikasi (Nomor Sendiri / Grup) */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 16 }}>
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} color="var(--purple-main)" /> Target Notifikasi
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: enabled ? 'var(--purple-main)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--purple-main)', cursor: 'pointer' }}
                />
                Notifikasi Aktif
              </label>
            </div>
          </div>

          <form onSubmit={handleSave}>
            {/* Tab Pilihan: Nomor Pribadi vs Grup */}
            <div style={{ display: 'flex', background: '#f1f5f9', padding: 4, borderRadius: 'var(--radius-sm)', marginBottom: 20 }}>
              <button
                type="button"
                onClick={() => setTargetType('personal')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: targetType === 'personal' ? '#ffffff' : 'transparent',
                  color: targetType === 'personal' ? 'var(--purple-main)' : 'var(--text-secondary)',
                  boxShadow: targetType === 'personal' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <Smartphone size={14} /> Nomor Pribadi Saya
              </button>
              <button
                type="button"
                onClick={() => setTargetType('group')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: targetType === 'group' ? '#ffffff' : 'transparent',
                  color: targetType === 'group' ? 'var(--purple-main)' : 'var(--text-secondary)',
                  boxShadow: targetType === 'group' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <Users size={14} /> Grup WhatsApp
              </button>
            </div>

            {/* Input Nomor Pribadi */}
            {targetType === 'personal' && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Nomor WhatsApp Anda:
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="search-input"
                    style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
                    placeholder="Contoh: 08123456789 atau 628123456789"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                  />
                </div>
                {phone && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Info size={13} color="var(--purple-main)" />
                    Format tujuan WhatsApp: <code style={{ color: 'var(--purple-main)', fontWeight: 600 }}>{formatPhoneToJid(phone)}</code>
                  </div>
                )}
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  * Anda dapat memasukkan awalan <code>08...</code> atau <code>628...</code>. Sistem otomatis mengonversi ke format internasional.
                </p>
              </div>
            )}

            {/* Input Pilihan Grup */}
            {targetType === 'group' && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Pilih Grup WhatsApp Tujuan:
                </label>
                {loadingGroups ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>
                    <span className="spinner-dark" style={{ verticalAlign: 'middle', marginRight: 8 }} />
                    Memuat daftar grup WhatsApp yang diikuti bot...
                  </div>
                ) : (
                  <select
                    className="filter-select"
                    style={{ width: '100%', fontSize: 13.5, padding: '9px 12px' }}
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
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  * Bot harus sudah bergabung di grup tersebut agar dapat mengirimkan pesan alert.
                </p>
              </div>
            )}

            {/* Feedback Pesan */}
            {saveSuccess && (
              <div style={{ padding: '10px 14px', background: '#dcfce7', color: '#15803d', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} /> {saveSuccess}
              </div>
            )}

            {saveError && (
              <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#b91c1c', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                {testResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {testResult.message}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
              <button
                type="button"
                className="btn btn-blue"
                onClick={handleTest}
                disabled={testing || !status.connected || (!phone && !selectedGroup)}
                title="Kirim pesan tes ke nomor / grup yang dipilih"
              >
                <Send size={14} />
                {testing ? 'Mengirim Tes...' : 'Kirim Pesan Uji Coba'}
              </button>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                <Save size={14} />
                {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
          </form>
        </div>

      </div>

      {/* Row Bawah: Pratinjau Tampilan Pesan WhatsApp & Panduan */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 }}>
        
        {/* Mockup Chat WhatsApp */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Pratinjau Pesan di WhatsApp Anda</span>
          </div>

          <div style={{
            background: '#efeae2',
            backgroundImage: 'radial-gradient(#d1d7db 1px, transparent 1px)',
            backgroundSize: '16px 16px',
            borderRadius: 'var(--radius-md)',
            padding: '20px 16px',
            border: '1px solid #d1d7db'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '8px 8px 8px 0px',
              padding: '12px 14px',
              maxWidth: 380,
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              position: 'relative',
              fontSize: 12.8,
              lineHeight: 1.5,
              color: '#111b21',
              fontFamily: 'Segoe UI, -apple-system, sans-serif'
            }}>
              <div style={{ fontWeight: 700, color: '#075e54', marginBottom: 2 }}>
                🛰️ Starlink GPRC Alert
              </div>
              <div style={{ fontSize: 11, color: '#667781', marginBottom: 10 }}>
                📅 24 Sep 2026, 05:15 WIB
              </div>

              <div style={{ marginBottom: 10 }}>
                <span style={{ color: '#ea0038', fontWeight: 700 }}>🔴 SUSPENDED (1 terminal baru):</span>
                <div style={{ paddingLeft: 8, marginTop: 3 }}>
                  &bull; AKUN DaySpring &mdash; POS Pengaman Karang Anyar
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <span style={{ color: '#00a884', fontWeight: 700 }}>✅ PULIH (1 terminal):</span>
                <div style={{ paddingLeft: 8, marginTop: 3 }}>
                  &bull; DSG-KANTOR DIST &mdash; DSG Site Camp 2
                </div>
              </div>

              <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 8, fontSize: 11.5, color: '#54656f' }}>
                📊 <b>Total: 119 terminal</b><br />
                ✅ Aktif: 115 &bull; 🔴 Suspended: 2 &bull; ⚠️ Dibatasi: 1 &bull; ⬛ Offline: 1
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10.5, color: '#667781' }}>
                <span>05:15</span>
                <CheckCheck size={14} color="#53bdeb" />
              </div>
            </div>
          </div>
        </div>

        {/* Informasi Jenis Alert */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Kapan Notifikasi Dikirimkan?</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fee2e2', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🔴</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b' }}>Terminal Suspended (Kendala Pembayaran)</div>
                <div style={{ fontSize: 12, color: '#7f1d1d', marginTop: 2, lineHeight: 1.4 }}>
                  Notifikasi dikirim seketika saat sub-akun terdeteksi suspended atau belum dibayar oleh pelanggan.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fef3c7', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>Terminal Dibatasi / Fair Use ToS</div>
                <div style={{ fontSize: 12, color: '#78350f', marginTop: 2, lineHeight: 1.4 }}>
                  Pemberitahuan bila ada perangkat Starlink yang dibatasi kecepatannya karena pelanggaran ketentuan layanan atau kuota limit.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#f0fdf4', border: '1px solid #dcfce7', padding: 12, borderRadius: 8 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>✅</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#166534' }}>Terminal Pulih (Recovered)</div>
                <div style={{ fontSize: 12, color: '#14532d', marginTop: 2, lineHeight: 1.4 }}>
                  Konfirmasi saat terminal yang sebelumnya bermasalah telah diselesaikan pembayarannya dan aktif kembali.
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
