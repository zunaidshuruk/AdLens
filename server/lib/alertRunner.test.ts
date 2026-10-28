import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlertEmail, runAlertRules, webhookPayload, type RunAlertsDeps } from './alertRunner.js';
import { createInMemoryAlertStore, type StoredAlertRule } from './alertRules.js';

const NOW = new Date('2026-10-28T06:00:00Z');
const rule = (over: Partial<StoredAlertRule> = {}): StoredAlertRule => ({
  id: 'r1', workspaceId: 'w', projectId: 'p', createdBy: 'u', createdAt: '', updatedAt: '', name: 'CPC', source: 'meta', metric: 'cpc', condition: 'above', threshold: 0.4, windowDays: 7,
  emails: ['a@b.com'], enabled: true, status: 'new', ...over,
});

function setup(measureImpl: RunAlertsDeps['measure'], over: Partial<RunAlertsDeps> = {}) {
  const store = createInMemoryAlertStore();
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const hooks: { url: string; payload: Record<string, unknown> }[] = [];
  const calls: { startDate: string; endDate: string }[] = [];
  const deps: RunAlertsDeps = {
    store,
    context: async () => ({ projectName: 'Acme <b>', emailAllowed: true, metricLabel: 'Cost per click' }),
    measure: async (r, range) => { calls.push(range); return measureImpl(r, range); },
    webhookUrl: (r) => (r.sealedWebhook ? 'https://hooks.example.com/abc' : null),
    sendMail: async (m) => { sent.push(m as never); return { ok: true }; },
    postWebhook: async (url, payload) => { hooks.push({ url, payload }); return true; },
    appUrl: 'https://app.example.com',
    now: NOW,
    ...over,
  };
  return { store, deps, sent, hooks, calls };
}

test('Alert run: a tripped rule is announced once by email, judged over the last complete days', async () => {
  const { store, deps, sent, calls } = setup(async () => 0.52);
  await store.put(rule());
  const s1 = await runAlertRules(deps);
  assert.deepEqual([s1.checked, s1.triggered, s1.notified], [1, 1, 1]);
  assert.deepEqual(calls[0], { startDate: '2026-10-21', endDate: '2026-10-27' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@b.com');
  assert.match(sent[0].subject, /Alert: CPC/);
  assert.match(sent[0].text, /Cost per click was 0.52 over the last 7 days, above your limit of 0.4/);
  assert.equal(sent[0].html.includes('Acme <b>'), false, 'project name is escaped in the email');
  const saved = (await store.get('r1'))!;
  assert.equal(saved.status, 'triggered');
  assert.equal(saved.lastValue, 0.52);
  assert.ok(saved.lastNotifiedAt);

  // same day again: not checked twice; next day, still tripped: not announced again
  assert.equal((await runAlertRules(deps)).skipped, 1);
  const next = await runAlertRules({ ...deps, now: new Date('2026-10-29T06:00:00Z') });
  assert.deepEqual([next.checked, next.triggered, next.notified], [1, 1, 0]);
  assert.equal(sent.length, 1);
  // a week later, still tripped: reminded
  const later = await runAlertRules({ ...deps, now: new Date('2026-11-05T06:00:00Z') });
  assert.equal(later.notified, 1);
  assert.equal(sent.length, 2);
});

test('Alert run: back to normal then tripped again is announced again; ok and no-data rules send nothing', async () => {
  let v: number | null = 0.9;
  const { store, deps, sent } = setup(async () => v);
  await store.put(rule());
  await runAlertRules(deps);
  v = 0.2;
  await runAlertRules({ ...deps, now: new Date('2026-10-29T06:00:00Z') });
  assert.equal((await store.get('r1'))!.status, 'ok');
  v = null;
  await runAlertRules({ ...deps, now: new Date('2026-10-30T06:00:00Z') });
  assert.equal((await store.get('r1'))!.status, 'nodata');
  v = 0.9;
  await runAlertRules({ ...deps, now: new Date('2026-10-31T06:00:00Z') });
  assert.equal(sent.length, 2);
});

test('Alert run: percent rules compare with the period before; webhook gets text, content and details', async () => {
  const { store, deps, hooks, calls } = setup(async (_r, range) => (range.endDate === '2026-10-27' ? 70 : 100));
  await store.put(rule({ condition: 'falls_pct', threshold: 20, emails: [], sealedWebhook: 'sealed', webhookHost: 'hooks.example.com' }));
  const s = await runAlertRules(deps);
  assert.equal(s.notified, 1);
  assert.deepEqual(calls[1], { startDate: '2026-10-14', endDate: '2026-10-20' });
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].payload.text, hooks[0].payload.content);
  assert.match(String(hooks[0].payload.text), /down 30% from 100/);
  assert.deepEqual((hooks[0].payload.alert as Record<string, unknown>).changePercent, -30);
});

test('Alert run: disabled rules are skipped, orphans removed, errors recorded briefly, email respects the plan', async () => {
  const { store, deps, sent } = setup(async (r) => { if (r.id === 'bad') throw new Error('token abc123 expired'); return 9; }, {
    context: async (r) => (r.id === 'gone' ? null : { projectName: 'P', emailAllowed: r.id !== 'free', metricLabel: 'X' }),
  });
  await store.put(rule({ id: 'off', enabled: false }));
  await store.put(rule({ id: 'gone' }));
  await store.put(rule({ id: 'bad' }));
  await store.put(rule({ id: 'free' }));
  const s = await runAlertRules(deps);
  assert.deepEqual([s.skipped, s.removed, s.errors, s.checked], [1, 1, 1, 2]);
  assert.equal(await store.get('gone'), null);
  const bad = (await store.get('bad'))!;
  assert.equal(bad.status, 'error');
  assert.equal(bad.lastError?.includes('abc123'), false);
  assert.equal(sent.length, 0, 'email is not sent when the plan does not include it');
  assert.equal((await store.get('free'))!.lastNotifiedAt, undefined);
});

test('Alert run: failed delivery is retried next day; force re-checks the same day', async () => {
  let accept = false;
  const { store, deps } = setup(async () => 9, { sendMail: async () => (accept ? { ok: true } : { ok: false, reason: 'network' }) });
  await store.put(rule({ threshold: 1 }));
  assert.equal((await runAlertRules(deps)).notified, 0);
  assert.equal((await store.get('r1'))!.lastNotifiedAt, undefined);
  accept = true;
  assert.equal((await runAlertRules(deps)).skipped, 1);
  assert.equal((await runAlertRules({ ...deps, force: true })).notified, 1);
});

test('Alert messages: test marking and escaping', () => {
  const r = rule({ name: '<script>' });
  const mail = buildAlertEmail(r, 'P', 'Sentence.', 'https://x', true);
  assert.match(mail.subject, /^Test: /);
  assert.equal(mail.html.includes('<script>'), false);
  const hook = webhookPayload(r, 'P', 'Sentence.', { current: 1, previous: null, evaluation: { triggered: true, changePercent: null }, sentence: 'Sentence.' }, 'https://x', true);
  assert.match(String(hook.text), /^Test of alert/);
});
