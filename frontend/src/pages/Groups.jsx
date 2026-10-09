import React, { useEffect, useState } from 'react'
import {
  Layers, Plus, Trash2, Edit2, Users, HardDrive, AlertTriangle,
  CheckCircle2, Search, X, Sparkles, Filter, ChevronRight, Check,
  Radio, ArrowUpRight, BarChart3, ShieldAlert, Cpu, AlertCircle,
  ExternalLink, ArrowRight, Gauge, Zap
} from 'lucide-react'
import {
  getGroups, getGroupDetail, createGroup, updateGroup, deleteGroup,
  addGroupMembers, removeGroupMember, detectStarlinkMini, getKits
} from '../api'
import { useAuth } from '../contexts/AuthContext'

const COLOR_PRESETS = [
  { name: 'Cyan Blue', hex: '#0284c7', bg: 'rgba(2, 132, 199, 0.12)' },
  { name: 'Berry Purple', hex: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)' },
  { name: 'Emerald', hex: '#059669', bg: 'rgba(5, 150, 105, 0.12)' },
  { name: 'Amber Gold', hex: '#d97706', bg: 'rgba(217, 119, 6, 0.12)' },
  { name: 'Rose Red', hex: '#e11d48', bg: 'rgba(225, 29, 72, 0.12)' },
  { name: 'Indigo', hex: '#4f46e5', bg: 'rgba(79, 70, 229, 0.12)' },
]

