import assert from 'node:assert/strict';
import test from 'node:test';
import { fromAddress, mailConfigured, mailProvider, sendMail, type SmtpSend } from './lib/mailer.js';

const msg = { to: 'a@b.com', subject: 'Hi', text: 't', html: '<p>t</p>' };
const gmail = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' };

test('Mail provider: SMTP needs host, user and password; SMTP wins unless Resend is asked for; nothing set means not configured', () => {
  assert.equal(mailProvider({}), null); assert.equal(mailConfigured({}), false);
  assert.equal(mailProvider({ SMTP_HOST: 'h', SMTP_USER: 'u' }), null, 'a password is needed');
  assert.equal(mailProvider(gmail), 'smtp'); assert.equal(mailConfigured(gmail), true);
  assert.equal(mailProvider({ RESEND_API_KEY: 'k', MAIL_FROM: 'x <a@b.com>' }), 'resend');
  assert.equal(mailProvider({ RESEND_API_KEY: 'k' }), null, 'Resend also needs a From address');
  const both = { ...gmail, RESEND_API_KEY: 'k', MAIL_FROM: 'x <a@b.com>' };
  assert.equal(mailProvider(both), 'smtp');
  assert.equal(mailProvider({ ...both, MAIL_PROVIDER: 'resend' }), 'resend');
  assert.equal(mailProvider({ ...gmail, MAIL_PROVIDER: 'resend' }), 'smtp', 'cannot pick a sender that is not set up');
});

test('SMTP sending: right settings, From defaults to the mailbox, attachments pass through, errors are explained without the password', async () => {
  const calls: { cfg: Parameters<SmtpSend>[0]; mail: Parameters<SmtpSend>[1] }[] = [];
  const ok: SmtpSend = async (cfg, mail) => { calls.push({ cfg, mail }); };
  assert.deepEqual(await sendMail(msg, { env: gmail, smtpSend: ok }), { ok: true });
  assert.deepEqual(calls[0]!.cfg, { host: 'smtp.gmail.com', port: 587, secure: false, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' });
  assert.equal(calls[0]!.mail.from, 'AdLens <me@gmail.com>'); assert.equal(fromAddress({ ...gmail, MAIL_FROM: 'Team <me@gmail.com>' }), 'Team <me@gmail.com>');
  await sendMail({ ...msg, attachments: [{ filename: 'a.pdf', content: Buffer.from('x') }], headers: { 'List-Unsubscribe': '<mailto:u@x.com>' } }, { env: { ...gmail, SMTP_PORT: '465' }, smtpSend: ok });
  assert.equal(calls[1]!.cfg.secure, true, 'port 465 is secure by default'); assert.equal(calls[1]!.mail.attachments?.length, 1); assert.ok(calls[1]!.mail.headers);

  const bad: SmtpSend = async () => { const e = new Error('Invalid login: 535 Username and Password not accepted for abcd efgh ijkl mnop') as Error & { responseCode: number; code: string }; e.responseCode = 535; e.code = 'EAUTH'; throw e; };
  const r = await sendMail(msg, { env: gmail, smtpSend: bad });
  assert.equal(r.ok, false); assert.equal((r as { reason: string }).reason, 'rejected');
  const detail = (r as { detail?: string }).detail ?? '';
  assert.match(detail, /535/); assert.ok(!detail.includes('abcd efgh'), 'password never shown');
  const down: SmtpSend = async () => { const e = new Error('getaddrinfo ENOTFOUND smtp.nowhere.test') as Error & { code: string }; e.code = 'ENOTFOUND'; throw e; };
  assert.equal(((await sendMail(msg, { env: gmail, smtpSend: down })) as { reason: string }).reason, 'network');
  assert.deepEqual(await sendMail(msg, { env: {} }), { ok: false, reason: 'not_configured' });
});
