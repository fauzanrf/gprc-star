import React, { useEffect, useRef, useState } from 'react'
import { Play, RefreshCw, Clock, Terminal, Activity, CheckCircle2, AlertCircle, Building2, Square } from 'lucide-react'
import { startScrape, cancelScrape, getScrapeStatus, getScrapeJobs, getParentAccounts } from '../api'
import { wsConnect } from '../api'

export default function Scraping() {
  const [workers, setWorkers] = useState(2)
  const [parentAccounts, setParentAccounts] = useState([])
  const [selectedParentId, setSelectedParentId] = useState('')
  const [status, setStatus] = useState(null)
  const [jobs, setJobs] = useState([])
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const wsRef = useRef(null)
  const logRef = useRef(null)

  const loadStatus = async () => {
    const s = await getScrapeStatus().catch(() => null)
    setStatus(s)
    setRunning(s?.status === 'running' || s?.status === 'pending')
  }

  const loadJobs = async () => {
    const j = await getScrapeJobs().catch(() => [])
    setJobs(j || [])
  }

  const loadParents = async () => {
    const p = await getParentAccounts().catch(() => [])
    setParentAccounts(p || [])
  }

  useEffect(() => {
    loadStatus()
    loadJobs()
    loadParents()

    const ws = wsConnect('/api/scrape/ws')
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'log') {
          setLogs(prev => [...prev.slice(-999), msg.message])
        } else if (msg.type === 'job_done' || msg.type === 'job_failed') {
          setRunning(false)
          setCancelling(false)
          loadStatus()
          loadJobs()
          loadParents()
        } else if (msg.type === 'job_start') {
          setRunning(true)
        }
      } catch {}
    }
    return () => ws.close()
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const handleStart = async () => {
    setLogs([])
    setRunning(true)
    try {
      await startScrape(workers, selectedParentId ? Number(selectedParentId) : null)
    } catch (e) {
      setLogs([`[ERROR] ${e.message}`])
      setRunning(false)
    }
  }

  const handleCancel = async () => {
    if (!window.confirm('Yakin ingin membatalkan proses scraping manual ini?')) return
    setCancelling(true)
    try {
      await cancelScrape()
      setLogs(prev => [...prev, '[!] Permintaan pembatalan dikirim ke server...'])
    } catch (e) {
      alert(`Gagal membatalkan: ${e.message}`)
      setCancelling(false)
    }
  }

  const getStatusBadge = (st) => {
    switch (st) {
      case 'done':
        return <span className="badge active">SUKSES</span>
      case 'failed':
        return <span className="badge restricted">FAILED</span>
      case 'running':
        return <span className="badge" style={{ background: '#e3f2fd', color: '#1565c0', border: '1px solid #bbdefb' }}>RUNNING</span>
      default:
        return <span className="badge suspended">{st ? st.toUpperCase() : '-'}</span>
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Scraping Control</h1>
        <p className="page-subtitle">Jalankan sinkronisasi data akun Starlink secara real-time dan paralel</p>
      </div>

      <div className="scraping-layout-grid">
        {/* Control Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Konfigurasi Scraper</span>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                  Pilih Akun Induk Starlink
                </label>
                <select
                  className="search-input"
                  style={{ width: '100%', cursor: 'pointer', background: '#fff' }}
                  value={selectedParentId}
                  onChange={e => setSelectedParentId(e.target.value)}
                  disabled={running}
                >
                  <option value="">Semua Akun Induk Aktif (Bergiliran)</option>
                  {parentAccounts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.account_name} ({p.email}) {!p.is_valid ? '⚠️ Butuh Login' : ''}
                    </option>
                  ))}
                </select>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
                  {selectedParentId ? 'Hanya akun ini yang akan di-scrape.' : 'Seluruh akun induk yang aktif akan di-scrape berurutan.'}
                </span>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                  Jumlah Paralel Worker
                </label>
                <input
                  type="number"
                  className="search-input"
                  style={{ width: '100%' }}
                  min={1}
                  max={3}
                  value={workers}
                  onChange={e => setWorkers(Number(e.target.value))}
                  disabled={running}
                />
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                  Rekomendasi: 2 worker (maksimal 3) agar 100% aman dari Starlink Envoy Rate Limit (429).
                </span>
              </div>

              {running ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '12px 18px', fontSize: 14 }}
                    disabled={true}
                  >
                    <span className="spinner" style={{ width: 16, height: 16 }} />
                    <span>Sedang Scraping...</span>
                  </button>
                  <button
                    className="btn"
                    style={{
                      width: '100%',
                      padding: '11px 18px',
                      fontSize: 13.5,
                      background: '#fee2e2',
                      color: '#dc2626',
                      border: '1px solid #fca5a5',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: cancelling ? 'not-allowed' : 'pointer'
                    }}
                    onClick={handleCancel}
                    disabled={cancelling}
                  >
                    <Square size={15} fill="#dc2626" />
                    <span>{cancelling ? 'Membatalkan...' : 'Batalkan Scraping'}</span>
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px 18px', fontSize: 14 }}
                  onClick={handleStart}
                >
                  <Play size={16} />
                  <span>Mulai Scraping Manual</span>
                </button>
              )}
            </div>
          </div>

          {status && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Status Job Terkini</span>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Status</span>
                  {getStatusBadge(status.status)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Total Perangkat (KIT)</span>
                  <span style={{ fontWeight: 700 }}>{status.total_kits}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Worker Digunakan</span>
                  <span style={{ fontWeight: 600 }}>{status.workers}</span>
                </div>
                {status.started_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Waktu Mulai</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {new Date(status.started_at).toLocaleTimeString('id-ID')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Log & History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Terminal size={17} color="var(--purple-main)" />
                <span className="card-title">Live Scraper Console</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {running && (
                  <span style={{ fontSize: 12, color: 'var(--blue-main)', display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
                    <span className="spinner-dark" style={{ width: 12, height: 12 }} />
                    Proses Berjalan...
                  </span>
                )}
                <button
                  className="btn btn-ghost"
                  onClick={() => setLogs([])}
                  style={{ fontSize: 12, padding: '5px 12px' }}
                >
                  Clear Console
                </button>
              </div>
            </div>

            <div className="log-terminal" ref={logRef}>
              {logs.length === 0 ? (
                <span style={{ color: '#64748b' }}>// Tekan "Mulai Scraping Manual" untuk melihat live progress output di sini...</span>
              ) : (
                logs.map((l, i) => {
                  const cls = (l.includes('ERROR') || l.includes('GAGAL') || l.includes('Traceback'))
                    ? 'log-error'
                    : (l.includes('SUKSES') || l.includes('[OK]') || l.includes('SELESAI'))
                    ? 'log-ok'
                    : (l.includes('WARNING') || l.includes('429'))
                    ? 'log-warn'
                    : ''
                  return <div key={i} className={cls}>{l}</div>
                })
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Riwayat Eksekusi Job</span>
              <button
                className="btn btn-ghost"
                onClick={loadJobs}
                style={{ fontSize: 12, padding: '5px 12px' }}
              >
                <RefreshCw size={13} />
                <span>Refresh</span>
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Status</th>
                    <th>Workers</th>
                    <th>Total KIT</th>
                    <th>Waktu Mulai</th>
                    <th>Waktu Selesai</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j.id}>
                      <td className="mono">#{j.id}</td>
                      <td>{getStatusBadge(j.status)}</td>
                      <td>{j.workers}</td>
                      <td style={{ fontWeight: 600 }}>{j.total_kits}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {j.started_at ? new Date(j.started_at).toLocaleString('id-ID', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        }) : '-'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {j.finished_at ? new Date(j.finished_at).toLocaleString('id-ID', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        }) : '-'}
                      </td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
                        Belum ada riwayat job.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
