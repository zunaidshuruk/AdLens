import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, LogOut, Megaphone, RefreshCw } from 'lucide-react';
import { describeMetaExpiry, getMetaCardMode, type MetaCardMode } from '../utils/metaCardState.js';

export interface MetaCardAdAccount {
  accountId: string;
  name: string;
  currency?: string;
  status?: string;
  usable?: boolean;
  businessName?: string | null;
}

export interface MetaCardAccountInfo {
  name?: string;
  accountId?: string;
  currency?: string;
  timezoneName?: string;
}

export interface MetaConnectCardProps {
  siteName: string;
  loginConfigured: boolean;
  userConnected: boolean;
  reconnect: string | null | undefined;
  expiresAt: string | null | undefined;
  adAccountId: string | null | undefined;
  systemConfigured: boolean;
  notAvailable: boolean;
  missingSecrets: string[];
  accountInfo: MetaCardAccountInfo | null;
  accountError: string | null;
  adAccounts: MetaCardAdAccount[];
  adAccountsLoading: boolean;
  adAccountsError: string | null;
  busy: boolean;
  onConnect: () => void | Promise<void>;
  onLoadAdAccounts: () => void | Promise<void>;
  onChooseAdAccount: (accountId: string) => void | Promise<unknown>;
  onDisconnect: () => void | Promise<unknown>;
}

const STATUS_TEXT: Record<MetaCardMode, { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  coming_soon: { label: 'Coming soon', tone: 'warning' },
  setup_needed: { label: 'Showing sample data', tone: 'warning' },
  connect: { label: 'Not connected', tone: 'muted' },
  reconnect: { label: 'Connection expired', tone: 'warning' },
  choose_account: { label: 'Connected. Choose an ad account', tone: 'warning' },
  connected: { label: 'Connected', tone: 'success' },
  shared: { label: 'Using the shared company connection', tone: 'success' },
};

const TONE_CLASS = { success: 'text-success', warning: 'text-warning', muted: 'text-fg-muted' } as const;

const PRIMARY_BUTTON =
  'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer disabled:bg-fill-3 disabled:text-fg-muted disabled:cursor-not-allowed';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-fg bg-fill-1 hover:bg-fill-2 border border-line transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const DANGER_BUTTON =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-danger bg-danger-soft hover:bg-danger-soft border border-danger-line transition-colors cursor-pointer disabled:opacity-50';

const DetailRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-fg-muted">{label}</span>
    <span className={`${mono ? 'font-mono' : 'font-semibold'} text-fg text-right`}>{value}</span>
  </div>
);

