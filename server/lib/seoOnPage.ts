/**
 * On-page checker (Sprint 41): one page against one target keyword.
 * Checks where the keyword appears, how often, how readable the text is, and (optionally) which related words competitors use.
 * These are practical checks, not a ranking promise.
 */
import { analyzeHtml, decodeEntities, parseAttrs, type PageFacts } from './seoPage.js';
import { tokenise, topicGap, visibleText } from './seoTopics.js';

export type Check = { id: string; status: 'good' | 'warn' | 'bad'; title: string; detail: string; fix: string };

const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
const has = (hay: string, needle: string) => norm(hay).includes(needle);

/** Counts non-overlapping whole-phrase matches (word boundaries via tokens, so it also works for Bangla and other scripts). */
export function countPhrase(text: string, phrase: string): number {
  const t = tokenise(text); const p = tokenise(phrase);
  if (p.length === 0) return 0;
  let n = 0;
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((w, k) => t[i + k] === w)) { n++; i += p.length - 1; }
  }
  return n;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const m = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}

export interface Readability { sentences: number; avgSentenceWords: number; flesch: number | null; level: 'easy' | 'ok' | 'hard' | 'unknown' }
export function readability(text: string): Readability {
  const sentences = text.split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
  const words = tokenise(text);
  if (sentences.length === 0 || words.length < 30) return { sentences: sentences.length, avgSentenceWords: 0, flesch: null, level: 'unknown' };
  const avg = words.length / sentences.length;
  const latin = words.filter((w) => /^[a-z]+$/.test(w)).length / words.length > 0.8;
  const flesch = latin ? Math.round(206.835 - 1.015 * avg - 84.6 * (words.reduce((a, w) => a + syllables(w), 0) / words.length)) : null;
  const level = avg > 25 ? 'hard' : flesch !== null ? (flesch >= 60 ? 'easy' : flesch >= 40 ? 'ok' : 'hard') : avg <= 18 ? 'easy' : 'ok';
  return { sentences: sentences.length, avgSentenceWords: Math.round(avg * 10) / 10, flesch, level };
}

export interface OnPageReport {
  url: string; keyword: string; score: number; facts: { title: string | null; description: string | null; h1: string[]; wordCount: number; urlPath: string };
  placement: { title: boolean; h1: boolean; description: boolean; url: boolean; firstParagraph: boolean; h2: number; imageAlt: number };
  occurrences: number; density: number; readability: Readability; checks: Check[];
  related: { missing: { term: string; competitors: number; avgCount: number }[]; note: string } | null;
}

const check = (id: string, status: Check['status'], title: string, detail: string, fix: string): Check => ({ id, status, title, detail, fix });

