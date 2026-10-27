import assert from 'node:assert/strict';
import test from 'node:test';
import { askOnDevice } from './onDeviceEngine.js';
import { DEFAULT_WEBLLM_SETTINGS, parseWebLlmSettings, pickRuntimeKind, resolveRuntime } from './onDeviceRuntime.js';
import { checkAgainstReports, finalizeStructured, parseStructuredAnswer, STRUCTURED_SYSTEM_PROMPT } from './structuredAnswer.js';
import { MODEL_CATALOG, availableModels, createWebLlmLanguageModel, detectWebGpu, isAllowedModuleUrl, loadWebLlmModule, unloadWebLlm, type WebLlmModuleLike } from './webLlmEngine.js';

const REPORT = 'sessions: 1,234 (prev 1000, +23.4%)\nusers: 800\nengagementRate: 61.25';
const DATES = { startDate: '2026-10-01', endDate: '2026-10-28' };

test('structured answers: valid JSON is parsed, fenced JSON too, junk is rejected', () => {
  const ok = parseStructuredAnswer('{"answer":"Sessions were 1,234.","figures":[{"label":"Sessions","value":"1,234"}],"missing":null}');
  assert.equal(ok?.answer, 'Sessions were 1,234.');
  assert.equal(ok?.figures.length, 1);
  assert.equal(ok?.missing, null);
  assert.equal(parseStructuredAnswer('```json\n{"answer":"Hi","figures":[],"missing":"none"}\n```')?.missing, null, '"none" means nothing is missing');
  assert.equal(parseStructuredAnswer('Here you go: {"answer":"x","figures":[]} thanks')?.answer, 'x');
  assert.equal(parseStructuredAnswer('not json'), null);
  assert.equal(parseStructuredAnswer('{"answer":""}'), null);
  assert.equal(parseStructuredAnswer('[1,2]'), null);
});

test('structured answers: figures not in the reports are caught, rounding is allowed', () => {
  const good = checkAgainstReports({ answer: 'Sessions were 1,234 and engagement 61.3%.', figures: [{ label: 'Sessions', value: '1,234' }, { label: 'Rate', value: '61.3%' }], missing: null }, [REPORT], DATES);
  assert.deepEqual(good.unverified, []);
  const bad = checkAgainstReports({ answer: 'Sessions were 2,500, up from 1,000.', figures: [{ label: 'Sessions', value: '2,500' }], missing: null }, [REPORT], DATES);
  assert.deepEqual(bad.unverified, ['2,500'], 'the invented figure is flagged once; 1,000 is real');
  const dates = checkAgainstReports({ answer: 'Between 2026-10-01 and 2026-10-28 sessions were 1,234.', figures: [], missing: null }, [REPORT], DATES);
  assert.deepEqual(dates.unverified, [], 'the year in the date range is not an invented number');
});

test('finalizeStructured: shows answer, missing data and a warning; falls back to raw text', () => {
  const text = finalizeStructured(JSON.stringify({ answer: 'Sessions were 9,999.', figures: [{ label: 's', value: '9,999' }], missing: 'Meta spend' }), [{ id: 'r', text: REPORT }], DATES);
  assert.match(text, /^Sessions were 9,999\./);
  assert.match(text, /Missing data: Meta spend/);
  assert.match(text, /could not be matched to your reports: 9,999/);
  assert.equal(finalizeStructured('Plain words', [{ id: 'r', text: REPORT }]), 'Plain words');
  assert.match(STRUCTURED_SYSTEM_PROMPT, /ONE JSON object/);
});

