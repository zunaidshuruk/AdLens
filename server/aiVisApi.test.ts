import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';
import { setTestTokenVerifier } from './lib/firebaseAdmin.js';
import { createInMemoryAgentStore, setTestAgentStore } from './lib/agentStore.js';
import { createInMemoryFirestoreStore, setTestFirestoreStore } from './lib/firestore.js';
import { createInMemoryProjectDocsStore, setTestProjectDocsStore } from './lib/projectDocs.js';
import { clearAiRateLimit, setTestAiRequest } from './routes/ai.js';

test('AI visibility API: prompts, competitors, runs cost quota, analysis saved, failures refunded', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-sprint-36-32chars!!';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.GEMINI_API_KEY = 'AIzaTestKeyForSeo'; process.env.GEMINI_MODEL = 'gemini-test'; delete process.env.GEMINI_API_KEY_2;
  clearAiRateLimit();
  const fs = createInMemoryFirestoreStore(); setTestFirestoreStore(fs);
  setTestProjectDocsStore(createInMemoryProjectDocsStore()); setTestAgentStore(createInMemoryAgentStore());
  const { workspace } = await fs.bootstrapUserAndWorkspace({ uid: 'uid_alice', email: 'alice@acme.com', displayName: 'Alice' });
  const p = await fs.createProject(workspace.id, { name: 'Convay', domain: 'convay.com', brandTerms: ['Convay Meet'], timezone: 'UTC', currency: 'USD', createdBy: 'uid_alice' } as never);
  await fs.bootstrapUserAndWorkspace({ uid: 'uid_bob', email: 'bob@acme.com', displayName: 'Bob' });
  setTestTokenVerifier(async (t: string) => {
    const who = t === 'token-alice' ? 'alice' : t === 'token-bob' ? 'bob' : null;
    if (!who) throw new Error('bad');
    return { uid: `uid_${who}`, email: `${who}@acme.com`, name: who, email_verified: true, firebase: { identities: { 'google.com': ['g'] }, sign_in_provider: 'google.com' } } as never;
  });
  let reply = 'Popular choices: Zoom, and Convay which is reliable and secure (convay.com).'; let status = 200;
  setTestAiRequest(async () => ({ status, headers: {}, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] }) }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, path: string, body?: unknown, token = 'token-alice') =>
    fetch(`${baseUrl}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-AdLens-Project': `${p.workspaceId}/${p.id}` } });
  const used = async () => (await fs.getUsage(workspace.id))?.aiQuestions ?? 0;
  try {
    assert.equal((await call('GET', '/api/aivis/overview', undefined, 'token-bob')).status, 404);
    assert.equal((await call('POST', '/api/aivis/prompts', { texts: ['short'] })).status, 400);
    const add = await call('POST', '/api/aivis/prompts', { texts: ['What is the best video meeting tool in Bangladesh?', 'what is the best video meeting tool in bangladesh?', 'Which secure chat apps do governments use?'] });
    assert.equal(add.status, 201); assert.equal(((await add.json()) as any).added, 2);
    assert.equal((await call('PUT', '/api/aivis/settings', { competitors: ['Zoom', 'Webex'] })).status, 200);
    let ov = (await (await call('GET', '/api/aivis/overview')).json()) as any;
    assert.equal(ov.prompts.length, 2); assert.deepEqual(ov.competitors, ['Zoom', 'Webex']); assert.deepEqual(ov.brandTerms, ['Convay', 'Convay Meet']); assert.equal(ov.summary.run, 0);

    const ids = ov.prompts.map((x: any) => x.id);
    assert.equal((await call('POST', '/api/aivis/run', { promptIds: [] })).status, 400);
    assert.equal((await call('POST', '/api/aivis/run', { promptIds: [ids[0]], agentId: 'nope' })).status, 404);
    assert.equal(await used(), 0);
    const run = await call('POST', '/api/aivis/run', { promptIds: ids });
    assert.equal(run.status, 200);
    const rb = (await run.json()) as any;
    assert.equal(rb.runs.length, 2); assert.equal(await used(), 2);
    assert.equal(rb.runs[0].analysis.mentioned, true); assert.equal(rb.runs[0].analysis.rank, 2); assert.equal(rb.runs[0].analysis.citedOwn, true);
    ov = (await (await call('GET', '/api/aivis/overview')).json()) as any;
    assert.equal(ov.summary.visibility, 100); assert.equal(ov.prompts[0].runs, 1); assert.equal(ov.trend.length, 1);

    status = 500; reply = '';
    assert.equal((await call('POST', '/api/aivis/run', { promptIds: [ids[0]] })).status, 502);
    assert.equal(await used(), 2, 'failed runs are given back');

    const hist = (await (await call('GET', `/api/aivis/history/${ids[0]}`)).json()) as any;
    assert.equal(hist.runs.length, 1);
    assert.equal((await call('DELETE', `/api/aivis/prompts/${ids[0]}`)).status, 200);
    assert.equal((await call('DELETE', `/api/aivis/prompts/${ids[0]}`)).status, 404);
    assert.equal((((await (await call('GET', `/api/aivis/history/${ids[0]}`)).json()) as any).runs).length, 0);
  } finally {
    server.close(); setTestAiRequest(null); setTestProjectDocsStore(null); setTestAgentStore(null); setTestTokenVerifier(null as never); setTestFirestoreStore(null as never);
  }
});
