import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToolMenu,
  sanitizeToolSchema,
  shortlistTools,
  toGeminiFunctionDeclarations,
  withDateDefaults,
  type ToolDefinition,
} from './aiTools.js';

const dateProps = {
  startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start' },
  endDate: { type: 'string', description: 'End' },
  compareStartDate: { type: 'string' },
  compareEndDate: { type: 'string' },
};
const tool = (id: string, title: string, description: string, source: ToolDefinition['source'], extra: Record<string, unknown> = {}, required: string[] = ['startDate', 'endDate']): ToolDefinition => ({
  id, title, description, source,
  input: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { ...dateProps, ...extra }, required, additionalProperties: false },
});

const TOOLS: ToolDefinition[] = [
  tool('ga4.overview', 'GA4 overview', 'Returns top-level Google Analytics 4 KPI totals: sessions, users and key events.', 'ga4'),
  tool('ga4.trafficBreakdown', 'Traffic breakdown', 'Breaks traffic down by channel, source, country, device or landing page.', 'ga4',
    { dimension: { type: 'string', enum: ['channel', 'sourceMedium', 'referrer', 'landingPage', 'country', 'device', 'browser', 'date', 'extra'] }, limit: { type: 'integer' } },
    ['startDate', 'endDate', 'dimension']),
  tool('ga4.aiTraffic', 'AI traffic', 'Sessions arriving from AI assistants such as ChatGPT, Perplexity, Gemini and Claude.', 'ga4'),
  tool('searchConsole.topQueries', 'Top search queries', 'Search queries with clicks, impressions, CTR and average position.', 'search_console'),
  tool('meta.campaigns', 'Meta campaigns', 'Meta Ads campaigns with spend, clicks, leads, CPC and cost per lead.', 'meta'),
  tool('meta.overview', 'Meta overview', 'Meta Ads account totals for spend, reach and leads.', 'meta'),
  tool('searchConsole.overview', 'Search overview', 'Search Console totals: clicks, impressions, CTR, position.', 'search_console'),
];

test('schemas lose $schema and the date arguments (including from "required")', () => {
  const s = sanitizeToolSchema(TOOLS[1].input, ['startDate', 'endDate', 'compareStartDate', 'compareEndDate']);
  assert.equal('$schema' in s, false);
  assert.deepEqual(Object.keys(s.properties as object), ['dimension', 'limit']);
  assert.deepEqual(s.required, ['dimension']);
  const none = sanitizeToolSchema(TOOLS[0].input, ['startDate', 'endDate', 'compareStartDate', 'compareEndDate']);
  assert.equal('required' in none, false);
});

test('Gemini declarations: dotted names kept, parameters only when there are any', () => {
  const decls = toGeminiFunctionDeclarations(TOOLS);
  assert.equal(decls[0].name, 'ga4.overview');
  assert.equal('parametersJsonSchema' in decls[0], false); // no args once dates are hidden
  assert.deepEqual(Object.keys((decls[1].parametersJsonSchema as { properties: object }).properties), ['dimension', 'limit']);
  const withDates = toGeminiFunctionDeclarations(TOOLS.slice(0, 1), { hideDateArgs: false });
  assert.ok('startDate' in ((withDates[0].parametersJsonSchema as { properties: object }).properties));
  assert.throws(() => toGeminiFunctionDeclarations([{ ...TOOLS[0], id: '1bad name' }]), /Invalid tool name/);
});

test('the UI date range always overrides whatever dates the model sent', () => {
  const args = withDateDefaults({ dimension: 'country', startDate: '1999-01-01', compareEndDate: 'x' }, { startDate: '2026-10-01', endDate: '2026-10-07' });
  assert.deepEqual(args, { dimension: 'country', startDate: '2026-10-01', endDate: '2026-10-07' });
  const cmp = withDateDefaults(undefined, { startDate: 'a', endDate: 'b', compareStartDate: 'c', compareEndDate: 'd' });
  assert.deepEqual(cmp, { startDate: 'a', endDate: 'b', compareStartDate: 'c', compareEndDate: 'd' });
});

test('shortlisting picks the relevant tools for a question', () => {
  const ids = (q: string, opts = {}) => shortlistTools(q, TOOLS, { max: 3, ...opts }).map((t) => t.id);
  assert.equal(ids('Which Meta campaign had the lowest cost per lead?')[0], 'meta.campaigns');
  assert.equal(ids('Which search queries have high impressions but low CTR?')[0], 'searchConsole.topQueries');
  assert.equal(ids('How much traffic came from ChatGPT and Perplexity?')[0], 'ga4.aiTraffic');
  assert.ok(ids('traffic by country').includes('ga4.trafficBreakdown'));
  assert.ok(!ids('Which Meta campaign had the lowest cost per lead?', { availableSources: ['ga4'] }).some((id) => id.startsWith('meta.')));
});

test('with no keyword match it falls back to each source overview', () => {
  const ids = shortlistTools('hello there', TOOLS, { max: 4, availableSources: ['ga4', 'meta'] }).map((t) => t.id);
  assert.deepEqual(ids.sort(), ['ga4.overview', 'meta.overview']);
});

test('the compact tool menu is short and shows arguments', () => {
  const menu = buildToolMenu([TOOLS[1], TOOLS[0]]);
  assert.match(menu, /^ga4\.trafficBreakdown\(dimension: channel\|sourceMedium\|referrer\|landingPage\|country\|device\|browser\|date\|…, limit\?: integer\) – Breaks traffic down/);
  assert.match(menu, /\nga4\.overview\(\) – Returns top-level Google Analytics 4 KPI totals/);
  assert.ok(!menu.includes('startDate'));
  assert.ok(menu.length < 400);
});