test('module address: https or this site only, no credentials, no data/blob', () => {
  assert.equal(isAllowedModuleUrl('https://cdn.example.com/web-llm.js', 'https://app.example.com'), true);
  assert.equal(isAllowedModuleUrl('/vendor/web-llm.js', 'https://app.example.com'), true);
  assert.equal(isAllowedModuleUrl('http://evil.com/x.js', 'https://app.example.com'), false);
  assert.equal(isAllowedModuleUrl('http://localhost:5173/x.js', 'http://localhost:5173'), true);
  assert.equal(isAllowedModuleUrl('data:text/javascript,alert(1)', 'https://app.example.com'), false);
  assert.equal(isAllowedModuleUrl('https://user:pw@cdn.example.com/x.js', 'https://app.example.com'), false);
  assert.equal(isAllowedModuleUrl('', 'https://app.example.com'), false);
});

const fakeModule = (reply: string, opts: { cached?: boolean; models?: string[] } = {}) => {
  const calls: Record<string, unknown>[] = [];
  const created: string[] = [];
  const mod: WebLlmModuleLike = {
    async CreateMLCEngine(id, cfg) {
      created.push(id);
      cfg?.initProgressCallback?.({ progress: 0.5 });
      cfg?.initProgressCallback?.({ progress: 1 });
      return { chat: { completions: { async create(req) { calls.push(req); return { choices: [{ message: { content: reply } }] }; } } } };
    },
    hasModelInCache: async () => Boolean(opts.cached),
    ...(opts.models ? { prebuiltAppConfig: { model_list: opts.models.map((model_id) => ({ model_id })) } } : {}),
  };
  return { mod, calls, created };
};

test('module loading rejects a bad address and a file that is not WebLLM', async () => {
  await assert.rejects(() => loadWebLlmModule('http://evil.com/x.js', async () => ({}), 'https://app.example.com'));
  await assert.rejects(() => loadWebLlmModule('/x.js', async () => ({ nothing: true }), 'https://app.example.com'), /not the WebLLM module/);
  const { mod } = fakeModule('{}');
  assert.equal(await loadWebLlmModule('/x.js', async () => mod, 'https://app.example.com'), mod);
});

test('model list is filtered against the hosted WebLLM version', () => {
  assert.deepEqual(availableModels(null), MODEL_CATALOG);
  const { mod } = fakeModule('{}', { models: [MODEL_CATALOG[1].id, 'something-else'] });
  assert.deepEqual(availableModels(mod).map((m) => m.id), [MODEL_CATALOG[1].id]);
  const { mod: none } = fakeModule('{}', { models: ['unrelated'] });
  assert.deepEqual(availableModels(none), MODEL_CATALOG, 'never an empty picker');
});

test('WebGPU detection', async () => {
  assert.equal(await detectWebGpu({}), false);
  assert.equal(await detectWebGpu({ gpu: { requestAdapter: async () => null } }), false);
  assert.equal(await detectWebGpu({ gpu: { requestAdapter: async () => ({}) } }), true);
  assert.equal(await detectWebGpu({ gpu: { requestAdapter: async () => { throw new Error('x'); } } }), false);
});

test('WebLLM as a language model: availability, progress, JSON mode, abort', async () => {
  await unloadWebLlm();
  const { mod, calls, created } = fakeModule('{"answer":"ok"}', { cached: false });
  assert.equal(await createWebLlmLanguageModel(mod, 'm1', false).availability(), 'unavailable', 'no WebGPU');
  const lm = createWebLlmLanguageModel(mod, 'm1', true);
  assert.equal(await lm.availability(), 'downloadable');
  const seen: number[] = [];
  const session = await lm.create({ initialPrompts: [{ role: 'system', content: 'SYS' }], monitor: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => m.addEventListener('downloadprogress', (e) => seen.push(e.loaded)) });
  assert.deepEqual(seen, [0.5, 1]);
  assert.equal(await lm.availability(), 'available', 'loaded once, stays warm');
  assert.equal(await session.prompt('Q'), '{"answer":"ok"}');
  assert.deepEqual(calls[0].response_format, { type: 'json_object' });
  assert.deepEqual((calls[0].messages as { role: string }[]).map((m) => m.role), ['system', 'user']);
  await lm.create({});
  assert.equal(created.length, 1, 'the engine is created once');
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => session.prompt('Q', { signal: ac.signal }), { name: 'AbortError' });
  await unloadWebLlm();
  const cachedLm = createWebLlmLanguageModel(fakeModule('{}', { cached: true }).mod, 'm2', true);
  assert.equal(await cachedLm.availability(), 'available', 'files already stored in the browser');
});

