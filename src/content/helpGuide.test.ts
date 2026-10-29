import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CHECKLIST, FAQS, GLOSSARY, GOALS, GROUPS, GUIDES } from './helpGuide.js';

const seoSource = readFileSync(new URL('../pages/SeoPage.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const seoTabs = new Set([...seoSource.matchAll(/\['([a-z]+)', '[^']+'\]/g)].map((m) => m[1]!));
const routes = new Set([...appSource.matchAll(/<Route path="(\/[^"]*)"/g)].map((m) => m[1]!));
const SHOTS = ['signin', 'connect', 'kpis', 'trend', 'table', 'heatmap', 'score', 'form', 'chat', 'share', 'tabs', 'reviews', 'keywords', 'alert', 'sidebar'];

test('guides: unique ids, known groups, real steps', () => {
  const ids = GUIDES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate guide id');
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const g of GUIDES) {
    assert.ok(groups.has(g.group), `${g.id}: unknown group`);
    assert.ok(g.steps.length >= 2, `${g.id}: needs at least 2 steps`);
    assert.ok(g.summary.length > 10 && g.title.length > 3);
    for (const s of g.steps) { assert.ok(s.text.length > 8, `${g.id}: empty step`); if (s.shot) assert.ok(SHOTS.includes(s.shot), `${g.id}: unknown shot ${s.shot}`); }
  }
  for (const gr of GROUPS) assert.ok(GUIDES.some((g) => g.group === gr.id), `group ${gr.id} has no guide`);
});

test('links in guides go to real pages and real SEO tabs', () => {
  const targets = [...GUIDES.map((g) => g.path), ...CHECKLIST.map((c) => c.path)].filter((p): p is string => Boolean(p));
  for (const t of targets) {
    const u = new URL(t, 'http://x');
    assert.ok(u.pathname === '/' || routes.has(u.pathname), `no route for ${t}`);
    const tab = u.searchParams.get('tab');
    if (tab) { assert.equal(u.pathname, '/seo'); assert.ok(seoTabs.has(tab), `no SEO tab "${tab}" for ${t}`); }
  }
});

test('goals and checklist point at real guides; every SEO tab has a guide', () => {
  const ids = new Set(GUIDES.map((g) => g.id));
  for (const g of GOALS) for (const id of g.guides) assert.ok(ids.has(id), `goal "${g.label}": no guide ${id}`);
  for (const c of CHECKLIST) assert.ok(ids.has(c.guide), `checklist ${c.id}: no guide ${c.guide}`);
  const covered = new Set(GUIDES.map((g) => new URL(g.path ?? '/', 'http://x').searchParams.get('tab')).filter(Boolean));
  for (const tab of seoTabs) assert.ok(covered.has(tab), `SEO tab "${tab}" has no guide`);
  assert.ok(FAQS.length >= 15 && GLOSSARY.length >= 10);
  assert.equal(new Set(FAQS.map((f) => f.q)).size, FAQS.length);
});

test('plain-language rule: no leftover developer words in guide text', () => {
  const text = JSON.stringify([GUIDES, FAQS, GLOSSARY, GOALS, CHECKLIST]).toLowerCase();
  for (const bad of ['api key id', 'firestore', 'endpoint', 'oauth', 'json']) assert.ok(!text.includes(bad), `jargon found: ${bad}`);
});
