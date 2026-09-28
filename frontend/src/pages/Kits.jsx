import React, { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, HardDrive, AlertTriangle, RotateCcw } from 'lucide-react'
import { getKits } from '../api'

const STATUS_LABELS = { active: 'Active', restricted: 'Restricted (ToS)', suspended: 'Suspended', inactive: 'Inactive' }

function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status] ?? status}</span>
}

const DEFAULT_COLUMN_WIDTHS = {
  no: 55,
  controller: 220,
  site: 280,
  kit: 160,
  sn: 160,
  status: 130,
  quota: 150,
  restriction_detail: 240,
  scraped_at: 160
}

const MIN_COLUMN_WIDTHS = {
  no: 40,
  controller: 130,
  site: 140,
  kit: 110,
  sn: 110,
  status: 100,
  quota: 120,
  restriction_detail: 130,
  scraped_at: 130
}

const STORAGE_KEY = 'starlink_kits_col_widths'

function getInitialWidths() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(saved) }
    }
  } catch (e) {
    console.warn('Failed to parse saved column widths:', e)
  }
  return DEFAULT_COLUMN_WIDTHS
}

export default function Kits({ selectedParentId }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuota = searchParams.get('quota') || ''
  const initialStatus = searchParams.get('status') || ''

  const [kits, setKits] = useState([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(initialStatus)
  const [quotaFilter, setQuotaFilter] = useState(initialQuota)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [colWidths, setColWidths] = useState(getInitialWidths)
  const PAGE_SIZE = 50

  const handleResizeStart = (colKey, e) => {
    e.preventDefault()
    e.stopPropagation()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX
    const startWidth = colWidths[colKey] || DEFAULT_COLUMN_WIDTHS[colKey]
    let currentWidth = startWidth

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX
      const minW = MIN_COLUMN_WIDTHS[colKey] || 50
      currentWidth = Math.max(minW, startWidth + deltaX)
      setColWidths(prev => ({ ...prev, [colKey]: currentWidth }))
    }

    const handleMouseUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      setColWidths(prev => {
        const final = { ...prev, [colKey]: currentWidth }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(final))
        } catch (err) {}
        return final
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const resetColWidths = () => {
    setColWidths(DEFAULT_COLUMN_WIDTHS)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {}
  }

  const totalTableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0)

  // Sinkronisasi jika query param URL berubah
  useEffect(() => {
    const q = searchParams.get('quota') || ''
    const st = searchParams.get('status') || ''
    if (q !== quotaFilter) setQuotaFilter(q)
    if (st !== filter) setFilter(st)
  }, [searchParams])

  const handleQuotaChange = (newVal) => {
    setQuotaFilter(newVal)
    setPage(1)
    const newParams = new URLSearchParams(searchParams)
    if (newVal) {
      newParams.set('quota', newVal)
    } else {
      newParams.delete('quota')
    }
    setSearchParams(newParams)
  }

  const handleStatusChange = (newVal) => {
    setFilter(newVal)
    setPage(1)
    const newParams = new URLSearchParams(searchParams)
    if (newVal) {
      newParams.set('status', newVal)
    } else {
      newParams.delete('status')
    }
    setSearchParams(newParams)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getKits({
        status: filter || undefined,
        quota_filter: quotaFilter || undefined,
        search: search || undefined,
        parent_id: selectedParentId || undefined,
        page,
        size: PAGE_SIZE
      })
      setKits(data || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [filter, quotaFilter, search, page, selectedParentId])

  useEffect(() => { setPage(1) }, [filter, quotaFilter, search, selectedParentId])
  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">KIT / Terminal</h1>
        <p className="page-subtitle">Daftar semua perangkat Starlink yang terdata di sistem</p>
      </div>

      <div className="card">
        <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
          {/* Top Row: Search and Status Dropdown */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span className="card-title">Daftar Perangkat</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flex: '1 1 auto', justifyContent: 'flex-end' }}>
              <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '100%' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                <input
                  className="search-input"
                  style={{ paddingLeft: 32, width: '100%' }}
                  placeholder="Cari site, KIT, SN..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select className="filter-select" value={filter} onChange={e => handleStatusChange(e.target.value)}>
                <option value="">Semua Status</option>
                <option value="active">Active (Normal)</option>
                <option value="restricted">Restricted (ToS)</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Quick Filter Chips: Quota Alerts & Column Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 6, borderTop: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <HardDrive size={14} /> Filter Kuota:
              </span>
              <div className="filter-chip-group">
                <button
                  type="button"
                  className={`filter-chip ${!quotaFilter ? 'active' : ''}`}
                  onClick={() => handleQuotaChange('')}
                >
                  Semua Kuota
                </button>
                <button
                  type="button"
                  className={`filter-chip danger ${quotaFilter === 'limit' ? 'active' : ''}`}
                  onClick={() => handleQuotaChange('limit')}
                >
                  🚨 Limit Quota (≥ 5 TB)
                </button>
                <button
                  type="button"
                  className={`filter-chip warning ${quotaFilter === 'near_full' ? 'active' : ''}`}
                  onClick={() => handleQuotaChange('near_full')}
                >
                  ⚠️ Quota Hampir Full (4.5 - 5 TB)
                </button>
                <button
                  type="button"
                  className={`filter-chip ${quotaFilter === 'any_alert' ? 'active' : ''}`}
                  onClick={() => handleQuotaChange('any_alert')}
                >
                  Semua Alert (≥ 4.5 TB)
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 12px', gap: 6 }}
                title="Kembalikan semua lebar kolom ke ukuran bawaan"
                onClick={resetColWidths}
              >
                <RotateCcw size={13} /> Reset Ukuran Kolom
              </button>

              {quotaFilter && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 10px', color: 'var(--purple-main)' }}
                  onClick={() => handleQuotaChange('')}
                >
                  Reset Filter Kuota &times;
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ tableLayout: 'fixed', minWidth: totalTableWidth, width: '100%' }}>
            <colgroup>
              <col style={{ width: colWidths.no }} />
              <col style={{ width: colWidths.controller }} />
              <col style={{ width: colWidths.site }} />
              <col style={{ width: colWidths.kit }} />
              <col style={{ width: colWidths.sn }} />
              <col style={{ width: colWidths.status }} />
              <col style={{ width: colWidths.quota }} />
              <col style={{ width: colWidths.restriction_detail }} />
              <col style={{ width: colWidths.scraped_at }} />
            </colgroup>
            <thead>
              <tr>
                <th className="resizable-th" style={{ width: colWidths.no }}>
                  No
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('no', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.controller }}>
                  Controller
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('controller', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.site }}>
                  Site
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('site', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.kit }}>
                  KIT Serial
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('kit', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.sn }}>
                  Dish SN
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('sn', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.status }}>
                  Status
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('status', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.quota }}>
                  Penggunaan
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('quota', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.restriction_detail }}>
                  Keterangan
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('restriction_detail', e)} />
                </th>
                <th className="resizable-th" style={{ width: colWidths.scraped_at }}>
                  Terakhir Disinkron
                  <div className="col-resizer" title="Tarik untuk mengubah lebar kolom" onMouseDown={e => handleResizeStart('scraped_at', e)} />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '36px' }}>
                    <span className="spinner-dark" />
                  </td>
                </tr>
              )}
              {!loading && kits.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
                    Tidak ada data ditemukan. Coba ubah kata kunci pencarian atau filter status.
                  </td>
                </tr>
              )}
              {!loading && kits.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{k.account_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{k.account_number}</div>
                  </td>
                  <td
                    style={{
                      fontWeight: 500,
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                      lineHeight: 1.4
                    }}
                    title={k.site || '-'}
                  >
                    {k.site || '-'}
                  </td>
                  <td className="mono">{k.kit || '-'}</td>
                  <td className="mono">{k.sn || '-'}</td>
                  <td><StatusBadge status={k.status} /></td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <span style={{
                        fontWeight: 700,
                        color: k.quota_alert === 'limit' ? '#dc2626' : (k.quota_alert === 'near_full' ? '#d97706' : 'var(--text-primary)')
                      }}>
                        {k.quota || '-'}
                      </span>
                      {k.quota_alert === 'limit' && (
                        <span className="badge-quota-limit" title="Penggunaan data ≥ 5.0 TB">
                          🚨 Limit Quota
                        </span>
                      )}
                      {k.quota_alert === 'near_full' && (
                        <span className="badge-quota-warning" title="Penggunaan data 4.5 - 5.0 TB">
                          ⚠️ Quota Hampir Full
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    style={{
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                      color: 'var(--text-muted)',
                      fontSize: 11.5,
                      lineHeight: 1.4
                    }}
                    title={k.restriction_detail || '-'}
                  >
                    {k.restriction_detail || '-'}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {k.scraped_at ? new Date(k.scraped_at).toLocaleString('id-ID', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    }) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span className="page-info">{kits.length} KIT ditampilkan (Halaman {page})</span>
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading}>
            ← Prev
          </button>
          <button className="btn btn-ghost" onClick={() => setPage(p => p + 1)} disabled={kits.length < PAGE_SIZE || loading}>
            Next →
          </button>
        </div>
      </div>
    </>
  )
}