test('runtime choice: Chrome first, WebLLM only when configured, enabled and WebGPU exists', () => {
  const base = { webGpu: true, moduleConfigured: true, webLlmEnabled: true };
  assert.equal(pickRuntimeKind({ ...base, chrome: 'available' }), 'chrome');
  assert.equal(pickRuntimeKind({ ...base, chrome: 'downloadable' }), 'chrome');
  assert.equal(pickRuntimeKind({ ...base, chrome: 'unsupported' }), 'webllm');
  assert.equal(pickRuntimeKind({ ...base, chrome: 'unsupported', webLlmEnabled: false }), 'none');
  assert.equal(pickRuntimeKind({ ...base, chrome: 'unsupported', moduleConfigured: false }), 'none');
  assert.equal(pickRuntimeKind({ ...base, chrome: 'unsupported', webGpu: false }), 'none');
  assert.deepEqual(parseWebLlmSettings('garbage'), DEFAULT_WEBLLM_SETTINGS);
  assert.equal(parseWebLlmSettings({ enabled: true, modelId: '../../evil' }).modelId, DEFAULT_WEBLLM_SETTINGS.modelId);
});

test('resolveRuntime: nothing configured changes nothing; WebLLM path works end to end through askOnDevice', async () => {
  await unloadWebLlm();
  const none = await resolveRuntime({ settings: { enabled: true, modelId: MODEL_CATALOG[0].id }, url: '', chromeLm: null });
  assert.equal(none.kind, 'none');
  assert.equal(none.webLlmOffered, false, 'hidden when the owner did not configure it');

  const reply = JSON.stringify({ answer: 'Sessions were 1,234 between 2026-10-01 and 2026-10-28.', figures: [{ label: 'Sessions', value: '1,234' }], missing: null });
  const { mod } = fakeModule(reply, { cached: true });
  const rt = await resolveRuntime({ settings: { enabled: true, modelId: MODEL_CATALOG[0].id }, url: '/vendor/web-llm.js', chromeLm: null, gpu: async () => true, loadModule: async () => mod });
  assert.equal(rt.kind, 'webllm');
  assert.equal(rt.status, 'available');

  const res = await askOnDevice(
    { question: 'How many sessions did I get?', project: { name: 'Shop', domain: 'shop.com' }, dates: DATES, availableSources: ['ga4'] },
    {
      lm: rt.lm,
      systemPrompt: rt.systemPrompt,
      finalize: rt.finalize,
      listTools: async () => [{ id: 'ga4.overview', title: 'Overview', description: 'Sessions, users and key events overview', source: 'ga4', input: {} }],
      runReport: async () => ({ sessions: { value: 1234, previousValue: 1000, changePercent: 23.4 } }),
    }
  );
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.answer, 'Sessions were 1,234 between 2026-10-01 and 2026-10-28.');
    assert.equal(res.numbersUsed.length, 1);
  }
  await unloadWebLlm();
});

test('askOnDevice without the new options behaves exactly as before (raw text, default prompt)', async () => {
  let system = '';
  const lm = { availability: async () => 'available', create: async (o?: Record<string, unknown>) => { system = (o?.initialPrompts as { content: string }[])[0].content; return { prompt: async () => 'Plain answer' }; } };
  const res = await askOnDevice(
    { question: 'sessions?', project: { name: 'S', domain: null }, dates: DATES, availableSources: ['ga4'] },
    { lm, listTools: async () => [{ id: 'ga4.overview', title: 'Overview', description: 'Sessions overview', source: 'ga4', input: {} }], runReport: async () => ({ sessions: 1 }) }
  );
  assert.equal(res.ok && res.answer, 'Plain answer');
  assert.match(system, /careful marketing analyst/);
});
