/**
 * Traffic source classification for AdLens (Sprint 6).
 *
 * Pure functions, no network calls. Input is GA4's sessionSource / sessionMedium
 * (and optionally sessionDefaultChannelGroup). Output is one AdLens source group,
 * plus the AI assistant name when the visit came from a known AI assistant.
 *
 * IMPORTANT LIMITATION (show this in the UI): AI attribution relies on the referrer
 * or UTM tags. AI visits without either arrive as "(direct) / (none)" and are
 * counted as Direct / unknown, not as AI.
 */

export const AI_DOMAIN_LIST_VERSION = '2026-10-18';

export interface AiAssistantDefinition {
  name: string;
  /** Hostnames (matched exactly or as a parent domain). */
  domains: string[];
  /** Bare source names sometimes used in utm_source (matched exactly). */
  aliases?: string[];
}

/**
 * Known AI assistants. Order matters only for display. Keep domains specific:
 * e.g. gemini.google.com, NOT google.com (which is search).
 */
export const AI_ASSISTANTS: AiAssistantDefinition[] = [
  { name: 'ChatGPT', domains: ['chatgpt.com', 'chat.openai.com'], aliases: ['chatgpt', 'openai'] },
  { name: 'Perplexity', domains: ['perplexity.ai'], aliases: ['perplexity'] },
  { name: 'Gemini', domains: ['gemini.google.com', 'bard.google.com'], aliases: ['gemini', 'bard'] },
  { name: 'Claude', domains: ['claude.ai'], aliases: ['claude', 'anthropic'] },
  {
    name: 'Copilot',
    domains: ['copilot.microsoft.com', 'copilot.cloud.microsoft', 'm365copilot.com'],
    aliases: ['copilot'],
  },
  { name: 'DeepSeek', domains: ['chat.deepseek.com', 'deepseek.com'], aliases: ['deepseek'] },
  { name: 'Meta AI', domains: ['meta.ai'], aliases: ['meta.ai', 'metaai'] },
  { name: 'Grok', domains: ['grok.com', 'x.ai'], aliases: ['grok'] },
  { name: 'Mistral Le Chat', domains: ['chat.mistral.ai'], aliases: ['lechat', 'mistral'] },
  { name: 'You.com', domains: ['you.com'], aliases: ['you.com'] },
  { name: 'Poe', domains: ['poe.com'], aliases: ['poe'] },
  { name: 'Phind', domains: ['phind.com'], aliases: ['phind'] },
  { name: 'NotebookLM', domains: ['notebooklm.google.com'], aliases: ['notebooklm'] },
  { name: 'Qwen', domains: ['chat.qwen.ai', 'qwen.ai'], aliases: ['qwen'] },
  { name: 'Kimi', domains: ['kimi.moonshot.cn', 'kimi.com'], aliases: ['kimi'] },
];

export type SourceGroup =
  | 'AI assistants'
  | 'Search'
  | 'Social'
  | 'Email'
  | 'Referral'
  | 'Paid'
  | 'Direct / unknown'
  | 'Other';

export const SOURCE_GROUPS: SourceGroup[] = [
  'AI assistants',
  'Search',
  'Social',
  'Email',
  'Referral',
  'Paid',
  'Direct / unknown',
  'Other',
];

const SEARCH_ENGINES = [
  'google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex', 'ecosia', 'naver',
  'brave', 'search.brave.com', 'startpage', 'qwant', 'seznam', 'sogou', 'aol',
];

const SOCIAL_SOURCES = [
  'facebook', 'fb', 'instagram', 'ig', 'linkedin', 'lnkd.in', 't.co', 'twitter', 'x', 'x.com',
  'youtube', 'tiktok', 'pinterest', 'reddit', 'quora', 'threads', 'threads.net',
  'whatsapp', 'messenger', 'telegram', 'snapchat', 'tumblr', 'medium', 'discord',
];

const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|cpa|cpp|paid|paid[-_ ]?\w*|\w*[-_ ]?paid|display|banner|retargeting|remarketing|ads?)$/;
const EMAIL_MEDIUM = /^(e[-_ ]?mail|newsletter|mailchimp|email[-_ ]?\w*)$/;
const SOCIAL_MEDIUM = /^(social|sm|social[-_ ]?(network|media)|organic[-_ ]?social)$/;

