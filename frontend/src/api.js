const BASE = import.meta.env.VITE_API_URL || '/api'
const WS_BASE = import.meta.env.VITE_WS_URL || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host

export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export function wsConnect(path) {
  return new WebSocket(`${WS_BASE}${path}`)
}

// Dashboard
export const getDashboardStats   = (parentId) => apiFetch(`/dashboard/stats${parentId ? `?parent_id=${parentId}` : ''}`)
export const getDashboardSummary = (parentId) => apiFetch(`/dashboard/summary${parentId ? `?parent_id=${parentId}` : ''}`)

// Parent Accounts (Multi Akun Induk)
export const getParentAccounts   = () => apiFetch('/parent-accounts')
export const createParentAccount = (data) => apiFetch('/parent-accounts', { method: 'POST', body: JSON.stringify(data) })
export const toggleParentAccount = (id) => apiFetch(`/parent-accounts/${id}/toggle`, { method: 'PATCH' })
export const deleteParentAccount = (id) => apiFetch(`/parent-accounts/${id}`, { method: 'DELETE' })

// Kits
export const getKits = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null && v !== ''))
  return apiFetch(`/kits?${q}`)
}

// Accounts (Sub-accounts)
export const getAccounts = (parentId) => apiFetch(`/accounts${parentId ? `?parent_id=${parentId}` : ''}`)
export const getAccountKits = (id) => apiFetch(`/accounts/${id}/kits`)

// Scrape
export const startScrape = (workers, parentAccountId = null) => apiFetch('/scrape/start', {
  method: 'POST', body: JSON.stringify({ workers, parent_account_id: parentAccountId || null }),
})
export const cancelScrape   = () => apiFetch('/scrape/cancel', { method: 'POST' })
export const getScrapeStatus = () => apiFetch('/scrape/status')
export const getScrapeJobs   = () => apiFetch('/scrape/jobs')

// Auth
export const getAuthStatus = () => apiFetch('/auth/status')
export const logout = () => apiFetch('/auth/logout', { method: 'POST' })

// WhatsApp Gateway & Notifications
export const getWhatsAppStatus     = () => apiFetch('/whatsapp/status')
export const getWhatsAppGroups     = () => apiFetch('/whatsapp/groups')
export const getWhatsAppConfig     = () => apiFetch('/whatsapp/config')
export const saveWhatsAppConfig    = (data) => apiFetch('/whatsapp/config', { method: 'POST', body: JSON.stringify(data) })
export const sendWhatsAppTest      = (data = {}) => apiFetch('/whatsapp/test', { method: 'POST', body: JSON.stringify(data) })
export const disconnectWhatsApp    = () => apiFetch('/whatsapp/disconnect', { method: 'POST' })
export const reloadWhatsApp        = () => apiFetch('/whatsapp/reload', { method: 'POST' })
