import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiSourceDimensionFilter,
  buildAiSourceRegExp,
  matchesAiSourceRegex,
} from './aiSourceFilter.js';

test('aiSourceFilter regex matches AI domains, subdomains, and aliases and rejects google.com and lookalikes', () => {
  const filter = buildAiSourceDimensionFilter();
  assert.equal(filter.filter.fieldName, 'sessionSource');
  assert.equal(filter.filter.stringFilter.matchType, 'FULL_REGEXP');
  assert.equal(filter.filter.stringFilter.caseSensitive, false);

  const re = buildAiSourceRegExp();

  // Matches exact domains, subdomains, and exact aliases (case-insensitive)
  for (const valid of [
    'chatgpt.com',
    'CHATGPT.COM',
    'chat.openai.com',
    'sub.perplexity.ai',
    'perplexity.ai',
    'gemini.google.com',
    'claude.ai',
    'copilot.microsoft.com',
    'chat.deepseek.com',
    'chatgpt',
    'openai',
    'perplexity',
    'claude',
    'gemini',
  ]) {
    assert.equal(re.test(valid), true, `Expected regex to match "${valid}"`);
    assert.equal(matchesAiSourceRegex(valid), true, `Expected matchesAiSourceRegex("${valid}")`);
  }

  // Rejects plain google.com, lookalike domains without a dot boundary, and unrelated sources
  for (const invalid of [
    'google.com',
    'www.google.com',
    'mail.google.com',
    'notchatgpt.com',
    'fakeperplexity.ai',
    'chatgpt.com.example.com',
    'bing.com',
    'facebook.com',
    '(direct)',
  ]) {
    assert.equal(re.test(invalid), false, `Expected regex to reject "${invalid}"`);
    assert.equal(matchesAiSourceRegex(invalid), false, `Expected matchesAiSourceRegex to reject "${invalid}"`);
  }
});
