import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardInputSchema } from './dashboardSpec.js';

const widget = (extra: Record<string, unknown>) => ({
  id: 'k1', title: 'Sessions', kind: 'kpi', source: 'ga4',
  spec: { dimensions: [], metrics: ['sessions'], filters: [], limit: 1 },
  layout: { x: 0, y: 0, w: 3, h: 2 }, ...extra,
});

test('Stage 19 — a panel may carry its own last-N-days range, only from the allowed list', () => {
  const ok = dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({ days: 7 })] });
  assert.equal(ok.success, true);
  const none = dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({})] });
  assert.equal(none.success, true);
  const bad = dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({ days: 5000 })] });
  assert.equal(bad.success, false);
});

test('Stage 19 — new chart kinds are accepted, and a gauge target must be a positive number', () => {
  for (const kind of ['stacked', 'pie', 'gauge', 'heatmap']) {
    assert.equal(dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({ kind })] }).success, true, kind);
  }
  assert.equal(dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({ kind: 'gauge', target: 500 })] }).success, true);
  assert.equal(dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({ kind: 'gauge', target: -1 })] }).success, false);
  assert.equal(dashboardInputSchema.safeParse({ name: 'D', description: '', widgets: [widget({ kind: 'donut' })] }).success, false);
});
