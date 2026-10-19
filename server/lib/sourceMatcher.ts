/**
 * "Find sources by domain" for the project setup wizard (Sprint 8). Pure functions.
 *
 * The user types their website domain; AdLens ranks the GA4 properties and Search Console
 * sites their Google account can see, explains each match in plain English, and pre-selects
 * the best pair. The route layer supplies:
 *   - GA4 properties from accountSummaries, plus each property's web data stream URIs
 *     (GET properties/{id}/dataStreams → webStreamData.defaultUri)
 *   - Search Console sites from sites.list
 */

export interface GA4PropertyCandidateInput {
  propertyId: string;
  displayName: string;
  accountName?: string;
  /** Web data stream default URIs, e.g. ["https://www.acme.com"] */
  streamUris?: string[];
}

export interface SearchConsoleSiteInput {
  siteUrl: string; // "sc-domain:acme.com" or "https://www.acme.com/"
  permissionLevel?: string; // siteOwner | siteFullUser | siteRestrictedUser | siteUnverifiedUser
}

export type MatchStrength = 'exact' | 'strong' | 'partial' | 'weak';

export interface RankedGA4Property extends GA4PropertyCandidateInput {
  score: number;
  strength: MatchStrength;
  reasons: string[];
}

export interface RankedSearchConsoleSite extends SearchConsoleSiteInput {
  score: number;
  strength: MatchStrength;
  reasons: string[];
}

