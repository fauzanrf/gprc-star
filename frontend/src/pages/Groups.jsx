import React, { useEffect, useState } from 'react'
import {
  Layers, Plus, Trash2, Edit2, Users, HardDrive, AlertTriangle,
  CheckCircle2, Search, X, Sparkles, Filter, ChevronRight, Check,
  Radio, ArrowUpRight, BarChart3, ShieldAlert, Cpu
} from 'lucide-react'
import {
  getGroups, getGroupDetail, createGroup, updateGroup, deleteGroup,
  addGroupMembers, removeGroupMember, detectStarlinkMini, getKits
} from '../api'

const COLOR_PRESETS = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Rose', hex: '#f43f5e' },
]

export default function Groups() {
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
    quota_limit_gb: '',
    color: '#3b82f6',
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

  const handleOpenCreateModal = (presetName = '', presetDesc = '', presetLimit = '', presetColor = '#3b82f6', initialIds = []) => {
    setEditingGroup(null)
    setGroupForm({
      name: presetName,
      description: presetDesc,
      quota_limit_gb: presetLimit,
      color: presetColor,
      initial_kit_ids: initialIds,
    })
    setShowGroupModal(true)
  }

  const handleOpenEditModal = (grp) => {
    setEditingGroup(grp)
    setGroupForm({
      name: grp.name,
      description: grp.description || '',
      quota_limit_gb: grp.quota_limit_gb > 0 ? String(grp.quota_limit_gb) : '',
      color: grp.color || '#3b82f6',
    })
    setShowGroupModal(true)
  }

  const handleSaveGroup = async (e) => {
    e.preventDefault()
    if (!groupForm.name.trim()) return
    setSavingGroup(true)
    try {
      const payload = {
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || null,
        quota_limit_gb: parseFloat(groupForm.quota_limit_gb) || 0,
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
    if (!window.confirm(`Yakin ingin menghapus group "${grp.name}"? (Data KIT tidak akan terhapus).`)) return
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
      // Load all available kits for adding
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
    if (!activeGroupDetail) return
    try {
      await removeGroupMember(activeGroupDetail.id, kitId)
      const updated = await getGroupDetail(activeGroupDetail.id)
      setActiveGroupDetail(updated)
      loadGroups()
    } catch (err) {
      alert(err.message || 'Gagal menghapus anggota')
    }
  }

  const handleAddSelectedMembers = async () => {
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
    if (!miniData || miniData.kits.length === 0) return
    const ids = miniData.kits.map(k => k.id)
    handleOpenCreateModal(
      'Group Starlink Mini',
      'Kelompok khusus perangkat Starlink Mini untuk pemantauan kuota paket 50GB / kuota bersama',
      '50',
      '#06b6d4',
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
  const overQuotaGroups = groups.filter(g => g.alert_level === 'over_quota').length
  const nearLimitGroups = groups.filter(g => g.alert_level === 'near_limit').length

  return (
    <div className="page-container" style={{ paddingBottom: 60 }}>
      {/* Top Header */}
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
            gap: 10,
            color: 'var(--text-primary)',
            margin: 0
          }}>
            <span style={{
              background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
              padding: '6px 10px',
              borderRadius: 12,
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              boxShadow: '0 4px 14px rgba(6, 182, 212, 0.3)'
            }}>
              <Layers size={22} />
            </span>
            Grouping & Kuota KIT
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Kelompokkan beberapa KIT Starlink untuk agregasi kuota, pengawasan batas limit, dan manajemen armada Starlink Mini.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* Quick Auto-Detect Mini Button */}
          {miniData && miniData.total_mini_detected > 0 && (
            <button
              type="button"
              onClick={() => setShowMiniModal(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(59, 130, 246, 0.12))',
                border: '1px solid rgba(6, 182, 212, 0.4)',
                color: '#0284c7',
                padding: '9px 16px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'none'}
            >
              <Cpu size={16} />
              <span>Deteksi Starlink Mini</span>
              <span style={{
                background: '#0284c7',
                color: '#ffffff',
                padding: '1px 7px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 800
              }}>
                {miniData.total_mini_detected}
              </span>
            </button>
          )}

          {/* Create Group Button */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleOpenCreateModal()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 18px',
              borderRadius: 10,
              fontWeight: 700,
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)'
            }}
          >
            <Plus size={18} />
            <span>Buat Group Baru</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        marginBottom: 28
      }}>
        {/* Card 1: Total Groups */}
        <div style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 18,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'rgba(59, 130, 246, 0.1)',
            color: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Layers size={24} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Total Groups
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
              {totalGroups}
            </div>
          </div>
        </div>

        {/* Card 2: Total Grouped KITs */}
        <div style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 18,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'rgba(16, 185, 129, 0.1)',
            color: '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Users size={24} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              KIT Terkelompok
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
              {totalGroupedKits} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>unit</span>
            </div>
          </div>
        </div>

        {/* Card 3: Total Group Quota */}
        <div style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 18,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'rgba(6, 182, 212, 0.1)',
            color: '#0891b2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <HardDrive size={24} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Agregasi Kuota Grup
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>
              {totalGroupQuotaGb >= 1024
                ? `${(totalGroupQuotaGb / 1024).toFixed(2)} TB`
                : `${totalGroupQuotaGb.toFixed(2)} GB`}
            </div>
          </div>
        </div>

        {/* Card 4: Limit Alerts */}
        <div style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 18,
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: overQuotaGroups > 0
              ? 'rgba(239, 68, 68, 0.12)'
              : nearLimitGroups > 0
              ? 'rgba(245, 158, 11, 0.12)'
              : 'rgba(16, 185, 129, 0.1)',
            color: overQuotaGroups > 0 ? '#dc2626' : nearLimitGroups > 0 ? '#d97706' : '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {overQuotaGroups > 0 ? <ShieldAlert size={24} /> : <CheckCircle2 size={24} />}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Status Kuota Limit
            </div>
            <div style={{
              fontSize: 18,
              fontWeight: 800,
              color: overQuotaGroups > 0 ? '#dc2626' : nearLimitGroups > 0 ? '#d97706' : '#059669',
              marginTop: 4
            }}>
              {overQuotaGroups > 0
                ? `${overQuotaGroups} Grup Over Limit!`
                : nearLimitGroups > 0
                ? `${nearLimitGroups} Mendekati Limit`
                : 'Semua Grup Aman'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Groups Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <span className="spinner-dark" />
          <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>Memuat daftar group...</p>
        </div>
      ) : groups.length === 0 ? (
        /* Empty State */
        <div style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px dashed var(--border)',
          borderRadius: 16,
          padding: '48px 24px',
          textAlign: 'center',
          maxWidth: 600,
          margin: '20px auto'
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(59, 130, 246, 0.08)',
            color: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <Layers size={32} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
            Belum Ada Group KIT
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5, margin: '0 0 20px' }}>
            Buat group untuk mengelompokkan beberapa KIT Starlink Anda (misalnya armada Starlink Mini, proyek lapangan, atau kapal), lalu tentukan batas kuota gabungan untuk monitoring.
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
                  fontWeight: 700
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 20
        }}>
          {groups.map(grp => {
            const hasLimit = grp.quota_limit_gb > 0
            const pct = grp.usage_percentage
            const isOver = grp.alert_level === 'over_quota'
            const isNear = grp.alert_level === 'near_limit'

            return (
              <div
                key={grp.id}
                style={{
                  background: 'var(--card-bg, #ffffff)',
                  border: isOver
                    ? '1.5px solid #f87171'
                    : isNear
                    ? '1.5px solid #fbbf24'
                    : '1px solid var(--border)',
                  borderRadius: 16,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  boxShadow: isOver
                    ? '0 4px 18px rgba(239, 68, 68, 0.12)'
                    : '0 2px 10px rgba(0,0,0,0.03)',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Header Card */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: grp.color || '#3b82f6',
                      flexShrink: 0,
                      boxShadow: `0 0 8px ${grp.color || '#3b82f6'}66`
                    }} />
                    <h3 style={{
                      margin: 0,
                      fontSize: 17,
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                      lineHeight: 1.3
                    }}>
                      {grp.name}
                    </h3>
                  </div>

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
                        borderRadius: 6,
                        cursor: 'pointer',
                        display: 'flex'
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
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
                        borderRadius: 6,
                        cursor: 'pointer',
                        display: 'flex'
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Description */}
                {grp.description && (
                  <p style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    margin: '8px 0 14px',
                    lineHeight: 1.4
                  }}>
                    {grp.description}
                  </p>
                )}

                {/* Member Badges */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  margin: grp.description ? '0 0 16px' : '10px 0 16px',
                  color: 'var(--text-muted)'
                }}>
                  <span style={{
                    background: 'var(--bg-secondary, #f1f5f9)',
                    padding: '3px 8px',
                    borderRadius: 8,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5
                  }}>
                    <Users size={12} />
                    {grp.member_count} KIT
                  </span>
                  <span>({grp.active_kits} Active{grp.inactive_kits > 0 ? `, ${grp.inactive_kits} Inactive` : ''})</span>
                </div>

                {/* Quota Progress / Gauge Section */}
                <div style={{
                  background: 'var(--bg-secondary, #f8fafc)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '14px',
                  marginBottom: 16
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Pemakaian Kuota
                    </div>
                    {hasLimit ? (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: isOver
                          ? '#fee2e2'
                          : isNear
                          ? '#fef3c7'
                          : '#d1fae5',
                        color: isOver
                          ? '#b91c1c'
                          : isNear
                          ? '#b45309'
                          : '#047857',
                      }}>
                        {isOver ? '⚠️ OVER LIMIT' : isNear ? '⚡ Mendekati Limit' : '✓ Normal'}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tanpa Limit</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {grp.total_quota_formatted}
                    </span>
                    {hasLimit && (
                      <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                        / {grp.quota_limit_gb >= 1024 ? `${(grp.quota_limit_gb / 1024).toFixed(2)} TB` : `${grp.quota_limit_gb} GB`} ({pct}%)
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {hasLimit && (
                    <div style={{
                      width: '100%',
                      height: 8,
                      borderRadius: 4,
                      background: '#e2e8f0',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${Math.min(pct, 100)}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: isOver
                          ? '#ef4444'
                          : isNear
                          ? '#f59e0b'
                          : grp.color || '#3b82f6',
                        transition: 'width 0.4s ease'
                      }} />
                    </div>
                  )}
                </div>

                {/* Footer Action */}
                <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenMembers(grp.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      padding: '7px 14px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = grp.color || '#3b82f6'
                      e.currentTarget.style.color = grp.color || '#3b82f6'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.color = 'var(--text-primary)'
                    }}
                  >
                    <span>Kelola Anggota ({grp.member_count})</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL 1: CREATE / EDIT GROUP */}
      {showGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowGroupModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 520, borderRadius: 16 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                {editingGroup ? 'Edit Group KIT' : 'Buat Group Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setShowGroupModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
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
                  placeholder="Contoh: Starlink Mini Armada 1 / Project Sawit"
                  value={groupForm.name}
                  onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>

              {/* Deskripsi */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Deskripsi (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Keterangan singkat fungsi atau lokasi kelompok ini..."
                  value={groupForm.description}
                  onChange={e => setGroupForm({ ...groupForm, description: e.target.value })}
                  className="form-control"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              {/* Batas Kuota (Limit GB) */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Batas Kuota Gabungan (GB)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Contoh: 50 untuk paket 50GB, atau 200 (kosongkan jika tanpa limit)"
                  value={groupForm.quota_limit_gb}
                  onChange={e => setGroupForm({ ...groupForm, quota_limit_gb: e.target.value })}
                  className="form-control"
                  style={{ width: '100%' }}
                />

                {/* Preset Limit Buttons */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Preset:</span>
                  {[
                    { label: '50 GB (Mini Paket)', val: '50' },
                    { label: '100 GB', val: '100' },
                    { label: '250 GB', val: '250' },
                    { label: '500 GB', val: '500' },
                    { label: '1 TB', val: '1024' },
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, quota_limit_gb: p.val })}
                      style={{
                        background: groupForm.quota_limit_gb === p.val ? 'var(--primary)' : 'var(--bg-secondary, #f1f5f9)',
                        color: groupForm.quota_limit_gb === p.val ? '#ffffff' : 'var(--text-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
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
                  Warna Aksen Group
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, color: c.hex })}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
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
                      {groupForm.color === c.hex && <Check size={16} />}
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
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingGroup}
                  className="btn btn-primary"
                  style={{ minWidth: 100 }}
                >
                  {savingGroup ? 'Menyimpan...' : editingGroup ? 'Simpan Perubahan' : 'Buat Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: AUTO-DETECT STARLINK MINI */}
      {showMiniModal && miniData && (
        <div className="modal-backdrop" onClick={() => setShowMiniModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 650, borderRadius: 16 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(6, 182, 212, 0.12)',
                  color: '#0891b2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Cpu size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    Hasil Deteksi Starlink Mini
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Ditemukan {miniData.total_mini_detected} perangkat Starlink Mini di sistem Anda
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
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(59, 130, 246, 0.08))',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0369a1' }}>Total Agregasi Kuota Mini</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0c4a6e', marginTop: 2 }}>
                  {miniData.total_quota_formatted}
                </div>
              </div>
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
                  background: 'linear-gradient(135deg, #06b6d4, #2563eb)'
                }}
              >
                <Sparkles size={16} />
                <span>Buat Group Khusus Mini</span>
              </button>
            </div>

            {/* List Mini Detected */}
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead style={{ background: 'var(--bg-secondary, #f8fafc)', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Site / Controller</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Serial (SN / KIT)</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Kuota</th>
                  </tr>
                </thead>
                <tbody>
                  {miniData.kits.map((k, i) => (
                    <tr key={k.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{k.site}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.account_name}</div>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                        <div>{k.sn}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.kit}</div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 700,
                          background: k.status === 'active' ? '#d1fae5' : '#fee2e2',
                          color: k.status === 'active' ? '#047857' : '#b91c1c'
                        }}>
                          {k.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>
                        {k.quota}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setShowMiniModal(false)} className="btn btn-outline">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: KELOLA ANGGOTA GROUP (DETAIL & MANAGE) */}
      {showMemberModal && activeGroupDetail && (
        <div className="modal-backdrop" onClick={() => setShowMemberModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 850, width: '92%', borderRadius: 16, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: 16,
              borderBottom: '1px solid var(--border)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: activeGroupDetail.color || '#3b82f6'
                  }} />
                  <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    {activeGroupDetail.name}
                  </h2>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  {activeGroupDetail.member_count} Anggota KIT &bull; Total Kuota: {activeGroupDetail.total_quota_formatted}
                  {activeGroupDetail.quota_limit_gb > 0 && ` / Batas: ${activeGroupDetail.quota_limit_gb} GB (${activeGroupDetail.usage_percentage}%)`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMemberModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body: Tabs / Sections */}
            <div style={{ overflowY: 'auto', padding: '16px 0', flex: 1 }}>
              {/* Add New Members Box */}
              <div style={{
                background: 'var(--bg-secondary, #f8fafc)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 16,
                marginBottom: 24
              }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  + Tambah KIT ke dalam Group
                </h4>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Cari Site, KIT, Dish SN, atau Controller..."
                      value={kitSearch}
                      onChange={e => setKitSearch(e.target.value)}
                      className="form-control"
                      style={{ paddingLeft: 32, width: '100%', fontSize: 12 }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setFilterOnlyMini(!filterOnlyMini)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: filterOnlyMini ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                      border: filterOnlyMini ? '1px solid #06b6d4' : '1px solid var(--border)',
                      color: filterOnlyMini ? '#0891b2' : 'var(--text-primary)',
                      padding: '7px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <Cpu size={14} />
                    <span>Hanya Starlink Mini</span>
                  </button>

                  <button
                    type="button"
                    disabled={selectedKitIds.length === 0 || addingMembers}
                    onClick={handleAddSelectedMembers}
                    className="btn btn-primary"
                    style={{
                      fontSize: 12,
                      padding: '7px 16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <Plus size={14} />
                    <span>Tambahkan ({selectedKitIds.length} dipilih)</span>
                  </button>
                </div>

                {/* Candidate Checklist */}
                {loadingAllKits ? (
                  <div style={{ textAlign: 'center', padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    Memuat daftar KIT...
                  </div>
                ) : candidateKits.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>
                    {kitSearch ? 'Tidak ada KIT yang cocok dengan pencarian.' : 'Semua KIT yang sesuai sudah terdaftar di group ini.'}
                  </div>
                ) : (
                  <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: '#ffffff' }}>
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
                            padding: '8px 12px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: isChecked ? 'rgba(59, 130, 246, 0.06)' : 'transparent',
                            fontSize: 12
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}} // handled by parent div
                              style={{ cursor: 'pointer' }}
                            />
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {k.site}
                                {isMini && (
                                  <span style={{
                                    fontSize: 10,
                                    background: '#cffafe',
                                    color: '#0891b2',
                                    padding: '1px 5px',
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
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{k.quota || '-'}</div>
                            <div style={{ fontSize: 10, color: k.status === 'active' ? '#059669' : '#dc2626' }}>{k.status}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Current Group Members Table */}
              <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                Daftar Anggota KIT ({activeGroupDetail.members.length})
              </h4>

              {activeGroupDetail.members.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: 28,
                  background: 'var(--bg-secondary, #f8fafc)',
                  borderRadius: 10,
                  color: 'var(--text-muted)',
                  fontSize: 13
                }}>
                  Belum ada KIT yang masuk ke dalam group ini. Gunakan kotak di atas untuk menambahkan.
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead style={{ background: 'var(--bg-secondary, #f8fafc)' }}>
                      <tr>
                        <th style={{ padding: '10px 14px', textAlign: 'left' }}>Site / Controller</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left' }}>Dish SN / KIT</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center' }}>Tipe</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center' }}>Status</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right' }}>Pemakaian Kuota</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', width: 60 }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeGroupDetail.members.map(m => (
                        <tr key={m.kit_id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{m.site}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.account_name}</div>
                          </td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>
                            <div>{m.sn}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.kit}</div>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            {m.is_mini ? (
                              <span style={{
                                background: '#cffafe',
                                color: '#0e7490',
                                padding: '2px 7px',
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
                              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Standard</span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: 10,
                              fontSize: 11,
                              fontWeight: 700,
                              background: m.status === 'active' ? '#d1fae5' : '#fee2e2',
                              color: m.status === 'active' ? '#047857' : '#b91c1c'
                            }}>
                              {m.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {m.quota}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(m.kit_id)}
                              title="Keluarkan dari group"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                padding: 4,
                                display: 'inline-flex'
                              }}
                            >
                              <X size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowMemberModal(false)}
                className="btn btn-primary"
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
