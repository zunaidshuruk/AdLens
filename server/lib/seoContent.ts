/**
 * Content toolkit helpers (Sprint 42): a content brief built from competitor pages, a topic map, and headline ideas.
 * No AI here: everything comes from the pages' own text and Google's suggestion list.
 */
import { tokenise } from '../../src/utils/textStats.js';
import { decodeEntities } from './seoPage.js';
import { clusterKeywords, type KeywordCluster } from './rankTracking.js';
import { topicGap, visibleText } from './seoTopics.js';

const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const QUESTION = /^(how to|how do|how does|how can|what is|what are|why do|why does|can you|should i|is it)\b/i;

export interface BriefPage { url: string; title: string | null; words: number; headings: string[] }
export interface ContentBrief {
  keyword: string;
  pages: BriefPage[];
  length: { median: number; min: number; max: number; recommended: number };
  outline: { text: string; pages: number }[];
  questions: string[];
  terms: { term: string; pages: number; avgCount: number }[];
  titles: string[];
}

export function pageOutline(html: string): { title: string | null; headings: string[]; text: string } {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1];
  const headings = [...clean.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => strip(m[2]!)).filter((h) => h.length >= 3 && h.length <= 140);
  return { title: title ? strip(title) : null, headings, text: visibleText(html) };
}

const headingKey = (h: string) => tokenise(h).filter((w) => w.length > 2).sort().join(' ');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };

export function buildBrief(keywordRaw: string, pages: { url: string; html: string }[]): ContentBrief {
  const keyword = keywordRaw.trim().toLowerCase();
  const parsed = pages.map((p) => ({ url: p.url, ...pageOutline(p.html) }));
  const words = parsed.map((p) => tokenise(p.text).length);
  const med = words.length ? median(words) : 0;
  const groups = new Map<string, { text: string; pages: Set<number>; first: number }>();
  parsed.forEach((p, pi) => p.headings.forEach((h, hi) => {
    const k = headingKey(h);
    if (!k) return;
    const g = groups.get(k) ?? { text: h, pages: new Set<number>(), first: hi };
    g.pages.add(pi); g.first = Math.min(g.first, hi);
    groups.set(k, g);
  }));
  const outline = [...groups.values()].sort((a, b) => b.pages.size - a.pages.size || a.first - b.first).slice(0, 12).map((g) => ({ text: g.text, pages: g.pages.size }));
  const questions: string[] = [];
  for (const p of parsed) for (const h of p.headings) if ((h.endsWith('?') || QUESTION.test(h)) && !questions.some((q) => headingKey(q) === headingKey(h))) questions.push(h);
  const kw = new Set(tokenise(keyword));
  const gap = topicGap('', parsed.map((p) => p.text), 40);
  const terms = gap.missing.filter((t) => !t.term.split(' ').every((w) => kw.has(w))).slice(0, 25).map(({ term, competitors, avgCount }) => ({ term, pages: competitors, avgCount }));
  return {
    keyword,
    pages: parsed.map((p, i) => ({ url: p.url, title: p.title, words: words[i]!, headings: p.headings.slice(0, 30) })),
    length: { median: med, min: words.length ? Math.min(...words) : 0, max: words.length ? Math.max(...words) : 0, recommended: Math.max(300, Math.round((med * 1.1) / 100) * 100) },
    outline, questions: questions.slice(0, 12), terms, titles: parsed.map((p) => p.title).filter((t): t is string => Boolean(t)),
  };
}

export interface TopicMap { topic: string; subtopics: KeywordCluster[]; questions: string[]; headlines: string[] }

export function headlineIdeas(topic: string, questions: string[] = []): string[] {
  const t = topic.trim();
  if (!t) return [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const out = [
    `${cap(t)}: a simple guide for beginners`,
    `The complete guide to ${t}`,
    `${cap(t)} mistakes to avoid`,
    `How to choose the right ${t}`,
    `${cap(t)}: what to know before you start`,
    `${cap(t)} compared: which one is right for you?`,
    `Your ${t} questions, answered`,
    `${cap(t)} checklist you can use today`,
  ];
  for (const q of questions.slice(0, 4)) out.push(cap(q.replace(/\?*$/, '')) + '?');
  return [...new Set(out)];
}

export function buildTopicMap(topic: string, ideas: { keyword: string; group: string }[]): TopicMap {
  const questions = ideas.filter((i) => i.group === 'questions').map((i) => i.keyword).slice(0, 15);
  const subtopics = clusterKeywords(ideas.map((i) => i.keyword), 2).filter((c) => c.name !== 'Other').slice(0, 12);
  return { topic: topic.trim().toLowerCase(), subtopics, questions, headlines: headlineIdeas(topic, questions) };
}
