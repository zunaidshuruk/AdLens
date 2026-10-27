/**
 * Launch readiness (Sprint 10): what must be true before Google and Meta will approve public sign-ups, checked from settings.
 * Pure function over the environment so it can be tested; scripts/launch-readiness.ts prints it.
 * Never prints a secret value, only whether it is set.
 */

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface ReadinessCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

type Env = Record<string, string | undefined>;

const set = (env: Env, k: string) => Boolean((env[k] ?? '').trim());

export function evaluateLaunchReadiness(env: Env): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const add = (id: string, title: string, ok: boolean, passText: string, failText: string, failStatus: CheckStatus = 'fail') =>
    checks.push({ id, title, status: ok ? 'pass' : failStatus, detail: ok ? passText : failText });

  const base = (env.APP_BASE_URL ?? '').trim();
  let host = '';
  try {
    host = new URL(base).hostname;
  } catch {
    host = '';
  }

  add('base-url', 'App address is HTTPS', /^https:\/\//.test(base), `Using ${host}.`, 'Set APP_BASE_URL to the public https:// address.');
  const ownDomain = Boolean(host) && !/(\.ai\.studio|\.vercel\.app|\.run\.app|localhost)$/.test(host) && host !== 'localhost';
  add('own-domain', 'Own domain (needed for Google brand verification)', ownDomain, `${host} looks like your own domain.`, 'Google verification needs a domain you own and can verify in Search Console. Hosting addresses such as *.ai.studio will not pass.');
  add('support-email', 'Support email for the Privacy Policy', set(env, 'SUPPORT_EMAIL'), 'Set.', 'Set SUPPORT_EMAIL. Google and Meta both require a contact address.');
  add('legal-entity', 'Legal entity named on the Privacy Policy and Terms', set(env, 'LEGAL_ENTITY'), `Set to ${(env.LEGAL_ENTITY ?? '').trim()}.`, 'LEGAL_ENTITY is not set, so the default (Synesis IT PLC) is used. Set it explicitly to confirm.', 'warn');
  add('legal-address', 'Postal address on the Privacy Policy', set(env, 'LEGAL_ADDRESS'), 'Set.', 'Add LEGAL_ADDRESS (recommended; required in some countries).', 'warn');
  add('google-oauth', 'Google sign-in and API access configured', set(env, 'GOOGLE_CLIENT_ID') && set(env, 'GOOGLE_CLIENT_SECRET'), 'Set.', 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  add('meta-app', 'Meta app configured for Facebook login', set(env, 'META_APP_ID') && set(env, 'META_APP_SECRET') && set(env, 'META_LOGIN_CONFIG_ID'), 'Set. The deletion callback needs META_APP_SECRET to verify requests.', 'Set META_APP_ID, META_APP_SECRET and META_LOGIN_CONFIG_ID.');
  add('token-key', 'Token encryption key', (env.TOKEN_ENCRYPTION_KEY ?? '').trim().length >= 32, 'Set (32+ characters).', 'Set TOKEN_ENCRYPTION_KEY to a long random value.');
  add('firebase', 'Firebase configured', ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID', 'FIREBASE_SERVICE_ACCOUNT_JSON'].every((k) => set(env, k)), 'Set.', 'Set all FIREBASE_* values.');
  add('gemini', 'Gemini key for the AI Analyst', set(env, 'GEMINI_API_KEY') && set(env, 'GEMINI_MODEL'), 'Set.', 'Set GEMINI_API_KEY and GEMINI_MODEL, or the cloud AI Analyst will not work.');
  add('meta-system-token', 'Shared Meta system token is limited to allow-listed emails', !set(env, 'META_ACCESS_TOKEN') || set(env, 'META_SYSTEM_USER_ALLOWED_EMAILS'), 'Safe.', 'META_ACCESS_TOKEN is set but META_SYSTEM_USER_ALLOWED_EMAILS is empty. Public users must never see your own ad accounts.');
  add('verified-email', 'Branded email sender', set(env, 'SUPPORT_EMAIL'), 'Contact address set.', 'Verification emails come from Firebase until a branded sender is set up in Firebase Authentication templates.', 'warn');
  return checks;
}

export function summariseReadiness(checks: ReadinessCheck[]): { ready: boolean; failed: number; warned: number } {
  return { ready: checks.every((c) => c.status !== 'fail'), failed: checks.filter((c) => c.status === 'fail').length, warned: checks.filter((c) => c.status === 'warn').length };
}
