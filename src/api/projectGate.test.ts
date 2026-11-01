import assert from 'node:assert/strict';
import test from 'node:test';
import { setActiveProjectHeader, setProjectsLoading, apiClient } from './client.js';

test('a project request waits until projects have loaded, then carries the project', async () => {
  const seen: Array<string | undefined> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>)['X-AdLens-Project']);
    return new Response(JSON.stringify({ dashboards: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    setActiveProjectHeader(null);
    setProjectsLoading(true);
    const p = apiClient.listDashboards().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(seen.length, 0, 'must not fire before projects are known');
    setActiveProjectHeader('ws1/p1');
    setProjectsLoading(false);
    await p;
    assert.deepEqual(seen, ['ws1/p1']);
  } finally {
    globalThis.fetch = realFetch;
    setProjectsLoading(false);
    setActiveProjectHeader(null);
  }
});
