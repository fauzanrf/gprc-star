// Role-based permissions matching Nexcare RBAC
export const PERMISSIONS = {
  super_admin: [
    'crud_client', 'crud_starlink', 'crud_rfo', 'approve_rfo',
    'crud_team_visit', 'assign_team_visit', 'manage_users',
    'view_all', 'view_client', 'view_rfo', 'view_team_visit',
    'edit_accounts', 'manage_scraping', 'manage_groups', 'manage_parent_accounts'
  ],
  noc2: [
    'crud_client', 'crud_starlink', 'crud_rfo', 'approve_rfo',
    'crud_team_visit', 'assign_team_visit', 'manage_users',
    'view_all', 'view_client', 'view_rfo', 'view_team_visit',
    'edit_accounts', 'manage_scraping', 'manage_groups', 'manage_parent_accounts'
  ],
  noc1: [
    'crud_client', 'crud_starlink', 'crud_rfo',
    'view_all', 'view_client', 'view_rfo', 'view_team_visit',
    'edit_accounts', 'manage_scraping', 'manage_groups'
  ],
  technical_support: [
    'crud_client', 'crud_starlink', 'crud_rfo',
    'view_all', 'view_client', 'view_rfo', 'view_team_visit',
    'edit_accounts'
  ],
  magang: [
    'view_client', 'view_rfo',
    'view_team_visit', 'view_all',
  ],
  provisioning: [
    'crud_client', 'view_rfo',
    'submit_team_visit', 'view_team_visit', 'view_all', 'view_client',
    'edit_accounts'
  ],
}

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  noc2: 'NOC 2',
  noc1: 'NOC 1',
  technical_support: 'Technical Support',
  magang: 'Magang',
  provisioning: 'Provisioning',
}

export const ROLE_BADGE_STYLES = {
  super_admin:       { background: '#ede7f6', color: '#5e35b1', border: '1px solid #b39ddb' },
  noc2:              { background: '#e0f2fe', color: '#0369a1', border: '1px solid #7dd3fc' },
  noc1:              { background: '#e0e7ff', color: '#4338ca', border: '1px solid #a5b4fc' },
  technical_support: { background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d' },
  magang:            { background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' },
  provisioning:      { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' },
}

export function hasPermission(role, permission) {
  if (!role) return false
  const perms = PERMISSIONS[role] || []
  return perms.includes(permission)
}