/** Lowercase, strip protocol, "www.", path, port and trailing dots. */
export function normalizeSource(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split('/')[0].split('?')[0].split(':')[0];
  s = s.replace(/^www\./, '').replace(/^m\./, '').replace(/^l\./, '').replace(/^lm\./, '');
  return s.replace(/\.+$/, '');
}

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Returns the AI assistant name for a GA4 session source, or null. */
export function matchAiAssistant(source: string | undefined | null): string | null {
  const host = normalizeSource(source);
  if (!host || host === '(direct)' || host === '(not set)') return null;
  for (const a of AI_ASSISTANTS) {
    if (a.domains.some((d) => domainMatches(host, d))) return a.name;
    if (a.aliases?.includes(host)) return a.name;
  }
  return null;
}

function matchesList(host: string, list: string[]): boolean {
  const firstLabel = host.split('.')[0];
  return list.some((entry) =>
    entry.includes('.') ? domainMatches(host, entry) : host === entry || firstLabel === entry
  );
}

export interface SourceClassification {
  group: SourceGroup;
  aiAssistant: string | null;
}

/**
 * Classify one GA4 session. Rule order (first match wins):
 * 1. AI assistants: source matches the AI domain list
 * 2. Paid: paid-type medium (cpc, paid_social, display…) or a "Paid …" GA4 channel group
 * 3. Email: email-type medium or source
 * 4. Search: medium "organic", or a search-engine source
 * 5. Social: social medium, a social source, or GA4 "Organic Social" channel group
 * 6. Direct / unknown: (direct)/(none), or source and medium both (not set)/empty
 * 7. Referral: medium "referral"
 * 8. Other: anything else (e.g. custom UTM mediums)
 */
export function classifySource(
  source: string | undefined | null,
  medium: string | undefined | null,
  channelGroup?: string | null
): SourceClassification {
  const host = normalizeSource(source);
  const med = (medium ?? '').trim().toLowerCase();
  const channel = (channelGroup ?? '').trim().toLowerCase();

  const ai = matchAiAssistant(source);
  if (ai) return { group: 'AI assistants', aiAssistant: ai };

  if (PAID_MEDIUM.test(med) || channel.startsWith('paid') || channel === 'display' || channel === 'cross-network') {
    return { group: 'Paid', aiAssistant: null };
  }
  if (EMAIL_MEDIUM.test(med) || host === 'email' || host.includes('mail.') || channel === 'email') {
    return { group: 'Email', aiAssistant: null };
  }
  if (med === 'organic' || channel === 'organic search' || (host && matchesList(host, SEARCH_ENGINES) && (med === 'referral' || med === '' || med === '(none)'))) {
    return { group: 'Search', aiAssistant: null };
  }
  if (SOCIAL_MEDIUM.test(med) || channel === 'organic social' || (host && matchesList(host, SOCIAL_SOURCES))) {
    return { group: 'Social', aiAssistant: null };
  }
  const unset = (v: string) => v === '' || v === '(not set)' || v === '(none)';
  if (host === '(direct)' || (unset(host) && unset(med))) {
    return { group: 'Direct / unknown', aiAssistant: null };
  }
  if (med === 'referral' || channel === 'referral') {
    return { group: 'Referral', aiAssistant: null };
  }
  return { group: 'Other', aiAssistant: null };
}

/** Human-readable rules, to show under the Source groups chart and in AI tool output. */
export const SOURCE_GROUP_RULES = [
  'AI assistants: session source matches the AdLens AI domain list (version ' + AI_DOMAIN_LIST_VERSION + ').',
  'Paid: UTM medium such as cpc, ppc, cpm, paid_social or display, or a GA4 "Paid" channel.',
  'Email: UTM medium email or newsletter.',
  'Search: medium organic, or a search engine source (Google, Bing, DuckDuckGo…).',
  'Social: social medium, or a social network source (Facebook, LinkedIn, YouTube, X…).',
  'Direct / unknown: no source information. Untagged AI visits also land here.',
  'Referral: links from other websites.',
  'Other: anything else, usually custom UTM mediums.',
];

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

export interface SourceMetricsRow {
  source: string;
  medium: string;
  channelGroup?: string;
  landingPage?: string;
  date?: string;
  sessions: number;
  activeUsers?: number;
  newUsers?: number;
  engagedSessions: number;
  keyEvents: number;
}

