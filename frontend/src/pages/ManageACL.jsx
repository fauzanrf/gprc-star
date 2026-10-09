import React, { useState, useEffect } from 'react'
import {
  Shield, User as UserIcon, Plus, Trash2, Edit2, Mail, Calendar,
  Check, X, AlertCircle, Lock, UserCheck, ShieldAlert
} from 'lucide-react'
import { getUserList, createUser, updateUser, deleteUser } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { ROLE_LABELS, ROLE_BADGE_STYLES } from '../lib/permissions'

const AVAILABLE_ROLES = [
  { value: 'admin',  label: 'Admin',  desc: 'Akses penuh ke seluruh sistem, pengelolaan user (ACL), akun, scraping, grup, dan konfigurasi' },
  { value: 'viewer', label: 'Viewer', desc: 'Akses baca-saja (Read-Only) untuk melihat dashboard, daftar akun, terminal, dan monitoring' },
]

export default function ManageACL() {
  const { session, role } = useAuth()
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'noc2'

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', role: 'viewer' })
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editUserData, setEditUserData] = useState(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  const [deleteId, setDeleteId] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const showToastMsg = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const data = await getUserList()
      setUsers(data || [])
    } catch (err) {
      showToastMsg('error', err.message || 'Gagal memuat daftar pengguna.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  // Create User
  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (!createForm.name || !createForm.email || !createForm.password) {
      setCreateError('Semua kolom wajib diisi.')
      return
    }

    setCreateLoading(true)
    setCreateError('')
    try {
      await createUser(createForm)
      setShowCreateModal(false)
      setCreateForm({ name: '', email: '', password: '', role: 'noc1' })
      showToastMsg('success', 'Pengguna baru berhasil ditambahkan!')
      fetchUsers()
    } catch (err) {
      setCreateError(err.message || 'Gagal membuat pengguna baru.')
    } finally {
      setCreateLoading(false)
    }
  }

  // Edit User
  const handleOpenEdit = (user) => {
    setEditUserData({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      password: '',
    })
    setEditError('')
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    if (!editUserData.name || !editUserData.email) {
      setEditError('Nama dan email wajib diisi.')
      return
    }

    setEditLoading(true)
    setEditError('')
    try {
      const payload = {
        name: editUserData.name.trim(),
        email: editUserData.email.trim(),
        role: editUserData.role,
      }
      if (editUserData.password.trim()) {
        payload.password = editUserData.password.trim()
      }

      await updateUser(editUserData.id, payload)
      setEditUserData(null)
      showToastMsg('success', 'Data pengguna berhasil diperbarui!')
      fetchUsers()
    } catch (err) {
      setEditError(err.message || 'Gagal memperbarui pengguna.')
    } finally {
      setEditLoading(false)
    }
  }

  // Delete User
  const handleDeleteUser = async () => {
    if (!deleteId) return
    setDeleteLoading(true)
    try {
      await deleteUser(deleteId)
      setDeleteId(null)
      showToastMsg('success', 'Pengguna berhasil dihapus.')
      fetchUsers()
    } catch (err) {
      showToastMsg('error', err.message || 'Gagal menghapus pengguna.')
    } finally {
      setDeleteLoading(false)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return (
    <>
      {/* Toast Notification */}
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

      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 className="page-title">Manajemen ACL & Pengguna</h1>
          <p className="page-subtitle">
            Kelola hak akses peran (Role-Based Access Control) dan akun pengguna Starlink GPRC
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, padding: '9px 18px' }}
            onClick={() => {
              setCreateError('')
              setCreateForm({ name: '', email: '', password: '', role: 'viewer' })
              setShowCreateModal(true)
            }}
          >
            <Plus size={16} />
            <span>Tambah User Baru</span>
          </button>
        )}
      </div>

      {/* Stats Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--purple-light)', color: 'var(--purple-main)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <UserCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Pengguna</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>{users.length}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#ede7f6', color: '#5e35b1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Administrator</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#5e35b1' }}>
              {users.filter(u => u.role === 'admin' || u.role === 'super_admin' || u.role === 'noc2' || u.role === 'noc1').length}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#f3f4f6', color: '#4b5563', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldAlert size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Viewer (Read-Only)</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#4b5563' }}>
              {users.filter(u => u.role === 'viewer' || u.role === 'magang').length}
            </div>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Daftar Pengguna & Hak Akses ACL</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 50 }}>No</th>
                <th>Pengguna</th>
                <th>Role ACL</th>
                <th>Bergabung Sejak</th>
                {isAdmin && <th style={{ width: 130, textAlign: 'center' }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} style={{ textAlign: 'center', padding: '36px' }}>
                    <span className="spinner-dark" />
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="empty-state">
                    Belum ada data pengguna terdaftar.
                  </td>
                </tr>
              )}
              {!loading && users.map((u, idx) => {
                const rStyle = ROLE_BADGE_STYLES[u.role] || { background: '#f1f5f9', color: '#475569' }
                const isCurrent = u.id === session?.id

                return (
                  <tr key={u.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'var(--purple-light)',
                          color: 'var(--purple-main)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 14,
                          flexShrink: 0
                        }}>
                          {u.name ? u.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{u.name}</span>
                            {isCurrent && (
                              <span style={{ fontSize: 10, background: '#ede7f6', color: '#5e35b1', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>
                                Anda
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <Mail size={12} /> {u.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 12,
                        ...rStyle
                      }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 12.5 }}>
                        <Calendar size={13} /> {formatDate(u.created_at)}
                      </div>
                    </td>
                    {isAdmin && (
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(u)}
                            style={{
                              background: '#f3e8ff',
                              color: 'var(--purple-main)',
                              border: '1px solid #d8b4fe',
                              padding: '5px 9px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                            title="Edit nama, role, atau reset password"
                          >
                            <Edit2 size={13} />
                          </button>

                          <button
                            type="button"
                            disabled={isCurrent}
                            onClick={() => setDeleteId(u.id)}
                            style={{
                              background: isCurrent ? '#f1f5f9' : '#fee2e2',
                              color: isCurrent ? '#94a3b8' : '#dc2626',
                              border: isCurrent ? '1px solid #e2e8f0' : '1px solid #fecaca',
                              padding: '5px 9px',
                              borderRadius: 6,
                              fontSize: 12,
                              cursor: isCurrent ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              opacity: isCurrent ? 0.5 : 1
                            }}
                            title={isCurrent ? "Tidak dapat menghapus akun sendiri" : "Hapus Pengguna"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permissions Matrix Information */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span className="card-title">Matriks Hak Akses Peran (ACL Permissions)</span>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {AVAILABLE_ROLES.map(r => {
              const rStyle = ROLE_BADGE_STYLES[r.value] || {}
              return (
                <div key={r.value} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: '#f8fafc' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8, ...rStyle }}>
                      {r.label}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                    {r.desc}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
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
            if (e.target === e.currentTarget) setShowCreateModal(false)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
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
                  Tambah Pengguna Baru
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  Buat akun baru dengan hak akses peran tertentu
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
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

            <form onSubmit={handleCreateUser} style={{ padding: '20px 24px' }}>
              {createError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="Contoh: Budi Santoso"
                    className="search-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Alamat Email (Login)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                    <input
                      type="email"
                      required
                      value={createForm.email}
                      onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                      placeholder="user@internetwork.net.id"
                      className="search-input"
                      style={{ width: '100%', paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                    <input
                      type="password"
                      required
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      placeholder="Minimal 6 karakter"
                      className="search-input"
                      style={{ width: '100%', paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Peran (Role ACL)
                  </label>
                  <select
                    className="filter-select"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  >
                    {AVAILABLE_ROLES.map(r => (
                      <option key={r.value} value={r.value}>
                        {r.label} — {r.desc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border-light)' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowCreateModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {createLoading ? (
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>Buat Pengguna</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUserData && (
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
            if (e.target === e.currentTarget) setEditUserData(null)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
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
                  Edit Pengguna & Peran
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  Perbarui nama, hak akses role, atau ganti kata sandi
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditUserData(null)}
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

            <form onSubmit={handleSaveEdit} style={{ padding: '20px 24px' }}>
              {editError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
                  {editError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    required
                    value={editUserData.name}
                    onChange={(e) => setEditUserData({ ...editUserData, name: e.target.value })}
                    className="search-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Alamat Email (Login)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                    <input
                      type="email"
                      required
                      value={editUserData.email}
                      onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                      className="search-input"
                      style={{ width: '100%', paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Ganti Password (Opsional)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)' }} />
                    <input
                      type="password"
                      value={editUserData.password}
                      onChange={(e) => setEditUserData({ ...editUserData, password: e.target.value })}
                      placeholder="Biarkan kosong jika tidak diubah"
                      className="search-input"
                      style={{ width: '100%', paddingLeft: 32 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Peran (Role ACL)
                  </label>
                  <select
                    className="filter-select"
                    style={{ width: '100%', height: 38, fontSize: 13 }}
                    value={editUserData.role}
                    onChange={(e) => setEditUserData({ ...editUserData, role: e.target.value })}
                  >
                    {AVAILABLE_ROLES.map(r => (
                      <option key={r.value} value={r.value}>
                        {r.label} — {r.desc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border-light)' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setEditUserData(null)}
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
                    <Check size={15} />
                  )}
                  <span>Simpan Perubahan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
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
            if (e.target === e.currentTarget) setDeleteId(null)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 380,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
              padding: 24,
              textAlign: 'center',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: '#fee2e2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px'
            }}>
              <Trash2 size={24} />
            </div>

            <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Hapus Pengguna?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
              Apakah Anda yakin ingin menghapus akun pengguna ini secara permanen dari sistem?
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteId(null)}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={handleDeleteUser}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                {deleteLoading ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
