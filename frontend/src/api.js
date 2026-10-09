const isSubpath = window.location.pathname.startsWith('/starlink')
const BASE = import.meta.env.VITE_API_URL || (isSubpath ? '/starlink/api' : '/api')
const wsPrefix = isSubpath ? '/starlink' : ''
const WS_BASE = import.meta.env.VITE_WS_URL || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + wsPrefix)

// ── Token Management ──────────────────────────────────────────────────────────
const TOKEN_KEY = 'starlink_auth_token'

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAccessToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY)
}

// ── HTTP Fetcher ─────────────────────────────────────────────────────────────
export async function apiFetch(path, opts = {}) {
  const token = getAccessToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...opts.headers,
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
  })

  if (res.status === 401 && !path.includes('/user-auth/login')) {
    // Session expired or invalid
    clearAccessToken()
    window.dispatchEvent(new CustomEvent('auth_unauthorized'))
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || err.message || 'Request failed')
  }
  return res.json()
}

export function wsConnect(path) {
  return new WebSocket(`${WS_BASE}${path}`)
}

// ── System User Auth & ACL ───────────────────────────────────────────────────
export const userLogin = (email, password) => apiFetch('/user-auth/login', {
  method: 'POST', body: JSON.stringify({ email, password }),
})
export const getUserMe   = () => apiFetch('/user-auth/me')
export const userLogout  = () => apiFetch('/user-auth/logout', { method: 'POST' })
export const getUserList = () => apiFetch('/user-auth/users')
export const createUser  = (data) => apiFetch('/user-auth/users', { method: 'POST', body: JSON.stringify(data) })
export const updateUser  = (id, data) => apiFetch(`/user-auth/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteUser  = (id) => apiFetch(`/user-auth/users/${id}`, { method: 'DELETE' })

// ── Dashboard ────────────────────────────────────────────────────────────────
export const getDashboardStats   = (parentId) => apiFetch(`/dashboard/stats${parentId ? `?parent_id=${parentId}` : ''}`)
export const getDashboardSummary = (parentId) => apiFetch(`/dashboard/summary${parentId ? `?parent_id=${parentId}` : ''}`)

// ── Parent Accounts (Multi Akun Induk) ───────────────────────────────────────
export const getParentAccounts   = () => apiFetch('/parent-accounts')
export const createParentAccount = (data) => apiFetch('/parent-accounts', { method: 'POST', body: JSON.stringify(data) })
export const toggleParentAccount = (id) => apiFetch(`/parent-accounts/${id}/toggle`, { method: 'PATCH' })
export const deleteParentAccount = (id) => apiFetch(`/parent-accounts/${id}`, { method: 'DELETE' })

// ── Kits ─────────────────────────────────────────────────────────────────────
export const getKits = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null && v !== ''))
  return apiFetch(`/kits?${q}`)
}

// ── Accounts (Sub-accounts) ──────────────────────────────────────────────────
export const getAccounts               = (parentId) => apiFetch(`/accounts${parentId ? `?parent_id=${parentId}` : ''}`)
export const getAccountKits            = (id) => apiFetch(`/accounts/${id}/kits`)
export const updateAccount             = (id, data) => apiFetch(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const bulkUpdateAccountEmails   = (items) => apiFetch('/accounts/bulk-update-email', { method: 'POST', body: JSON.stringify(items) })

// ── Scrape ───────────────────────────────────────────────────────────────────
export const startScrape = (workers, parentAccountId = null) => apiFetch('/scrape/start', {
  method: 'POST', body: JSON.stringify({ workers, parent_account_id: parentAccountId || null }),
})
export const cancelScrape   = () => apiFetch('/scrape/cancel', { method: 'POST' })
export const getScrapeStatus = () => apiFetch('/scrape/status')
export const getScrapeJobs   = () => apiFetch('/scrape/jobs')

// ── Starlink Scraper OTP Auth ────────────────────────────────────────────────
export const getAuthStatus = () => apiFetch('/auth/status')
export const logoutStarlinkSession = () => apiFetch('/auth/logout', { method: 'POST' })
export const logout = logoutStarlinkSession // backward compatibility

// ── WhatsApp Gateway & Notifications ─────────────────────────────────────────
export const getWhatsAppStatus     = () => apiFetch('/whatsapp/status')
export const getWhatsAppGroups     = () => apiFetch('/whatsapp/groups')
export const getWhatsAppConfig     = () => apiFetch('/whatsapp/config')
export const saveWhatsAppConfig    = (data) => apiFetch('/whatsapp/config', { method: 'POST', body: JSON.stringify(data) })
export const sendWhatsAppTest      = (data = {}) => apiFetch('/whatsapp/test', { method: 'POST', body: JSON.stringify(data) })
export const disconnectWhatsApp    = () => apiFetch('/whatsapp/disconnect', { method: 'POST' })
export const reloadWhatsApp        = () => apiFetch('/whatsapp/reload', { method: 'POST' })

// ── KIT Grouping & Quota Monitoring ──────────────────────────────────────────
export const getGroups          = () => apiFetch('/groups')
export const getGroupDetail     = (id) => apiFetch(`/groups/${id}`)
export const createGroup        = (data) => apiFetch('/groups', { method: 'POST', body: JSON.stringify(data) })
export const updateGroup        = (id, data) => apiFetch(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteGroup        = (id) => apiFetch(`/groups/${id}`, { method: 'DELETE' })
export const addGroupMembers    = (id, kitIds) => apiFetch(`/groups/${id}/members`, { method: 'POST', body: JSON.stringify({ kit_ids: kitIds }) })
export const removeGroupMember  = (groupId, kitId) => apiFetch(`/groups/${groupId}/members/${kitId}`, { method: 'DELETE' })
export const detectStarlinkMini = () => apiFetch('/groups/detect-mini')
