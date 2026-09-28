import React, { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, ShieldAlert, PauseCircle, WifiOff, RefreshCw,
  HardDrive, ArrowUpRight, MoreHorizontal, ChevronRight,
  TrendingUp, AlertTriangle, Clock, Play
} from 'lucide-react'
import { getDashboardStats, getDashboardSummary } from '../api'
import logoImg from '../logo.png'

export default function Dashboard({ selectedParentId: propParentId }) {
  const [stats, setStats] = useState(null)
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('active')
  const [insightTab, setInsightTab] = useState('quota')
  const [parentFilter, setParentFilter] = useState(propParentId || '')

  // Countdown state
  const [countdownText, setCountdownText] = useState('')
  const [isScrapingNow, setIsScrapingNow] = useState(false)
  const timerRef = useRef(null)

  const load = async (pId = parentFilter) => {
    setLoading(true)
    try {
      const [s, sum] = await Promise.all([
        getDashboardStats(pId || undefined),
        getDashboardSummary(pId || undefined)
      ])
      setStats(s)
      setSummary(sum || [])
      setIsScrapingNow(Boolean(s?.is_scraping))
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  // Handle parent account change
  useEffect(() => {
    setParentFilter(propParentId || '')
    load(propParentId || '')
  }, [propParentId])

  useEffect(() => {
    const handleParentEvent = (e) => {
      setParentFilter(e.detail || '')
      load(e.detail || '')
    }
    window.addEventListener('parent_account_changed', handleParentEvent)
    return () => window.removeEventListener('parent_account_changed', handleParentEvent)
  }, [])

  // Countdown timer calculation
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    const updateCountdown = () => {
      if (stats?.is_scraping) {
        setIsScrapingNow(true)
        setCountdownText('Sedang berlangsung...')
        return
      }

      if (!stats?.next_scraped_at) {
        setCountdownText('Menunggu jadwal...')
        return
      }

      const target = new Date(stats.next_scraped_at).getTime()
      const now = Date.now()
      const diffSec = Math.floor((target - now) / 1000)

      if (diffSec <= 0) {
        setIsScrapingNow(true)
        setCountdownText('Sedang scraping...')
      } else {
        setIsScrapingNow(false)
        const hours = Math.floor(diffSec / 3600)
        const mins  = Math.floor((diffSec % 3600) / 60)
        const secs  = diffSec % 60
        if (hours > 0) {
          setCountdownText(`${hours}j ${mins}m ${secs}d`)
        } else {
          setCountdownText(`${mins}m ${secs}d`)
        }
      }
    }

    updateCountdown()
    timerRef.current = setInterval(updateCountdown, 1000)

    return () => clearInterval(timerRef.current)
  }, [stats])

  // Polling to refresh data if scraping or every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      load()
    }, 30000)
    return () => clearInterval(interval)
  }, [parentFilter])

  const lastScrape = stats?.last_scraped_at
    ? new Date(stats.last_scraped_at).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }) + ' WIB'
    : '-'

  const filteredSummary = summary.filter(acc =>
    (acc.account_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (acc.account_number || '').toLowerCase().includes(search.toLowerCase())
  )

  const topAccountsForChart = summary.slice(0, 10)
  const restrictedAccounts = summary.filter(a => (a.restricted || 0) > 0).slice(0, 5)
  const quotaAlerts = stats?.quota_alerts || []
  const quotaAlertsCount = (stats?.limit_quota_count || 0) + (stats?.near_full_quota_count || 0)

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 className="page-title">Dashboard Overview</h1>
          <p className="page-subtitle">Pembaruan data terakhir: {lastScrape}</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Live Countdown Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: isScrapingNow ? '#e3f2fd' : '#ffffff',
            border: isScrapingNow ? '1px solid #90caf9' : '1px solid var(--border)',
            padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
            color: isScrapingNow ? '#1565c0' : 'var(--text-secondary)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
          }}>
            <Clock size={16} color={isScrapingNow ? '#1e88e5' : 'var(--purple-main)'} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Scraping Berikutnya:</span>
            <span style={{ color: isScrapingNow ? '#1565c0' : 'var(--purple-main)', letterSpacing: 0.3 }}>
              {countdownText}
            </span>
          </div>

          <button className="btn btn-ghost" onClick={() => load()} disabled={loading}>
            <RefreshCw size={15} style={{ animation: loading ? 'spin .7s linear infinite' : '' }} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {/* ── Quota Alert Banner (High Usage) ── */}
      {quotaAlertsCount > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #fff1f2 0%, #fffbeb 100%)',
          border: '1px solid #fecaca',
          borderRadius: 'var(--radius)',
          padding: '14px 20px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          boxShadow: '0 2px 8px rgba(220, 38, 38, 0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              background: '#fee2e2',
              padding: 10,
              borderRadius: 12,
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <HardDrive size={22} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Peringatan Kuota Data Starlink</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, background: '#ef4444', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                  {quotaAlertsCount} KIT Perlu Perhatian
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: '#7f1d1d', marginTop: 2 }}>
                Terdapat KIT dengan konsumsi data tinggi yang mendekati batas (4.5TB+) atau telah mencapai batas limit (5TB+).
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {(stats?.limit_quota_count || 0) > 0 && (
              <Link
                to="/kits?quota=limit"
                className="badge-quota-limit"
                style={{ textDecoration: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
              >
                🚨 {stats.limit_quota_count} Limit Quota (≥ 5TB)
              </Link>
            )}
            {(stats?.near_full_quota_count || 0) > 0 && (
              <Link
                to="/kits?quota=near_full"
                className="badge-quota-warning"
                style={{ textDecoration: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
              >
                ⚠️ {stats.near_full_quota_count} Quota Hampir Full (4.5 - 5TB)
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── Top Berry Cards Grid ── */}
      <div className="berry-cards-grid">
        {/* 1. Purple Card: Total KIT */}
        <div className="berry-card-purple">
          <div className="card-top-row">
            <div className="card-icon-pill" style={{ background: '#ffffff', padding: 6 }}>
              <img src={logoImg} alt="Logo" style={{ width: 28, height: 28, objectFit: 'contain' }} />
            </div>
            <div style={{ opacity: 0.8, cursor: 'pointer' }}>
              <MoreHorizontal size={20} />
            </div>
          </div>

          <div>
            <div className="card-stat-value">
              {stats ? (stats.total_kits ?? 0) : <span className="spinner" />}
            </div>
            <div className="card-stat-label">
              <span>Total Perangkat / KIT</span>
              <span className="card-trend-badge">
                <ArrowUpRight size={12} />
                {stats && stats.total_kits ? `${Math.round((stats.active / stats.total_kits) * 100)}% Normal` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Blue Card: Active KIT */}
        <div className="berry-card-blue">
          <div className="card-top-row">
            <div className="card-icon-pill">
              <CheckCircle2 size={22} />
            </div>
            <div className="card-toggle-group">
              <button
                className={`card-toggle-btn ${activeTab === 'active' ? 'active' : ''}`}
                onClick={() => setActiveTab('active')}
              >
                Active
              </button>
              <button
                className={`card-toggle-btn ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                Total
              </button>
            </div>
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="card-stat-value">
              {stats ? (activeTab === 'active' ? stats.active : stats.total_kits) : <span className="spinner" />}
            </div>
            <div className="card-stat-label">
              <span>{activeTab === 'active' ? 'KIT Beroperasi Normal' : 'Total Semua Terminal'}</span>
            </div>
          </div>

          {/* Berry Wave Sparkline SVG */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, opacity: 0.35, pointerEvents: 'none' }}>
            <svg viewBox="0 0 400 80" preserveAspectRatio="none" style={{ width: '100%', height: '55px', display: 'block' }}>
              <path
                d="M0,45 C70,10 140,65 210,35 C280,5 350,60 400,20 L400,80 L0,80 Z"
                fill="rgba(255,255,255,0.4)"
              />
              <path
                d="M0,50 C80,20 150,70 220,40 C290,10 360,65 400,25"
                fill="none"
                stroke="#ffffff"
                strokeWidth="3"
              />
            </svg>
          </div>
        </div>

        {/* 3. Small Side Stack Cards */}
        <div className="berry-cards-side-stack">
          {/* Restricted Card */}
          <div className="stat-card-white">
            <div className="side-icon-box red">
              <ShieldAlert size={22} />
            </div>
            <div>
              <div className="side-stat-number" style={{ color: 'var(--red-main)' }}>
                {stats ? stats.restricted : <span className="spinner-dark" />}
              </div>
              <div className="side-stat-title">Restricted (ToS / Dibatasi)</div>
            </div>
          </div>

          {/* Inactive & Suspended Card */}
          <div className="stat-card-white">
            <div className="side-icon-box amber">
              <WifiOff size={22} />
            </div>
            <div>
              <div className="side-stat-number" style={{ color: 'var(--amber-text)' }}>
                {stats ? (stats.inactive + stats.suspended) : <span className="spinner-dark" />}
              </div>
              <div className="side-stat-title">Offline & Ditangguhkan</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Middle Section: Visual Chart + Side Insights ── */}
      <div className="dashboard-grid-2col">
        {/* Left Column: Stacking Bar Chart */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Distribusi Status Perangkat</div>
              <div className="card-subtitle">Perbandingan status terminal pada 10 sub-akun utama</div>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', background: '#f1f5f9', padding: '4px 10px', borderRadius: 20 }}>
              {summary.length} Akun Terdaftar
            </span>
          </div>

          <div className="card-body">
            <div className="chart-header-row">
              <div>
                <div className="chart-metric-value">{stats?.total_kits ?? 390} KIT</div>
                <div className="chart-metric-sub">Total terdata di seluruh lokasi</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="badge active">● {stats?.active ?? 0} Normal</span>
                <span className="badge restricted">● {stats?.restricted ?? 0} ToS</span>
              </div>
            </div>

            {/* Stacking Bar Visuals */}
            <div className="chart-bars-wrap">
              {topAccountsForChart.length === 0 ? (
                <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: 13 }}>Memuat visualisasi...</div>
              ) : (
                topAccountsForChart.map((acc, i) => {
                  const maxTotal = Math.max(...topAccountsForChart.map(a => a.total), 1)
                  const heightPct = Math.max(15, Math.round((acc.total / maxTotal) * 100))
                  const activePct = acc.total ? (acc.active / acc.total) * 100 : 100
                  const restrictedPct = acc.total ? (acc.restricted / acc.total) * 100 : 0
                  const inactivePct = 100 - activePct - restrictedPct

                  return (
                    <div key={acc.account_number} className="bar-col">
                      <div
                        className="bar-stack"
                        style={{ height: `${heightPct}%` }}
                        title={`${acc.account_name}: ${acc.active} Active, ${acc.restricted} Restricted, ${acc.inactive} Inactive`}
                      >
                        <div className="bar-segment-purple" style={{ height: `${activePct}%` }} />
                        {restrictedPct > 0 && (
                          <div style={{ height: `${restrictedPct}%`, background: 'var(--red-main)' }} />
                        )}
                        {inactivePct > 0 && (
                          <div className="bar-segment-lavender" style={{ height: `${inactivePct}%` }} />
                        )}
                      </div>
                      <div className="bar-label">
                        {acc.account_name.length > 8 ? acc.account_name.slice(0, 7) + '..' : acc.account_name}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Legend */}
            <div className="chart-legend">
              <div className="legend-item">
                <div className="legend-color" style={{ background: 'var(--purple-main)' }} />
                <span>Active ({stats?.active ?? 0})</span>
              </div>
              <div className="legend-item">
                <div className="legend-color" style={{ background: 'var(--red-main)' }} />
                <span>Restricted ToS ({stats?.restricted ?? 0})</span>
              </div>
              <div className="legend-item">
                <div className="legend-color" style={{ background: '#d1c4e9' }} />
                <span>Offline ({stats?.inactive ?? 0})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Insights & Priority Sites */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="card-title">Perhatian & Insight</div>
              <div className="card-subtitle">Terminal berisiko dan limitasi</div>
            </div>
            <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 3, borderRadius: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  background: insightTab === 'quota' ? '#ffffff' : 'transparent',
                  color: insightTab === 'quota' ? '#b91c1c' : 'var(--text-muted)',
                  boxShadow: insightTab === 'quota' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
                onClick={() => setInsightTab('quota')}
              >
                Alert Quota ({quotaAlertsCount})
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  background: insightTab === 'tos' ? '#ffffff' : 'transparent',
                  color: insightTab === 'tos' ? 'var(--purple-main)' : 'var(--text-muted)',
                  boxShadow: insightTab === 'tos' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
                onClick={() => setInsightTab('tos')}
              >
                Limitasi ToS ({stats?.restricted ?? 0})
              </button>
            </div>
          </div>

          {insightTab === 'quota' ? (
            <div className="card-body">
              <div className="insight-card-top" style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%)', border: '1px solid #fed7aa' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="insight-top-value" style={{ color: '#dc2626' }}>
                      {quotaAlertsCount} KIT
                    </div>
                    <div className="insight-top-label" style={{ color: '#9a3412', fontWeight: 600 }}>
                      {stats?.limit_quota_count || 0} Limit Quota (≥5TB) &bull; {stats?.near_full_quota_count || 0} Hampir Full
                    </div>
                  </div>
                  <div style={{ background: '#fee2e2', padding: 8, borderRadius: 8, color: '#dc2626' }}>
                    <HardDrive size={20} />
                  </div>
                </div>
              </div>

              <div className="insight-list">
                {quotaAlerts.length > 0 ? (
                  quotaAlerts.slice(0, 6).map((item) => (
                    <div key={item.id} className="insight-row">
                      <div style={{ maxWidth: '58%', overflow: 'hidden' }}>
                        <div className="insight-row-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.site}>
                          {item.site}
                        </div>
                        <div className="insight-row-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.account_name} &bull; <span style={{ fontFamily: 'monospace' }}>{item.kit}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: item.level === 'limit' ? '#dc2626' : '#d97706' }}>
                          {item.quota}
                        </span>
                        {item.level === 'limit' ? (
                          <span className="badge-quota-limit" style={{ fontSize: 10, padding: '2px 8px' }}>🚨 Limit Quota</span>
                        ) : (
                          <span className="badge-quota-warning" style={{ fontSize: 10, padding: '2px 8px' }}>⚠️ Quota Hampir Full</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Tidak ada perangkat dengan alert kuota saat ini.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <Link
                  to="/kits?quota=any_alert"
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'center', color: '#b91c1c', fontWeight: 600 }}
                >
                  <span>Lihat {quotaAlertsCount} KIT Alert Kuota</span>
                  <ChevronRight size={15} />
                </Link>
              </div>
            </div>
          ) : (
            <div className="card-body">
              <div className="insight-card-top">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="insight-top-value">{stats?.restricted ?? 17} Perangkat</div>
                    <div className="insight-top-label">Terkena Limitasi (ToS)</div>
                  </div>
                  <div style={{ background: 'rgba(94, 53, 177, 0.15)', padding: 8, borderRadius: 8, color: 'var(--purple-main)' }}>
                    <AlertTriangle size={20} />
                  </div>
                </div>
              </div>

              <div className="insight-list">
                {restrictedAccounts.length > 0 ? (
                  restrictedAccounts.map((item) => (
                    <div key={item.account_number} className="insight-row">
                      <div>
                        <div className="insight-row-title">{item.account_name}</div>
                        <div className="insight-row-sub">{item.total} total terminal</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className="badge-trend-down">
                          {item.restricted} ToS
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Semua akun dalam kondisi stabil.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 20 }}>
                <Link
                  to="/kits?status=restricted"
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'center', color: 'var(--purple-main)' }}
                >
                  <span>Lihat Semua Perangkat ToS</span>
                  <ChevronRight size={15} />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Section: Table Ringkasan per Akun ── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Ringkasan per Akun</div>
            <div className="card-subtitle">Daftar sub-akun Starlink yang dipantau</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Cari nama / nomor akun..."
              className="search-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Nama Akun</th>
                <th>Nomor Akun</th>
                <th>Total KIT</th>
                <th>Active</th>
                <th>Restricted (ToS)</th>
                <th>Suspended</th>
                <th>Inactive</th>
              </tr>
            </thead>
            <tbody>
              {filteredSummary.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    Tidak ada akun yang sesuai pencarian.
                  </td>
                </tr>
              )}
              {filteredSummary.map((acc) => (
                <tr key={acc.account_number}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{acc.account_name}</div>
                  </td>
                  <td className="mono">{acc.account_number}</td>
                  <td>
                    <span style={{ fontWeight: 700 }}>{acc.total}</span>
                  </td>
                  <td>
                    <span className="badge active">{acc.active}</span>
                  </td>
                  <td>
                    {acc.restricted > 0 ? (
                      <span className="badge restricted">{acc.restricted}</span>
                    ) : (
                      <span style={{ color: 'var(--text-light)', paddingLeft: 8 }}>0</span>
                    )}
                  </td>
                  <td>
                    {acc.suspended > 0 ? (
                      <span className="badge suspended">{acc.suspended}</span>
                    ) : (
                      <span style={{ color: 'var(--text-light)', paddingLeft: 8 }}>0</span>
                    )}
                  </td>
                  <td>
                    {acc.inactive > 0 ? (
                      <span className="badge inactive">{acc.inactive}</span>
                    ) : (
                      <span style={{ color: 'var(--text-light)', paddingLeft: 8 }}>0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
