import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { createInMemoryAgentStore, setTestAgentStore } from './lib/agentStore.js';
import { createInMemoryVaultStore, setTestConnectionStore } from './lib/connectionStore.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { getVault, resetVaultSingleton } from './lib/vault.js';
import { setTestAiRequest } from './routes/ai.js';

test('Sprint 16 — AI agents API: keys sealed, never returned, permissions, test, ask, consent, limits', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-16-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';

  const fs = createInMemoryFirestoreStore();
  setTestFirestoreStore(fs);
  setTestConnectionStore(createInMemoryVaultStore());
  setTestProjectDocsStore(createInMemoryProjectDocsStore());
  const agents = createInMemoryAgentStore();
  setTestAgentStore(agents);
  resetVaultSingleton();

  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const project = await fs.createProject(workspace.id, { name: 'Shop', domain: 'shop.com', ga4PropertyId: '1001', ga4PropertyName: 'GA', timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' });
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (token: string) => {
    const who = token === 'token-alice' ? 'alice' : token === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  await getVault().saveConnection({ uid: 'uid_alice', provider: 'google', accountLabel: 'alice@acme.com', scopes: ['x'], refreshToken: 'rt', accessToken: 'GOOGLE-ACCESS-TOKEN', accessTokenExpiresAt: Date.now() + 3_600_000 });

  const calls: { url: string; auth: string | undefined; body: any }[] = [];
  let providerStatus = 200;
  setTestAiRequest(async (url, opts) => {
    calls.push({ url: url.toString(), auth: opts.headers?.Authorization ?? opts.headers?.authorization, body: opts.body ? JSON.parse(opts.body) : null });
    if (providerStatus !== 200) return { status: providerStatus, headers: {}, text: '{"error":"nope"}' };
    return { status: 200, headers: {}, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK, traffic looks steady.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4 } }) };
  });

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, o: { method?: string; body?: unknown; token?: string; api?: string } = {}) =>
    fetch(`${baseUrl}${o.api ?? '/api/agents'}${path}`, {
      method: o.method,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      headers: { Authorization: `Bearer ${o.token ?? 'token-alice'}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${workspace.id}/${project.id}` },
    });
  const SECRET = 'sk-test-SECRETKEY1234';
  const agentBody = { name: 'My GPT', provider: 'openai-compatible', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.example.com/v1', systemPrompt: 'Be brief.', allowedSources: ['ga4'] };

  try {
    assert.equal((await fetch(`${baseUrl}/api/agents`)).status, 401);

    // consent is required
    const noConsent = await call('', { method: 'POST', body: { agent: agentBody, apiKey: SECRET } });
    assert.equal(noConsent.status, 400);
    assert.equal(((await noConsent.json()) as any).error.code, 'CONSENT_REQUIRED');

    // bad inputs
    assert.equal((await call('', { method: 'POST', body: { agent: { ...agentBody, baseUrl: 'http://localhost:8080' }, apiKey: SECRET, consent: true } })).status, 400);
    assert.equal((await call('', { method: 'POST', body: { agent: { ...agentBody, provider: 'gemini', model: 'gemini-x', baseUrl: undefined }, consent: true } })).status, 400);
    assert.equal((await call('', { method: 'POST', body: { agent: agentBody, apiKey: 'has spaces in it', consent: true } })).status, 400);

    // create
    const created = await call('', { method: 'POST', body: { agent: agentBody, apiKey: SECRET, consent: true } });
    assert.equal(created.status, 201);
    const raw = await created.text();
    assert.ok(!raw.includes(SECRET), 'the key must never be returned');
    const { agent } = JSON.parse(raw) as { agent: any };
    assert.equal(agent.hasApiKey, true);
    assert.equal(agent.apiKeyHint, '••••1234');
    assert.ok(agent.consentedAt);
    // sealed at rest
    const stored = JSON.stringify(agents.dumpSecrets());
    assert.ok(!stored.includes(SECRET));
    assert.ok(stored.includes('v1.'));

    // list never leaks, and a stranger sees nothing
    const listRaw = await (await call('')).text();
    assert.ok(!listRaw.includes(SECRET) && !listRaw.includes('v1.'));
    assert.equal(JSON.parse(listRaw).agents.length, 1);
    assert.equal(JSON.parse(listRaw).limit, 3);
    assert.equal((await call('', { token: 'token-bob' })).status, 404);
    assert.equal((await call(`/${agent.id}`, { method: 'DELETE', token: 'token-bob' })).status, 404);

    // options: connected sources and the report list
    const options = (await (await call('/options')).json()) as any;
    assert.equal(options.sources.find((s: any) => s.id === 'ga4').connected, true);
    assert.equal(options.sources.find((s: any) => s.id === 'meta').connected, false);
    assert.ok(options.reports.some((r: any) => r.id === 'ga4.explore'));

    // test connection: uses the key, returns ok; a rejected key gives a friendly error without the key
    const tested = (await (await call(`/${agent.id}/test`, { method: 'POST' })).json()) as any;
    assert.equal(tested.ok, true);
    assert.equal(calls.at(-1)!.auth, `Bearer ${SECRET}`);
    assert.ok(!JSON.stringify(calls.at(-1)!.body).includes('shop.com'), 'the test sends no project data');
    providerStatus = 401;
    const bad = await (await call(`/${agent.id}/test`, { method: 'POST' })).text();
    assert.ok(!bad.includes(SECRET));
    assert.equal(JSON.parse(bad).ok, false);
    assert.equal(JSON.parse(bad).code, 'PROVIDER_AUTH');
    providerStatus = 200;

    // ask through the normal route with agentId: no built-in allowance used
    const ask = (agentId: string) => call('', { api: '/api/ai/ask', method: 'POST', body: { question: 'How is traffic?', startDate: '2026-10-01', endDate: '2026-10-07', agentId } });
    const asked = (await (await ask(agent.id)).json()) as any;
    assert.equal(asked.ok, true, JSON.stringify(asked));
    assert.equal(asked.engine.kind, 'custom-agent');
    assert.equal(asked.engine.label, 'My GPT');
    assert.equal(asked.quota, null);
    assert.ok(asked.answer.includes('traffic looks steady'));
    assert.equal(calls.at(-1)!.auth, `Bearer ${SECRET}`);
    const usage = (await (await call('/usage', { api: '/api/ai' })).json()) as any;
    assert.equal(usage.used, 0);
    // unknown agent / stranger
    assert.equal((await ask('nope')).status, 404);
    assert.equal((await call('', { api: '/api/ai/ask', method: 'POST', token: 'token-bob', body: { question: 'x', startDate: '2026-10-01', endDate: '2026-10-07', agentId: agent.id } })).status, 404);

    // changing where the data goes withdraws consent until it is confirmed again
    const changed = (await (await call(`/${agent.id}`, { method: 'PUT', body: { agent: { ...agentBody, baseUrl: 'https://api.other.example.com/v1' } } })).json()) as any;
    assert.equal(changed.agent.consentedAt, null);
    assert.equal(changed.agent.hasApiKey, true, 'omitting the key keeps the saved one');
    const blocked = (await (await ask(agent.id)).json()) as any;
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, 'AGENT_CONSENT_REQUIRED');
    const reconsent = (await (await call(`/${agent.id}`, { method: 'PUT', body: { agent: { ...agentBody, baseUrl: 'https://api.other.example.com/v1' }, consent: true } })).json()) as any;
    assert.ok(reconsent.agent.consentedAt);
    assert.equal(((await (await ask(agent.id)).json()) as any).ok, true);

    // switched off
    await call(`/${agent.id}`, { method: 'PUT', body: { agent: { ...agentBody, baseUrl: 'https://api.other.example.com/v1', enabled: false } } });
    assert.equal(((await (await ask(agent.id)).json()) as any).error.code, 'AGENT_DISABLED');

    // permissions: an agent allowed only Meta cannot use GA4 reports on a GA4-only project
    const metaOnly = (await (await call('', { method: 'POST', body: { agent: { ...agentBody, name: 'Meta only', allowedSources: ['meta'] }, apiKey: SECRET, consent: true } })).json()) as any;
    const noReports = (await (await ask(metaOnly.agent.id)).json()) as any;
    assert.equal(noReports.ok, false);
    assert.equal(noReports.error.code, 'NO_REPORTS_AVAILABLE');

    // webhook: signing secret shown once, then only "exists"
    const hook = await call('', { method: 'POST', body: { agent: { name: 'Hook', provider: 'webhook', baseUrl: 'https://hooks.example.com/adlens', allowedSources: ['ga4'] }, consent: true } });
    assert.equal(hook.status, 201);
    const hookJson = (await hook.json()) as any;
    assert.ok(String(hookJson.webhookSecret).startsWith('whsec_'));
    const afterHook = await (await call('')).text();
    assert.ok(!afterHook.includes(hookJson.webhookSecret));
    assert.equal(JSON.parse(afterHook).agents.find((a: any) => a.id === hookJson.agent.id).hasWebhookSecret, true);
    const rotated = (await (await call(`/${hookJson.agent.id}`, { method: 'PUT', body: { agent: { name: 'Hook', provider: 'webhook', baseUrl: 'https://hooks.example.com/adlens', allowedSources: ['ga4'] }, rotateWebhookSecret: true, consent: true } })).json()) as any;
    assert.ok(rotated.webhookSecret && rotated.webhookSecret !== hookJson.webhookSecret);

    // limit of 3
    const fourth = await call('', { method: 'POST', body: { agent: { ...agentBody, name: 'Fourth' }, apiKey: SECRET, consent: true } });
    assert.equal(fourth.status, 409);
    assert.equal(((await fourth.json()) as any).error.code, 'LIMIT_REACHED');

    // delete removes the agent and its secrets
    assert.equal((await call(`/${agent.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/${agent.id}`, { method: 'DELETE' })).status, 404);
    assert.ok(!(`${workspace.id}/${agent.id}` in agents.dumpSecrets()));
  } finally {
    server.close();
    setTestAiRequest(null);
    setTestAgentStore(null);
  }
});
