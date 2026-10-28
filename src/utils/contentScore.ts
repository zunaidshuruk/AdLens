/** Live scoring for the writing assistant (Sprint 42). Pure, runs in the browser as you type. */
import { countPhrase, readability, tokenise, type Readability } from './textStats.js';

export interface WriteCheck { id: string; status: 'good' | 'warn' | 'bad'; title: string; fix: string }
export interface WriteScore { score: number; words: number; occurrences: number; density: number; headings: number; readability: Readability; termsUsed: number; termsTotal: number; checks: WriteCheck[] }

export function scoreWriting(text: string, opts: { keyword?: string; targetWords?: number; terms?: string[] } = {}): WriteScore {
  const keyword = (opts.keyword ?? '').trim();
  const words = tokenise(text).length;
  const lines = text.split('\n');
  const headings = lines.filter((l) => /^#{1,4}\s+\S/.test(l)).length;
  const body = lines.filter((l) => !/^#{1,4}\s/.test(l)).join('\n');
  const read = readability(body);
  const occurrences = keyword ? countPhrase(text, keyword) : 0;
  const density = keyword && words ? Math.round(((occurrences * tokenise(keyword).length) / words) * 10000) / 100 : 0;
  const first100 = tokenise(text).slice(0, 100).join(' ');
  const terms = (opts.terms ?? []).filter(Boolean);
  const termsUsed = terms.filter((t) => countPhrase(text, t) > 0).length;
  const target = opts.targetWords && opts.targetWords > 0 ? opts.targetWords : 800;
  const c: (WriteCheck & { w: number })[] = [];
  const add = (id: string, status: WriteCheck['status'], title: string, fix: string, w: number) => c.push({ id, status, title, fix, w });

  if (words === 0) add('length', 'bad', 'Nothing written yet', 'Start typing or paste your draft.', 25);
  else if (words < target * 0.5) add('length', 'bad', `${words} words, aim for about ${target}`, 'Add sections that answer the questions readers have.', 25);
  else if (words < target * 0.85) add('length', 'warn', `${words} words, aim for about ${target}`, 'A little more depth would help.', 25);
  else add('length', 'good', `${words} words, a good length`, '', 25);

  if (keyword) {
    if (occurrences === 0) add('kw', 'bad', 'The keyword is not in the text', `Use "${keyword}" naturally a few times.`, 20);
    else if (density > 3) add('kw', 'warn', `Keyword used ${occurrences}× (${density}%), a bit much`, 'Swap some for synonyms.', 20);
    else add('kw', 'good', `Keyword used ${occurrences}× (${density}%)`, '', 20);
    add('intro', countPhrase(first100, keyword) > 0 ? 'good' : 'warn', countPhrase(first100, keyword) > 0 ? 'Keyword is in the opening' : 'Keyword is not in the first 100 words', `Mention "${keyword}" early.`, 10);
    const inHeading = lines.some((l) => /^#{1,4}\s/.test(l) && countPhrase(l, keyword) > 0);
    add('hkw', inHeading ? 'good' : 'warn', inHeading ? 'Keyword is in a heading' : 'No heading contains the keyword', `Put "${keyword}" in the title or one heading.`, 8);
  }
  add('headings', headings >= Math.max(2, Math.floor(words / 300)) ? 'good' : words < 150 ? 'good' : 'warn', headings ? `${headings} heading${headings === 1 ? '' : 's'}` : 'No headings', 'Break the text up with "## " headings every few paragraphs.', 12);
  if (read.level === 'hard') add('read', 'warn', `Hard to read (${read.avgSentenceWords} words a sentence)`, 'Shorten long sentences and use simpler words.', 15);
  else if (read.level === 'unknown') add('read', 'good', 'Reading level shows once you write a few sentences', '', 15);
  else add('read', 'good', `Easy to read (${read.avgSentenceWords} words a sentence)`, '', 15);
  const longSentences = body.split(/(?<=[.!?।])\s+/).filter((s) => tokenise(s).length > 35).length;
  if (longSentences > 0) add('long', 'warn', `${longSentences} very long sentence${longSentences === 1 ? '' : 's'}`, 'Split sentences over 35 words.', 5);
  if (terms.length) add('terms', termsUsed / terms.length >= 0.6 ? 'good' : termsUsed / terms.length >= 0.3 ? 'warn' : 'bad', `${termsUsed} of ${terms.length} related words used`, 'Work in more of the related words where they fit.', 10);

  let earned = 0; let total = 0;
  for (const k of c) { total += k.w; earned += k.status === 'good' ? k.w : k.status === 'warn' ? k.w * 0.5 : 0; }
  return { score: words === 0 ? 0 : Math.round((earned / total) * 100), words, occurrences, density, headings, readability: read, termsUsed, termsTotal: terms.length, checks: c.map(({ w: _w, ...rest }) => rest) };
}
