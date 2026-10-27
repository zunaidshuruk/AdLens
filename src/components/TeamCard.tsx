import { UserPlus, Users, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, type TeamView } from '../api/client';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

/** Settings → Workspace: who is on the team, add people by email, and offer colleagues on the same company email. */
export const TeamCard: React.FC = () => {
  const { activeWorkspace } = useAppContext();
  const { user } = useAuth();
  const wsId = activeWorkspace?.id;
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      setTeam(await apiClient.teamGet(wsId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the team.');
    }
  }, [wsId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!wsId) return null;
  const isOwner = team?.yourRole === 'owner';
  const assignable = (team?.roles ?? []).filter((r) => r.assignable);
  const roleOf = (id: string) => team?.roles.find((r) => r.id === id);
  const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';
  const btn = 'rounded-lg border border-line text-xs font-medium text-fg px-3 py-2 min-h-[36px] disabled:opacity-50';

  return (
    <section data-testid="team-card" className="p-6 rounded-xl border border-line bg-surface space-y-5">
      <div className="flex items-center gap-2.5 border-b border-line pb-4">
        <Users className="w-4 h-4 text-accent-text" />
        <div>
          <h2 className="text-sm font-semibold text-fg">Team</h2>
          <p className="text-xs text-fg-muted">
            People in this workspace see its projects, dashboards and saved reports. Each person connects their own Google and Meta accounts, so to see live data they need access to the same Google Analytics property and Search Console site.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {notice && <p role="status" className="text-xs text-success">{notice}</p>}

      {team && (
        <>
          <p className="text-xs text-fg-muted">{team.members.length} of {team.limit} {team.limit === 1 ? 'person' : 'people'} on your plan{team.invites.length > 0 ? `, plus ${team.invites.length} waiting to join` : ''}.</p>

          <ul className="divide-y divide-line rounded-lg border border-line">
            {team.members.map((m) => {
              const you = m.uid === user?.uid;
              const target = roleOf(m.role);
              const canRemove = !you && m.role !== 'owner' && team.canManage && Boolean(target?.assignable);
              const canChangeRole = !you && m.role !== 'owner' && team.canManageRoles && Boolean(target?.assignable);
              return (
                <li key={m.uid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-fg truncate">{m.displayName}{you ? ' (you)' : ''}</div>
                    <div className="text-xs text-fg-muted truncate">{m.email || 'No email on file'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canChangeRole ? (
                      <select
                        aria-label={`Role for ${m.displayName}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => void run(() => apiClient.teamSetRole(wsId, m.uid, e.target.value))}
                        className={`${field} py-1 text-xs`}
                      >
                        {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-fg-muted">{m.roleName ?? m.role}</span>
                    )}
                    {canRemove && (
                      <button type="button" disabled={busy} aria-label={`Remove ${m.displayName}`} className={btn}
                        onClick={() => { if (window.confirm(`Remove ${m.displayName} from this workspace?`)) void run(() => apiClient.teamRemove(wsId, m.uid), 'Removed.'); }}>
                        Remove
                      </button>
                    )}
                    {you && m.role !== 'owner' && (
                      <button type="button" disabled={busy} className={btn}
                        onClick={() => { if (window.confirm('Leave this workspace?')) void run(() => apiClient.teamRemove(wsId, m.uid).then(() => { window.location.assign('/'); })); }}>
                        Leave
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {team.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-fg truncate">{i.email}</div>
                  <div className="text-xs text-fg-muted">Waiting for them to sign in with this email · {i.roleName ?? i.role}</div>
                </div>
                {team.canManage && (
                  <button type="button" disabled={busy} aria-label={`Cancel invitation for ${i.email}`} className={`${btn} inline-flex items-center gap-1`}
                    onClick={() => void run(() => apiClient.teamCancelInvite(wsId, i.id), 'Invitation cancelled.')}>
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>

          {team.canManage && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const clean = email.trim();
                if (!clean) return;
                void run(async () => {
                  const r = await apiClient.teamAdd(wsId, clean, assignable.some((a) => a.id === role) ? role : 'member');
                  setEmail('');
                  setNotice(r.added ? 'Added to the team.' : 'Invitation saved. They join when they sign in to AdLens with this email.');
                });
              }}
            >
              <label className="flex-1 min-w-[220px] space-y-1">
                <span className="text-xs text-fg-muted">Add a person by email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={`${field} w-full`} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-fg-muted">Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={`${field} block`}>
                  {assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <button type="submit" disabled={busy || !email.trim()} className={`${btn} inline-flex items-center gap-1.5`}>
                <UserPlus className="w-3.5 h-3.5" /> Add
              </button>
            </form>
          )}

          {isOwner && (
            <div className="border-t border-line pt-4 space-y-2">
              <label className="flex items-start gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(team.joinDomain)}
                  disabled={busy}
                  onChange={(e) => void run(() => apiClient.teamSetDomainJoin(wsId, e.target.checked), e.target.checked ? 'Colleagues will now be offered the chance to join.' : 'Turned off.')}
                />
                <span>
                  Offer colleagues with my company email the chance to join
                  <span className="block text-xs text-fg-muted">
                    {team.joinDomain
                      ? `Anyone who signs in with a verified @${team.joinDomain} address is asked whether they want to join. Nobody is added without saying yes. Personal addresses such as Gmail are never matched.`
                      : 'Needs a verified company email address (not Gmail or similar). People are only asked, never added without saying yes.'}
                  </span>
                </span>
              </label>
            </div>
          )}
        </>
      )}
    </section>
  );
};
