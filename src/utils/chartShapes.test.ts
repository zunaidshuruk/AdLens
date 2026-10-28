import assert from 'node:assert/strict';
import test from 'node:test';
import { gaugeFraction, heatGrid, pieSlices, pivotTwoDimensions } from './chartShapes.js';

const rows = [
  { d: 'Mon', c: 'BD', v: 10 }, { d: 'Mon', c: 'US', v: 5 }, { d: 'Tue', c: 'BD', v: 20 }, { d: 'Tue', c: 'IN', v: 1 },
];

test('Stage 19 — pivot: one row per first breakdown, one column per second, tail folded', () => {
  const p = pivotTwoDimensions(rows, 'd', 'c', 'v');
  assert.deepEqual(p.series, ['BD', 'US', 'IN']);
  assert.deepEqual(p.data[0], { label: 'Mon', BD: 10, US: 5 });
  const folded = pivotTwoDimensions(rows, 'd', 'c', 'v', 1);
  assert.deepEqual(folded.series, ['BD', 'Other']);
  assert.equal(folded.data[0].Other, 5);
});

test('Stage 19 — pie: biggest first, small tail becomes Other, zeros dropped', () => {
  const s = pieSlices([{ label: 'a', value: 1 }, { label: 'b', value: 5 }, { label: 'c', value: 3 }, { label: 'z', value: 0 }], 2);
  assert.deepEqual(s, [{ label: 'b', value: 5 }, { label: 'Other', value: 4 }]);
});

test('Stage 19 — gauge: percent needs no target, other numbers do, and it stays within 0..1', () => {
  assert.equal(gaugeFraction(40, true), 0.4);
  assert.equal(gaugeFraction(500, false), null);
  assert.equal(gaugeFraction(500, false, 1000), 0.5);
  assert.equal(gaugeFraction(5000, false, 1000), 1);
  assert.equal(gaugeFraction(-3, true), 0);
});

test('Stage 19 — heat map: intensity is relative to the biggest cell, gaps are null', () => {
  const g = heatGrid(rows, 'd', 'c', 'v');
  assert.deepEqual(g.rowLabels, ['Tue', 'Mon']);
  assert.deepEqual(g.colLabels, ['BD', 'US', 'IN']);
  assert.equal(g.cells[0][0].intensity, 1);
  assert.equal(g.cells[1][2].value, null);
  assert.equal(g.cells[1][0].intensity, 0.5);
});
