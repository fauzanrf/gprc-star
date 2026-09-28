import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Mail, HardDrive, ExternalLink, X, AlertTriangle } from 'lucide-react'
import { getAccounts, getAccountKits } from '../api'

const STATUS_LABELS = {
  active: 'Active',
  restricted: 'Restricted (ToS)',
  suspended: 'Suspended',
  inactive: 'Inactive'
}

function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status] ?? status}</span>
}

export default function Accounts({ selectedParentId }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Modal State for Sub-Account Kits
  const [modalAccount, setModalAccount] = useState(null)
  const [modalKits, setModalKits] = useState([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalSearch, setModalSearch] = useState('')

  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    getAccounts(selectedParentId || undefined)
      .then(setAccounts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedParentId])

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && modalAccount) {
        handleCloseModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalAccount])

  const handleOpenKitsModal = async (account) => {
    setModalAccount(account)
    setModalLoading(true)
    setModalSearch('')
    try {
      const data = await getAccountKits(account.id)
      setModalKits(data || [])
    } catch (e) {
      console.error(e)
      setModalKits([])
    } finally {
      setModalLoading(false)
    }
  }

  const handleCloseModal = () => {
    setModalAccount(null)
    setModalKits([])
    setModalSearch('')
  }

  const filtered = accounts.filter(a =>
    (a.account_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.account_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const filteredModalKits = modalKits.filter(k =>
    (k.site || '').toLowerCase().includes(modalSearch.toLowerCase()) ||
    (k.kit || '').toLowerCase().includes(modalSearch.toLowerCase()) ||
    (k.sn || '').toLowerCase().includes(modalSearch.toLowerCase()) ||
    (k.status || '').toLowerCase().includes(modalSearch.toLowerCase())
  )

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Sub-Accounts</h1>
        <p className="page-subtitle">{accounts.length} sub-akun Starlink terdaftar</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Daftar Akun</span>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: '100%' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
            <input
              className="search-input"
              style={{ paddingLeft: 32, width: '100%' }}
              placeholder="Cari nama, no akun, atau email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>No</th>
                <th>Nama Controller</th>
                <th>Nomor Akun</th>
                <th>Jumlah KIT</th>
                <th>Alamat Email</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '36px' }}>
                    <span className="spinner-dark" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    <div className="empty-state-icon">👤</div>
                    Tidak ada akun yang ditemukan.
                  </td>
                </tr>
              )}
              {!loading && filtered.map((a, i) => (
                <tr key={a.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.account_name}</div>
                  </td>
                  <td className="mono">{a.account_number}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleOpenKitsModal(a)}
                      title={`Klik untuk melihat detail ${a.kit_count} KIT di ${a.account_name}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'var(--purple-light)',
                        color: 'var(--purple-main)',
                        border: '1px solid #d1c4e9',
                        padding: '4px 12px',
                        borderRadius: 14,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--purple-main)'
                        e.currentTarget.style.color = '#ffffff'
                        e.currentTarget.style.borderColor = 'var(--purple-main)'
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(94, 53, 177, 0.25)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--purple-light)'
                        e.currentTarget.style.color = 'var(--purple-main)'
                        e.currentTarget.style.borderColor = '#d1c4e9'
                        e.currentTarget.style.boxShadow = 'none'
                        e.currentTarget.style.transform = 'none'
                      }}
                    >
                      <HardDrive size={12} />
                      {a.kit_count} KIT
                    </button>
                  </td>
                  <td>
                    {a.email ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Mail size={13} color="var(--purple-main)" style={{ flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>
                          {a.email}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Daftar KIT di Sub-Akun */}
      {modalAccount && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseModal()
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 1000,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
              padding: 0,
              overflow: 'hidden',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              background: '#ffffff'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                    {modalAccount.account_name}
                  </h2>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    background: '#f1f5f9',
                    color: 'var(--purple-main)',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontWeight: 600
                  }}>
                    {modalAccount.account_number}
                  </span>
                  {modalAccount.email && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      background: '#f8fafc',
                      border: '1px solid var(--border-light)',
                      padding: '2px 8px',
                      borderRadius: 6
                    }}>
                      <Mail size={12} color="var(--purple-main)" /> {modalAccount.email}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  Daftar perangkat / KIT yang aktif di dalam sub-akun ini
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseModal}
                style={{
                  border: 'none',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#e2e8f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#f1f5f9'}
                title="Tutup (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Sub-Header: Badges & Internal Search */}
            <div style={{
              padding: '12px 24px',
              background: '#f8fafc',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  background: 'var(--purple-light)',
                  color: 'var(--purple-main)',
                  fontWeight: 700,
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 20
                }}>
                  Total: {modalKits.length} KIT
                </span>
                {modalKits.filter(k => k.status === 'active').length > 0 && (
                  <span className="badge active" style={{ fontSize: 11, padding: '3px 8px' }}>
                    {modalKits.filter(k => k.status === 'active').length} Active
                  </span>
                )}
                {modalKits.filter(k => k.status === 'restricted').length > 0 && (
                  <span className="badge restricted" style={{ fontSize: 11, padding: '3px 8px' }}>
                    {modalKits.filter(k => k.status === 'restricted').length} Restricted
                  </span>
                )}
                {modalKits.filter(k => k.status === 'suspended').length > 0 && (
                  <span className="badge suspended" style={{ fontSize: 11, padding: '3px 8px' }}>
                    {modalKits.filter(k => k.status === 'suspended').length} Suspended
                  </span>
                )}
                {modalKits.filter(k => k.status === 'inactive').length > 0 && (
                  <span className="badge inactive" style={{ fontSize: 11, padding: '3px 8px' }}>
                    {modalKits.filter(k => k.status === 'inactive').length} Inactive
                  </span>
                )}
              </div>

              {modalKits.length > 3 && (
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                  <input
                    className="search-input"
                    style={{ paddingLeft: 28, height: 32, fontSize: 12, width: 220 }}
                    placeholder="Cari site, KIT, SN..."
                    value={modalSearch}
                    onChange={e => setModalSearch(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Modal Body: Table */}
            <div style={{ overflowY: 'auto', flex: 1, padding: 0 }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
                  <tr>
                    <th style={{ width: 45 }}>No</th>
                    <th>Nama Site</th>
                    <th>KIT Serial</th>
                    <th>Dish SN</th>
                    <th>Status</th>
                    <th>Penggunaan</th>
                    <th>Keterangan</th>
                    <th>Terakhir Disinkron</th>
                  </tr>
                </thead>
                <tbody>
                  {modalLoading && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '40px' }}>
                        <span className="spinner-dark" />
                      </td>
                    </tr>
                  )}
                  {!modalLoading && filteredModalKits.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        Tidak ada KIT yang cocok dengan pencarian di sub-akun ini.
                      </td>
                    </tr>
                  )}
                  {!modalLoading && filteredModalKits.map((k, idx) => (
                    <tr key={k.id}>
                      <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        lineHeight: 1.4,
                        maxWidth: 240
                      }} title={k.site || '-'}>
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
                            <span className="badge-quota-limit" style={{ fontSize: 10, padding: '2px 8px' }}>
                              🚨 Limit Quota
                            </span>
                          )}
                          {k.quota_alert === 'near_full' && (
                            <span className="badge-quota-warning" style={{ fontSize: 10, padding: '2px 8px' }}>
                              ⚠️ Quota Hampir Full
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        color: 'var(--text-muted)',
                        fontSize: 11.5,
                        maxWidth: 200,
                        lineHeight: 1.4
                      }} title={k.restriction_detail || '-'}>
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

            {/* Modal Footer */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#ffffff'
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Menampilkan {filteredModalKits.length} dari {modalKits.length} KIT
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleCloseModal}
                >
                  Tutup
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    handleCloseModal()
                    navigate(`/kits?search=${encodeURIComponent(modalAccount.account_number)}`)
                  }}
                >
                  Buka di Halaman KIT <ExternalLink size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
