/** Small text measures shared by the server checks and the in-browser writing assistant (Sprint 42). Pure functions. */

export function tokenise(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

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

