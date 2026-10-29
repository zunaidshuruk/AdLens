import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getServerConfig } from '../config.js';
import { buildAccountEmail, generateActionLink, ourActionLink, type AccountMailKind } from '../lib/accountMail.js';
import { verifyIdToken } from '../lib/firebaseAdmin.js';
import { mailConfigured, mailProvider, sendMail } from '../lib/mailer.js';
import { checkRateLimit } from '../lib/rateLimiter.js';

/**
 * Confirm-your-email and reset-password emails through our own sender (Resend). The page tries this first. When it answers
 * `handled: false` (mail not set up, or sending failed) the page falls back to Firebase's own email, so nobody is left without one.
 */
export const accountMailRouter = Router();
const fail = (res: Response, status: number, code: string, message: string): void => { res.status(status).json({ error: { code, message } }); };
const baseUrl = (): string => getServerConfig().appBaseUrl;

async function sendAction(kind: AccountMailKind, email: string, name: string | null): Promise<{ handled: boolean; reason?: string; detail?: string }> {
  if (!mailConfigured()) return { handled: false, reason: 'not_configured' };
  let link: string;
  try { link = ourActionLink(await generateActionLink(kind, email, `${baseUrl().replace(/\/+$/, '')}/${kind === 'verify' ? '' : 'sign-in'}`), baseUrl()); }
  catch (e) {
    const code = String((e as { code?: unknown }).code ?? '');
    // Asking to reset a password for an unknown address is normal; say nothing different about it.
    if (code === 'auth/user-not-found' || code === 'auth/email-not-found') return { handled: true };
    return { handled: false, reason: 'link_failed' };
  }
  const mail = buildAccountEmail(kind, link, 'AdLens', name);
  const r = await sendMail({ ...mail, to: email });
  return r.ok ? { handled: true } : { handled: false, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) };
}

// Signed in but not yet confirmed: they cannot use requireUser (it refuses unconfirmed accounts), so the sign-in token is checked here.
accountMailRouter.post('/verification', async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in first.');
    let decoded: Awaited<ReturnType<typeof verifyIdToken>>;
    try { decoded = await verifyIdToken(header.slice(7).trim()); } catch { return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in first.'); }
    const email = typeof decoded.email === 'string' ? decoded.email : '';
    if (!email) return fail(res, 400, 'NO_EMAIL', 'Your account has no email address.');
    if (decoded.email_verified) return void res.json({ handled: true, already: true });
    const rl = await checkRateLimit('acct-verify', decoded.uid, 6, 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', `Too many emails requested. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes.`);
    res.json(await sendAction('verify', email, typeof decoded.name === 'string' ? decoded.name : null));
  } catch { fail(res, 500, 'ACCOUNT_MAIL_FAILED', 'Something went wrong.'); }
});

const resetBody = z.object({ email: z.string().trim().toLowerCase().email().max(120) });
accountMailRouter.post('/password-reset', async (req: Request, res: Response) => {
  try {
    const parsed = resetBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_EMAIL', 'Type a valid email address.');
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const [a, b] = await Promise.all([checkRateLimit('acct-reset-ip', ip, 20, 3_600_000), checkRateLimit('acct-reset-mail', parsed.data.email, 5, 3_600_000)]);
    if (!a.allowed || !b.allowed) return fail(res, 429, 'RATE_LIMITED', 'Too many reset requests. Try again in a little while.');
    const r = await sendAction('reset', parsed.data.email, null);
    res.json({ handled: r.handled });
  } catch { fail(res, 500, 'ACCOUNT_MAIL_FAILED', 'Something went wrong.'); }
});

// "Send me a test email": tells the signed-in person exactly what is wrong when mail does not arrive.
accountMailRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in first.');
    let decoded: Awaited<ReturnType<typeof verifyIdToken>>;
    try { decoded = await verifyIdToken(header.slice(7).trim()); } catch { return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in first.'); }
    const to = typeof decoded.email === 'string' ? decoded.email : '';
    if (!to) return fail(res, 400, 'NO_EMAIL', 'Your account has no email address.');
    const rl = await checkRateLimit('acct-test', decoded.uid, 5, 3_600_000);
    if (!rl.allowed) return fail(res, 429, 'RATE_LIMITED', 'Too many test emails. Try again later.');
    const provider = mailProvider();
    if (!provider) return void res.json({ sent: false, to, reason: 'not_configured', message: 'Email sending is not set up on this server. No domain of your own? Use a mailbox: set SMTP_HOST, SMTP_USER and SMTP_PASS (for Gmail: smtp.gmail.com, your Gmail address and an app password). Or set RESEND_API_KEY and MAIL_FROM with a domain verified in Resend. Then redeploy.' });
    const r = await sendMail({ to, subject: 'AdLens test email', text: 'This is a test email from AdLens. If you can read it, email sending works.', html: '<p>This is a test email from AdLens. If you can read it, email sending works.</p>' });
    if (r.ok) return void res.json({ sent: true, to, message: `Test email sent to ${to} using ${provider === 'smtp' ? 'your mailbox (SMTP)' : 'Resend'}. If it does not arrive within a minute, check spam.${provider === 'resend' ? ' Also check that your sending domain is verified in Resend.' : ''}` });
    const why = provider === 'smtp'
      ? (r.reason === 'network' ? `The server could not connect to the mail server (${r.detail ?? 'no details'}). Check SMTP_HOST and SMTP_PORT (587 is the usual port).` : `The mail server refused it (${r.detail ?? 'no details'}). For Gmail this almost always means the app password is wrong or 2-Step Verification is not on for that Google account; SMTP_USER must be the full Gmail address.`)
      : (r.reason === 'network' ? 'The server could not reach the mail service.' : `The mail service refused it (${r.detail ?? 'no details'}). The most common cause is a sending domain that is not verified in Resend, or MAIL_FROM using a different domain.`);
    res.json({ sent: false, to, reason: r.reason, message: why });
  } catch { fail(res, 500, 'ACCOUNT_MAIL_FAILED', 'Something went wrong.'); }
});
