import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { buildAccountEmail, ourActionLink, setTestActionLinkGenerator } from './lib/accountMail.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';

test('Account emails: link rewritten to our address, text is escaped and plain', () => {
  const l = ourActionLink('https://proj.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=ABC123&apiKey=SECRETKEY&continueUrl=x&lang=en', 'https://app.example.com/');
  assert.equal(l, 'https://app.example.com/auth/action?mode=verifyEmail&oobCode=ABC123');
  assert.ok(!l.includes('SECRETKEY'));
  assert.throws(() => ourActionLink('https://x.com/?a=b', 'https://app.example.com'));
  const m = buildAccountEmail('reset', 'https://app.example.com/auth/action?mode=resetPassword&oobCode=Z', 'AdLens', '<b>Ann</b>');
  assert.ok(!m.html.includes('<b>Ann</b>')); assert.match(m.subject, /Reset your AdLens password/); assert.match(m.text, /oobCode=Z/);
  assert.match(buildAccountEmail('verify', 'https://x/y').subject, /Confirm your email/);
});

test('Account email routes: sent through our sender, fall back when mail is off or refused, no account probing, limits, test email', async () => {
  process.env.APP_BASE_URL = 'http://localhost:3000';
  const realFetch = globalThis.fetch;
  const sent: { to: string[]; subject: string; text: string }[] = [];
  let resend: { ok: boolean; status: number; body: string } = { ok: true, status: 200, body: '{"id":"1"}' };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('api.resend.com')) { const b = JSON.parse(String(init?.body)); if (resend.ok) sent.push(b); return new Response(resend.body, { status: resend.status }); }
    return realFetch(input, init);
  }) as typeof fetch;
  setTestActionLinkGenerator(async (kind, email) => { if (email === 'ghost@x.com') { const e = new Error('nope') as Error & { code: string }; e.code = 'auth/user-not-found'; throw e; } return `https://proj.firebaseapp.com/__/auth/action?mode=${kind === 'verify' ? 'verifyEmail' : 'resetPassword'}&oobCode=CODE_${kind}&apiKey=K`; });
  setTestTokenVerifier(async (t: string) => ({ uid: `uid_${t}`, email: t === 'noemail' ? undefined : `${t}@acme.com`, name: t, email_verified: t === 'done', firebase: { sign_in_provider: 'password', identities: {} } }) as never);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/account-mail`;
  const post = (path: string, body?: unknown, token?: string) => realFetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  try {
    // mail not set up -> the page falls back to Firebase's own email
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM; for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_PROVIDER']) delete process.env[k];
    assert.deepEqual(await (await post('/verification', {}, 'ann')).json(), { handled: false, reason: 'not_configured' });
    assert.deepEqual(await (await post('/password-reset', { email: 'ann@acme.com' })).json(), { handled: false });
    const t0 = await (await post('/test', {}, 'ann')).json() as { sent: boolean; message: string };
    assert.equal(t0.sent, false); assert.match(t0.message, /SMTP_HOST/); assert.match(t0.message, /RESEND_API_KEY/);

    process.env.RESEND_API_KEY = 're_test'; process.env.MAIL_FROM = 'AdLens <hello@example.com>';
    assert.equal((await post('/verification', {})).status, 401);
    assert.equal((await post('/verification', {}, 'noemail')).status, 400);
    assert.deepEqual(await (await post('/verification', {}, 'done')).json(), { handled: true, already: true });
    assert.equal(sent.length, 0);
    assert.deepEqual(await (await post('/verification', {}, 'bob')).json(), { handled: true });
    assert.deepEqual(sent[0]!.to, ['bob@acme.com']); assert.match(sent[0]!.subject, /Confirm your email/);
    assert.match(sent[0]!.text, /http:\/\/localhost:3000\/auth\/action\?mode=verifyEmail&oobCode=CODE_verify/);
    assert.ok(!sent[0]!.text.includes('apiKey'));

    // reset: same answer for real and unknown addresses; only a real one gets mail
    assert.deepEqual(await (await post('/password-reset', { email: 'Real@Acme.com' })).json(), { handled: true });
    assert.deepEqual(sent[1]!.to, ['real@acme.com']); assert.match(sent[1]!.text, /mode=resetPassword&oobCode=CODE_reset/);
    assert.deepEqual(await (await post('/password-reset', { email: 'ghost@x.com' })).json(), { handled: true });
    assert.equal(sent.length, 2, 'unknown address gets nothing');
    assert.equal((await post('/password-reset', { email: 'not-an-email' })).status, 400);

    // refused by the mail service -> fall back; test email explains why
    resend = { ok: false, status: 403, body: '{"message":"The example.com domain is not verified."}' };
    assert.deepEqual(await (await post('/verification', {}, 'cat')).json(), { handled: false, reason: 'rejected', detail: '403: The example.com domain is not verified.' });
    const t1 = await (await post('/test', {}, 'ann')).json() as { sent: boolean; message: string };
    assert.equal(t1.sent, false); assert.match(t1.message, /not verified/);
    resend = { ok: true, status: 200, body: '{}' };
    const t2 = await (await post('/test', {}, 'dan')).json() as { sent: boolean; to: string };
    assert.equal(t2.sent, true); assert.equal(t2.to, 'dan@acme.com');

    // limits: 6 verification emails an hour per person, 5 resets an hour per address
    let last = 0; for (let i = 0; i < 8; i++) last = (await post('/verification', {}, 'limit')).status;
    assert.equal(last, 429);
    for (let i = 0; i < 6; i++) last = (await post('/password-reset', { email: 'spam@acme.com' })).status;
    assert.equal(last, 429);
  } finally { server.close(); globalThis.fetch = realFetch; setTestActionLinkGenerator(null); delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM; }
});
