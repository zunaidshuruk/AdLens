/**
 * Sends email through Resend's web address (no extra package). Configure with RESEND_API_KEY and MAIL_FROM
 * (for example "AdLens <alerts@yourdomain.com>"; the sending domain must be verified with Resend).
 * Without them, nothing is sent and the caller is told so.
 */
export interface MailMessage { to: string; subject: string; text: string; html: string; headers?: Record<string, string>; attachments?: { filename: string; content: Buffer }[] }
export type MailResult = { ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'network'; /** What the mail service said (for example "domain is not verified"), never a secret. */ detail?: string };

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
      body: JSON.stringify({ from: env.MAIL_FROM!.trim(), to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, ...(msg.headers ? { headers: msg.headers } : {}), ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const raw = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    let said = ''; try { const j = JSON.parse(raw) as { message?: unknown }; said = typeof j.message === 'string' ? j.message : ''; } catch { said = ''; }
    return typeof res.status === 'number' ? { ok: false, reason: 'rejected', detail: `${res.status}${said ? `: ${said.slice(0, 240)}` : ''}` } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
