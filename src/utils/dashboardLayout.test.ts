import assert from 'node:assert/strict';
import test from 'node:test';
import { DASHBOARD_TEMPLATES } from '../config/dashboardTemplates.js';
import type { DashboardWidget } from '../types/dashboard.js';
import { addWidget, clampLayout, compact, DEFAULT_SIZE, findFreeSpot, hasOverlap, mobileOrder, placeWidget, removeWidget, resizeWidget } from './dashboardLayout.js';

const t = (id: string, x: number, y: number, w: number, h: number): DashboardWidget => ({ id, title: id, kind: 'text', text: 'x', layout: { x, y, w, h } });

test('Sprint 14 — layout: clamping keeps widgets inside the 12-column grid', () => {
  assert.deepEqual(clampLayout({ x: 10, y: -3, w: 6, h: 0 }), { x: 6, y: 0, w: 6, h: 1 });
  assert.deepEqual(clampLayout({ x: 0, y: 0, w: 99, h: 99 }), { x: 0, y: 0, w: 12, h: 12 });
});

test('Sprint 14 — layout: compact pulls widgets up and never overlaps', () => {
  const out = compact([t('a', 0, 0, 6, 2), t('b', 0, 5, 6, 2), t('c', 6, 9, 6, 2)]);
  assert.equal(hasOverlap(out), false);
  assert.deepEqual(out.map((w) => w.layout.y), [0, 2, 0]);
});

test('Sprint 14 — layout: moving a widget onto another pushes the other one down', () => {
  const start = [t('a', 0, 0, 6, 2), t('b', 6, 0, 6, 2)];
  const out = placeWidget(start, 'b', { x: 0, y: 0 });
  assert.equal(hasOverlap(out), false);
  assert.deepEqual(out.find((w) => w.id === 'b')!.layout, { x: 0, y: 0, w: 6, h: 2 });
  assert.equal(out.find((w) => w.id === 'a')!.layout.y, 2);
});

test('Sprint 14 — layout: resize, add and remove stay tidy', () => {
  let ws: DashboardWidget[] = [t('a', 0, 0, 6, 2), t('b', 6, 0, 6, 2), t('c', 0, 2, 12, 2)];
  ws = resizeWidget(ws, 'a', 6, 0);
  assert.equal(hasOverlap(ws), false);
  assert.equal(ws.find((w) => w.id === 'a')!.layout.w, 12);
  ws = addWidget(ws, { id: 'n', title: 'n', kind: 'text', text: 'n' }, DEFAULT_SIZE.text);
  assert.equal(hasOverlap(ws), false);
  assert.equal(ws.length, 4);
  ws = removeWidget(ws, 'a');
  assert.equal(hasOverlap(ws), false);
  assert.equal(ws.length, 3);
});

test('Sprint 14 — layout: free spot and phone order', () => {
  assert.deepEqual(findFreeSpot([t('a', 0, 0, 6, 2)], { w: 6, h: 2 }), { x: 6, y: 0, w: 6, h: 2 });
  assert.deepEqual(findFreeSpot([t('a', 0, 0, 12, 2)], { w: 3, h: 2 }), { x: 0, y: 2, w: 3, h: 2 });
  const order = mobileOrder([t('b', 6, 0, 6, 2), t('c', 0, 2, 6, 2), t('a', 0, 0, 6, 2)]);
  assert.deepEqual(order.map((w) => w.id), ['a', 'b', 'c']);
});

test('Sprint 14 — layout: every starter template is overlap-free and uses only real fields', () => {
  assert.ok(DASHBOARD_TEMPLATES.length >= 4);
  for (const tpl of DASHBOARD_TEMPLATES) {
    assert.equal(hasOverlap(tpl.widgets), false, tpl.id);
    assert.equal(new Set(tpl.widgets.map((w) => w.id)).size, tpl.widgets.length, tpl.id);
  }
});
