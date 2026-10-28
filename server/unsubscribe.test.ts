import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { buildWeeklyDigest, buildAnomalyAlert } from './lib/digest.js';
import { createInMemoryDigestStore, setTestDigestStore, subscriptionId } from './lib/digestStore.js';
import { sendMail } from './lib/mailer.js';
import { readUnsubscribe, unsubscribeUrl } from './lib/unsubscribe.js';
import { resetProtectionState } from './middleware/protect.js';

process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-24-32chars!!';

test('Unsubscribe link — genuine links read back, changed or forged ones do not', () => {
  const id = subscriptionId('u1', 'w1', 'p1');
  const url = new URL(unsubscribeUrl('https://app.example.com/', id));
  assert.equal(url.pathname, '/api/unsubscribe');
  assert.equal(readUnsubscribe(url.searchParams.get('s'), url.searchParams.get('t')), id);
  const other = new URL(unsubscribeUrl('https://app.example.com', subscriptionId('u2', 'w1', 'p1')));
  assert.equal(readUnsubscribe(other.searchParams.get('s'), url.searchParams.get('t')), null, 'signature of another subscription');
  assert.equal(readUnsubscribe(url.searchParams.get('s'), 'abc'), null);
  assert.equal(readUnsubscribe(undefined, undefined), null);
});

test('Unsubscribe link — emails carry the link and the one-click header', async () => {
  const link = 'https://app.example.com/api/unsubscribe?s=a&t=b';
  const w = buildWeeklyDigest({ projectName: 'P', domain: 'a.com', startDate: '2026-10-19', endDate: '2026-10-25', appUrl: 'https://x', metrics: [], unsubscribeUrl: link });
  assert.ok(w.text.includes(link) && w.html.includes('Unsubscribe'));
  assert.equal(w.headers?.['List-Unsubscribe'], `<${link}>`);
  assert.equal(w.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const a = buildAnomalyAlert({ projectName: 'P', domain: 'a.com', appUrl: 'https://x', unsubscribeUrl: link, anomaly: { date: '2026-10-25', value: 80, baseline: 200, changePercent: -60, direction: 'down' } });
  assert.ok(a.text.includes(link) && a.headers);
  assert.equal(buildWeeklyDigest({ projectName: 'P', domain: 'a.com', startDate: 'a', endDate: 'b', appUrl: 'https://x', metrics: [] }).headers, undefined);
  let sent: { headers?: Record<string, string> } = {};
  await sendMail({ to: 'a@b.c', subject: 's', text: 't', html: 'h', headers: w.headers }, { env: { RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c' }, fetchFn: (async (_u: unknown, init: { body: string }) => { sent = JSON.parse(init.body); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch });
  assert.equal(sent.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('Unsubscribe link — GET only asks, POST removes the subscription, a bad link changes nothing', async () => {
  resetProtectionState();
  const store = createInMemoryDigestStore();
  setTestDigestStore(store);
  const id = subscriptionId('u1', 'w1', 'p1');
  await store.put({ id, uid: 'u1', email: 'a@b.c', workspaceId: 'w1', projectId: 'p1', weekly: true, alerts: true, createdAt: new Date().toISOString() });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const url = new URL(unsubscribeUrl(base, id));
    const q = url.search;
    const g = await fetch(`${base}/api/unsubscribe${q}`);
    assert.equal(g.status, 200);
    assert.match(await g.text(), /<form method="post"/);
    assert.equal((await store.listForUid('u1')).length, 1, 'opening the link does not unsubscribe');
    assert.equal((await fetch(`${base}/api/unsubscribe?s=${url.searchParams.get('s')}&t=bad`, { method: 'POST' })).status, 400);
    assert.equal((await store.listForUid('u1')).length, 1);
    const p = await fetch(`${base}/api/unsubscribe${q}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(p.status, 200);
    assert.equal((await store.listForUid('u1')).length, 0);
  } finally { setTestDigestStore(null); server.close(); }
});
