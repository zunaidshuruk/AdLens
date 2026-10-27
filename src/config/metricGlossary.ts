/**
 * Plain-language definitions for every metric AdLens shows (Sprint 8: the "i" tooltip on each KPI,
 * and context for the AI analyst). One place to keep wording accurate and consistent.
 *
 * `better` tells the UI which direction is good, so cost metrics going up are shown in red.
 */

export type MetricSource = 'ga4' | 'search_console' | 'meta' | 'adlens';
export type BetterDirection = 'higher' | 'lower' | 'neutral';

export interface MetricInfo {
  label: string;
  definition: string;
  formula?: string;
  source: MetricSource;
  better: BetterDirection;
  /** Extra detail that prevents common misreadings. */
  note?: string;
  /** Other names this metric appears under in tables and charts. */
  aliases: string[];
}

export const METRIC_GLOSSARY: Record<string, MetricInfo> = {
  sessions: {
    label: 'Sessions',
    definition: 'Visits to your website. A session ends after 30 minutes without activity, so one person can have several sessions.',
    source: 'ga4', better: 'higher',
    aliases: ['total sessions', 'visits'],
  },
  views: {
    label: 'Views',
    definition: 'How many times a page was opened or reloaded. One visitor can open the same page several times.',
    source: 'ga4', better: 'higher',
    aliases: ['page views', 'pageviews', 'screen page views'],
  },
  users: {
    label: 'Users',
    definition: 'Distinct people who visited and engaged with your site in the period.',
    note: 'GA4 counts active users by default. The same person on two devices counts twice.',
    source: 'ga4', better: 'higher',
    aliases: ['active users', 'total users', 'visitors'],
  },
  newUsers: {
    label: 'New users',
    definition: 'People visiting your site for the first time (no earlier visit recorded by GA4).',
    source: 'ga4', better: 'higher',
    aliases: ['new visitors'],
  },
  engagedSessions: {
    label: 'Engaged sessions',
    definition: 'Sessions that lasted at least 10 seconds, included a key event, or had two or more page views.',
    source: 'ga4', better: 'higher',
    aliases: ['engaged visits'],
  },
  engagementRate: {
    label: 'Engagement rate',
    definition: 'The share of sessions that were engaged.',
    formula: 'engaged sessions ÷ sessions',
    note: 'The opposite of bounce rate: a 60% engagement rate means a 40% bounce rate.',
    source: 'ga4', better: 'higher',
    aliases: ['engagement %'],
  },
  avgEngagementTime: {
    label: 'Average engagement time',
    definition: 'How long your site was in the foreground of the visitor’s browser, on average per active user.',
    formula: 'total engagement time ÷ active users',
    source: 'ga4', better: 'higher',
    aliases: ['avg engagement time', 'engagement time', 'avg. engagement time'],
  },
  keyEvents: {
    label: 'Key events',
    definition: 'Actions you marked as important in GA4, such as demo requests, sign-ups or purchases. GA4’s new name for “conversions”.',
    source: 'ga4', better: 'higher',
    aliases: ['conversions', 'goal conversions', 'goals', 'key event count'],
  },
  keyEventRate: {
    label: 'Key event rate',
    definition: 'How often a session leads to a key event.',
    formula: 'key events ÷ sessions',
    note: 'A session can contain more than one key event, so this can slightly overstate the share of sessions that converted.',
    source: 'adlens', better: 'higher',
    aliases: ['conversion rate'],
  },
  aiSessions: {
    label: 'AI assistant sessions',
    definition: 'Visits that arrived from AI assistants such as ChatGPT, Perplexity, Gemini, Claude or Copilot.',
    note: 'Only visits that carry a referrer or UTM tag are recognised. Untagged AI visits appear as Direct, so the real number may be higher.',
    source: 'adlens', better: 'higher',
    aliases: ['ai sessions', 'ai traffic', 'ai referral sessions'],
  },
  aiShare: {
    label: 'AI share of sessions',
    definition: 'The proportion of all sessions that came from AI assistants.',
    formula: 'AI assistant sessions ÷ all sessions',
    source: 'adlens', better: 'higher',
    aliases: ['ai share', 'share of sessions', 'ai share of all sessions'],
  },
  aiKeyEvents: {
    label: 'Key events from AI',
    definition: 'Key events (the actions you track as goals, such as a sign-up or a form submission) completed by visitors who arrived from AI assistants.',
    note: 'Only visits recognised as AI traffic are counted, so the real number may be higher.',
    source: 'adlens', better: 'higher',
    aliases: ['key events from ai', 'ai key events', 'ai conversions'],
  },
  searchClicks: {
    label: 'Clicks (Search)',
    definition: 'Times someone clicked through to your site from Google Search results.',
    note: 'Not the same as Meta “link clicks”, which count clicks on your ads.',
    source: 'search_console', better: 'higher',
    aliases: ['organic search clicks', 'search clicks', 'gsc clicks', 'organic clicks'],
  },
  searchImpressions: {
    label: 'Impressions (Search)',
    definition: 'Times a link to your site appeared in Google Search results, whether or not it was scrolled into view or clicked.',
    source: 'search_console', better: 'higher',
    aliases: ['search impressions', 'gsc impressions', 'total impressions'],
  },
  searchCtr: {
    label: 'Click-through rate (Search)',
    definition: 'How often people who saw your site in search results clicked it.',
    formula: 'clicks ÷ impressions',
    source: 'search_console', better: 'higher',
    aliases: ['search ctr', 'organic ctr', 'avg ctr', 'average ctr'],
  },
  position: {
    label: 'Average position',
    definition: 'Where your site typically ranks in search results. 1 is the top result.',
    note: 'An average across everything people searched, so a few very high or very low rankings can move it. Lower is better.',
    source: 'search_console', better: 'lower',
    aliases: ['avg position', 'average position', 'avg. position', 'ranking', 'avg. search position', 'average search position'],
  },
  spend: {
    label: 'Spend',
    definition: 'Money spent on ads in the period, in the ad account’s currency.',
    source: 'meta', better: 'neutral',
    note: 'Spending more is not good or bad by itself; judge it against results.',
    aliases: ['ad spend', 'amount spent', 'cost', 'total spend', 'meta ad spend'],
  },
  impressions: {
    label: 'Impressions (Ads)',
    definition: 'Times your ads were shown on screen. One person can see an ad several times.',
    source: 'meta', better: 'higher',
    aliases: ['ad impressions', 'meta impressions'],
  },
  reach: {
    label: 'Reach',
    definition: 'Distinct people who saw your ads at least once.',
    note: 'Reach cannot be added up across days or campaigns, because the same person may be counted in each.',
    source: 'meta', better: 'higher',
    aliases: ['people reached', 'unique reach'],
  },
  frequency: {
    label: 'Frequency',
    definition: 'How many times, on average, each person saw your ads.',
    formula: 'impressions ÷ reach',
    note: 'Very high frequency can mean ad fatigue. Neither higher nor lower is automatically better.',
    source: 'meta', better: 'neutral',
    aliases: ['avg frequency', 'ad frequency'],
  },
  linkClicks: {
    label: 'Link clicks',
    definition: 'Clicks on links in your ads that take people to your website or another destination.',
    note: 'Meta’s “all clicks” also include likes, shares and profile clicks, so it is higher. AdLens uses link clicks, like Ads Manager’s default columns.',
    source: 'meta', better: 'higher',
    aliases: ['clicks', 'ad clicks', 'meta clicks'],
  },
  adCtr: {
    label: 'Click-through rate (Ads)',
    definition: 'How often people who saw your ad clicked its link.',
    formula: 'link clicks ÷ impressions',
    source: 'meta', better: 'higher',
    aliases: ['ctr', 'link ctr', 'meta ctr'],
  },
  cpc: {
    label: 'Cost per link click (CPC)',
    definition: 'What each click on an ad link cost you, on average.',
    formula: 'spend ÷ link clicks',
    source: 'meta', better: 'lower',
    aliases: ['cost per click', 'cpc (link)', 'cost per click (cpc)', 'cpc'],
  },
  cpm: {
    label: 'Cost per 1,000 impressions (CPM)',
    definition: 'What it cost to show your ads 1,000 times.',
    formula: 'spend ÷ impressions × 1,000',
    source: 'meta', better: 'lower',
    aliases: ['cost per mille', 'cost per 1000 impressions', 'cost per 1k impr. (cpm)', 'cpm'],
  },
  leads: {
    label: 'Leads',
    definition: 'People who submitted a lead form on Facebook or Instagram, or a lead event tracked on your website through the Meta Pixel.',
    source: 'meta', better: 'higher',
    aliases: ['ad leads', 'results', 'total leads', 'meta qualified leads'],
  },
  cpl: {
    label: 'Cost per lead (CPL)',
    definition: 'What each lead cost you, on average.',
    formula: 'spend ÷ leads',
    source: 'meta', better: 'lower',
    aliases: ['cost per lead', 'cost / lead'],
  },
  landingRate: {
    label: 'Landing rate',
    definition: 'The share of ad link clicks that turned into a visit recorded by Google Analytics.',
    formula: 'GA4 sessions from the campaign ÷ link clicks',
    note: 'Well below 100% is normal, but a very low rate can point to slow pages, broken links, or visitors leaving before the tracking loads.',
    source: 'adlens', better: 'higher',
    aliases: ['click-to-session rate'],
  },
  costPerEngagedSession: {
    label: 'Cost per engaged session',
    definition: 'What each engaged website visit from your ads cost.',
    formula: 'spend ÷ engaged sessions from the campaign',
    source: 'adlens', better: 'lower',
    aliases: ['cost per engaged visit'],
  },
  costPerKeyEvent: {
    label: 'Cost per key event',
    definition: 'What each key event (such as a demo request) from your ads cost, using Google Analytics results.',
    formula: 'spend ÷ key events from the campaign',
    source: 'adlens', better: 'lower',
    aliases: ['cost per conversion', 'cost per key event'],
  },
  changeVsPrevious: {
    label: 'Change vs previous period',
    definition: 'How much a number moved compared with the period of the same length just before the selected one.',
    formula: '(this period − previous period) ÷ previous period',
    note: 'Compared with zero, a change cannot be shown as a percentage.',
    source: 'adlens', better: 'neutral',
    aliases: ['% change', 'vs previous period', 'change'],
  },
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').trim();

const ALIAS_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [key, info] of Object.entries(METRIC_GLOSSARY)) {
    for (const name of [key, info.label, ...info.aliases]) m.set(norm(name), key);
  }
  return m;
})();

