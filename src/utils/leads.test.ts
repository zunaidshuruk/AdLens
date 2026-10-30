import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeadInfo } from '../api/client.js';
import { dueFollowUps, leadsToCsv, leadsToTsv, parseCsv, parsePasted, pipelineSummary } from './leads.js';

const lead = (o: Partial<LeadInfo>): LeadInfo => ({ id: 'x', name: 'A', website: '', email: '', phone: '', status: 'new', value: 0, followUp: '', notes: '', audit: null, assigneeId: '', source: 'manual', createdAt: '', updatedAt: '', ...o });

test('pipelineSummary splits open, won and lost and works out a win rate', () => {
  const s = pipelineSummary([lead({ status: 'new', value: 100 }), lead({ status: 'proposal', value: 400 }), lead({ status: 'won', value: 1000 }), lead({ status: 'lost', value: 50 }), lead({ status: 'lost' })]);
  assert.deepEqual(s, { open: 2, openValue: 500, won: 1, wonValue: 1000, lost: 2, winRate: 33 });
  assert.equal(pipelineSummary([lead({})]).winRate, null);
});

test('dueFollowUps lists only open leads due today or earlier, oldest first', () => {
  const d = dueFollowUps([lead({ id: 'a', followUp: '2026-10-30' }), lead({ id: 'b', followUp: '2026-10-20' }), lead({ id: 'c', followUp: '2026-10-01', status: 'won' }), lead({ id: 'd', followUp: '2026-10-25', status: 'meeting' }), lead({ id: 'e' })], '2026-10-26');
  assert.deepEqual(d.map((l) => l.id), ['b', 'd']);
});

test('leadsToCsv quotes commas and defuses spreadsheet formulas', () => {
  const csv = leadsToCsv([lead({ name: 'Acme, Inc', notes: '=HYPERLINK("x")', status: 'meeting', value: 250, audit: { url: 'u', score: 80, at: '', issues: [] } })]).trim().split('\r\n');
  assert.equal(csv[0], 'Name,Website,Email,Phone,Status,Value,Follow up,Site check score,Assigned to,Notes');
  assert.equal(csv[1], '"Acme, Inc",,,,Meeting set,250,,80,,"\'=HYPERLINK(""x"")"');
});

test('parseCsv reads quotes, commas and line breaks inside quotes, Excel byte-order marks and blank lines', () => {
  const rows = parseCsv('﻿Full name,Email,Notes\r\n"Smith, Ann",ann@x.com,"Said ""hi""\nthen left"\r\n\r\nBob,,\r\n');
  assert.deepEqual(rows, [{ 'Full name': 'Smith, Ann', Email: 'ann@x.com', Notes: 'Said "hi"\nthen left' }, { 'Full name': 'Bob' }]);
  assert.deepEqual(parseCsv('Name\n'), []);
  assert.deepEqual(parseCsv(''), []);
});

test('leadsToCsv adds who each lead is assigned to', () => {
  const csv = leadsToCsv([lead({ name: 'A', assigneeId: 'u1' }), lead({ name: 'B' })], new Map([['u1', 'Alice']]));
  const lines = csv.trim().split('\r\n');
  assert.ok(lines[0]!.includes('Assigned to'));
  assert.ok(lines[1]!.includes('Alice'));
  assert.ok(!lines[2]!.includes('Alice'));
});

test('parsePasted reads spreadsheet (tab) and comma text', () => {
  assert.deepEqual(parsePasted('Name\tEmail\tPhone\nAnn, Co\tann@x.com\t+880 1711\n'), [{ Name: 'Ann, Co', Email: 'ann@x.com', Phone: '+880 1711' }]);
  assert.deepEqual(parsePasted('Name,Email\nBob,b@x.com'), [{ Name: 'Bob', Email: 'b@x.com' }]);
  assert.deepEqual(parsePasted('Name\tEmail'), []);
});

test('leadsToTsv: one row per lead, no tabs or line breaks inside cells, formulas defused, phone numbers left alone', () => {
  const tsv = leadsToTsv([lead({ name: 'A\tB', notes: 'line1\nline2', phone: '+880 1711-000000', website: '=cmd()', assigneeId: 'u1' })], new Map([['u1', 'Alice']]));
  const rows = tsv.split('\n');
  assert.equal(rows.length, 2);
  const cells = rows[1]!.split('\t');
  assert.equal(cells.length, rows[0]!.split('\t').length);
  assert.deepEqual([cells[0], cells[3], cells[1], cells[7], cells[8]], ['A B', '+880 1711-000000', "'=cmd()", 'Alice', 'line1 line2']);
});
