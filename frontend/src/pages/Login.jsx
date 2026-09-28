import React, { useEffect, useRef, useState } from 'react'
import { LogIn, ShieldCheck, AlertTriangle } from 'lucide-react'
import { getAuthStatus, logout as apiLogout } from '../api'
import { wsConnect } from '../api'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPass] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('idle') // idle|connecting|otp_required|done|failed
  const [messages, setMessages] = useState([])
  const [sessionStatus, setSessionStatus] = useState(null)
  const wsRef = useRef(null)

  useEffect(() => {
    getAuthStatus().then(setSessionStatus).catch(() => {})
    return () => wsRef.current?.close()
  }, [])

  const addMsg = (msg) => setMessages(prev => [...prev, msg])

  const handleStart = () => {
    if (!email || !password) return
    setMessages([])
    setStep('connecting')
    setOtp('')

    const ws = wsConnect('/api/auth/ws')
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'start_login', email, password }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.event === 'status') addMsg({ type: 'info', text: msg.message })
      if (msg.event === 'otp_required') { setStep('otp_required'); addMsg({ type: 'warn', text: msg.message }) }
      if (msg.event === 'login_success') {
        setStep('done')
        addMsg({ type: 'ok', text: msg.message })
        getAuthStatus().then(setSessionStatus).catch(() => {})
      }
      if (msg.event === 'login_failed') {
        setStep('failed')
        addMsg({ type: 'error', text: msg.message })
      }
      if (msg.event === 'error') {
        setStep('failed')
        addMsg({ type: 'error', text: msg.message })
      }
    }
    ws.onclose = () => {
      if (step === 'connecting' || step === 'otp_required') {
        setStep('failed')
        addMsg({ type: 'error', text: 'Koneksi WebSocket terputus.' })
      }
    }
  }

  const handleOtp = () => {
    if (!otp.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ action: 'submit_otp', otp: otp.trim() }))
    addMsg({ type: 'info', text: `OTP "${otp}" dikirim. Memverifikasi...` })
    setOtp('')
    setStep('connecting')
  }

  const handleLogout = async () => {
    await apiLogout().catch(() => {})
    setSessionStatus({ is_valid: false })
    setStep('idle')
    setMessages([])
  }

  const msgColor = {
    info: 'var(--text-secondary)',
    warn: 'var(--amber-text)',
    ok: 'var(--green-text)',
    error: 'var(--red-text)'
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Login Starlink</h1>
        <p className="page-subtitle">Kelola sesi autentikasi akun Starlink utama untuk scraping</p>
      </div>

      <div className="login-layout-grid">
        {/* Form Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Session Status Card */}
          <div className="card">
            <div className="card-body" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {sessionStatus?.is_valid ? (
                  <>
                    <div style={{ background: '#e8f5e9', padding: 8, borderRadius: 10, color: 'var(--green-text)' }}>
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--green-text)', fontSize: 14 }}>Sesi Aktif & Valid</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        Terakhir update: {sessionStatus.updated_at ? new Date(sessionStatus.updated_at).toLocaleString('id-ID') : '-'}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 12px' }}
                      onClick={handleLogout}
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ background: '#fff8e1', padding: 8, borderRadius: 10, color: 'var(--amber-text)' }}>
                      <AlertTriangle size={24} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--amber-text)', fontSize: 14 }}>Sesi Tidak Aktif</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        Perlu login untuk otorisasi sesi scraper.
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Login Credentials Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">{step === 'done' ? 'Login Berhasil' : 'Form Autentikasi'}</span>
            </div>

            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                    Email Akun Starlink
                  </label>
                  <input
                    className="search-input"
                    style={{ width: '100%' }}
                    type="email"
                    placeholder="email@domain.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={step !== 'idle' && step !== 'failed' && step !== 'done'}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                    Password
                  </label>
                  <input
                    className="search-input"
                    style={{ width: '100%' }}
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPass(e.target.value)}
                    disabled={step !== 'idle' && step !== 'failed' && step !== 'done'}
                  />
                </div>

                {step === 'otp_required' && (
                  <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple-main)', marginBottom: 4 }}>
                      Masukkan Kode OTP
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                      Starlink mengirim kode verifikasi ke email / SMS Anda.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="search-input"
                        style={{ flex: 1, textAlign: 'center', fontSize: 18, letterSpacing: 6, fontWeight: 700 }}
                        type="text"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="______"
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleOtp()}
                        autoFocus
                      />
                      <button className="btn btn-primary" onClick={handleOtp} disabled={!otp.trim()}>
                        Verifikasi
                      </button>
                    </div>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px 18px', fontSize: 14, marginTop: 4 }}
                  onClick={step === 'idle' || step === 'failed' || step === 'done' ? handleStart : undefined}
                  disabled={step === 'connecting' || step === 'otp_required' || !email || !password}
                >
                  {step === 'connecting' ? (
                    <>
                      <span className="spinner" style={{ width: 16, height: 16 }} />
                      <span>Menghubungkan ke Starlink...</span>
                    </>
                  ) : step === 'otp_required' ? (
                    'Menunggu Verifikasi OTP...'
                  ) : (
                    <>
                      <LogIn size={16} />
                      <span>Login ke Starlink</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Console Log */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Console Log Autentikasi</span>
          </div>
          <div style={{ padding: '20px 24px', minHeight: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                // Log proses autentikasi akan muncul di sini...
              </span>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  color: msgColor[m.type] || 'var(--text-primary)',
                  display: 'flex',
                  gap: 10,
                  padding: '4px 0',
                  borderBottom: '1px solid var(--border-light)'
                }}
              >
                <span style={{ color: 'var(--text-light)', fontSize: 11, flexShrink: 0, marginTop: 2, fontFamily: 'monospace' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontWeight: m.type === 'ok' || m.type === 'error' ? 600 : 400 }}>
                  {m.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