export function onPageReport(html: string, pageUrl: string, keywordRaw: string, competitorTexts: string[] = [], meta: { status?: number; ms?: number; bytes?: number } = {}): OnPageReport {
  const keyword = norm(keywordRaw);
  const facts: PageFacts = analyzeHtml(html, pageUrl, { status: meta.status ?? 200, contentType: 'text/html', ms: meta.ms ?? 0, bytes: meta.bytes ?? html.length });
  const noScript = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const h2s = [...noScript.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1]!));
  const alts = (noScript.match(/<img\b[^>]*>/gi) ?? []).map((t) => parseAttrs(t).alt ?? '');
  const paras = [...noScript.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1]!)).filter((p) => p.split(' ').length >= 8);
  const text = visibleText(html);
  const urlPath = decodeURIComponent(new URL(pageUrl).pathname);
  const words = tokenise(text).length;

  const placement = {
    title: has(facts.title ?? '', keyword),
    h1: facts.h1.some((h) => has(h, keyword)),
    description: has(facts.description ?? '', keyword),
    url: has(urlPath, keyword) || tokenise(keyword).every((w) => tokenise(urlPath).includes(w)),
    firstParagraph: paras[0] ? has(paras[0].split(' ').slice(0, 100).join(' '), keyword) : false,
    h2: h2s.filter((h) => has(h, keyword)).length,
    imageAlt: alts.filter((a) => has(a, keyword)).length,
  };
  const occurrences = countPhrase(text, keyword);
  const density = words ? Math.round((occurrences * tokenise(keyword).length / words) * 10000) / 100 : 0;
  const read = readability(text);

  const c: Check[] = [];
  c.push(placement.title ? check('title', 'good', 'Keyword is in the page title', 'Search results show the title, so this matters most.', '') : check('title', 'bad', 'Keyword is missing from the page title', `The title is "${facts.title ?? 'missing'}".`, `Work "${keywordRaw}" into the title, ideally near the start.`));
  c.push(placement.h1 ? check('h1', 'good', 'Keyword is in the main heading (H1)', '', '') : check('h1', facts.h1.length ? 'warn' : 'bad', 'Keyword is missing from the main heading (H1)', facts.h1.length ? `The H1 is "${facts.h1[0]}".` : 'The page has no H1.', `Use "${keywordRaw}" or a close variation in the H1.`));
  c.push(placement.description ? check('description', 'good', 'Keyword is in the meta description', '', '') : check('description', 'warn', 'Keyword is missing from the meta description', facts.description ? 'Google bolds matching words, which helps people click.' : 'The page has no meta description.', `Write a 120 to 155 character description that includes "${keywordRaw}".`));
  c.push(placement.url ? check('url', 'good', 'Keyword is in the web address', '', '') : check('url', 'warn', 'Keyword is not in the web address', `The address path is ${urlPath}.`, 'Only change an address on a new page; changing a live one needs a redirect.'));
  c.push(placement.firstParagraph ? check('intro', 'good', 'Keyword is in the opening text', '', '') : check('intro', 'warn', 'Keyword is not in the first 100 words', 'Opening with the topic helps readers and search engines.', `Mention "${keywordRaw}" in your first paragraph.`));
  c.push(placement.h2 > 0 ? check('h2', 'good', `Keyword appears in ${placement.h2} sub-heading${placement.h2 === 1 ? '' : 's'}`, '', '') : check('h2', 'warn', 'No sub-heading mentions the keyword', `The page has ${facts.h2Count} sub-heading${facts.h2Count === 1 ? '' : 's'}.`, 'Use the keyword or a variation in one sub-heading.'));
  c.push(placement.imageAlt > 0 ? check('alt', 'good', 'An image description mentions the keyword', '', '') : check('alt', facts.images.total ? 'warn' : 'good', facts.images.total ? 'No image description mentions the keyword' : 'No images to check', '', facts.images.total ? 'Describe one relevant image using the keyword, naturally.' : ''));
  if (words < 300) c.push(check('length', 'bad', `Very short page (${words} words)`, 'Thin pages rarely satisfy a search.', 'Cover the topic fully; compare with the pages that rank.'));
  else if (words < 600) c.push(check('length', 'warn', `Short page (${words} words)`, '', 'Add sections that answer the questions people ask.'));
  else c.push(check('length', 'good', `Good length (${words} words)`, '', ''));
  if (occurrences === 0) c.push(check('density', 'bad', 'The keyword never appears in the text', '', `Use "${keywordRaw}" naturally a few times.`));
  else if (density > 3) c.push(check('density', 'warn', `Keyword used a lot (${density}% of words)`, 'Over about 3% can read as stuffing.', 'Use synonyms and related words instead of repeating.'));
  else c.push(check('density', 'good', `Keyword used ${occurrences} time${occurrences === 1 ? '' : 's'} (${density}%)`, '', ''));
  if (read.level === 'hard') c.push(check('read', 'warn', 'Text is hard to read', `Average sentence is ${read.avgSentenceWords} words${read.flesch !== null ? `, reading ease ${read.flesch}` : ''}.`, 'Shorten sentences and use simpler words.'));
  else if (read.level !== 'unknown') c.push(check('read', 'good', 'Text is easy to read', `Average sentence is ${read.avgSentenceWords} words.`, ''));
  if (facts.images.missingAlt > 0) c.push(check('imgalt', 'warn', `${facts.images.missingAlt} image${facts.images.missingAlt === 1 ? '' : 's'} without a description`, '', 'Add alt text to every meaningful image.'));
  if (!facts.viewport) c.push(check('viewport', 'bad', 'Not set up for phones', 'No viewport tag found.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'));
  if (facts.noindex) c.push(check('noindex', 'bad', 'The page tells Google not to index it', '', 'Remove the noindex tag if you want it to rank.'));

  const weight: Record<string, number> = { title: 18, h1: 14, description: 8, url: 6, intro: 8, h2: 6, alt: 3, length: 12, density: 10, read: 5, imgalt: 3, viewport: 5, noindex: 20 };
  let earned = 0; let total = 0;
  for (const k of c) { const w = weight[k.id] ?? 0; total += w; earned += k.status === 'good' ? w : k.status === 'warn' ? w * 0.5 : 0; }
  const score = total ? Math.round((earned / total) * 100) : 0;

  let related: OnPageReport['related'] = null;
  if (competitorTexts.length > 0) {
    const gap = topicGap(text, competitorTexts, 20);
    related = { missing: gap.missing.map(({ term, competitors, avgCount }) => ({ term, competitors, avgCount })), note: 'Words that competitor pages you supplied use and this page does not.' };
  }
  return { url: pageUrl, keyword: keywordRaw, score, facts: { title: facts.title, description: facts.description, h1: facts.h1, wordCount: words, urlPath }, placement, occurrences, density, readability: read, checks: c, related };
}
