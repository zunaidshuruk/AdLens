/**
 * Workspace permissions (Sprint 21). Every member has ONE role; a role is a set of permissions.
 * Built-in roles: Owner (always everything), Admin, Moderator, Member. Workspace admins can add custom roles by ticking permissions.
 * The rules that stop people handing out more power than they have live here too, so every route uses the same ones.
 */
import { randomUUID } from 'node:crypto';
import type { WorkspaceDoc } from './firestore.js';

export const PERMISSIONS = [
  'reports.view', 'content.edit', 'ai.use', 'projects.edit', 'projects.delete', 'agents.manage',
  'team.manage', 'roles.manage', 'workspace.settings', 'billing.manage', 'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Plain-language names for the role editor. */
export const PERMISSION_INFO: Record<Permission, { label: string; help: string; group: string }> = {
  'reports.view': { group: 'Data', label: 'View reports and dashboards', help: 'See the data screens. Every role has this.' },
  'content.edit': { group: 'Data', label: 'Edit dashboards and saved reports', help: 'Create, change and delete dashboards and saved reports.' },
  'ai.use': { group: 'Data', label: 'Use the AI Analyst', help: 'Ask questions. Uses the workspace\'s monthly AI questions.' },
  'projects.edit': { group: 'Projects', label: 'Create and edit projects', help: 'Add sites and choose their Google and Meta data sources.' },
  'projects.delete': { group: 'Projects', label: 'Delete projects', help: 'Permanently remove a project.' },
  'agents.manage': { group: 'Projects', label: 'Manage AI agents', help: 'Connect, change and remove AI agents.' },
  'team.manage': { group: 'People', label: 'Add and remove people', help: 'Invite people and remove those with equal or lower access.' },
  'roles.manage': { group: 'People', label: 'Create roles and assign them', help: 'Make custom roles and change who has which role.' },
  'workspace.settings': { group: 'Workspace', label: 'Change workspace settings', help: 'Name, logo, default currency and time zone.' },
  'billing.manage': { group: 'Workspace', label: 'Request plan upgrades', help: 'Ask for a different plan.' },
  'audit.view': { group: 'Workspace', label: 'See the activity log', help: 'Who did what in this workspace.' },
};

export const BUILTIN_ROLE_IDS = ['owner', 'admin', 'moderator', 'member'] as const;
export type BuiltinRoleId = (typeof BUILTIN_ROLE_IDS)[number];

export interface RoleDef { id: string; name: string; description: string; permissions: Permission[]; builtin: boolean }

export const BUILTIN_ROLES: Record<BuiltinRoleId, RoleDef> = {
  owner: { id: 'owner', name: 'Owner', description: 'Everything, always. One per workspace.', permissions: [...PERMISSIONS], builtin: true },
  admin: { id: 'admin', name: 'Admin', description: 'Everything except being the owner.', permissions: [...PERMISSIONS], builtin: true },
  moderator: {
    id: 'moderator', name: 'Moderator', description: 'Runs the day-to-day: content, agents and people, but not settings, plans or roles.', builtin: true,
    permissions: ['reports.view', 'content.edit', 'ai.use', 'projects.edit', 'agents.manage', 'team.manage', 'audit.view'],
  },
  member: { id: 'member', name: 'Member', description: 'Works with the data: dashboards, reports and the AI Analyst.', permissions: ['reports.view', 'content.edit', 'ai.use', 'projects.edit'], builtin: true },
};

export interface CustomRole { name: string; description?: string; permissions: Permission[]; createdAt: string }
export const MAX_CUSTOM_ROLES = 20;
export const newRoleId = () => `c_${randomUUID().replace(/-/g, '').slice(0, 8)}`;

const isPermission = (p: unknown): p is Permission => typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p);

/** Keeps only real permissions, removes repeats, and always includes viewing. */
export function cleanPermissions(input: unknown): Permission[] {
  const set = new Set<Permission>(['reports.view']);
  if (Array.isArray(input)) for (const p of input) if (isPermission(p)) set.add(p);
  return PERMISSIONS.filter((p) => set.has(p));
}

/** The definition of a role id in this workspace, or null if it does not exist (for example a deleted custom role). */
export function roleDef(ws: Pick<WorkspaceDoc, 'customRoles'>, roleId: string | null | undefined): RoleDef | null {
  if (!roleId) return null;
  if ((BUILTIN_ROLE_IDS as readonly string[]).includes(roleId)) return BUILTIN_ROLES[roleId as BuiltinRoleId];
  const c = ws.customRoles?.[roleId];
  return c ? { id: roleId, name: c.name, description: c.description ?? '', permissions: cleanPermissions(c.permissions), builtin: false } : null;
}

export function allRoles(ws: Pick<WorkspaceDoc, 'customRoles'>): RoleDef[] {
  const custom = Object.keys(ws.customRoles ?? {}).map((id) => roleDef(ws, id)!).sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILTIN_ROLE_IDS.map((id) => BUILTIN_ROLES[id]), ...custom];
}

/** The role id a person has in a workspace, or null when they are not in it. The owner is always 'owner'. */
export function roleIdOf(ws: Pick<WorkspaceDoc, 'members' | 'ownerId'>, uid: string): string | null {
  if (ws.ownerId === uid && Object.prototype.hasOwnProperty.call(ws.members, uid)) return 'owner';
  return Object.prototype.hasOwnProperty.call(ws.members, uid) ? ws.members[uid] : null;
}

/** What this person may do here. Members with a role that no longer exists can only view. */
export function permissionsOf(ws: Pick<WorkspaceDoc, 'members' | 'ownerId' | 'customRoles'>, uid: string): Set<Permission> {
  const id = roleIdOf(ws, uid);
  if (!id) return new Set();
  return new Set(roleDef(ws, id)?.permissions ?? ['reports.view']);
}

export const can = (ws: Pick<WorkspaceDoc, 'members' | 'ownerId' | 'customRoles'>, uid: string, perm: Permission): boolean => permissionsOf(ws, uid).has(perm);

/** True when everything in `inner` is also in `outer`. Nobody may give out, or take away, more than they have themselves. */
export const isSubset = (inner: readonly Permission[], outer: ReadonlySet<Permission>): boolean => inner.every((p) => outer.has(p));

export function roleLabel(ws: Pick<WorkspaceDoc, 'customRoles'>, roleId: string): string {
  return roleDef(ws, roleId)?.name ?? 'Unknown role';
}
