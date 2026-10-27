/**
 * AdLens staff roles (Sprint 21): who may do what in the admin panel.
 * The emails in OPERATOR_EMAILS are always Super admins. Other staff are added on the panel's Staff tab with one of these roles.
 */
export const PLATFORM_PERMISSIONS = ['overview.view', 'workspaces.view', 'workspaces.members', 'billing.manage', 'settings.manage', 'operators.manage'] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_PERMISSION_INFO: Record<PlatformPermission, string> = {
  'overview.view': 'See the overview, health checks and usage',
  'workspaces.view': 'See workspaces, users, subscriptions and the activity log',
  'workspaces.members': "Change or remove people in someone's workspace",
  'billing.manage': 'Set plans, record payments, handle upgrade requests',
  'settings.manage': 'Edit plan limits, prices and feature switches',
  'operators.manage': 'Add and remove AdLens staff and choose their roles',
};

export const PLATFORM_ROLE_IDS = ['super', 'billing', 'support', 'settings'] as const;
export type PlatformRoleId = (typeof PLATFORM_ROLE_IDS)[number];

export const PLATFORM_ROLES: Record<PlatformRoleId, { name: string; description: string; permissions: PlatformPermission[] }> = {
  super: { name: 'Super admin', description: 'Everything, including adding staff.', permissions: [...PLATFORM_PERMISSIONS] },
  billing: { name: 'Billing manager', description: 'Plans, payments, upgrade requests and subscriptions.', permissions: ['overview.view', 'workspaces.view', 'billing.manage'] },
  support: { name: 'Support', description: "Looks things up and manages people in customers' workspaces. Cannot change plans or settings.", permissions: ['overview.view', 'workspaces.view', 'workspaces.members'] },
  settings: { name: 'Settings manager', description: 'Plan limits, prices and feature switches. No payments, no staff.', permissions: ['overview.view', 'settings.manage'] },
};

export const isPlatformRoleId = (v: unknown): v is PlatformRoleId => typeof v === 'string' && (PLATFORM_ROLE_IDS as readonly string[]).includes(v);