export interface GroupTotals {
  group: SourceGroup;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  sharePercent: number;
  keyEventRate: number;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Sessions per source group (all 8 groups returned, zero-filled, sorted by sessions). */
export function aggregateBySourceGroup(rows: SourceMetricsRow[]): GroupTotals[] {
  const acc = new Map<SourceGroup, { sessions: number; engagedSessions: number; keyEvents: number }>();
  for (const g of SOURCE_GROUPS) acc.set(g, { sessions: 0, engagedSessions: 0, keyEvents: 0 });
  let total = 0;
  for (const r of rows) {
    const { group } = classifySource(r.source, r.medium, r.channelGroup);
    const t = acc.get(group)!;
    t.sessions += r.sessions;
    t.engagedSessions += r.engagedSessions;
    t.keyEvents += r.keyEvents;
    total += r.sessions;
  }
  return SOURCE_GROUPS.map((group) => {
    const t = acc.get(group)!;
    return {
      group,
      ...t,
      sharePercent: pct(t.sessions, total),
      keyEventRate: pct(t.keyEvents, t.sessions),
    };
  }).sort((a, b) => b.sessions - a.sessions);
}

export interface AiReferralTotals {
  assistant: string;
  sessions: number;
  activeUsers: number;
  newUsers: number;
  engagedSessions: number;
  keyEvents: number;
  keyEventRate: number;
  shareOfAiPercent: number;
  shareOfAllSessionsPercent: number;
}

export interface AiReferralSummary {
  listVersion: string;
  totalSessions: number;
  aiSessions: number;
  aiSharePercent: number;
  byAssistant: AiReferralTotals[];
  byLandingPage: { landingPage: string; sessions: number; keyEvents: number; topAssistant: string }[];
  byDate: { date: string; sessions: number }[];
}

/**
 * AI referral summary from GA4 rows (dimensions: sessionSource, sessionMedium, and optionally
 * landingPage or date). totalSessions should come from an unfiltered total for the same range.
 */
export function summarizeAiReferrals(rows: SourceMetricsRow[], totalSessions: number): AiReferralSummary {
  const byAssistant = new Map<string, Omit<AiReferralTotals, 'assistant' | 'keyEventRate' | 'shareOfAiPercent' | 'shareOfAllSessionsPercent'>>();
  const byPage = new Map<string, { sessions: number; keyEvents: number; perAssistant: Map<string, number> }>();
  const byDate = new Map<string, number>();
  let aiSessions = 0;

  for (const r of rows) {
    const assistant = matchAiAssistant(r.source);
    if (!assistant) continue;
    aiSessions += r.sessions;

    const a = byAssistant.get(assistant) ?? { sessions: 0, activeUsers: 0, newUsers: 0, engagedSessions: 0, keyEvents: 0 };
    a.sessions += r.sessions;
    a.activeUsers += r.activeUsers ?? 0;
    a.newUsers += r.newUsers ?? 0;
    a.engagedSessions += r.engagedSessions;
    a.keyEvents += r.keyEvents;
    byAssistant.set(assistant, a);

    if (r.landingPage) {
      const p = byPage.get(r.landingPage) ?? { sessions: 0, keyEvents: 0, perAssistant: new Map() };
      p.sessions += r.sessions;
      p.keyEvents += r.keyEvents;
      p.perAssistant.set(assistant, (p.perAssistant.get(assistant) ?? 0) + r.sessions);
      byPage.set(r.landingPage, p);
    }
    if (r.date) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.sessions);
  }

  return {
    listVersion: AI_DOMAIN_LIST_VERSION,
    totalSessions,
    aiSessions,
    aiSharePercent: pct(aiSessions, totalSessions),
    byAssistant: [...byAssistant.entries()]
      .map(([assistant, t]) => ({
        assistant,
        ...t,
        keyEventRate: pct(t.keyEvents, t.sessions),
        shareOfAiPercent: pct(t.sessions, aiSessions),
        shareOfAllSessionsPercent: pct(t.sessions, totalSessions),
      }))
      .sort((a, b) => b.sessions - a.sessions),
    byLandingPage: [...byPage.entries()]
      .map(([landingPage, p]) => ({
        landingPage,
        sessions: p.sessions,
        keyEvents: p.keyEvents,
        topAssistant: [...p.perAssistant.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '',
      }))
      .sort((a, b) => b.sessions - a.sessions),
    byDate: [...byDate.entries()].map(([date, sessions]) => ({ date, sessions })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