export const MetaConnectCard: React.FC<MetaConnectCardProps> = (p) => {
  const mode = getMetaCardMode({
    loginConfigured: p.loginConfigured,
    userConnected: p.userConnected,
    reconnect: p.reconnect,
    adAccountId: p.adAccountId,
    systemConfigured: p.systemConfigured,
    notAvailable: p.notAvailable,
  });
  const [picked, setPicked] = useState('');
  const [changing, setChanging] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [saving, setSaving] = useState(false);

  const showPicker = mode === 'choose_account' || (mode === 'connected' && changing);
  const { onLoadAdAccounts } = p;

  // Fetch the user's ad accounts whenever the picker is shown.
  useEffect(() => {
    if (showPicker) void onLoadAdAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPicker]);

  const status = STATUS_TEXT[mode];
  const expiry = p.userConnected ? describeMetaExpiry(p.expiresAt) : null;
  const usable = p.adAccounts.filter((a) => a.usable !== false);

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      await p.onChooseAdAccount(picked);
      setChanging(false);
      setPicked('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 rounded-xl border border-line bg-surface flex flex-col justify-between gap-5" data-testid="meta-card">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent-text flex items-center justify-center shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg">Facebook and Instagram Ads</h2>
              <div data-testid="meta-connection-status" className={`text-xs font-medium mt-0.5 ${TONE_CLASS[status.tone]}`}>
                {status.label}
              </div>
            </div>
          </div>
          {(mode === 'connected' || mode === 'shared') && <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-1" />}
        </div>

        <p className="text-xs text-fg-muted leading-relaxed">
          Spend, reach, clicks, cost per click and leads for {p.siteName}, straight from your Facebook ad account. AdLens only reads your numbers. It can never change your ads.
        </p>

        {mode === 'connect' && (
          <button type="button" onClick={() => void p.onConnect()} disabled={p.busy} data-testid="connect-facebook-button" className={PRIMARY_BUTTON}>
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span>Connect Facebook</span>
          </button>
        )}

        {mode === 'reconnect' && (
          <div className="p-3.5 rounded-lg border border-warning-line bg-warning-soft space-y-3" role="alert" data-testid="meta-reconnect-notice">
            <div className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Facebook connections last about 60 days, and yours has ended. Sign in again to keep your numbers coming.</span>
            </div>
            <button type="button" onClick={() => void p.onConnect()} disabled={p.busy} data-testid="reconnect-facebook-button" className={PRIMARY_BUTTON}>
              <RefreshCw className="w-4 h-4 shrink-0" />
              <span>Reconnect Facebook</span>
            </button>
          </div>
        )}

        {showPicker && (
          <div className="space-y-2.5" data-testid="meta-account-picker">
            <label htmlFor="meta-ad-account-select" className="block text-xs font-semibold text-fg">
              Which ad account should AdLens use?
            </label>
            {p.adAccountsLoading ? (
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Finding your ad accounts...</span>
              </div>
            ) : p.adAccountsError ? (
              <div className="text-xs text-danger font-medium" role="alert">{p.adAccountsError}</div>
            ) : usable.length === 0 ? (
              <div className="text-xs text-warning leading-relaxed" role="status">
                No ad accounts were found on this Facebook login. Ask whoever manages your ads to give you access in Meta Business Settings, then try again.
              </div>
            ) : (
              <select
                id="meta-ad-account-select"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-line bg-fill-1 text-fg focus:outline-none focus:ring-2 focus:ring-focus"
              >
                <option value="">Choose an ad account...</option>
                {usable.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.name}
                    {a.businessName ? ` (${a.businessName})` : ''}
                    {a.currency ? ` · ${a.currency}` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void save()} disabled={!picked || saving || p.busy} data-testid="meta-save-account" className={SECONDARY_BUTTON}>
                {saving ? 'Saving...' : 'Use this account'}
              </button>
              <button type="button" onClick={() => void p.onLoadAdAccounts()} disabled={p.adAccountsLoading} className={SECONDARY_BUTTON}>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Check again</span>
              </button>
              {changing && (
                <button type="button" onClick={() => { setChanging(false); setPicked(''); }} className={SECONDARY_BUTTON}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {(mode === 'connected' || mode === 'shared') && !showPicker && (
          <div data-testid="meta-account-details" className="p-3.5 rounded-lg border border-line bg-fill-1 space-y-2 text-xs">
            {p.accountError ? (
              <div className="text-danger font-medium">{p.accountError}</div>
            ) : (
              <>
                <DetailRow label="Account name" value={p.accountInfo?.name ?? 'Loading...'} />
                <DetailRow label="Account ID" value={p.accountInfo?.accountId ?? p.adAccountId ?? '—'} mono />
                <DetailRow label="Currency" value={p.accountInfo?.currency ?? '—'} mono />
                <DetailRow label="Time zone" value={p.accountInfo?.timezoneName ?? '—'} mono />
              </>
            )}
          </div>
        )}

        {mode === 'connected' && expiry && (
          <p className={`text-[11px] leading-relaxed ${expiry.urgent ? 'text-warning font-medium' : 'text-fg-muted'}`} data-testid="meta-expiry-note">
            {expiry.text}
          </p>
        )}

        {mode === 'coming_soon' && (
          <p className="text-xs text-warning leading-relaxed">Connecting your own Facebook account is coming soon.</p>
        )}

        {mode === 'setup_needed' && (
          <div role="region" aria-label="Facebook sign-in setup notice" data-testid="meta-unconfigured-notice" className="p-3.5 rounded-lg border border-warning-line bg-warning-soft space-y-2">
            <div className="text-xs font-semibold text-warning">Facebook sign-in is not set up yet</div>
            <p className="text-[11px] text-warning leading-relaxed">
              The app owner needs to add these settings on the server before people can connect Facebook:
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {(p.missingSecrets.length > 0 ? p.missingSecrets : ['META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID']).map((name) => (
                <code key={name} className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-warning-soft text-warning border border-warning-line">
                  {name}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>

      {p.userConnected && (
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'connected' && !showPicker && (
            <button type="button" onClick={() => setChanging(true)} className={SECONDARY_BUTTON} data-testid="meta-change-account">
              Change ad account
            </button>
          )}
          {!confirmDisconnect ? (
            <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={p.busy} className={DANGER_BUTTON} data-testid="disconnect-facebook-button">
              <LogOut className="w-3.5 h-3.5" />
              <span>Disconnect Facebook</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs" role="alertdialog" aria-label="Confirm disconnect">
              <span className="text-fg-muted">Disconnect Facebook?</span>
              <button
                type="button"
                onClick={async () => {
                  await p.onDisconnect();
                  setConfirmDisconnect(false);
                  setChanging(false);
                }}
                disabled={p.busy}
                className={DANGER_BUTTON}
                data-testid="confirm-disconnect-facebook"
              >
                {p.busy ? 'Disconnecting...' : 'Yes, disconnect'}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(false)} className={SECONDARY_BUTTON}>
                Keep it
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