export default function Groups() {
  const { session, role } = useAuth()
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isViewer = !isAdmin

  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)

  // Mini Detection state
  const [miniData, setMiniData] = useState(null)
  const [showMiniModal, setShowMiniModal] = useState(false)

  // Modal Create/Edit Group
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    quota_limit_per_kit_gb: '100',
    color: '#0284c7',
  })
  const [savingGroup, setSavingGroup] = useState(false)

  // Modal Detail / Member Management
  const [activeGroupDetail, setActiveGroupDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showMemberModal, setShowMemberModal] = useState(false)

  // Add Member state inside detail modal
  const [allKits, setAllKits] = useState([])
  const [loadingAllKits, setLoadingAllKits] = useState(false)
  const [kitSearch, setKitSearch] = useState('')
  const [filterOnlyMini, setFilterOnlyMini] = useState(false)
  const [selectedKitIds, setSelectedKitIds] = useState([])
  const [addingMembers, setAddingMembers] = useState(false)

  const loadGroups = async () => {
    setLoading(true)
    try {
      const data = await getGroups()
      setGroups(data || [])
    } catch (e) {
      console.error('Failed to load groups:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadMiniDetection = async () => {
    try {
      const data = await detectStarlinkMini()
      setMiniData(data)
    } catch (e) {
      console.error('Failed to detect mini:', e)
    }
  }

  useEffect(() => {
    loadGroups()
    loadMiniDetection()
  }, [])

  const handleOpenCreateModal = (presetName = '', presetDesc = '', presetLimit = '100', presetColor = '#0284c7', initialIds = []) => {
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    setEditingGroup(null)
    setGroupForm({
      name: presetName,
      description: presetDesc,
      quota_limit_per_kit_gb: presetLimit,
      color: presetColor,
      initial_kit_ids: initialIds,
    })
    setShowGroupModal(true)
  }

  const handleOpenEditModal = (grp) => {
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    setEditingGroup(grp)
    setGroupForm({
      name: grp.name,
      description: grp.description || '',
      quota_limit_per_kit_gb: grp.quota_limit_per_kit_gb > 0 ? String(grp.quota_limit_per_kit_gb) : '100',
      color: grp.color || '#0284c7',
    })
    setShowGroupModal(true)
  }

  const handleSaveGroup = async (e) => {
    e.preventDefault()
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    if (!groupForm.name.trim()) return
    setSavingGroup(true)
    try {
      const perKitVal = parseFloat(groupForm.quota_limit_per_kit_gb) || 100.0
      const payload = {
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || null,
        quota_limit_per_kit_gb: perKitVal,
        quota_limit_gb: 0,
        color: groupForm.color,
      }
      if (editingGroup) {
        await updateGroup(editingGroup.id, payload)
      } else {
        payload.initial_kit_ids = groupForm.initial_kit_ids || []
        await createGroup(payload)
      }
      setShowGroupModal(false)
      loadGroups()
      loadMiniDetection()
    } catch (err) {
      alert(err.message || 'Gagal menyimpan group')
    } finally {
      setSavingGroup(false)
    }
  }

  const handleDeleteGroup = async (grp) => {
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    if (!window.confirm(`Yakin ingin menghapus group "${grp.name}"? Data KIT di Starlink tidak akan terhapus.`)) return
    try {
      await deleteGroup(grp.id)
      loadGroups()
      if (activeGroupDetail?.id === grp.id) {
        setShowMemberModal(false)
      }
    } catch (err) {
      alert(err.message || 'Gagal menghapus group')
    }
  }

  // Open Member Management Modal
  const handleOpenMembers = async (groupId) => {
    setShowMemberModal(true)
    setLoadingDetail(true)
    setSelectedKitIds([])
    setKitSearch('')
    try {
      const detail = await getGroupDetail(groupId)
      setActiveGroupDetail(detail)
      loadAvailableKits()
    } catch (err) {
      alert(err.message || 'Gagal memuat detail group')
      setShowMemberModal(false)
    } finally {
      setLoadingDetail(false)
    }
  }

  const loadAvailableKits = async () => {
    setLoadingAllKits(true)
    try {
      const res = await getKits({ size: 500 })
      setAllKits(res || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingAllKits(false)
    }
  }

  const handleRemoveMember = async (kitId) => {
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    if (!activeGroupDetail) return
    try {
      await removeGroupMember(activeGroupDetail.id, kitId)
      const updated = await getGroupDetail(activeGroupDetail.id)
      setActiveGroupDetail(updated)
      loadGroups()
    } catch (err) {
      alert(err.message || 'Gagal mengeluarkan anggota')
    }
  }

  const handleAddSelectedMembers = async () => {
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    if (!activeGroupDetail || selectedKitIds.length === 0) return
    setAddingMembers(true)
    try {
      await addGroupMembers(activeGroupDetail.id, selectedKitIds)
      const updated = await getGroupDetail(activeGroupDetail.id)
      setActiveGroupDetail(updated)
      setSelectedKitIds([])
      loadGroups()
    } catch (err) {
      alert(err.message || 'Gagal menambahkan anggota')
    } finally {
      setAddingMembers(false)
    }
  }

  const handleOneClickCreateMiniGroup = async () => {
    if (isViewer) {
      alert('Role Viewer hanya memiliki akses baca-saja.')
      return
    }
    if (!miniData || miniData.kits.length === 0) return
    const ids = miniData.kits.map(k => k.id)
    handleOpenCreateModal(
      'Armada Starlink Mini',
      'Pengelompokan khusus seluruh perangkat Starlink Mini (Dish SN M1HT...) dengan batas kuota 100 GB per KIT.',
      '100',
      '#0284c7',
      ids
    )
    setShowMiniModal(false)
  }

  // Filter available kits that are NOT already in the active group
  const existingKitIds = new Set((activeGroupDetail?.members || []).map(m => m.kit_id))
  const candidateKits = allKits.filter(k => {
    if (existingKitIds.has(k.id)) return false
    const matchSearch =
      (k.site || '').toLowerCase().includes(kitSearch.toLowerCase()) ||
      (k.kit || '').toLowerCase().includes(kitSearch.toLowerCase()) ||
      (k.sn || '').toLowerCase().includes(kitSearch.toLowerCase()) ||
      (k.account_name || '').toLowerCase().includes(kitSearch.toLowerCase())
    if (!matchSearch) return false

    if (filterOnlyMini) {
      const isMini =
        (k.sn || '').toUpperCase().startsWith('M1HT') ||
        (k.kit || '').toUpperCase().startsWith('KIT4M') ||
        (k.site || '').toLowerCase().includes('mini')
      if (!isMini) return false
    }
    return true
  })

  // Summary Metrics
  const totalGroups = groups.length
  const totalGroupedKits = groups.reduce((acc, g) => acc + g.member_count, 0)
  const totalGroupQuotaGb = groups.reduce((acc, g) => acc + g.total_quota_gb, 0)
  const totalOverLimitKits = groups.reduce((acc, g) => acc + (g.kits_over_limit || 0), 0)

  return (
    <div className="page-container" style={{ paddingBottom: 60 }}>
      {/* ── Top Header ────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        marginBottom: 24
      }}>
        <div>
          <h1 style={{
            fontSize: 24,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: 'var(--text-primary)',
            margin: 0
          }}>
            <span style={{
              background: 'linear-gradient(135deg, #0284c7, #4f46e5)',
              padding: '8px 12px',
              borderRadius: 12,
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              boxShadow: '0 4px 16px rgba(2, 132, 199, 0.3)'
            }}>
              <Layers size={22} />
            </span>
            Grouping & Kuota KIT
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>
            Pengelompokan armada KIT Starlink dengan pemantauan batas kuota per KIT (Maks 100 GB/KIT untuk Starlink Mini).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Quick Auto-Detect Mini Button */}
          {miniData && miniData.total_mini_detected > 0 && (
            <button
              type="button"
              onClick={() => setShowMiniModal(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#ffffff',
                border: '1.5px solid #0284c7',
                color: '#0284c7',
                padding: '9px 16px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.08)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(2, 132, 199, 0.05)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = '#ffffff'
                e.currentTarget.style.transform = 'none'
              }}
            >
              <Cpu size={16} />
              <span>Deteksi Starlink Mini</span>
              <span style={{
                background: '#0284c7',
                color: '#ffffff',
                padding: '1px 8px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 800
              }}>
                {miniData.total_mini_detected}
              </span>
            </button>
          )}

          {/* Read-Only Badge for Viewer */}
          {isViewer && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#f3f4f6',
              color: '#6b7280',
              padding: '8px 14px',
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              border: '1px solid #e5e7eb'
            }}>
              <ShieldAlert size={15} />
              <span>Mode Baca-Saja (Role Viewer)</span>
            </div>
          )}

          {/* Create Group Button */}
          {isAdmin && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleOpenCreateModal()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 10,
                fontWeight: 700,
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.28)'
              }}
            >
              <Plus size={18} />
              <span>Buat Group Baru</span>
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Stats Cards ───────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginBottom: 28
      }}>
        {/* Card 1 */}
        <div style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '18px 20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: 'rgba(2, 132, 199, 0.1)',
            color: '#0284c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Groups
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
              {totalGroups} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>kelompok</span>
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '18px 20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: 'rgba(16, 185, 129, 0.1)',
            color: '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Users size={22} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              KIT Terkelompok
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
              {totalGroupedKits} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>terminal</span>
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '18px 20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: 'rgba(99, 102, 241, 0.1)',
            color: '#4f46e5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <HardDrive size={22} />
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Kuota Grup
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
              {totalGroupQuotaGb >= 1024
                ? `${(totalGroupQuotaGb / 1024).toFixed(2)} TB`
                : `${totalGroupQuotaGb.toFixed(2)} GB`}
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '18px 20px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: totalOverLimitKits > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
            color: totalOverLimitKits > 0 ? '#dc2626' : '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            {totalOverLimitKits > 0 ? <ShieldAlert size={22} /> : <CheckCircle2 size={22} />}
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              KIT Over Limit (&gt;100GB)
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 800,
              color: totalOverLimitKits > 0 ? '#dc2626' : '#059669',
              marginTop: 2
            }}>
              {totalOverLimitKits > 0 ? `${totalOverLimitKits} Terminal!` : 'Semua Sesuai Limit'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Groups Grid ──────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <span className="spinner-dark" />
          <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13.5 }}>Memuat data grouping...</p>
        </div>
      ) : groups.length === 0 ? (
        /* Empty State */
        <div style={{
          background: '#ffffff',
          border: '1.5px dashed var(--border)',
          borderRadius: 20,
          padding: '50px 30px',
          textAlign: 'center',
          maxWidth: 640,
          margin: '30px auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
        }}>
          <div style={{
            width: 70,
            height: 70,
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.1), rgba(79, 70, 229, 0.1))',
            color: '#0284c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 18px'
          }}>
            <Layers size={36} />
          </div>
          <h3 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>
            Belum Ada Group KIT Dibuat
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            Kelompokkan beberapa terminal Starlink Anda dan tentukan batas kuota per KIT (misal 100 GB untuk Starlink Mini) agar pemakaian kuota terkendali dan tidak membengkak.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {miniData && miniData.total_mini_detected > 0 && (
              <button
                type="button"
                onClick={handleOneClickCreateMiniGroup}
                className="btn btn-outline"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  borderColor: '#0284c7',
                  color: '#0284c7',
                  fontWeight: 700,
                  padding: '10px 18px',
                  borderRadius: 10
                }}
              >
                <Cpu size={16} />
                <span>Buat Group Starlink Mini ({miniData.total_mini_detected} KIT)</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleOpenCreateModal()}
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 10,
                fontWeight: 700
              }}
            >
              <Plus size={16} />
              <span>Buat Group Baru</span>
            </button>
          </div>
        </div>
      ) : (
        /* Groups Cards Grid */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
          gap: 22
        }}>
          {groups.map(grp => {
            const limitPerKit = grp.quota_limit_per_kit_gb || 100.0
            const overCount = grp.kits_over_limit || 0
            const nearCount = grp.kits_near_limit || 0
            const safeCount = grp.kits_safe || 0
            const totalAlloc = grp.total_allocation_gb || 0

            return (
              <div
                key={grp.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid var(--border)',
                  borderRadius: 18,
                  padding: '22px',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  boxShadow: '0 3px 14px rgba(0, 0, 0, 0.04)',
                  transition: 'all 0.25s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.08)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'none'
                  e.currentTarget.style.boxShadow = '0 3px 14px rgba(0, 0, 0, 0.04)'
                }}
              >
                {/* Header Card */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: `${grp.color || '#0284c7'}18`,
                      color: grp.color || '#0284c7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <Layers size={20} />
                    </div>
                    <div>
                      <h3 style={{
                        margin: 0,
                        fontSize: 17,
                        fontWeight: 800,
                        color: 'var(--text-primary)',
                        lineHeight: 1.3
                      }}>
                        {grp.name}
                      </h3>
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 3,
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#0284c7',
                        background: 'rgba(2, 132, 199, 0.08)',
                        padding: '2px 8px',
                        borderRadius: 6
                      }}>
                        <Gauge size={12} />
                        Batas: {limitPerKit} GB / KIT
                      </div>
                    </div>
                  </div>

                  {isAdmin && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(grp)}
                        title="Edit Group"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          padding: 6,
                          borderRadius: 8,
                          cursor: 'pointer',
                          display: 'flex',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'var(--bg-canvas)'
                          e.currentTarget.style.color = 'var(--text-primary)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'var(--text-muted)'
                        }}
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(grp)}
                        title="Hapus Group"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          padding: 6,
                          borderRadius: 8,
                          cursor: 'pointer',
                          display: 'flex'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Description */}
                {grp.description && (
                  <p style={{
                    fontSize: 12.5,
                    color: 'var(--text-muted)',
                    margin: '0 0 14px',
                    lineHeight: 1.45
                  }}>
                    {grp.description}
                  </p>
                )}

                {/* Per-KIT Status Breakdown Pills */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginBottom: 16
                }}>
                  <span style={{
                    background: 'var(--bg-canvas)',
                    padding: '4px 10px',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5
                  }}>
                    <Users size={13} color="var(--text-muted)" />
                    {grp.member_count} KIT
                  </span>

                  {overCount > 0 ? (
                    <span style={{
                      background: '#fee2e2',
                      color: '#b91c1c',
                      padding: '4px 10px',
                      borderRadius: 8,
                      fontWeight: 800,
                      fontSize: 11.5,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      ⚠️ {overCount} Melebihi {limitPerKit}GB
                    </span>
                  ) : null}

                  {nearCount > 0 ? (
                    <span style={{
                      background: '#fef3c7',
                      color: '#b45309',
                      padding: '4px 10px',
                      borderRadius: 8,
                      fontWeight: 800,
                      fontSize: 11.5
                    }}>
                      ⚡ {nearCount} Hampir Penuh
                    </span>
                  ) : null}

                  {safeCount > 0 && overCount === 0 ? (
                    <span style={{
                      background: '#d1fae5',
                      color: '#047857',
                      padding: '4px 10px',
                      borderRadius: 8,
                      fontWeight: 800,
                      fontSize: 11.5
                    }}>
                      ✓ {safeCount} Sesuai Kuota
                    </span>
                  ) : null}
                </div>

                {/* Quota Aggregation Section */}
                <div style={{
                  background: 'var(--bg-canvas, #f8fafc)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '16px',
                  marginBottom: 18
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Total Pemakaian Kuota
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>
                      Alokasi: {grp.total_allocation_formatted}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)' }}>
                      {grp.total_quota_formatted}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                      Rata-rata: {grp.member_count > 0 ? `${(grp.total_quota_gb / grp.member_count).toFixed(1)} GB/KIT` : '0 GB'}
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div style={{
                    width: '100%',
                    height: 8,
                    borderRadius: 4,
                    background: '#e2e8f0',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${Math.min(grp.overall_usage_percentage, 100)}%`,
                      height: '100%',
                      borderRadius: 4,
                      background: overCount > 0
                        ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                        : 'linear-gradient(90deg, #10b981, #0284c7)',
                      transition: 'width 0.4s ease'
                    }} />
                  </div>
                </div>

                {/* Footer Action */}
                <div style={{ marginTop: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenMembers(grp.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#ffffff',
                      border: '1.5px solid var(--border)',
                      padding: '10px 16px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = grp.color || '#0284c7'
                      e.currentTarget.style.color = grp.color || '#0284c7'
                      e.currentTarget.style.background = 'rgba(2, 132, 199, 0.04)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.color = 'var(--text-primary)'
                      e.currentTarget.style.background = '#ffffff'
                    }}
                  >
                    <span>{isViewer ? 'Lihat Anggota & Rincian Kuota' : 'Kelola Anggota & Rincian Kuota'} ({grp.member_count})</span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── MODAL 1: CREATE / EDIT GROUP ──────────────────────── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {showGroupModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }} onClick={() => setShowGroupModal(false)}>
          <div
            style={{
              background: '#ffffff',
              borderRadius: 20,
              width: '100%',
              maxWidth: 520,
              padding: 28,
              boxShadow: '0 25px 60px -15px rgba(0,0,0,0.3)',
              position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(2, 132, 199, 0.1)',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Layers size={20} />
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  {editingGroup ? 'Edit Group KIT' : 'Buat Group Baru'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowGroupModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4
                }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveGroup}>
              {/* Nama Group */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Nama Group <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Armada Starlink Mini / Site Riau"
                  value={groupForm.name}
                  onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
                  className="search-input"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13.5 }}
                />
              </div>

              {/* Deskripsi */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Deskripsi (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Keterangan singkat tentang kelompok perangkat ini..."
                  value={groupForm.description}
                  onChange={e => setGroupForm({ ...groupForm, description: e.target.value })}
                  className="search-input"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13, resize: 'vertical' }}
                />
              </div>

              {/* Batas Kuota per KIT (Max 100 GB) */}
              <div style={{
                background: 'var(--bg-canvas, #f8fafc)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: '16px',
                marginBottom: 20
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                    Batas Kuota Maksimum per KIT (GB)
                  </label>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', background: 'rgba(2, 132, 199, 0.1)', padding: '2px 8px', borderRadius: 6 }}>
                    Default: 100 GB
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.4 }}>
                  Setiap KIT di grup ini akan dipantau terhadap batas ini. Peringatan akan muncul bila ada KIT yang melebihi batas tersebut.
                </p>

                <input
                  type="number"
                  step="1"
                  min="1"
                  placeholder="Contoh: 100"
                  value={groupForm.quota_limit_per_kit_gb}
                  onChange={e => setGroupForm({ ...groupForm, quota_limit_per_kit_gb: e.target.value })}
                  className="search-input"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 14, fontWeight: 700 }}
                  required
                />

                {/* Preset Buttons */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', fontWeight: 600 }}>Preset:</span>
                  {[
                    { label: '50 GB (Mini Standard)', val: '50' },
                    { label: '100 GB (Rekomendasi)', val: '100' },
                    { label: '200 GB', val: '200' },
                    { label: '500 GB', val: '500' },
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, quota_limit_per_kit_gb: p.val })}
                      style={{
                        background: groupForm.quota_limit_per_kit_gb === p.val ? '#0284c7' : '#ffffff',
                        color: groupForm.quota_limit_per_kit_gb === p.val ? '#ffffff' : 'var(--text-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '4px 10px',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pilihan Warna */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Warna Identitas Group
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, color: c.hex })}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: c.hex,
                        border: groupForm.color === c.hex ? '3px solid #ffffff' : 'none',
                        outline: groupForm.color === c.hex ? `2px solid ${c.hex}` : 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        transition: 'transform 0.15s ease'
                      }}
                    >
                      {groupForm.color === c.hex && <Check size={18} />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="btn btn-outline"
                  style={{ borderRadius: 10, padding: '9px 18px' }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingGroup}
                  className="btn btn-primary"
                  style={{ borderRadius: 10, padding: '9px 22px', minWidth: 120 }}
                >
                  {savingGroup ? 'Menyimpan...' : editingGroup ? 'Simpan' : 'Buat Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── MODAL 2: AUTO-DETECT STARLINK MINI ─────────────────── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {showMiniModal && miniData && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }} onClick={() => setShowMiniModal(false)}>
          <div
            style={{
              background: '#ffffff',
              borderRadius: 20,
              width: '100%',
              maxWidth: 700,
              padding: 28,
              boxShadow: '0 25px 60px -15px rgba(0,0,0,0.3)',
              position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: 'rgba(2, 132, 199, 0.1)',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Cpu size={22} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    Deteksi Otomatis Starlink Mini
                  </h2>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Ditemukan {miniData.total_mini_detected} unit terminal Starlink Mini (Dish SN M1HT...)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMiniModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.08), rgba(79, 70, 229, 0.08))',
              border: '1px solid rgba(2, 132, 199, 0.25)',
              borderRadius: 14,
              padding: '16px 20px',
              marginBottom: 18,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0369a1' }}>Total Pemakaian Seluruh Mini</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#0c4a6e', marginTop: 2 }}>
                  {miniData.total_quota_formatted}
                </div>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleOneClickCreateMiniGroup}
                  className="btn btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '9px 18px',
                    borderRadius: 10
                  }}
                >
                  <Sparkles size={16} />
                  <span>Buat Group Starlink Mini (100GB/KIT)</span>
                </button>
              )}
            </div>

            {/* List Mini Detected */}
            <div style={{
              maxHeight: 280,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 12
            }}>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead style={{ background: 'var(--bg-canvas)', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Site / Controller</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Dish SN</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>Status</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>Pemakaian Kuota</th>
                  </tr>
                </thead>
                <tbody>
                  {miniData.kits.map(k => (
                    <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{k.site}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.account_name}</div>
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                        {k.sn}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          background: k.status === 'active' ? '#d1fae5' : '#fee2e2',
                          color: k.status === 'active' ? '#047857' : '#b91c1c'
                        }}>
                          {k.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {k.quota}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setShowMiniModal(false)}
                className="btn btn-outline"
                style={{ borderRadius: 10, padding: '8px 18px' }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ── MODAL 3: KELOLA ANGGOTA GROUP & DETAIL PER-KIT ─────── */}
      {/* ══════════════════════════════════════════════════════════ */}
      {showMemberModal && activeGroupDetail && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }} onClick={() => setShowMemberModal(false)}>
          <div
            style={{
              background: '#ffffff',
              borderRadius: 22,
              width: '100%',
              maxWidth: 960,
              maxHeight: '92vh',
              boxShadow: '0 25px 65px -15px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px 26px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#ffffff'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: activeGroupDetail.color || '#0284c7'
                  }} />
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    {activeGroupDetail.name}
                  </h2>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span>{activeGroupDetail.member_count} Anggota KIT</span>
                  <span>&bull;</span>
                  <span style={{ fontWeight: 700, color: '#0284c7' }}>
                    Batas Maksimum: {activeGroupDetail.quota_limit_per_kit_gb || 100} GB / KIT
                  </span>
                  <span>&bull;</span>
                  <span>Total Pemakaian: {activeGroupDetail.total_quota_formatted}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMemberModal(false)}
                style={{
                  background: 'var(--bg-canvas)',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ overflowY: 'auto', padding: '24px 26px', flex: 1 }}>

              {/* ── Add Members Box (Admin Only) ──────────────── */}
              {isAdmin && (
                <div style={{
                  background: 'var(--bg-canvas, #f8fafc)',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: '18px 20px',
                  marginBottom: 24
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                    + Tambahkan Terminal KIT ke dalam Group
                  </h4>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {candidateKits.length} KIT tersedia
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Cari Site, KIT, Dish SN, atau Controller..."
                      value={kitSearch}
                      onChange={e => setKitSearch(e.target.value)}
                      className="search-input"
                      style={{ paddingLeft: 36, width: '100%', fontSize: 13, borderRadius: 10 }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setFilterOnlyMini(!filterOnlyMini)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: filterOnlyMini ? 'rgba(2, 132, 199, 0.15)' : '#ffffff',
                      border: filterOnlyMini ? '1.5px solid #0284c7' : '1px solid var(--border)',
                      color: filterOnlyMini ? '#0284c7' : 'var(--text-primary)',
                      padding: '8px 14px',
                      borderRadius: 10,
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <Cpu size={15} />
                    <span>Hanya Starlink Mini</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedKitIds.length === 0 || addingMembers}
                    onClick={handleAddSelectedMembers}
                    className="btn btn-primary"
                    style={{
                      fontSize: 13,
                      padding: '8px 18px',
                      borderRadius: 10,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontWeight: 700
                    }}
                  >
                    <Plus size={16} />
                    <span>Tambahkan ({selectedKitIds.length} dipilih)</span>
                  </button>
                </div>

                {/* Candidate Checklist */}
                {loadingAllKits ? (
                  <div style={{ textAlign: 'center', padding: 14, fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Memuat daftar terminal...
                  </div>
                ) : candidateKits.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', padding: 10 }}>
                    {kitSearch ? 'Tidak ada KIT yang cocok dengan pencarian.' : 'Semua KIT yang sesuai sudah terdaftar di group ini.'}
                  </div>
                ) : (
                  <div style={{
                    maxHeight: 180,
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    background: '#ffffff'
                  }}>
                    {candidateKits.slice(0, 50).map(k => {
                      const isChecked = selectedKitIds.includes(k.id)
                      const isMini =
                        (k.sn || '').toUpperCase().startsWith('M1HT') ||
                        (k.kit || '').toUpperCase().startsWith('KIT4M') ||
                        (k.site || '').toLowerCase().includes('mini')

                      return (
                        <div
                          key={k.id}
                          onClick={() => {
                            setSelectedKitIds(prev =>
                              isChecked ? prev.filter(id => id !== k.id) : [...prev, k.id]
                            )
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '9px 14px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isChecked ? 'rgba(2, 132, 199, 0.06)' : 'transparent',
                            fontSize: 12.5,
                            transition: 'background 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ width: 16, height: 16, cursor: 'pointer' }}
                            />
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {k.site}
                                {isMini && (
                                  <span style={{
                                    fontSize: 10,
                                    background: '#cffafe',
                                    color: '#0891b2',
                                    padding: '1px 6px',
                                    borderRadius: 6,
                                    fontWeight: 800
                                  }}>
                                    MINI
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {k.account_name} &bull; <span style={{ fontFamily: 'monospace' }}>{k.sn}</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{k.quota || '-'}</div>
                            <div style={{ fontSize: 10.5, color: k.status === 'active' ? '#059669' : '#dc2626' }}>{k.status}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              )}

              {/* ── Current Group Members Table with 100GB Analysis ──── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                  Daftar Terminal & Analisis Kuota (Maks {activeGroupDetail.quota_limit_per_kit_gb || 100} GB/KIT)
                </h4>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Diurutkan dari pemakaian kuota tertinggi
                </span>
              </div>

              {activeGroupDetail.members.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: 32,
                  background: 'var(--bg-canvas, #f8fafc)',
                  borderRadius: 14,
                  color: 'var(--text-muted)',
                  fontSize: 13.5
                }}>
                  Belum ada terminal KIT yang masuk ke dalam group ini.
                </div>
              ) : (
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                }}>
                  <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--bg-canvas, #f8fafc)' }}>
                      <tr>
                        <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700 }}>Site / Controller</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700 }}>Serial (SN / KIT)</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 700 }}>Tipe</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700 }}>Pemakaian Kuota</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, width: 220 }}>Status Limit ({activeGroupDetail.quota_limit_per_kit_gb || 100} GB)</th>
                        {isAdmin && <th style={{ padding: '12px 14px', textAlign: 'center', width: 60, fontWeight: 700 }}>Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {activeGroupDetail.members.map(m => {
                        const isOver = m.alert_level === 'over_quota'
                        const isNear = m.alert_level === 'near_limit'
                        const pct = m.usage_percentage

                        return (
                          <tr key={m.kit_id} style={{
                            borderBottom: '1px solid var(--border)',
                            background: isOver ? 'rgba(239, 68, 68, 0.02)' : '#ffffff'
                          }}>
                            {/* Site */}
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{m.site}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{m.account_name}</div>
                            </td>

                            {/* SN */}
                            <td style={{ padding: '12px 14px', fontFamily: 'monospace' }}>
                              <div style={{ fontWeight: 600 }}>{m.sn}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.kit}</div>
                            </td>

                            {/* Tipe */}
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              {m.is_mini ? (
                                <span style={{
                                  background: '#cffafe',
                                  color: '#0e7490',
                                  padding: '2px 8px',
                                  borderRadius: 8,
                                  fontWeight: 800,
                                  fontSize: 11,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}>
                                  <Cpu size={12} />
                                  MINI
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Standard</span>
                              )}
                            </td>

                            {/* Kuota */}
                            <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                              <div style={{ fontSize: 14, fontWeight: 900, color: isOver ? '#dc2626' : 'var(--text-primary)' }}>
                                {m.quota}
                              </div>
                            </td>

                            {/* Limit Status Bar & Badge */}
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  padding: '2px 7px',
                                  borderRadius: 6,
                                  background: isOver ? '#fee2e2' : isNear ? '#fef3c7' : '#d1fae5',
                                  color: isOver ? '#b91c1c' : isNear ? '#b45309' : '#047857',
                                }}>
                                  {isOver ? `⚠️ OVER (+${m.excess_gb} GB)` : isNear ? `⚡ ${pct}% Penuh` : `✓ Aman (${pct}%)`}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {m.quota_gb} / {m.limit_gb} GB
                                </span>
                              </div>

                              {/* Progress bar per KIT */}
                              <div style={{
                                width: '100%',
                                height: 6,
                                borderRadius: 3,
                                background: '#e2e8f0',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  width: `${Math.min(pct, 100)}%`,
                                  height: '100%',
                                  borderRadius: 3,
                                  background: isOver ? '#ef4444' : isNear ? '#f59e0b' : '#10b981'
                                }} />
                              </div>
                            </td>

                            {/* Action */}
                            {isAdmin && (
                              <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(m.kit_id)}
                                  title="Keluarkan dari group"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    padding: 6,
                                    borderRadius: 6,
                                    display: 'inline-flex'
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 26px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              background: 'var(--bg-canvas)'
            }}>
              <button
                type="button"
                onClick={() => setShowMemberModal(false)}
                className="btn btn-primary"
                style={{ borderRadius: 10, padding: '9px 24px' }}
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
