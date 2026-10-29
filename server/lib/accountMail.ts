/**
 * Account emails (confirm your email, reset your password) sent through our own mail sender instead of Firebase's default one.
 * Firebase's built-in sender is a shared firebaseapp.com address that many inboxes silently drop. Here the server asks Firebase for the
 * one-time code, puts it in a link on our own address, and sends it through Resend like every other AdLens email.
 */
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp } from './firebaseAdmin.js';
import { escapeHtml } from './digest.js';

export type AccountMailKind = 'verify' | 'reset';

type LinkGenerator = (kind: AccountMailKind, email: string, continueUrl: string) => Promise<string>;
let override: LinkGenerator | null = null;
export function setTestActionLinkGenerator(f: LinkGenerator | null): void { override = f; }

const CONTINUE_PROBLEMS = new Set(['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/missing-continue-uri']);

/** Asks Firebase for the one-time link. If our address is not in its Authorized domains list, asks again without a return address. */
export async function generateActionLink(kind: AccountMailKind, email: string, continueUrl: string): Promise<string> {
  if (override) return override(kind, email, continueUrl);
  const auth = getAuth(getFirebaseAdminApp());
  const make = (settings?: { url: string; handleCodeInApp: boolean }) => (kind === 'verify' ? auth.generateEmailVerificationLink(email, settings) : auth.generatePasswordResetLink(email, settings));
  try { return await make({ url: continueUrl, handleCodeInApp: false }); }
  catch (e) { if (CONTINUE_PROBLEMS.has(String((e as { code?: unknown }).code))) return make(); throw e; }
}

/** Turns Firebase's link into one on our own address (the /auth/action page already knows how to finish it). */
export function ourActionLink(firebaseLink: string, appBaseUrl: string): string {
  const u = new URL(firebaseLink);
  const mode = u.searchParams.get('mode');
  const code = u.searchParams.get('oobCode');
  if (!mode || !code) throw new Error('The link from Firebase had no code.');
  const out = new URL('/auth/action', appBaseUrl.replace(/\/+$/, '') + '/');
  out.searchParams.set('mode', mode);
  out.searchParams.set('oobCode', code);
  return out.toString();
}

export function buildAccountEmail(kind: AccountMailKind, link: string, brandName = 'AdLens', name?: string | null): { subject: string; text: string; html: string } {
  const hi = name?.trim() ? `Hi ${name.trim()},` : 'Hi,';
  const verify = kind === 'verify';
  const subject = verify ? `Confirm your email for ${brandName}` : `Reset your ${brandName} password`;
  const lead = verify ? `Press the button to confirm your email address and finish setting up ${brandName}.` : `Someone asked to reset the password for your ${brandName} account. Press the button to choose a new one.`;
  const button = verify ? 'Confirm my email' : 'Choose a new password';
  const small = verify ? 'If you did not create this account, you can ignore this email.' : 'If you did not ask for this, you can ignore this email. Your password stays the same.';
  const text = [hi, '', lead, '', link, '', small].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#17181b"><p>${escapeHtml(hi)}</p><p>${escapeHtml(lead)}</p><p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#17181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(button)}</a></p><p style="font-size:12px;color:#666">Or copy this address into your browser:<br>${escapeHtml(link)}</p><p style="font-size:12px;color:#666">${escapeHtml(small)} The link works once and expires after a while.</p></div>`;
  return { subject, text, html };
}
