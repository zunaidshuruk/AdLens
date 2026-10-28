/**
 * AI visibility (Sprint 43): ask an AI assistant the questions your customers ask, then record whether it names your brand,
 * where, how warmly, and which websites it points to. Honest limit: this is one assistant answering as it normally would,
 * not a live look at ChatGPT or Perplexity (connect your own agent key to test another assistant); wording changes between runs.
 */
import { z } from 'zod';
import { countPhrase, tokenise } from '../../src/utils/textStats.js';
import { ProviderError, type AgentProvider } from './agentProviders.js';

export const PROMPT_SYSTEM = [
  'You are a helpful assistant. Answer the user\'s question the way you normally would for a person searching for advice or recommendations.',
  'Be concrete: when the question asks for options, name specific products, companies or websites you know of, with a short reason for each. Do not invent facts; if you are not sure, say so.',
  'Keep the answer under 250 words.',
].join('\n');

export const promptsInputSchema = z.object({ texts: z.array(z.string().trim().min(8, 'Each question needs at least 8 characters').max(200)).min(1, 'Add at least one question').max(30) });
export const settingsInputSchema = z.object({ competitors: z.array(z.string().trim().min(2).max(60)).max(10) });

const POSITIVE = ['best', 'great', 'excellent', 'reliable', 'trusted', 'leading', 'popular', 'recommended', 'easy', 'affordable', 'powerful', 'fast', 'secure', 'top', 'strong', 'ideal', 'robust', 'flexible'];
const NEGATIVE = ['worst', 'poor', 'expensive', 'unreliable', 'slow', 'limited', 'complaints', 'lacks', 'lacking', 'difficult', 'avoid', 'issues', 'problems', 'buggy', 'outdated', 'confusing', 'costly', 'weak'];

export interface EntityMention { name: string; mentioned: boolean }
export interface Analysis {
  mentioned: boolean; rank: number | null; competitors: EntityMention[];
  sentiment: 'positive' | 'neutral' | 'negative' | null; sources: string[]; citedOwn: boolean; excerpt: string;
}

const firstIndex = (text: string, term: string): number => {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
  const m = re.exec(text);
  return m ? m.index + m[1]!.length : -1;
};

export function extractSources(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]"']+/gi)) { try { out.add(new URL(m[0]).hostname.replace(/^www\./, '').toLowerCase()); } catch { /* ignore */ } }
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|info|edu|gov|bd|uk|in|us|ca|au|de|fr|es|nl)(?:\.[a-z]{2})?)\b/gi)) out.add(m[1]!.toLowerCase().replace(/^www\./, ''));
  return [...out].slice(0, 20);
}

export function analyseAnswer(text: string, brandTerms: string[], competitors: string[], ownDomain?: string | null): Analysis {
  const brands = brandTerms.map((b) => b.trim()).filter((b) => b.length >= 2);
  const found: { name: string; at: number; own: boolean }[] = [];
  for (const b of brands) { const i = firstIndex(text, b); if (i >= 0) found.push({ name: b, at: i, own: true }); }
  const own = found.length ? found.reduce((a, b) => (b.at < a.at ? b : a)) : null;
  const others = competitors.map((c) => ({ name: c, at: firstIndex(text, c) }));
  const ranked = [...(own ? [{ name: 'brand', at: own.at }] : []), ...others.filter((o) => o.at >= 0)].sort((a, b) => a.at - b.at);
  const rank = own ? ranked.findIndex((r) => r.name === 'brand') + 1 : null;
  let sentiment: Analysis['sentiment'] = null;
  if (own) {
    const sentences = text.split(/(?<=[.!?\n])\s+/).filter((s) => brands.some((b) => firstIndex(s, b) >= 0));
    let score = 0;
    for (const s of sentences) { const t = tokenise(s); score += t.filter((w) => POSITIVE.includes(w)).length - t.filter((w) => NEGATIVE.includes(w)).length; }
    sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  }
  const sources = extractSources(text);
  const dom = (ownDomain ?? '').toLowerCase().replace(/^www\./, '');
  return {
    mentioned: Boolean(own), rank, competitors: others.map((o) => ({ name: o.name, mentioned: o.at >= 0 })), sentiment, sources,
    citedOwn: Boolean(dom) && sources.some((s) => s === dom || s.endsWith(`.${dom}`)), excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 600),
  };
}

export type AskOutcome = { ok: true; text: string } | { ok: false; code: 'PROVIDER_ERROR' | 'EMPTY'; message: string; providerCode?: string };
export async function askEngine(question: string, provider: AgentProvider): Promise<AskOutcome> {
  try {
    const turn = await provider.complete({ systemPrompt: PROMPT_SYSTEM, messages: [{ role: 'user', content: question }], tools: [] });
    const text = turn.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 6000);
    if (!text) return { ok: false, code: 'EMPTY', message: 'The AI did not return an answer.' };
    return { ok: true, text };
  } catch (err) {
    if (err instanceof ProviderError) return { ok: false, code: 'PROVIDER_ERROR', message: err.message, providerCode: err.code };
    return { ok: false, code: 'PROVIDER_ERROR', message: 'The AI could not be reached.' };
  }
}

export interface RunRecord { id: string; promptId: string; engine: string; at: string; analysis: Analysis }
export function summariseRuns(latest: (RunRecord | null)[]): { run: number; visibility: number; shareOfVoice: number | null; citedOwn: number; sentiment: { positive: number; neutral: number; negative: number } } {
  const runs = latest.filter((r): r is RunRecord => r !== null);
  const mentioned = runs.filter((r) => r.analysis.mentioned);
  let brand = 0; let total = 0;
  for (const r of runs) { const c = r.analysis.competitors.filter((x) => x.mentioned).length; brand += r.analysis.mentioned ? 1 : 0; total += c + (r.analysis.mentioned ? 1 : 0); }
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const r of mentioned) if (r.analysis.sentiment) sentiment[r.analysis.sentiment]++;
  return { run: runs.length, visibility: runs.length ? Math.round((mentioned.length / runs.length) * 100) : 0, shareOfVoice: total ? Math.round((brand / total) * 100) : null, citedOwn: runs.filter((r) => r.analysis.citedOwn).length, sentiment };
}
