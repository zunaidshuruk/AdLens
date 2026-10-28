/**
 * Sends email through Resend's web address (no extra package). Configure with RESEND_API_KEY and MAIL_FROM
 * (for example "AdLens <alerts@yourdomain.com>"; the sending domain must be verified with Resend).
 * Without them, nothing is sent and the caller is told so.
 */
export interface MailMessage { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export type MailResult = { ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'network' };

export function mailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.MAIL_FROM?.trim());
}

export async function sendMail(msg: MailMessage, opts: { env?: Record<string, string | undefined>; fetchFn?: typeof fetch } = {}): Promise<MailResult> {
  const env = opts.env ?? process.env;
  if (!mailConfigured(env)) return { ok: false, reason: 'not_configured' };
  try {
    const res = await (opts.fetchFn ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM!.trim(), to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, ...(msg.headers ? { headers: msg.headers } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
