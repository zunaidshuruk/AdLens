import assert from 'node:assert/strict';
import test from 'node:test';

test('Demand score: free estimate from suggestion rank, repeats and your own views', async () => {
  const { demandScore, keywordIdeas } = await import('./lib/seoKeywords.js');
  const strong = demandScore(6, 0, 1500); const weak = demandScore(1, 9, null);
  assert.equal(strong.level, 'high'); assert.equal(weak.level, 'low');
  assert.ok(strong.score > weak.score && strong.score <= 100 && weak.score >= 0);
  assert.equal(demandScore(0, 0, null).score, 50, 'first place alone is 50');
  const ideas = await keywordIdeas('shoes', async (q) => (q === 'shoes best' || q === 'shoes price' ? ['shoes cheap', 'shoes sale'] : q === 'shoes for' ? ['shoes sale'] : []));
  const sale = ideas.find((i) => i.keyword === 'shoes sale')!; const cheap = ideas.find((i) => i.keyword === 'shoes cheap')!;
  assert.equal(sale.hits, 3); assert.equal(sale.bestRank, 0); assert.equal(cheap.hits, 2); assert.equal(cheap.bestRank, 0);
});
