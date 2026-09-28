import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Plus, RefreshCw, Trash2, CheckCircle2, AlertTriangle,
  LogIn, ShieldCheck, ToggleLeft, ToggleRight, Radio, ExternalLink, Play
} from 'lucide-react'
import {
  getParentAccounts, createParentAccount, toggleParentAccount,
  deleteParentAccount, wsConnect, startScrape
} from '../api'

export default function ParentAccounts() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [formData, setFormData] = useState({ account_name: '', email: '', password: '' })
  const [submitting, setSubmitting] = useState(false)

  // Login Modal State
  const [loginModalAccount, setLoginModalAccount] = useState(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loginStep, setLoginStep] = useState('idle') // idle | connecting | otp_required | done | failed
  const [loginLogs, setLoginLogs] = useState([])
  const wsRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getParentAccounts()
      setAccounts(data || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    return () => wsRef.current?.close()
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!formData.account_name || !formData.email) return
    setSubmitting(true)
    try {
      await createParentAccount(formData)
      setShowAddModal(false)
      setFormData({ account_name: '', email: '', password: '' })
      load()
    } catch (e) {
      alert(e.message)
    }
    setSubmitting(false)
  }

  const handleToggle = async (id) => {
    try {
      await toggleParentAccount(id)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Yakin ingin menghapus Akun Induk "${name}"? Sub-akun yang ada tidak akan terhapus.`)) return
    try {
      await deleteParentAccount(id)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const handleScrapeSingle = async (acc) => {
    if (!acc.is_valid) {
      alert(`Akun "${acc.account_name}" belum memiliki sesi login valid. Silakan klik "Login" terlebih dahulu.`)
      return
    }
    try {
      await startScrape(3, acc.id)
      navigate('/scraping')
    } catch (e) {
      alert(`Gagal memulai scraping: ${e.message}`)
    }
  }

  // Login Handlers
  const openLoginModal = (acc) => {
    setLoginModalAccount(acc)
    setLoginEmail(acc.email)
    setLoginPassword(acc.password || '')
    setOtp('')
    setLoginStep('idle')
    setLoginLogs([])
  }

  const startLoginWS = () => {
    if (!loginEmail || !loginPassword) return
    setLoginLogs([])
    setLoginStep('connecting')
    setOtp('')

    const ws = wsConnect('/api/auth/ws')
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: 'start_login',
        email: loginEmail,
        password: loginPassword,
        parent_account_id: loginModalAccount.id
      }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'status') {
          setLoginLogs(prev => [...prev, { type: 'info', text: msg.message }])
        } else if (msg.event === 'otp_required') {
          setLoginStep('otp_required')
          setLoginLogs(prev => [...prev, { type: 'warn', text: msg.message }])
        } else if (msg.event === 'login_success') {
          setLoginStep('done')
          setLoginLogs(prev => [...prev, { type: 'ok', text: msg.message }])
          load()
        } else if (msg.event === 'login_failed' || msg.event === 'error') {
          setLoginStep('failed')
          setLoginLogs(prev => [...prev, { type: 'error', text: msg.message }])
        }
      } catch {}
    }

    ws.onclose = () => {
      if (loginStep === 'connecting' || loginStep === 'otp_required') {
        setLoginStep('failed')
        setLoginLogs(prev => [...prev, { type: 'error', text: 'Koneksi terputus.' }])
      }
    }
  }

  const submitOtp = () => {
    if (!otp.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ action: 'submit_otp', otp: otp.trim() }))
    setLoginLogs(prev => [...prev, { type: 'info', text: `OTP "${otp}" dikirim. Memverifikasi...` }])
    setOtp('')
    setLoginStep('connecting')
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 className="page-title">Manajemen Akun Induk</h1>
          <p className="page-subtitle">Kelola multi-akun Starlink utama untuk scraping otomatis</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin .7s linear infinite' : '' }} />
            <span>Refresh</span>
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={15} />
            <span>Tambah Akun Induk</span>
          </button>
        </div>
      </div>

      {/* Grid of Parent Accounts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 20, marginBottom: 30 }}>
        {accounts.map(acc => (
          <div key={acc.id} className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: acc.is_valid ? '#e8f5e9' : '#fff8e1',
                  color: acc.is_valid ? '#2e7d32' : '#f57f17',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Building2 size={22} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{acc.account_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{acc.email}</div>
                </div>
              </div>

              <button
                onClick={() => handleToggle(acc.id)}
                title={acc.is_active ? 'Nonaktifkan dari scheduler' : 'Aktifkan untuk scheduler'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: acc.is_active ? 'var(--green-main)' : 'var(--text-light)' }}
              >
                {acc.is_active ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sub-Accounts</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{acc.sub_account_count} Akun</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Perangkat</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--purple-main)' }}>{acc.total_kits} KIT</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>Status Sesi:</span>
              {acc.is_valid ? (
                <span className="badge active">● Terotentikasi</span>
              ) : (
                <span className="badge restricted">● Butuh Login / OTP</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Scraped: {acc.last_scraped_at ? new Date(acc.last_scraped_at).toLocaleString('id-ID', {
                  timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                }) : 'Belum pernah'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: 12, color: 'var(--purple-main)', fontWeight: 600 }}
                  onClick={() => handleScrapeSingle(acc)}
                  title={`Scrape akun ${acc.account_name} sekarang`}
                >
                  <Play size={13} />
                  <span>Scrape</span>
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => openLoginModal(acc)}
                >
                  <LogIn size={13} />
                  <span>Login</span>
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: 12, color: 'var(--red-main)' }}
                  onClick={() => handleDelete(acc.id, acc.account_name)}
                  title="Hapus akun induk"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {accounts.length === 0 && !loading && (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
            Belum ada akun induk terdaftar. Klik tombol "+ Tambah Akun Induk" di atas untuk menambahkan.
          </div>
        )}
      </div>

      {/* Modal Add Account */}
      {showAddModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card" style={{ width: 440, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Tambah Akun Induk Starlink</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Masukkan identitas akun Starlink utama yang akan dipantau.
            </p>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Nama Label Akun
                </label>
                <input
                  className="search-input"
                  style={{ width: '100%' }}
                  placeholder="Misal: PT ABC - Starlink Utama"
                  value={formData.account_name}
                  onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Email Starlink
                </label>
                <input
                  className="search-input"
                  style={{ width: '100%' }}
                  type="email"
                  placeholder="email@starlink.com"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Password (Opsional)
                </label>
                <input
                  className="search-input"
                  style={{ width: '100%' }}
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddModal(false)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Menyimpan...' : 'Simpan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Login & OTP Relay */}
      {loginModalAccount && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card" style={{ width: 500, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              Login: {loginModalAccount.account_name}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
              {loginModalAccount.email}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              <input
                className="search-input"
                style={{ width: '100%' }}
                type="email"
                placeholder="Email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                disabled={loginStep === 'connecting' || loginStep === 'otp_required'}
              />
              <input
                className="search-input"
                style={{ width: '100%' }}
                type="password"
                placeholder="Password Starlink"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                disabled={loginStep === 'connecting' || loginStep === 'otp_required'}
              />

              {loginStep === 'otp_required' && (
                <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple-main)', marginBottom: 4 }}>
                    Masukkan Kode OTP
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Periksa email atau nomor HP yang terdaftar pada Starlink untuk kode verifikasi.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="search-input"
                      style={{ flex: 1, textAlign: 'center', letterSpacing: 4, fontWeight: 700, fontSize: 16 }}
                      placeholder="Contoh: 123456"
                      value={otp}
                      onChange={e => setOtp(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submitOtp()}
                      autoFocus
                    />
                    <button className="btn btn-primary" onClick={submitOtp} disabled={!otp.trim()}>
                      Kirim OTP
                    </button>
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={startLoginWS}
                disabled={loginStep === 'connecting' || loginStep === 'otp_required' || !loginEmail || !loginPassword}
              >
                {loginStep === 'connecting' ? 'Menghubungkan...' : loginStep === 'done' ? 'Autentikasi Ulang' : 'Mulai Autentikasi'}
              </button>
            </div>

            {/* Logs Terminal */}
            <div
              className="log-terminal"
              style={{ height: 160, fontSize: 11.5, marginBottom: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
              ref={el => el && (el.scrollTop = el.scrollHeight)}
            >
              {loginLogs.length === 0 ? '// Log koneksi akan tampil di sini...' : loginLogs.map((l, i) => (
                <div key={i} className={l.type === 'error' ? 'log-error' : l.type === 'ok' ? 'log-ok' : l.type === 'warn' ? 'log-warn' : ''}>
                  {l.text}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setLoginModalAccount(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
