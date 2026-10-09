import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Mail, HardDrive, ExternalLink, X, AlertTriangle,
  Edit2, Check, FileSpreadsheet, Building2, Save, AlertCircle, ShieldAlert
} from 'lucide-react'
import {
  getAccounts,
  getAccountKits,
  updateAccount,
  bulkUpdateAccountEmails,
  getParentAccounts,
} from '../api'
import { useAuth } from '../contexts/AuthContext'

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
  const { session, can } = useAuth()
  const isMagang = session?.role === 'magang'
  const canEdit = !isMagang && (can('edit_accounts') || can('crud_starlink') || can('crud_client') || !session)

  const [accounts, setAccounts] = useState([])
  const [parentAccounts, setParentAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Toast feedback
  const [toast, setToast] = useState(null)

  // Modal State for Sub-Account Kits
  const [modalAccount, setModalAccount] = useState(null)
  const [modalKits, setModalKits] = useState([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalSearch, setModalSearch] = useState('')

  // Modal State for Single Account Edit
  const [editModalData, setEditModalData] = useState(null)
  const [editLoading, setEditLoading] = useState(false)

  // Inline Email Editing
  const [inlineEditingId, setInlineEditingId] = useState(null)
  const [inlineEmail, setInlineEmail] = useState('')
  const [inlineSaving, setInlineSaving] = useState(false)

  // Bulk Email Update Modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkInputText, setBulkInputText] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)

  const navigate = useNavigate()

  const showToast = (type, message) => {
    setToast({ type, message })
    setTimeout(() => {
      setToast(null)
    }, 3500)
  }

  const loadAccounts = () => {
    setLoading(true)
    getAccounts(selectedParentId || undefined)
      .then(setAccounts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadAccounts()
    getParentAccounts().then(setParentAccounts).catch(() => {})
  }, [selectedParentId])

  // Close modals on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (modalAccount) handleCloseModal()
        if (editModalData) setEditModalData(null)
        if (bulkModalOpen) setBulkModalOpen(false)
        if (inlineEditingId) setInlineEditingId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalAccount, editModalData, bulkModalOpen, inlineEditingId])

  // Kits modal
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

  // Inline Email Save
  const handleStartInlineEdit = (acc) => {
    if (!canEdit) {
      showToast('error', 'Role Magang hanya memiliki akses baca-saja.')
      return
    }
    setInlineEditingId(acc.id)
    setInlineEmail(acc.email || '')
  }

  const handleSaveInlineEmail = async (accId) => {
    setInlineSaving(true)
    try {
      const updated = await updateAccount(accId, { email: inlineEmail.trim() })
      setAccounts(prev => prev.map(a => a.id === accId ? { ...a, email: updated.email } : a))
      setInlineEditingId(null)
      showToast('success', `Email untuk akun berhasil diperbarui menjadi ${updated.email || '(kosong)'}`)
    } catch (err) {
      showToast('error', err.message || 'Gagal memperbarui email akun.')
    } finally {
      setInlineSaving(false)
    }
  }

  // Edit Modal Save
  const handleOpenEditModal = (acc) => {
    if (!canEdit) {
      showToast('error', 'Role Magang hanya memiliki akses baca-saja.')
      return
    }
    setEditModalData({
      id: acc.id,
      account_number: acc.account_number,
      account_name: acc.account_name,
      email: acc.email || '',
      parent_account_id: acc.parent_account_id || '',
    })
  }

  const handleSaveEditModal = async (e) => {
    e.preventDefault()
    if (!editModalData) return
    setEditLoading(true)
    try {
      const payload = {
        account_name: editModalData.account_name.trim(),
        email: editModalData.email.trim(),
        parent_account_id: editModalData.parent_account_id ? Number(editModalData.parent_account_id) : -1,
      }
      const updated = await updateAccount(editModalData.id, payload)
      setAccounts(prev => prev.map(a => a.id === editModalData.id ? { ...a, ...updated } : a))
      setEditModalData(null)
      showToast('success', `Data akun ${updated.account_number} berhasil diperbarui!`)
    } catch (err) {
      showToast('error', err.message || 'Gagal menyimpan perubahan akun.')
    } finally {
      setEditLoading(false)
    }
  }

  // Bulk Email Update Parse & Execute
  const handleProcessBulkUpdate = async () => {
    if (!bulkInputText.trim()) return
    setBulkLoading(true)
    setBulkResult(null)

    const lines = bulkInputText.trim().split('\n')
    const items = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      // Support separator: tab, comma, semicolon, or space
      let parts = []
      if (line.includes('\t')) parts = line.split('\t')
      else if (line.includes(',')) parts = line.split(',')
      else if (line.includes(';')) parts = line.split(';')
      else parts = line.split(/\s+/)

      if (parts.length >= 2) {
        const accNum = parts[0].trim()
        const emailVal = parts[1].trim()
        if (accNum && emailVal) {
          items.push({ account_number: accNum, email: emailVal })
        }
      }
    }

    if (items.length === 0) {
      setBulkLoading(false)
      showToast('error', 'Format data tidak valid. Gunakan format: NomorAkun,Email per baris.')
      return
    }

    try {
      const res = await bulkUpdateAccountEmails(items)
      setBulkResult(res)
      loadAccounts()
      showToast('success', `Berhasil memperbarui ${res.updated_count} email akun!`)
    } catch (err) {
      showToast('error', err.message || 'Gagal melakukan bulk update email.')
    } finally {
      setBulkLoading(false)
    }
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
      {/* Toast Alert */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 10000,
            padding: '12px 20px',
            borderRadius: 10,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 600,
            animation: 'fadeIn 0.2s ease-out',
            background: toast.type === 'success' ? '#059669' : '#dc2626',
            color: '#ffffff',
          }}
        >
          {toast.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 className="page-title">Sub-Accounts</h1>
          <p className="page-subtitle">
            {accounts.length} sub-akun Starlink terdaftar • Dapat diedit langsung dari luar (email & nama akun)
          </p>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, padding: '8px 16px' }}
              onClick={() => {
                setBulkInputText('')
                setBulkResult(null)
                setBulkModalOpen(true)
              }}
              title="Bulk update atau paste email dari file Excel / Spreadsheet"
            >
              <FileSpreadsheet size={16} />
              <span>Bulk Edit Email (Excel)</span>
            </button>
          </div>
        )}

        {isMagang && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: '#f3f4f6',
            color: '#6b7280',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            border: '1px solid #e5e7eb'
          }}>
            <ShieldAlert size={14} />
            <span>Mode Baca-Saja (Role Magang)</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span className="card-title">Daftar Akun Starlink</span>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
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
                <th style={{ width: 50 }}>No</th>
                <th>Nama Controller</th>
                <th>Nomor Akun</th>
                <th>Akun Induk</th>
                <th>Jumlah KIT</th>
                <th style={{ minWidth: 260 }}>Alamat Email (Dapat Diedit)</th>
                {canEdit && <th style={{ width: 90, textAlign: 'center' }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} style={{ textAlign: 'center', padding: '36px' }}>
                    <span className="spinner-dark" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="empty-state">
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
                  <td className="mono" style={{ fontWeight: 600 }}>{a.account_number}</td>
                  <td>
                    {a.parent_account_name ? (
                      <span style={{ fontSize: 12, color: 'var(--purple-main)', fontWeight: 600 }}>
                        {a.parent_account_name}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
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

                  {/* Editable Email Column */}
                  <td>
                    {inlineEditingId === a.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="email"
                          autoFocus
                          value={inlineEmail}
                          onChange={(e) => setInlineEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveInlineEmail(a.id)
                            if (e.key === 'Escape') setInlineEditingId(null)
                          }}
                          placeholder="masukkan@email.com"
                          className="search-input"
                          style={{
                            padding: '4px 8px',
                            fontSize: 12.5,
                            height: 30,
                            minWidth: 180,
                            borderColor: 'var(--purple-main)',
                            outline: 'none',
                          }}
                        />
                        <button
                          type="button"
                          disabled={inlineSaving}
                          onClick={() => handleSaveInlineEmail(a.id)}
                          style={{
                            background: '#059669',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            width: 28,
                            height: 28,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                          title="Simpan (Enter)"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setInlineEditingId(null)}
                          style={{
                            background: '#ef4444',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            width: 28,
                            height: 28,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                          title="Batal (Esc)"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {a.email ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Mail size={13} color="var(--purple-main)" style={{ flexShrink: 0 }} />
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 13 }}>
                              {a.email}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                            (Belum ada email)
                          </span>
                        )}

                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleStartInlineEdit(a)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--purple-main)',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              borderRadius: 4,
                              opacity: 0.7,
                              transition: 'opacity 0.15s ease',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                            title="Edit email langsung di tabel"
                          >
                            <Edit2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Actions Column */}
                  {canEdit && (
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(a)}
                        style={{
                          background: '#f3e8ff',
                          color: 'var(--purple-main)',
                          border: '1px solid #d8b4fe',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--purple-main)'
                          e.currentTarget.style.color = '#ffffff'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#f3e8ff'
                          e.currentTarget.style.color = 'var(--purple-main)'
                        }}
                        title="Edit data akun lengkap"
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Edit Akun (Single) */}
      {editModalData && (
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
            if (e.target === e.currentTarget) setEditModalData(null)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 520,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
              padding: 0,
              overflow: 'hidden',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#ffffff'
            }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  Edit Sub-Account Starlink
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  Perbarui alamat email dan atribut akun dari luar
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModalData(null)}
                style={{
                  border: 'none',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)'
                }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEditModal} style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Nomor Akun (Starlink ID)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={editModalData.account_number}
                    className="search-input mono"
                    style={{ width: '100%', background: '#f8fafc', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'block' }}>
                    Nomor akun unik dari Starlink portal (read-only).
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Alamat Email (Mapping Eksternal)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                    <input
                      type="email"
                      value={editModalData.email}
                      onChange={(e) => setEditModalData({ ...editModalData, email: e.target.value })}
                      placeholder="client@perusahaan.com"
                      className="search-input"
                      style={{ width: '100%', paddingLeft: 32 }}
                    />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'block' }}>
                    Email PIC / klien ini dapat diedit kapan saja untuk keperluan notifikasi & rekonsiliasi.
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Nama Controller / Akun
                  </label>
                  <input
                    type="text"
                    required
                    value={editModalData.account_name}
                    onChange={(e) => setEditModalData({ ...editModalData, account_name: e.target.value })}
                    className="search-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Akun Induk (Parent Account)
                  </label>
                  <select
                    className="filter-select"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={editModalData.parent_account_id}
                    onChange={(e) => setEditModalData({ ...editModalData, parent_account_id: e.target.value })}
                  >
                    <option value="">-- Tanpa Akun Induk (Lepas) --</option>
                    {parentAccounts.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.account_name} ({p.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditModalData(null)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {editLoading ? (
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                  ) : (
                    <Save size={15} />
                  )}
                  <span>Simpan Perubahan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Bulk Update Email dari Luar (Excel / CSV) */}
      {bulkModalOpen && (
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
            if (e.target === e.currentTarget) setBulkModalOpen(false)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 620,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
              padding: 0,
              overflow: 'hidden',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#ffffff'
            }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  Bulk Update Email dari Luar
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  Copy-paste data email dari file Excel atau Spreadsheet untuk mengupdate banyak akun sekaligus
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                style={{
                  border: 'none',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)'
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '20px 24px' }}>
              <div style={{ marginBottom: 12, background: '#ede7f6', border: '1px solid #d1c4e9', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-main)', marginBottom: 4 }}>
                  Petunjuk Format:
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Salin kolom <b>Nomor Akun</b> dan <b>Email</b> dari Excel, lalu paste di bawah.
                  Format per baris didukung:
                  <code style={{ background: '#ffffff', padding: '1px 5px', borderRadius: 4, marginLeft: 4 }}>
                    ACC-123456,email@domain.com
                  </code> atau dipisahkan tab/spasi.
                </div>
              </div>

              <textarea
                rows={9}
                value={bulkInputText}
                onChange={(e) => setBulkInputText(e.target.value)}
                placeholder={"ACC-1001,pic1@domain.com\nACC-1002,pic2@domain.com\nACC-1003\tpic3@domain.com"}
                style={{
                  width: '100%',
                  padding: 12,
                  fontFamily: 'monospace',
                  fontSize: 12.5,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />

              {bulkResult && (
                <div style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 8,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                  fontSize: 12.5
                }}>
                  <b>Hasil Update:</b> Berhasil memperbarui {bulkResult.updated_count} akun.
                  {bulkResult.errors?.length > 0 && (
                    <div style={{ marginTop: 6, color: '#991b1b', fontSize: 11.5 }}>
                      Perhatian: {bulkResult.errors.join(', ')}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border-light)' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setBulkModalOpen(false)}
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={bulkLoading || !bulkInputText.trim()}
                  onClick={handleProcessBulkUpdate}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {bulkLoading ? (
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>Proses & Simpan Email</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
