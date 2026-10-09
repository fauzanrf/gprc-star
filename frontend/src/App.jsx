import React, { useEffect, useState } from 'react'
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Monitor, Users, RefreshCw, LogIn, Building2,
  ExternalLink, ChevronRight, MessageSquare,
  PanelLeftClose, PanelLeftOpen, Menu, X, Layers, LogOut,
  User as UserIcon, Shield
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Kits from './pages/Kits'
import Accounts from './pages/Accounts'
import Groups from './pages/Groups'
import Scraping from './pages/Scraping'
import StarlinkSession from './pages/StarlinkSession'
import LoginPage from './pages/Login'
import ParentAccounts from './pages/ParentAccounts'
import WhatsAppPage from './pages/WhatsApp'
import ManageACL from './pages/ManageACL'
import { getAuthStatus, getParentAccounts } from './api'
import { useAuth } from './contexts/AuthContext'
import { ROLE_LABELS, ROLE_BADGE_STYLES } from './lib/permissions'
import logoImg from './logo.png'

const NAV_GROUPS = [
  {
    title: 'DASHBOARD',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Overview' },
    ]
  },
  {
    title: 'MANAGEMENT',
    items: [
      { to: '/parent-accounts', icon: Building2, label: 'Akun Induk' },
      { to: '/groups', icon: Layers, label: 'Grouping & Kuota' },
      { to: '/kits', icon: Monitor, label: 'KIT / Terminal' },
      { to: '/accounts', icon: Users, label: 'Accounts' },
      { to: '/scraping', icon: RefreshCw, label: 'Scraping Control' },
      { to: '/acl', icon: Shield, label: 'Manajemen ACL' },
    ]
  },
  {
    title: 'INTEGRASI & SISTEM',
    items: [
      { to: '/whatsapp', icon: MessageSquare, label: 'Notifikasi WA' },
      { to: '/starlink-session', icon: LogIn, label: 'Sesi Scraper (OTP)' },
    ]
  }
]

