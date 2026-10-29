/**
 * Sends email one of two ways. (1) Any mailbox over SMTP: set SMTP_HOST, SMTP_USER and SMTP_PASS (and optionally SMTP_PORT, MAIL_FROM). This works
 * with Gmail or Google Workspace (an app password), Brevo, Zoho, Outlook and others, and needs no domain of your own. (2) Resend: set RESEND_API_KEY
 * and MAIL_FROM (the sending domain must be verified with Resend). If both are set, SMTP is used unless MAIL_PROVIDER=resend.
 * Without either, nothing is sent and the caller is told so.
 */
export interface MailMessage { to: string; subject: string; text: string; html: string; headers?: Record<string, string>; attachments?: { filename: string; content: Buffer }[] }
export type MailResult = { ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'network'; /** What the mail service said (for example "domain is not verified"), never a secret. */ detail?: string };

type Env = Record<string, string | undefined>;
export const smtpConfigured = (env: Env = process.env): boolean => Boolean(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASS);
export const resendConfigured = (env: Env = process.env): boolean => Boolean(env.RESEND_API_KEY?.trim() && env.MAIL_FROM?.trim());
/** Which sender will be used, or null when none is set up. */
export function mailProvider(env: Env = process.env): 'smtp' | 'resend' | null {
  const want = env.MAIL_PROVIDER?.trim().toLowerCase();
  if (want === 'resend' && resendConfigured(env)) return 'resend';
  if (want === 'smtp' && smtpConfigured(env)) return 'smtp';
  return smtpConfigured(env) ? 'smtp' : resendConfigured(env) ? 'resend' : null;
}
export const mailConfigured = (env: Env = process.env): boolean => mailProvider(env) !== null;
/** The From line. With SMTP it defaults to the mailbox itself, which is what Gmail and most providers require. */
export const fromAddress = (env: Env = process.env): string => env.MAIL_FROM?.trim() || `AdLens <${env.SMTP_USER?.trim() ?? ''}>`;

export interface SmtpSettings { host: string; port: number; secure: boolean; user: string; pass: string }
export type SmtpSend = (cfg: SmtpSettings, mail: { from: string; to: string; subject: string; text: string; html: string; headers?: Record<string, string>; attachments?: { filename: string; content: Buffer }[] }) => Promise<void>;
const realSmtpSend: SmtpSend = async (cfg, mail) => {
  const nodemailer = (await import('nodemailer')).default;
  const t = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  await t.sendMail(mail);
};
const smtpSettings = (env: Env): SmtpSettings => { const port = Number(env.SMTP_PORT?.trim()) || 587; return { host: env.SMTP_HOST!.trim(), port, secure: env.SMTP_SECURE ? /^(1|true|yes)$/i.test(env.SMTP_SECURE.trim()) : port === 465, user: env.SMTP_USER!.trim(), pass: env.SMTP_PASS! }; };
/** A short, safe reason from a mail-server error: the server's own words, with the password removed. */
const smtpDetail = (e: unknown, pass: string): string => { const m = e instanceof Error ? e.message : String(e); const code = (e as { responseCode?: unknown }).responseCode; return `${typeof code === 'number' ? `${code}: ` : ''}${m.split(pass).join('***')}`.replace(/\s+/g, ' ').slice(0, 240); };

export async function sendMail(msg: MailMessage, opts: { env?: Env; fetchFn?: typeof fetch; smtpSend?: SmtpSend } = {}): Promise<MailResult> {
  const env = opts.env ?? process.env;
  const provider = mailProvider(env);
  if (!provider) return { ok: false, reason: 'not_configured' };
  if (provider === 'smtp') {
    const cfg = smtpSettings(env);
    try {
      await (opts.smtpSend ?? realSmtpSend)(cfg, { from: fromAddress(env), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, ...(msg.headers ? { headers: msg.headers } : {}), ...(msg.attachments?.length ? { attachments: msg.attachments } : {}) });
      return { ok: true };
    } catch (e) {
      const code = String((e as { code?: unknown }).code ?? '');
      return ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'].includes(code) ? { ok: false, reason: 'network', detail: smtpDetail(e, cfg.pass) } : { ok: false, reason: 'rejected', detail: smtpDetail(e, cfg.pass) };
    }
  }
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
