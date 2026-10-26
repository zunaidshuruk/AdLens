/**
 * Decides which version of the Facebook / Meta Ads card to show.
 * Pure function so it can be tested without a screen.
 */

export type MetaCardMode =
  | 'coming_soon' // Facebook sign-in is not set up and the user is not on the shared connection
  | 'setup_needed' // nothing is configured at all (demo data)
  | 'connect' // ready: show the big "Connect Facebook" button
  | 'reconnect' // user's own Facebook connection ran out
  | 'choose_account' // connected, but no ad account chosen yet
  | 'connected' // connected with an ad account
  | 'shared'; // using the shared company connection (admin fallback)

export interface MetaCardInput {
  loginConfigured: boolean;
  userConnected: boolean;
  reconnect: string | null | undefined; // 'ok' | 'due_soon' | 'expired' | 'no_expiry'
  adAccountId: string | null | undefined;
  systemConfigured: boolean;
  notAvailable: boolean;
}

export function getMetaCardMode(i: MetaCardInput): MetaCardMode {
  if (i.userConnected) {
    if (i.reconnect === 'expired') return 'reconnect';
    return i.adAccountId ? 'connected' : 'choose_account';
  }
  if (i.reconnect === 'expired' && i.loginConfigured) return 'reconnect';
  if (i.loginConfigured) return 'connect';
  if (i.systemConfigured && !i.notAvailable) return 'shared';
  if (i.notAvailable) return 'coming_soon';
  return 'setup_needed';
}

/** "You will need to sign in to Facebook again by 24 Dec 2026", or null when there is no date. */
export function describeMetaExpiry(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): { text: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - now.getTime()) / 86_400_000);
  if (days <= 0) return { text: 'Your Facebook connection has expired.', urgent: true };
  const date = new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (days <= 7) {
    return {
      text: `Your Facebook connection ends in ${days} day${days === 1 ? '' : 's'} (${date}). Reconnect soon.`,
      urgent: true,
    };
  }
  return { text: `Facebook stays connected until about ${date}. After that, just reconnect.`, urgent: false };
}