export function getMetricInfo(key: string): MetricInfo | null {
  return METRIC_GLOSSARY[key] ?? null;
}

/** Finds the glossary key for a label shown in the UI ("Total Sessions", "Avg. Position", "CPL"). */
export function findMetricKey(label: string, hint?: MetricSource): string | null {
  const n = norm(label);
  const hit = ALIAS_INDEX.get(n);
  if (hit && (!hint || METRIC_GLOSSARY[hit].source === hint || METRIC_GLOSSARY[hit].source === 'adlens')) return hit;
  // "clicks" and "impressions" mean different things per source: use the hint to choose.
  if (hint === 'search_console') {
    if (n === 'clicks') return 'searchClicks';
    if (n === 'impressions') return 'searchImpressions';
    if (n === 'ctr' || n === 'click through rate ctr' || n === 'click through rate') return 'searchCtr';
  }
  if (hint === 'meta') {
    if (n === 'clicks') return 'linkClicks';
    if (n === 'impressions') return 'impressions';
    if (n === 'ctr' || n === 'click through rate ctr' || n === 'click through rate') return 'adCtr';
  }
  return hit ?? null;
}

/** True when a rise is bad news (costs, ranking position), so the UI shows it in red. */
export function isLowerBetter(key: string): boolean {
  return METRIC_GLOSSARY[key]?.better === 'lower';
}
