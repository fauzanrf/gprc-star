// Role-based permissions: 2 user types (admin & viewer)
export const PERMISSIONS = {
  admin: [
    'crud_client', 'crud_starlink', 'crud_rfo', 'approve_rfo',
    'crud_team_visit', 'assign_team_visit', 'manage_users',
    'view_all', 'view_client', 'view_rfo', 'view_team_visit',
    'edit_accounts', 'manage_scraping', 'manage_groups', 'manage_parent_accounts'
  ],
  viewer: [
    'view_all', 'view_client', 'view_rfo', 'view_team_visit',
  ],
}

export const ROLE_LABELS = {
  admin: 'Admin',
  viewer: 'Viewer',
  // Backward-compatibility fallbacks
  super_admin: 'Admin',
  noc2: 'Admin',
  noc1: 'Admin',
  technical_support: 'Admin',
  provisioning: 'Admin',
  magang: 'Viewer',
}

export const ROLE_BADGE_STYLES = {
  admin:  { background: '#ede7f6', color: '#5e35b1', border: '1px solid #b39ddb' },
  viewer: { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' },
  // Backward-compatibility fallbacks
  super_admin: { background: '#ede7f6', color: '#5e35b1', border: '1px solid #b39ddb' },
  magang:      { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' },
}

export function hasPermission(role, permission) {
  if (!role) return false
  const r = role === 'admin' || role === 'super_admin' ? 'admin' : (PERMISSIONS[role] ? role : 'viewer')
  const perms = PERMISSIONS[r] || PERMISSIONS.viewer || []
  return perms.includes(permission)
}