export interface SourceMatchResult {
  domain: string;
  ga4: RankedGA4Property[];
  searchConsole: RankedSearchConsoleSite[];
  suggested: { ga4PropertyId: string | null; searchConsoleSiteUrl: string | null };
  notes: string[];
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/** "https://www.Acme.com/pricing" → "acme.com". Returns '' for invalid input. */
export function normalizeDomain(input: string | undefined | null): string {
  if (!input) return '';
  let s = input.trim().toLowerCase();
  if (s.startsWith('sc-domain:')) s = s.slice('sc-domain:'.length);
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  s = s.replace(/^www\./, '').replace(/\.+$/, '');
  return /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(s) ? s : '';
}

/** First label of the registrable part, used for display-name matching: "acme.com" → "acme". */
export function brandLabel(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return parts[0] ?? '';
  // handle common two-part public suffixes such as .com.bd, .co.uk
  const secondLevel = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ac']);
  return secondLevel.has(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
}

function isSubdomainOf(host: string, domain: string): boolean {
  return host !== domain && host.endsWith(`.${domain}`);
}

function strengthFor(score: number): MatchStrength {
  if (score >= 90) return 'exact';
  if (score >= 60) return 'strong';
  if (score >= 30) return 'partial';
  return 'weak';
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreGA4Property(domain: string, p: GA4PropertyCandidateInput): RankedGA4Property {
  let score = 0;
  const reasons: string[] = [];
  const hosts = (p.streamUris ?? []).map(normalizeDomain).filter(Boolean);

  if (hosts.includes(domain)) {
    score = 100;
    reasons.push(`Its web data stream tracks ${domain}.`);
  } else if (hosts.some((h) => isSubdomainOf(h, domain))) {
    const sub = hosts.find((h) => isSubdomainOf(h, domain))!;
    score = 70;
    reasons.push(`Its web data stream tracks ${sub}, a subdomain of ${domain}.`);
  } else if (hosts.some((h) => isSubdomainOf(domain, h))) {
    const parent = hosts.find((h) => isSubdomainOf(domain, h))!;
    score = 65;
    reasons.push(`Its web data stream tracks ${parent}, which includes ${domain}.`);
  }

  const label = brandLabel(domain);
  const name = `${p.displayName} ${p.accountName ?? ''}`.toLowerCase();
  if (name.includes(domain)) {
    score = Math.max(score, 50) + (score > 0 ? 5 : 0);
    reasons.push(`Its name mentions ${domain}.`);
  } else if (label.length >= 3 && name.includes(label)) {
    score = Math.max(score, 35) + (score > 0 ? 3 : 0);
    reasons.push(`Its name mentions "${label}".`);
  }

  if (hosts.length === 0) reasons.push('No web data stream found, so it was matched by name only.');
  if (score === 0) reasons.push(`No sign that it tracks ${domain}.`);

  score = Math.min(score, 100);
  return { ...p, score, strength: strengthFor(score), reasons };
}

const PERMISSION_BONUS: Record<string, number> = {
  siteOwner: 3,
  siteFullUser: 2,
  siteRestrictedUser: 0,
};

export function scoreSearchConsoleSite(domain: string, s: SearchConsoleSiteInput): RankedSearchConsoleSite {
  let score = 0;
  const reasons: string[] = [];
  const isDomainProperty = s.siteUrl.toLowerCase().startsWith('sc-domain:');
  const host = normalizeDomain(s.siteUrl);
  const rawHost = s.siteUrl.toLowerCase().replace(/^[a-z-]+:(\/\/)?/, '').split('/')[0];

  if (isDomainProperty && host === domain) {
    score = 100;
    reasons.push(`Domain property for ${domain}, covering all subdomains and http/https.`);
  } else if (!isDomainProperty && host === domain) {
    score = 90;
    reasons.push(`URL-prefix property for ${rawHost}.`);
    if (s.siteUrl.toLowerCase().startsWith('http://')) {
      score -= 10;
      reasons.push('It uses http://, so https traffic may be missing.');
    }
  } else if (isDomainProperty && isSubdomainOf(domain, host)) {
    score = 80;
    reasons.push(`Domain property for ${host}, which includes ${domain}.`);
  } else if (isSubdomainOf(host, domain)) {
    score = 55;
    reasons.push(`Covers only ${host}, a subdomain of ${domain}.`);
  } else {
    reasons.push(`Does not cover ${domain}.`);
  }

  if (score > 0) {
    const bonus = PERMISSION_BONUS[s.permissionLevel ?? ''] ?? 0;
    score = Math.min(100, score + bonus);
    if (s.permissionLevel === 'siteRestrictedUser') {
      reasons.push('You have restricted access; some reports may be limited.');
    }
  }

  return { ...s, score, strength: strengthFor(score), reasons };
}

// ---------------------------------------------------------------------------
// Ranking + suggestion
// ---------------------------------------------------------------------------

const SUGGEST_THRESHOLD = 60;

export function matchSourcesForDomain(
  domainInput: string,
  ga4Properties: GA4PropertyCandidateInput[],
  searchConsoleSites: SearchConsoleSiteInput[]
): SourceMatchResult {
  const domain = normalizeDomain(domainInput);
  if (!domain) {
    return {
      domain: '',
      ga4: [],
      searchConsole: [],
      suggested: { ga4PropertyId: null, searchConsoleSiteUrl: null },
      notes: ['Enter a website domain such as example.com.'],
    };
  }

  const ga4 = ga4Properties
    .map((p) => scoreGA4Property(domain, p))
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  const searchConsole = searchConsoleSites
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => scoreSearchConsoleSite(domain, s))
    .sort((a, b) => b.score - a.score || a.siteUrl.localeCompare(b.siteUrl));

  const notes: string[] = [];
  const bestGa4 = ga4[0] && ga4[0].score >= SUGGEST_THRESHOLD ? ga4[0] : null;
  const bestSc = searchConsole[0] && searchConsole[0].score >= SUGGEST_THRESHOLD ? searchConsole[0] : null;

  if (ga4.length === 0) notes.push('This Google account has no GA4 properties. Ask the site owner for Viewer access.');
  else if (!bestGa4) notes.push(`No GA4 property clearly tracks ${domain}. Pick one manually or ask for access.`);
  else if (ga4.filter((p) => p.score >= SUGGEST_THRESHOLD).length > 1) {
    notes.push('More than one GA4 property matches. Check that the suggested one is the main site.');
  }

  if (searchConsoleSites.length === 0) notes.push('This Google account has no verified Search Console sites.');
  else if (!bestSc) notes.push(`No Search Console site covers ${domain}. Verify the site in Search Console first.`);

  return {
    domain,
    ga4,
    searchConsole,
    suggested: {
      ga4PropertyId: bestGa4?.propertyId ?? null,
      searchConsoleSiteUrl: bestSc?.siteUrl ?? null,
    },
    notes,
  };
}
