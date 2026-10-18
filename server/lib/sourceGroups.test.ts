import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateBySourceGroup,
  classifySource,
  matchAiAssistant,
  normalizeSource,
  summarizeAiReferrals,
} from './sourceGroups.js';

test('normalizeSource strips protocol, www, mobile prefixes and paths', () => {
  assert.equal(normalizeSource('https://www.ChatGPT.com/c/abc'), 'chatgpt.com');
  assert.equal(normalizeSource('m.facebook.com'), 'facebook.com');
  assert.equal(normalizeSource('l.facebook.com'), 'facebook.com');
  assert.equal(normalizeSource(undefined), '');
});

test('matchAiAssistant: domains, subdomains and utm aliases; never plain google.com', () => {
  assert.equal(matchAiAssistant('chatgpt.com'), 'ChatGPT');
  assert.equal(matchAiAssistant('chat.openai.com'), 'ChatGPT');
  assert.equal(matchAiAssistant('www.perplexity.ai'), 'Perplexity');
  assert.equal(matchAiAssistant('gemini.google.com'), 'Gemini');
  assert.equal(matchAiAssistant('claude.ai'), 'Claude');
  assert.equal(matchAiAssistant('copilot.microsoft.com'), 'Copilot');
  assert.equal(matchAiAssistant('chatgpt'), 'ChatGPT');
  assert.equal(matchAiAssistant('google'), null);
  assert.equal(matchAiAssistant('google.com'), null);
  assert.equal(matchAiAssistant('(direct)'), null);
  assert.equal(matchAiAssistant('notchatgpt.com'), null);
});

test('classifySource follows the documented rule order', () => {
  const g = (s: string, m: string, c?: string) => classifySource(s, m, c).group;
  assert.equal(g('chatgpt.com', 'referral'), 'AI assistants');
  assert.equal(g('chatgpt.com', 'cpc'), 'AI assistants'); // AI beats paid
  assert.equal(g('facebook', 'paid_social'), 'Paid'); // Meta ads with UTMs
  assert.equal(g('google', 'cpc'), 'Paid');
  assert.equal(g('google', 'organic'), 'Search');
  assert.equal(g('bing.com', 'referral'), 'Search');
  assert.equal(g('newsletter', 'email'), 'Email');
  assert.equal(g('m.facebook.com', 'referral'), 'Social');
  assert.equal(g('linkedin.com', 'referral'), 'Social');
  assert.equal(g('lnkd.in', 'referral'), 'Social');
  assert.equal(g('(direct)', '(none)'), 'Direct / unknown');
  assert.equal(g('(not set)', '(not set)'), 'Direct / unknown');
  assert.equal(g('partner-site.com', 'referral'), 'Referral');
  assert.equal(g('qr-poster', 'offline'), 'Other');
  assert.equal(g('x', 'y', 'Organic Social'), 'Social');
});

test('aggregateBySourceGroup returns all groups, shares and key event rates', () => {
  const out = aggregateBySourceGroup([
    { source: 'google', medium: 'organic', sessions: 60, engagedSessions: 40, keyEvents: 6 },
    { source: 'chatgpt.com', medium: 'referral', sessions: 20, engagedSessions: 15, keyEvents: 4 },
    { source: '(direct)', medium: '(none)', sessions: 20, engagedSessions: 10, keyEvents: 0 },
  ]);
  assert.equal(out.length, 8);
  const search = out.find((r) => r.group === 'Search')!;
  const ai = out.find((r) => r.group === 'AI assistants')!;
  assert.equal(search.sharePercent, 60);
  assert.equal(ai.keyEventRate, 20);
  assert.equal(out.find((r) => r.group === 'Email')!.sessions, 0);
  assert.equal(out[0].group, 'Search');
});

test('summarizeAiReferrals totals by assistant, landing page and date', () => {
  const s = summarizeAiReferrals(
    [
      { source: 'chatgpt.com', medium: 'referral', landingPage: '/pricing', date: '2026-10-01', sessions: 30, engagedSessions: 20, keyEvents: 3, activeUsers: 25, newUsers: 20 },
      { source: 'perplexity.ai', medium: 'referral', landingPage: '/pricing', date: '2026-10-02', sessions: 10, engagedSessions: 8, keyEvents: 1 },
      { source: 'chat.openai.com', medium: 'referral', landingPage: '/blog/zoom-alternative', date: '2026-10-02', sessions: 10, engagedSessions: 5, keyEvents: 0 },
      { source: 'google', medium: 'organic', landingPage: '/', date: '2026-10-01', sessions: 500, engagedSessions: 300, keyEvents: 20 },
    ],
    1000
  );
  assert.equal(s.aiSessions, 50);
  assert.equal(s.aiSharePercent, 5);
  assert.deepEqual(s.byAssistant.map((a) => [a.assistant, a.sessions, a.shareOfAiPercent]), [
    ['ChatGPT', 40, 80],
    ['Perplexity', 10, 20],
  ]);
  assert.deepEqual(s.byLandingPage[0], { landingPage: '/pricing', sessions: 40, keyEvents: 4, topAssistant: 'ChatGPT' });
  assert.deepEqual(s.byDate, [
    { date: '2026-10-01', sessions: 30 },
    { date: '2026-10-02', sessions: 20 },
  ]);
  assert.ok(s.listVersion.length > 0);
});