export default function App() {
  const location = useLocation()
  const { session, isLoading, logout, role } = useAuth()

  const [sessionValid, setSessionValid] = useState(null)
  const [parentAccounts, setParentAccounts] = useState([])
  const [selectedParentId, setSelectedParentId] = useState(
    localStorage.getItem('starlink_selected_parent_id') || ''
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('starlink_sidebar_collapsed') === 'true'
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('starlink_sidebar_collapsed', String(next))
      return next
    })
  }

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (session) {
      getAuthStatus()
        .then(d => setSessionValid(d.is_valid))
        .catch(() => setSessionValid(false))

      getParentAccounts()
        .then(setParentAccounts)
        .catch(() => {})
    }
  }, [location.pathname, session])

  const handleSelectParent = (val) => {
    setSelectedParentId(val)
    if (val) {
      localStorage.setItem('starlink_selected_parent_id', val)
    } else {
      localStorage.removeItem('starlink_selected_parent_id')
    }
    window.dispatchEvent(new CustomEvent('parent_account_changed', { detail: val }))
  }

  const findCurrentTitle = () => {
    if (location.pathname === '/') return 'Dashboard'
    if (location.pathname.startsWith('/parent-accounts')) return 'Manajemen Akun Induk'
    if (location.pathname.startsWith('/groups')) return 'Grouping & Kuota KIT'
    if (location.pathname.startsWith('/kits')) return 'KIT / Terminal'
    if (location.pathname.startsWith('/accounts')) return 'Accounts'
    if (location.pathname.startsWith('/scraping')) return 'Scraping Control'
    if (location.pathname.startsWith('/acl')) return 'Manajemen ACL'
    if (location.pathname.startsWith('/starlink-session')) return 'Sesi Scraper Starlink'
    if (location.pathname.startsWith('/whatsapp')) return 'Notifikasi WhatsApp'
    return 'Dashboard'
  }

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        flexDirection: 'column',
        gap: 14
      }}>
        <div style={{
          width: 42,
          height: 42,
          border: '4px solid #5e35b1',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <p style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
          Memuat sesi NEXCARE...
        </p>
      </div>
    )
  }

  // If not authenticated, render Login Page
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  const roleStyle = ROLE_BADGE_STYLES[role] || { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }
  const roleName = ROLE_LABELS[role] || role || 'User'

  return (
    <div className={`layout ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      {/* Mobile Drawer Backdrop */}
      <div
        className={`sidebar-backdrop ${mobileMenuOpen ? 'active' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-label="Tutup menu"
      />

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-badge" style={{ background: '#ffffff', border: '1px solid var(--border)', padding: 4 }}>
            <img src={logoImg} alt="Starlink Logo" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          </div>
          <div className="logo-text">
            <div className="logo-title">Starlink GPRC</div>
            <div className="logo-subtitle">Enterprise Monitoring</div>
          </div>
          {/* Mobile close button */}
          <button
            className="mobile-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            title="Tutup Menu"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        {/* User Card in Sidebar (Nexcare style) */}
        {!sidebarCollapsed && (
          <div style={{
            margin: '12px 14px 4px',
            padding: '10px 12px',
            borderRadius: 10,
            background: '#f8fafc',
            border: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--purple-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--purple-main)',
              flexShrink: 0
            }}>
              <UserIcon size={17} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.name}
              </div>
              <span style={{
                display: 'inline-block',
                fontSize: 10.5,
                fontWeight: 700,
                padding: '1px 7px',
                borderRadius: 10,
                marginTop: 2,
                ...roleStyle
              }}>
                {roleName}
              </span>
            </div>
          </div>
        )}

        <nav className="nav-container">
          {NAV_GROUPS.map((group, idx) => (
            <div key={idx} className="nav-group">
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) =>
                item.external ? (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="nav-item external-nav-item"
                    title={sidebarCollapsed ? item.label : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <item.icon size={18} className="nav-icon" />
                    <span>{item.label}</span>
                    <ExternalLink size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} />
                  </a>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    title={sidebarCollapsed ? item.label : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <item.icon size={18} className="nav-icon" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="version-pill" title="v2.0 • Production (WIB)">
            <span className="dot-live" />
            <span>v2.0 • ACL Ready</span>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <div className="main">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            {/* Mobile Hamburger Button */}
            <button
              className="mobile-toggle-btn"
              onClick={() => setMobileMenuOpen(true)}
              title="Buka Menu"
              type="button"
            >
              <Menu size={20} />
            </button>

            {/* Desktop Sidebar Collapse Toggle */}
            <button
              className="desktop-collapse-btn"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Perluas Sidebar" : "Kecilkan Sidebar"}
              type="button"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>

            <div className="breadcrumb">
              <span>Home</span>
              <ChevronRight size={14} />
              <span className="breadcrumb-active">{findCurrentTitle()}</span>
            </div>
          </div>

          <div className="topbar-right">
            {/* Multi-Account Selector */}
            {parentAccounts.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Building2 size={15} color="var(--purple-main)" />
                <select
                  className="filter-select"
                  style={{ fontSize: 12.5, padding: '5px 10px', height: 32 }}
                  value={selectedParentId}
                  onChange={e => handleSelectParent(e.target.value)}
                >
                  <option value="">Semua Akun Induk (Global)</option>
                  {parentAccounts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.account_name} ({p.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <NavLink
              to="/whatsapp"
              className="topbar-wa-btn"
              title="Pengaturan Notifikasi WhatsApp"
            >
              <MessageSquare size={15} />
              <span>Notifikasi WA</span>
            </NavLink>

            {sessionValid !== null && (
              <div className={`session-pill ${sessionValid ? 'valid' : 'invalid'}`}>
                <span className={`status-dot ${sessionValid ? 'online' : 'offline'}`} />
                <span>{sessionValid ? 'Scraper Siap' : 'Scraper Offline'}</span>
              </div>
            )}

            {/* User Profile & ACL Role Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 6, borderLeft: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {session.name}
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 8,
                  marginTop: 2,
                  ...roleStyle
                }}>
                  {roleName}
                </span>
              </div>

              <button
                type="button"
                onClick={logout}
                title="Keluar dari sistem (Logout)"
                style={{
                  background: '#fee2e2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#dc2626'
                  e.currentTarget.style.color = '#ffffff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fee2e2'
                  e.currentTarget.style.color = '#dc2626'
                }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="content">
          <div className="page-wrapper fade-in">
            <Routes>
              <Route path="/" element={<Dashboard selectedParentId={selectedParentId} />} />
              <Route path="/parent-accounts" element={<ParentAccounts />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/kits" element={<Kits selectedParentId={selectedParentId} />} />
              <Route path="/accounts" element={<Accounts selectedParentId={selectedParentId} />} />
              <Route path="/scraping" element={<Scraping />} />
              <Route path="/acl" element={<ManageACL />} />
              <Route path="/starlink-session" element={<StarlinkSession />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/whatsapp" element={<WhatsAppPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
