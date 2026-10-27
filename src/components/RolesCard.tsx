import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, type TeamRole, type TeamView } from '../api/client';
import { useAppContext } from '../context/AppContext';

const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
const btn = 'rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50';
const primary = 'rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50';

interface Draft { id: string | null; name: string; description: string; permissions: Set<string> }

/** Settings → Workspace: what each role may do. People with "Create roles and assign them" can add custom roles. */
export const RolesCard: React.FC = () => {
  const { activeWorkspace } = useAppContext();
  const wsId = activeWorkspace?.id;
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    if (!wsId) return;
    try { setTeam(await apiClient.teamGet(wsId)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load roles.'); }
  }, [wsId]);
  useEffect(() => { void load(); }, [load]);

  const labels = useMemo(() => new Map((team?.permissionList ?? []).map((p) => [p.id, p])), [team]);
  const groups = useMemo(() => {
    const out = new Map<string, NonNullable<typeof team>['permissionList']>();
    for (const p of team?.permissionList ?? []) out.set(p.group, [...(out.get(p.group) ?? []), p]);
    return [...out.entries()];
  }, [team]);

  if (!wsId) return null;
  const mine = new Set(team?.yourPermissions ?? []);
  const customCount = (team?.roles ?? []).filter((r) => !r.builtin).length;

  const save = async () => {
    if (!draft || !team) return;
    setBusy(true); setError(null); setNotice(null);
    const body = { name: draft.name.trim(), description: draft.description.trim(), permissions: [...draft.permissions] };
    try {
      if (draft.id) await apiClient.teamUpdateRole(wsId, draft.id, body); else await apiClient.teamCreateRole(wsId, body);
      setNotice(draft.id ? 'Role saved. People with this role get the change straight away.' : 'Role created. Give it to people from the team list above.');
      setDraft(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the role.'); } finally { setBusy(false); }
  };

  const remove = async (r: TeamRole) => {
    if (!window.confirm(`Delete the role "${r.name}"? ${r.memberCount > 0 ? `${r.memberCount} ${r.memberCount === 1 ? 'person' : 'people'} will become Members.` : ''}`)) return;
    setBusy(true); setError(null); setNotice(null);
    try { await apiClient.teamDeleteRole(wsId, r.id); setNotice('Role deleted.'); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the role.'); } finally { setBusy(false); }
  };

  const toggle = (id: string) => setDraft((d) => {
    if (!d || id === 'reports.view') return d;
    const next = new Set(d.permissions);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...d, permissions: next };
  });

  return (
    <section data-testid="roles-card" className="p-6 rounded-xl border border-line bg-surface space-y-5">
      <div className="flex items-center gap-2.5 border-b border-line pb-4">
        <KeyRound className="w-4 h-4 text-accent-text" />
        <div>
          <h2 className="text-sm font-semibold text-fg">Roles and permissions</h2>
          <p className="text-xs text-fg-muted">Each person has one role, and a role is a set of permissions. {team ? `You are ${team.yourRoleName}.` : ''}</p>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {notice && <p role="status" className="text-xs text-success">{notice}</p>}
      {!team && !error && <p className="text-xs text-fg-muted">Loading…</p>}

      {team && (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {team.roles.map((r) => (
              <li key={r.id} className="px-3 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-fg">{r.name} <span className="text-xs font-normal text-fg-muted">{r.builtin ? '· starter role' : '· custom role'} · {r.memberCount} {r.memberCount === 1 ? 'person' : 'people'}</span></div>
                    {r.description && <div className="text-xs text-fg-muted">{r.description}</div>}
                  </div>
                  {team.canManageRoles && !r.builtin && (
                    <div className="flex gap-2">
                      <button type="button" className={`${btn} inline-flex items-center gap-1`} disabled={busy || !r.editable} title={r.editable ? '' : 'This role has permissions you do not have'}
                        onClick={() => setDraft({ id: r.id, name: r.name, description: r.description, permissions: new Set(r.permissions) })}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                      <button type="button" className={`${btn} inline-flex items-center gap-1`} disabled={busy || !r.editable} onClick={() => void remove(r)}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.permissions.map((p) => <span key={p} className="rounded-full bg-fill-2 text-fg-muted text-[11px] px-2 py-0.5">{labels.get(p)?.label ?? p}</span>)}
                </div>
              </li>
            ))}
          </ul>

          {team.canManageRoles && !draft && (
            <button type="button" className={`${primary} inline-flex items-center gap-1.5`} disabled={busy || customCount >= team.maxCustomRoles}
              onClick={() => setDraft({ id: null, name: '', description: '', permissions: new Set(['reports.view']) })}>
              <Plus className="w-3.5 h-3.5" /> Create a role
            </button>
          )}
          {team.canManageRoles && customCount >= team.maxCustomRoles && <p className="text-xs text-fg-muted">You have reached {team.maxCustomRoles} custom roles.</p>}

          {draft && (
            <form className="rounded-lg border border-accent-line bg-accent-soft p-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <h3 className="text-sm font-semibold text-fg">{draft.id ? 'Edit role' : 'New role'}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block"><span className="text-xs text-fg-muted">Role name</span><input value={draft.name} maxLength={30} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Analyst" className={`${field} w-full`} /></label>
                <label className="space-y-1 block"><span className="text-xs text-fg-muted">Short description (optional)</span><input value={draft.description} maxLength={120} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={`${field} w-full`} /></label>
              </div>
              <div className="space-y-3">
                {groups.map(([group, list]) => (
                  <fieldset key={group} className="space-y-1.5">
                    <legend className="text-xs font-semibold text-fg">{group}</legend>
                    {list.map((p) => {
                      const locked = p.id === 'reports.view';
                      const unavailable = !locked && !mine.has(p.id);
                      return (
                        <label key={p.id} className={`flex items-start gap-2 text-sm ${unavailable ? 'opacity-50' : 'text-fg'}`}>
                          <input type="checkbox" className="mt-1" checked={draft.permissions.has(p.id)} disabled={locked || unavailable} onChange={() => toggle(p.id)} />
                          <span>{p.label}<span className="block text-xs text-fg-muted">{p.help}{unavailable ? ' You cannot give this because you do not have it.' : ''}</span></span>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="submit" className={primary} disabled={busy || draft.name.trim().length < 2}>{busy ? 'Saving…' : 'Save role'}</button>
                <button type="button" className={btn} disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
};
